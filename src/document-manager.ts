import { existsSync, mkdirSync } from "fs";
import { readFile, readdir } from "fs/promises";
import * as path from "path";
import { createHash } from 'crypto';
import type { Document, DocumentChunk, DocumentSummary, CodeBlock, EmbeddingProvider, QueryOptions, QueryResponse, DocumentDiscoveryResult, MetadataFilter, Reranker, RerankResult } from './types.js';
import { LangChainChunker } from './chunking/langchain-chunker.js';
import { extractText } from 'unpdf';
import { getDefaultDataDir, expandHomeDir, getLogger } from './utils.js';
import { extractMarkdownCodeBlocks } from './markdown-code-blocks.js';
import { normalizeLanguageTag } from './code-block-utils.js';
import { LanceDBV1 } from './vector-db/lance-db-v1.js';
import { detectLanguages, getAcceptedLanguages, getLanguageConfidenceThreshold, isLanguageAllowed, getDefaultQueryLanguages } from './language-detection.js';
import { ApiReranker } from './reranking/api-reranker.js';
import { getRerankingConfig, isRerankingEnabled } from './reranking/config.js';
import type { ChunkV1, CodeBlockV1, DocumentTagV1, DocumentV1 } from './types/database-v1.js';

const logger = getLogger('DocumentManager');
const SUPPORTED_UPLOAD_EXTENSIONS = ['.txt', '.md', '.pdf'] as const;

/**
 * Document manager that handles document operations with chunking, indexing, and embeddings
 */
export class DocumentManager {
    private dataDir: string;
    private uploadsDir: string;
    private embeddingProvider: EmbeddingProvider;
    private chunker: LangChainChunker;
    private vectorDatabase: LanceDBV1 | null = null;
    private vectorDbInitPromise: Promise<void> | null = null;
    private useIndexing: boolean;
    private useVectorDb: boolean;
    private useParallelProcessing: boolean;
    private useStreaming: boolean;
    private useTagGeneration: boolean;
    private useGeneratedTagsInQuery: boolean;
    private reranker: Reranker | null = null;
    private rerankingEnabled: boolean = false;

    constructor(embeddingProvider: EmbeddingProvider, vectorDatabase?: LanceDBV1) {
        // Always use default paths
        const baseDir = getDefaultDataDir();
        this.dataDir = path.join(baseDir, 'data');
        this.uploadsDir = path.join(baseDir, 'uploads');

        this.embeddingProvider = embeddingProvider;
        this.chunker = new LangChainChunker(this.embeddingProvider);

        // Feature flags with fallback
        this.useIndexing = process.env.MCP_INDEXING_ENABLED !== 'false';
        this.useVectorDb = true;
        this.useParallelProcessing = process.env.MCP_PARALLEL_ENABLED !== 'false';
        this.useStreaming = process.env.MCP_STREAMING_ENABLED !== 'false';
        this.useTagGeneration = process.env.MCP_TAG_GENERATION_ENABLED === 'true';
        this.useGeneratedTagsInQuery = process.env.MCP_GENERATED_TAGS_IN_QUERY === 'true';
        
        // Initialize reranker if enabled
        this.rerankingEnabled = isRerankingEnabled();
        if (this.rerankingEnabled) {
            try {
                const config = getRerankingConfig();
                this.reranker = new ApiReranker(config);
                logger.info(`Reranker initialized (${config.provider}, ${config.model})`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorStack = error instanceof Error ? error.stack : undefined;
                logger.error(`Reranker initialization failed: ${errorMessage}`);
                if (errorStack) {
                    logger.error(errorStack);
                }
                this.rerankingEnabled = false;
                this.reranker = null;
            }
        } else {
            logger.info('Reranking is disabled.');
        }

        this.ensureDataDir();
        this.ensureUploadsDir();
        if (!this.useIndexing) {
            logger.info('Keyword indexing disabled by config.');
        }

        // Initialize vector database with error handling
        // Note: We initialize asynchronously in the background to avoid blocking the constructor
        if (this.useVectorDb) {
            this.vectorDatabase = vectorDatabase || this.createVectorDatabase();
            // Initialize asynchronously without blocking constructor, but store the promise
            this.vectorDbInitPromise = this.initializeVectorDatabase().catch(error => {
                logger.error('Vector database initialization failed:', error);
                this.useVectorDb = false;
                this.vectorDatabase = null;
                this.vectorDbInitPromise = null;
            });
        } else {
            logger.warn('Vector DB disabled; vector features are unavailable.');
        }
    }

    /**
     * Create and initialize LanceDB vector database instance
     */
    private createVectorDatabase(): LanceDBV1 {
        const dbPathEnv = process.env.MCP_LANCE_DB_PATH;
        const defaultDataDir = getDefaultDataDir();
        const dbPath = dbPathEnv ? expandHomeDir(dbPathEnv) : path.join(defaultDataDir, 'lancedb');
        return new LanceDBV1(dbPath);
    }

    /**
     * Initialize vector database
     */
    private async initializeVectorDatabase(): Promise<void> {
        if (!this.vectorDatabase) {
            return;
        }

        try {
            await this.vectorDatabase.initialize();
        } catch (error) {
            logger.error('Failed to initialize vector database:', error);
            throw error;
        }
    }

    /**
     * Ensure vector database is initialized before use
     * This waits for async initialization to complete with a timeout
     */
    async ensureVectorDbReady(): Promise<boolean> {
        if (!this.useVectorDb) {
            return false;
        }
        
        if (!this.vectorDatabase) {
            return false;
        }

        // If there's an ongoing initialization, wait for it (with retry logic)
        if (this.vectorDbInitPromise) {
            const maxRetries = 3;
            const baseTimeoutMs = 30000; // 30 seconds base timeout
            
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const timeoutMs = baseTimeoutMs * Math.pow(2, attempt); // Exponential backoff: 30s, 60s, 120s
                    
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(new Error(`Vector DB initialization timeout (${timeoutMs}ms)`));
                        }, timeoutMs);
                    });

                    await Promise.race([this.vectorDbInitPromise, timeoutPromise]);
                    break; // Success, exit retry loop
                } catch (error) {
                    if (attempt === maxRetries - 1) {
                        // All retries exhausted
                        logger.error('Vector DB initialization failed after all retries:', error);
                        // Disable vector DB if initialization fails after all retries
                        this.useVectorDb = false;
                        this.vectorDatabase = null;
                        this.vectorDbInitPromise = null;
                        return false;
                    }
                    
                    // Wait before retry (exponential backoff)
                    const delayMs = Math.min(5000, 1000 * Math.pow(2, attempt));
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        }

        // Check if vector DB is actually initialized
        const isInitialized = (this.vectorDatabase as any).isInitialized?.() ?? true;
        
        if (!isInitialized) {
            return false;
        }

        return true;
    }

    private ensureDataDir(): void {
        if (!existsSync(this.dataDir)) {
            mkdirSync(this.dataDir, { recursive: true });
        }
    }

    private ensureUploadsDir(): void {
        if (!existsSync(this.uploadsDir)) {
            mkdirSync(this.uploadsDir, { recursive: true });
        }
    }

    // Getter methods for directory paths
    getDataDir(): string {
        return path.resolve(this.dataDir);
    }

    getUploadsDir(): string {
        return path.resolve(this.uploadsDir);
    }

    getUploadsPath(): string {
        return path.resolve(this.uploadsDir);
    }

    // Getter for embedding provider
    getEmbeddingProvider(): EmbeddingProvider {
        return this.embeddingProvider;
    }

    async addDocument(title: string, content: string, metadata: Record<string, any> = {}): Promise<Document | null> {
        try {
            const confidenceThreshold = getLanguageConfidenceThreshold();
            let detectedLanguages = await detectLanguages(content, confidenceThreshold);
            const acceptedLanguages = getAcceptedLanguages();
            const minLetterCount = 20;

            if (!isLanguageAllowed(detectedLanguages, acceptedLanguages)) {
                const letterCount = (content.match(/\p{L}/gu) ?? []).length;
                if (letterCount < minLetterCount) {
                    detectedLanguages = ['unknown'];
                }
            }

            if (!isLanguageAllowed(detectedLanguages, acceptedLanguages)) {
                logger.warn(`Document rejected: language '${detectedLanguages.join(', ')}' not in accepted languages list`);
                return null;
            }

            const vectorDbReady = await this.ensureVectorDbReady();
            if (!vectorDbReady || !this.vectorDatabase) {
                throw new Error('Vector database is not available. Ensure initialization succeeds.');
            }

            const contentHash = this.calculateContentHash(content);
            const existing = await this.vectorDatabase.getDocumentByContentHash(contentHash);
            if (existing) {
                logger.warn(`Duplicate content detected, existing document: ${existing.id}`);
            }

            const source = this.normalizeSource(metadata.source);
            const documentId = await this.vectorDatabase.addDocument({
                title,
                content,
                content_hash: contentHash,
                content_length: content.length,
                source,
                original_filename: this.normalizeNullable(metadata.originalFilename ?? metadata.original_filename),
                file_extension: this.normalizeNullable(metadata.fileExtension ?? metadata.file_extension),
                crawl_id: this.normalizeNullable(metadata.crawl_id),
                crawl_url: this.normalizeNullable(metadata.crawl_url ?? metadata.source_url),
                author: this.normalizeNullable(metadata.author),
                description: this.normalizeNullable(metadata.description),
                content_type: this.normalizeNullable(metadata.contentType ?? metadata.content_type),
                chunks_count: 0,
                code_blocks_count: 0,
                status: 'active',
            });

            try {
                const tags = this.normalizeTags(metadata.tags);
                const generatedTags = this.normalizeTags(metadata.tags_generated);
                await this.vectorDatabase.addDocumentTags(documentId, [
                    ...tags.map(tag => ({ tag, is_generated: false })),
                    ...generatedTags.map(tag => ({ tag, is_generated: true })),
                ]);

                await this.vectorDatabase.addDocumentLanguages(documentId, detectedLanguages);

                const chunkOptions = this.getChunkOptionsFromEnv();
                const chunks = await this.chunker.createChunks(documentId, content, chunkOptions);
                const chunkRows = this.toChunkRows(documentId, chunks);
                if (chunkRows.length > 0) {
                    await this.vectorDatabase.addChunks(chunkRows);
                }

                const codeBlocks = this.buildCodeBlocks(documentId, content, chunks, metadata);
                if (codeBlocks.length > 0) {
                    await this.addCodeBlocks(documentId, codeBlocks, {
                        source,
                        source_url: metadata.source_url,
                        crawl_id: metadata.crawl_id,
                        contentType: metadata.contentType || metadata.content_type,
                    });
                }

                if (this.useIndexing) {
                    await this.addKeywords(documentId, title, content);
                }

                await this.vectorDatabase.updateDocumentCounts(documentId, chunkRows.length, codeBlocks.length);

                if (this.useTagGeneration) {
                    this.generateTagsForDocument(documentId, title, content);
                }

                return await this.getDocument(documentId);
            } catch (error) {
                await this.vectorDatabase.deleteDocument(documentId);
                throw error;
            }
        } catch (error) {
            logger.error('Unhandled error in addDocument:', error);
            logger.error('Error details:', {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                name: error instanceof Error ? error.name : undefined
            });
            throw new Error(`Failed to add document: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async getDocument(id: string): Promise<Document | null> {
        const vectorDbReady = await this.ensureVectorDbReady();
        if (!vectorDbReady || !this.vectorDatabase) {
            return null;
        }

        const document = await this.vectorDatabase.getDocument(id);
        if (!document) {
            return null;
        }

        const [chunks, tags, languages] = await Promise.all([
            this.vectorDatabase.getChunksByDocument(id),
            this.vectorDatabase.getDocumentTagsDetailed(id),
            this.vectorDatabase.getDocumentLanguages(id),
        ]);

        const uniqueLanguages = Array.from(new Set(languages));

        return {
            id: document.id,
            title: document.title,
            content: document.content,
            metadata: this.buildDocumentMetadata(document, tags, languages),
            chunks: this.mapChunks(chunks),
            created_at: document.created_at,
            updated_at: document.updated_at,
        };
    }
    
    async getOnlyContentDocument(id: string): Promise<string | null> {
        const document = await this.getDocument(id);
        return document ? document.content : null;
    }

    async getAllDocuments(): Promise<Document[]> {
        const vectorDbReady = await this.ensureVectorDbReady();
        if (!vectorDbReady || !this.vectorDatabase) {
            return [];
        }

        const docs = await this.vectorDatabase.getAllDocuments();
        const documents: Document[] = [];

        for (const doc of docs) {
            const document = await this.getDocument(doc.id);
            if (document) {
                documents.push(document);
            }
        }

        return documents;
    }

    private async listDocumentIds(): Promise<string[]> {
        const vectorDbReady = await this.ensureVectorDbReady();
        if (!vectorDbReady || !this.vectorDatabase) {
            return [];
        }

        const documents = await this.vectorDatabase.getAllDocuments();
        return documents.map(doc => doc.id).sort();
    }

    async listDocumentSummaries(options: {
        offset?: number;
        limit?: number;
        includeMetadata?: boolean;
        includePreview?: boolean;
        previewLength?: number;
    } = {}): Promise<{ total: number; documents: DocumentSummary[] }> {
        const offset = Math.max(0, options.offset ?? 0);
        const limit = Math.max(0, options.limit ?? 50);
        const includeMetadata = options.includeMetadata ?? false;
        const includePreview = options.includePreview ?? false;
        const previewLength = Math.max(0, options.previewLength ?? 200);

        const vectorDbReady = await this.ensureVectorDbReady();
        if (!vectorDbReady || !this.vectorDatabase) {
            return { total: 0, documents: [] };
        }

        const allDocuments = await this.vectorDatabase.getAllDocuments();
        const total = allDocuments.length;
        const slice = allDocuments
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .slice(offset, offset + limit);

        const documents: DocumentSummary[] = [];

        for (const doc of slice) {
            const summary: DocumentSummary = {
                id: doc.id,
                title: doc.title,
                created_at: doc.created_at,
                updated_at: doc.updated_at,
                content_length: doc.content_length,
                chunks_count: doc.chunks_count,
            };

            if (includeMetadata) {
                const [tags, languages] = await Promise.all([
                    this.vectorDatabase.getDocumentTagsDetailed(doc.id),
                    this.vectorDatabase.getDocumentLanguages(doc.id),
                ]);
                summary.metadata = this.buildDocumentMetadata(doc, tags, languages);
            }

            if (includePreview && previewLength > 0) {
                const preview = doc.content.substring(0, previewLength);
                summary.content_preview = doc.content.length > previewLength ? `${preview}...` : preview;
            }

            documents.push(summary);
        }

        return { total, documents };
    }

    private getSimilarityThreshold(): number {
        const raw = process.env.MCP_SIMILARITY_THRESHOLD;
        const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
        return Number.isFinite(parsed) ? parsed : 0.0;
    }

    private calculateContentHash(content: string): string {
        return createHash('sha256')
            .update(content.trim())
            .digest('hex')
            .substring(0, 16);
    }

    /**
     * Generate tags for a document using AI provider
     * Runs non-blocking in the background
     */
    private async generateTagsForDocument(documentId: string, title: string, content: string): Promise<void> {
        if (!this.useTagGeneration) {
            return;
        }

        // Run tag generation in background without blocking
        setImmediate(async () => {
            try {
                const tags = await this.generateTags(title, content);
                
                if (tags.length > 0) {
                    const vectorDbReady = await this.ensureVectorDbReady();
                    if (!vectorDbReady || !this.vectorDatabase) {
                        logger.warn('Vector DB not ready, skipping generated tags');
                        return;
                    }

                    const normalizedTags = this.normalizeTags(tags);
                    await this.vectorDatabase.addDocumentTags(
                        documentId,
                        normalizedTags.map(tag => ({ tag, is_generated: true }))
                    );
                }
            } catch (error) {
                logger.error(`Failed to generate tags for document ${documentId}:`, error);
            }
        });
    }

    /**
     * Generate tags using configured AI provider
     */
    private async generateTags(title: string, content: string): Promise<string[]> {
        // Truncate content if too long (keep first 2000 chars for context)
        const truncatedContent = content.length > 2000 ? content.substring(0, 2000) + '...' : content;
        
        const system = 'You are an expert document tagger. Generate relevant tags for the given document. Return only a JSON array of tag strings. Tags should be concise, descriptive, and relevant to the document content. Do not include markdown or extra text.';
        const user = `Document title: ${title}\n\nDocument content:\n${truncatedContent}\n\nGenerate 5-10 relevant tags for this document.`;

        // Check for OpenAI-compatible provider
        const baseUrl = process.env.MCP_AI_BASE_URL;
        let model = process.env.MCP_AI_MODEL;
        const apiKey = process.env.MCP_AI_API_KEY;

        if (baseUrl) {
            // Provide default model based on base URL if not specified
            if (!model) {
                if (baseUrl.includes('synthetic.new')) {
                    model = 'hf:zai-org/glm-4.7';
                } else {
                    model = 'ministral-3-8b-instruct-2512';
                }
            }
            
            try {
                const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
                const v1BaseUrl = normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
                
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                };
                
                if (apiKey) {
                    headers.Authorization = `Bearer ${apiKey}`;
                }
                
                const response = await fetch(`${v1BaseUrl}/chat/completions`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        model,
                        temperature: 0.3,
                        messages: [
                            { role: 'system', content: system },
                            { role: 'user', content: user }
                        ]
                    })
                });
                
                const payloadText = await response.text();
                
                if (!response.ok) {
                    throw new Error(`OpenAI request failed (${response.status}): ${payloadText}`);
                }
                
                const payload = JSON.parse(payloadText);
                const responseText = payload?.choices?.[0]?.message?.content || '';
                
                const tags = this.parseTagsFromResponse(responseText);
                
                if (tags.length === 0) {
                    logger.warn('Tag generation returned empty array.');
                }
                
                return tags;
            } catch (error) {
                logger.error('Failed to generate tags with OpenAI provider:', error);
                logger.warn('Tag generation returned empty array due to error.');
                return [];
            }
        }

        logger.warn('AI provider not configured. MCP_AI_BASE_URL must be set to enable tag generation.');
        return [];
    }

    /**
     * Parse tags from AI response
     */
    private parseTagsFromResponse(response: string): string[] {
        // Try to parse as JSON array
        try {
            const parsed = JSON.parse(response);
            if (Array.isArray(parsed)) {
                return parsed
                    .filter(tag => typeof tag === 'string' && tag.trim().length > 0)
                    .map(tag => tag.trim());
            }
        } catch {
            // Not valid JSON, try to extract array from text
        }
        
        // Try to extract array from text using regex
        const arrayMatch = response.match(/\[([^\]]+)\]/);
        if (arrayMatch) {
            try {
                const tags = JSON.parse(arrayMatch[0]);
                if (Array.isArray(tags)) {
                    return tags
                        .filter(tag => typeof tag === 'string' && tag.trim().length > 0)
                        .map(tag => tag.trim());
                }
            } catch {
                // Fall through to line-based parsing
            }
        }
        
        // Fall back to line-based parsing (comma or newline separated)
        const lines = response
            .replace(/["'`]/g, '')
            .split(/[,\n]/)
            .map(line => line.trim())
            .filter(line => line.length > 0 && line.length < 50);
        
        return lines;
    }
    
    /**
     * Extract text content from a PDF file with streaming support for large files
     * @param filePath Path to the PDF file
     * @returns Extracted text content
     */
    private async extractTextFromPdf(filePath: string): Promise<string> {
        try {
            const stats = await import('fs/promises').then(fs => fs.stat(filePath));
            const fileSizeLimit = parseInt(process.env.MCP_STREAM_FILE_SIZE_LIMIT || '10485760'); // 10MB
            
            let dataBuffer: Buffer;
            
            if (this.useStreaming && stats.size > fileSizeLimit) {
                dataBuffer = await this.readFileStreaming(filePath);
            } else {
                dataBuffer = await readFile(filePath);
            }
            
            // Convert Buffer to Uint8Array as required by unpdf
            const uint8Array = new Uint8Array(dataBuffer);
            const result = await extractText(uint8Array);
            
            // unpdf returns { totalPages: number, text: string[] }
            const text = result.text.join('\n');
            
            if (!text || text.trim().length === 0) {
                throw new Error('No text found in PDF or PDF might be image-based');
            }
            
            return text;
        } catch (error) {
            throw new Error(`Failed to extract text from PDF: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Read file using streaming for large files
     */
    private async readFileStreaming(filePath: string): Promise<Buffer> {
        const fs = await import('fs');
        const chunkSize = parseInt(process.env.MCP_STREAM_CHUNK_SIZE || '65536'); // 64KB chunks
        
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            const readStream = fs.createReadStream(filePath, { highWaterMark: chunkSize });
            
            readStream.on('data', (chunk) => {
                chunks.push(chunk as Buffer);
            });
            
            readStream.on('end', () => {
                resolve(Buffer.concat(chunks));
            });
            
            readStream.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Read text file with streaming support for large files
     */
    private async readTextFile(filePath: string): Promise<string> {
        try {
            const stats = await import('fs/promises').then(fs => fs.stat(filePath));
            const fileSizeLimit = parseInt(process.env.MCP_STREAM_FILE_SIZE_LIMIT || '10485760'); // 10MB
            
            if (this.useStreaming && stats.size > fileSizeLimit) {
                const buffer = await this.readFileStreaming(filePath);
                return buffer.toString('utf-8');
            } else {
                return await readFile(filePath, 'utf-8');
            }
        } catch (error) {
            throw new Error(`Failed to read text file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async collectUploadFiles(): Promise<string[]> {
        const { readdir, stat, realpath } = await import('fs/promises');
        const files: string[] = [];
        const visitedDirs = new Set<string>();
        const MAX_DEPTH = 10;

        const findFilesRecursive = async (dir: string, depth: number = 0) => {
            if (depth > MAX_DEPTH) {
                logger.warn(`Reached maximum depth (${MAX_DEPTH}), skipping: ${dir}`);
                return;
            }

            const realPath = await realpath(dir).catch(() => dir);
            if (visitedDirs.has(realPath)) {
                logger.warn(`Skipping already visited directory (cycle detected): ${realPath}`);
                return;
            }
            visitedDirs.add(realPath);

            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isSymbolicLink()) {
                    const stats = await stat(fullPath).catch(() => null);
                    if (stats) {
                        if (stats.isDirectory()) {
                            await findFilesRecursive(fullPath, depth + 1);
                        } else if (stats.isFile()) {
                            files.push(fullPath);
                        }
                    }
                } else if (entry.isDirectory()) {
                    await findFilesRecursive(fullPath, depth + 1);
                } else if (entry.isFile()) {
                    files.push(fullPath);
                }
            }
        };

        await findFilesRecursive(this.uploadsDir);
        return files;
    }

    private async readUploadContent(filePath: string, fileExtension: string): Promise<string> {
        if (fileExtension === '.pdf') {
            return this.extractTextFromPdf(filePath);
        }
        return this.readTextFile(filePath);
    }

    async processUploadsFolder(): Promise<{ processed: number; errors: string[] }> {
        const errors: string[] = [];
        let processed = 0;

        try {
            const files = await this.collectUploadFiles();
            for (const filePath of files) {
                try {
                    const fileName = path.basename(filePath);
                    const fileExtension = path.extname(fileName).toLowerCase();

                    if (!SUPPORTED_UPLOAD_EXTENSIONS.includes(fileExtension as typeof SUPPORTED_UPLOAD_EXTENSIONS[number])) {
                        continue;
                    }

                    const content = await this.readUploadContent(filePath, fileExtension);

                    if (!content.trim()) {
                        errors.push(`File ${fileName} is empty or contains no extractable text`);
                        continue;
                    }

                    // Create document title from filename (without extension)
                    const title = path.basename(fileName, fileExtension);

                    // Check if document with this filename already exists and remove it
                    const existingDoc = await this.findDocumentByTitle(title);
                    if (existingDoc) {
                        await this.deleteDocument(existingDoc.id);
                    }

                    // Create new document with embeddings
                    const document = await this.addDocument(title, content, {
                        source: 'upload',
                        originalFilename: fileName,
                        fileExtension,
                        processedAt: new Date().toISOString()
                    });

                    // Skip if document was rejected (e.g., language not allowed)
                    if (!document) {
                        errors.push(`File ${fileName} was rejected (possibly due to language restrictions)`);
                        continue;
                    }

                    processed++;
                } catch (error) {
                    errors.push(`Error processing ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            return { processed, errors };
        } catch (error) {
            throw new Error(`Failed to process uploads folder: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async processUploadFile(filePath: string, metadata: Record<string, unknown> = {}): Promise<Document | null> {
        const uploadsPath = this.getUploadsPath();
        const resolvedPath = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(uploadsPath, filePath);

        if (!resolvedPath.startsWith(uploadsPath)) {
            throw new Error('Upload path must be within the uploads directory');
        }

        const fileName = path.basename(resolvedPath);
        const fileExtension = path.extname(fileName).toLowerCase();

        if (!SUPPORTED_UPLOAD_EXTENSIONS.includes(fileExtension as typeof SUPPORTED_UPLOAD_EXTENSIONS[number])) {
            throw new Error(`Unsupported upload file type: ${fileExtension}`);
        }

        const content = await this.readUploadContent(resolvedPath, fileExtension);

        if (!content.trim()) {
            throw new Error(`File ${fileName} is empty or contains no extractable text`);
        }

        const title = typeof metadata.title === 'string'
            ? metadata.title
            : path.basename(fileName, fileExtension);

        const existingDoc = await this.findDocumentByTitle(title);
        if (existingDoc) {
            await this.deleteDocument(existingDoc.id);
        }

        const baseMetadata: Record<string, unknown> = {
            source: 'upload',
            originalFilename: fileName,
            fileExtension,
            processedAt: new Date().toISOString(),
        };

        return this.addDocument(title, content, { ...baseMetadata, ...metadata });
    }

    private async findDocumentByTitle(title: string): Promise<Document | null> {
        const documents = await this.getAllDocuments();
        return documents.find(doc => doc.title === title) || null;
    }

    async listUploadsFiles(): Promise<{ name: string; size: number; modified: string; supported: boolean }[]> {
        const files: { name: string; size: number; modified: string; supported: boolean }[] = [];

        try {
            const { stat } = await import('fs/promises');
            const filePaths = await this.collectUploadFiles();

            for (const filePath of filePaths) {
                const stats = await stat(filePath);
                if (stats.isFile()) {
                    const fileName = path.basename(filePath);
                    const fileExtension = path.extname(fileName).toLowerCase();
                    
                    files.push({
                        name: fileName,
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        supported: SUPPORTED_UPLOAD_EXTENSIONS.includes(fileExtension as typeof SUPPORTED_UPLOAD_EXTENSIONS[number])
                    });
                }
            }

            return files.sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            throw new Error(`Failed to list uploads files: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async deleteDocument(documentId: string): Promise<boolean> {
        try {
            const vectorDbReady = await this.ensureVectorDbReady();
            if (!vectorDbReady || !this.vectorDatabase) {
                return false;
            }

            const existing = await this.vectorDatabase.getDocument(documentId);
            if (!existing) {
                return false;
            }

            await this.vectorDatabase.deleteDocument(documentId);
            return true;
        } catch (error) {
            throw new Error(`Failed to delete document: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async deleteCrawlSession(crawlId: string): Promise<{ deleted: number; errors: string[] }> {
        const documents = await this.getAllDocuments();
        const toDelete = documents.filter(doc => doc.metadata?.crawl_id === crawlId);
        const errors: string[] = [];
        let deleted = 0;

        for (const document of toDelete) {
            try {
                const success = await this.deleteDocument(document.id);
                if (success) {
                    deleted += 1;
                }
            } catch (error) {
                errors.push(`${document.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        return { deleted, errors };
    }

    /**
     * Query documents with vector-first ranking and keyword fallback
     * Returns ranked document summaries without full content
     * @param queryText - The search query text
     * @param options - Query options including pagination and filters
     * @returns QueryResponse with ranked document results and pagination metadata
     */
    async query(queryText: string, options: QueryOptions = {}): Promise<QueryResponse> {
        const limit = options.limit ?? 10;
        const offset = options.offset ?? 0;
        const includeMetadata = options.include_metadata ?? true;
        const filters = options.filters ?? {};
        const useReranking = options.useReranking ?? this.rerankingEnabled;

        // Apply default language filters if not specified
        if (!filters.languages) {
            const defaultLanguages = getDefaultQueryLanguages();
            if (defaultLanguages) {
                filters.languages = defaultLanguages;
            }
        }

        // Stage 1: Vector search with candidate retrieval (5x for reranking pool)
        let candidates: DocumentDiscoveryResult[] = [];
        
        // Fetch a large number of candidates to ensure we get chunks from all relevant documents
        // This is necessary because:
        // 1. Multiple chunks can belong to the same document
        // 2. We need to paginate at the document level, not chunk level
        // 3. Metadata filters may eliminate some documents after retrieval
        const candidateLimit = useReranking ? (limit + offset) * 5 : 1000;
        
        if (this.useVectorDb && this.vectorDatabase) {
            const vectorDbReady = await this.ensureVectorDbReady();
            
            if (vectorDbReady) {
                try {
                    const queryEmbedding = await this.embeddingProvider.generateEmbedding(queryText);

                    const vectorResults = await this.vectorDatabase.search(
                        queryEmbedding,
                        candidateLimit
                    );
                    
                    // Group by document ID and aggregate scores
                    const docScoreMap = new Map<string, { score: number; chunks: number }>();
                    
                    for (const result of vectorResults) {
                        const docId = result.chunk.document_id;
                        const existing = docScoreMap.get(docId) || { score: 0, chunks: 0 };
                        docScoreMap.set(docId, {
                            score: existing.score + result.score,
                            chunks: existing.chunks + 1
                        });
                    }
                    
                    // Convert to results with average scores
                    const similarityThreshold = this.getSimilarityThreshold();
                    
                    candidates = Array.from(docScoreMap.entries())
                        .filter(([_, data]) => (data.score / data.chunks) >= similarityThreshold)
                        .map(([docId, data]) => ({
                            id: docId,
                            title: '',
                            score: data.score / data.chunks,
                            updated_at: '',
                            chunks_count: data.chunks
                        }))
                        .sort((a, b) => b.score - a.score);
                } catch (error) {
                    logger.warn('Vector search failed, falling back to keyword search:', error);
                }
            } else {
                logger.warn('Vector DB not ready, skipping vector search');
            }
        } else {
            logger.warn('Vector DB not enabled, skipping vector search');
        }
        
        // Fall back to keyword search if vector search returned insufficient results
        const minVectorResults = Math.max(1, Math.floor(limit / 2));
        if (candidates.length < minVectorResults && this.useIndexing && this.vectorDatabase) {
            const keywordResults = await this.keywordSearchFallback(queryText, candidates);
            candidates = [...candidates, ...keywordResults];
        }
        
        // Stage 2: Rerank if enabled
        let results: DocumentDiscoveryResult[] = candidates;
        if (useReranking && this.reranker && candidates.length > 0) {
            try {
                // Fetch document contents for reranking
                const documentContents: string[] = [];
                for (const candidate of candidates) {
                    const document = await this.getDocument(candidate.id);
                    if (document) {
                        documentContents.push(document.content);
                    }
                }
                
                // Perform reranking
                const reranked = await this.reranker.rerank(queryText, documentContents, {
                    topK: limit + offset
                });

                // Map reranked indices to results
                results = this.mapRerankedResults(reranked, candidates);
            } catch (error) {
                logger.warn('Reranking failed, using vector-only results:', error);
                // Fallback to vector-only results if reranking fails
                results = candidates;
            }
        }
        
        // Fetch document details for all results
        const finalResults: DocumentDiscoveryResult[] = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const document = await this.getDocument(result.id);
            if (document) {
                if (!this.matchesFilters(document.metadata, filters)) {
                    continue;
                }
                finalResults.push({
                    id: document.id,
                    title: document.title,
                    score: result.score,
                    updated_at: document.updated_at,
                    chunks_count: document.chunks.length,
                    metadata: includeMetadata ? document.metadata : undefined
                });
            }
        }

        // Fallback: if filters are present but no results matched, scan documents by metadata + text match.
        if (finalResults.length === 0 && Object.keys(filters).length > 0) {
            const queryLower = queryText.trim().toLowerCase();
            const documents = await this.getAllDocuments();

            for (const document of documents) {
                if (!this.matchesFilters(document.metadata, filters)) {
                    continue;
                }

                if (queryLower.length > 0) {
                    const title = document.title?.toLowerCase() ?? '';
                    const content = document.content?.toLowerCase() ?? '';
                    if (!title.includes(queryLower) && !content.includes(queryLower)) {
                        continue;
                    }
                }

                finalResults.push({
                    id: document.id,
                    title: document.title,
                    score: 1,
                    updated_at: document.updated_at,
                    chunks_count: document.chunks.length,
                    metadata: includeMetadata ? document.metadata : undefined
                });
            }
        }
        
        // Apply pagination
        const paginatedResults = finalResults.slice(offset, offset + limit);
        
        return {
            results: paginatedResults,
            pagination: {
                total_documents: finalResults.length,
                returned: paginatedResults.length,
                has_more: offset + limit < finalResults.length,
                next_offset: offset + limit < finalResults.length ? offset + limit : null
            }
        };
    }

    /**
     * Map reranked indices to original results
     * @param reranked - Reranking results with indices and scores
     * @param candidates - Original candidate results
     * @returns Reordered results based on reranking
     */
    private mapRerankedResults(reranked: RerankResult[], candidates: DocumentDiscoveryResult[]): DocumentDiscoveryResult[] {
        const result: DocumentDiscoveryResult[] = [];
        
        for (const rerankResult of reranked) {
            const candidate = candidates[rerankResult.index];
            if (candidate) {
                result.push({
                    ...candidate,
                    score: rerankResult.score
                });
            }
        }
        
        return result;
    }

    private matchesFilters(metadata: Record<string, any> | undefined, filters: MetadataFilter): boolean {
        if (!filters || Object.keys(filters).length === 0) {
            return true;
        }

        const docMetadata = metadata || {};

        if (filters.tags && filters.tags.length > 0) {
            const tags = new Set<string>();
            const rawTags = docMetadata.tags;
            const rawGeneratedTags = docMetadata.tags_generated;

            if (Array.isArray(rawTags)) {
                rawTags.forEach(tag => tags.add(String(tag)));
            } else if (typeof rawTags === 'string') {
                tags.add(rawTags);
            }

            if (this.useGeneratedTagsInQuery) {
                if (Array.isArray(rawGeneratedTags)) {
                    rawGeneratedTags.forEach(tag => tags.add(String(tag)));
                } else if (typeof rawGeneratedTags === 'string') {
                    tags.add(rawGeneratedTags);
                }
            }

            const hasAllTags = filters.tags.every(tag => tags.has(tag));
            if (!hasAllTags) {
                return false;
            }
        }

        if (filters.source && docMetadata.source !== filters.source) {
            return false;
        }

        if (filters.crawl_id && docMetadata.crawl_id !== filters.crawl_id) {
            return false;
        }

        if (filters.author && docMetadata.author !== filters.author) {
            return false;
        }

        if (filters.contentType) {
            const contentType = docMetadata.contentType || docMetadata.content_type;
            if (contentType !== filters.contentType) {
                return false;
            }
        }

        // Language filter
        if (filters.languages && filters.languages.length > 0) {
            const docLanguages = docMetadata.languages;
            if (!docLanguages || docLanguages.length === 0) {
                // Document has no language metadata, only match if 'unknown' is in filter
                if (!filters.languages.includes('unknown')) {
                    return false;
                }
            } else {
                // Check if any document language matches the filter
                const hasMatchingLanguage = filters.languages.some(lang =>
                    docLanguages.includes(lang) ||
                    (lang === 'unknown' && docLanguages.includes('unknown'))
                );
                if (!hasMatchingLanguage) {
                    return false;
                }
            }
        }

        return true;
    }

    private normalizeSource(source: unknown): 'upload' | 'crawl' | 'api' {
        if (typeof source === 'string') {
            const normalized = source.toLowerCase().trim();
            if (normalized === 'upload' || normalized === 'crawl' || normalized === 'api') {
                return normalized;
            }
        }
        return 'api';
    }

    private normalizeNullable(value: unknown): string | null {
        if (typeof value !== 'string') {
            return null;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    private normalizeTags(value: unknown): string[] {
        if (!value) {
            return [];
        }

        const rawTags = Array.isArray(value)
            ? value
            : typeof value === 'string'
                ? value.split(',')
                : [];

        const normalized = rawTags
            .map(tag => String(tag).trim().toLowerCase())
            .filter(tag => tag.length > 0);

        return Array.from(new Set(normalized));
    }

    private getChunkOptionsFromEnv(): { maxSize?: number; overlap?: number } {
        const envChunkSize = parseInt(process.env.MCP_CHUNK_SIZE || '-1');
        const envChunkOverlap = parseInt(process.env.MCP_CHUNK_OVERLAP || '-1');

        const chunkOptions: { maxSize?: number; overlap?: number } = {};
        if (envChunkSize > 0) {
            chunkOptions.maxSize = envChunkSize;
        }
        if (envChunkOverlap > 0) {
            chunkOptions.overlap = envChunkOverlap;
        }

        return chunkOptions;
    }

    private toChunkRows(documentId: string, chunks: DocumentChunk[]): Omit<ChunkV1, 'id' | 'created_at'>[] {
        return chunks
            .map((chunk) => {
                const embedding = chunk.embeddings ?? [];
                if (!embedding.length) {
                    return null;
                }

                return {
                    document_id: documentId,
                    chunk_index: chunk.chunk_index,
                    start_position: chunk.start_position,
                    end_position: chunk.end_position,
                    content: chunk.content,
                    content_length: chunk.content.length,
                    embedding,
                    surrounding_context: chunk.metadata?.surrounding_context ?? null,
                    semantic_topic: chunk.metadata?.semantic_topic ?? null,
                } satisfies Omit<ChunkV1, 'id' | 'created_at'>;
            })
            .filter((row): row is Omit<ChunkV1, 'id' | 'created_at'> => row !== null);
    }

    private mapChunks(chunks: ChunkV1[]): DocumentChunk[] {
        return [...chunks]
            .sort((a, b) => a.chunk_index - b.chunk_index)
            .map((chunk) => ({
                id: chunk.id,
                document_id: chunk.document_id,
                chunk_index: chunk.chunk_index,
                content: chunk.content,
                embeddings: chunk.embedding,
                start_position: chunk.start_position,
                end_position: chunk.end_position,
                metadata: {
                    surrounding_context: chunk.surrounding_context ?? undefined,
                    semantic_topic: chunk.semantic_topic ?? undefined,
                },
            }));
    }

    private buildDocumentMetadata(
        document: DocumentV1,
        tags: DocumentTagV1[],
        languages: string[]
    ): Record<string, any> {
        const manualTags = Array.from(new Set(tags.filter(tag => !tag.is_generated).map(tag => tag.tag)));
        const generatedTags = Array.from(new Set(tags.filter(tag => tag.is_generated).map(tag => tag.tag)));
        const uniqueLanguages = Array.from(new Set(languages));

        return {
            source: document.source,
            originalFilename: document.original_filename,
            fileExtension: document.file_extension,
            crawl_id: document.crawl_id,
            crawl_url: document.crawl_url,
            author: document.author,
            description: document.description,
            content_type: document.content_type,
            contentType: document.content_type,
            tags: manualTags,
            tags_generated: generatedTags,
            languages: uniqueLanguages,
            created_at: document.created_at,
            updated_at: document.updated_at,
            processed_at: document.processed_at,
            chunks_count: document.chunks_count,
            code_blocks_count: document.code_blocks_count,
        };
    }

    private resolveCodeLanguage(metadata: Record<string, any>): string | null {
        const explicitLanguage = this.normalizeNullable(
            metadata.programming_language ?? metadata.language ?? metadata.lang
        );
        if (explicitLanguage) {
            const normalized = normalizeLanguageTag(explicitLanguage);
            return normalized === 'unknown' ? null : normalized;
        }

        const extension = this.normalizeNullable(metadata.fileExtension ?? metadata.file_extension)
            ?? this.normalizeNullable(metadata.originalFilename ?? metadata.original_filename)
                ?.split('.')
                .slice(-1)[0];

        if (extension) {
            const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
            const map: Record<string, string> = {
                '.ts': 'typescript',
                '.tsx': 'typescript',
                '.js': 'javascript',
                '.jsx': 'javascript',
                '.mjs': 'javascript',
                '.cjs': 'javascript',
                '.py': 'python',
                '.rb': 'ruby',
                '.java': 'java',
                '.go': 'go',
                '.rs': 'rust',
                '.cpp': 'cpp',
                '.cxx': 'cpp',
                '.cc': 'cpp',
                '.c': 'c',
                '.cs': 'csharp',
                '.kt': 'kotlin',
                '.swift': 'swift',
                '.scala': 'scala',
                '.php': 'php',
                '.sql': 'sql',
                '.json': 'json',
                '.yml': 'yaml',
                '.yaml': 'yaml',
                '.toml': 'toml',
                '.sh': 'shell',
                '.bash': 'shell',
                '.zsh': 'shell',
                '.ps1': 'powershell',
                '.md': 'markdown',
                '.html': 'html',
                '.css': 'css',
            };

            const resolved = map[ext];
            if (!resolved) {
                return null;
            }
            const normalized = normalizeLanguageTag(resolved);
            return normalized === 'unknown' ? null : normalized;
        }

        return null;
    }

    private buildCodeBlocks(
        documentId: string,
        content: string,
        chunks: DocumentChunk[],
        metadata: Record<string, any>
    ): CodeBlock[] {
        const markdownBlocks = extractMarkdownCodeBlocks(content);
        if (markdownBlocks.length > 0) {
            return markdownBlocks.map((block, index) => ({
                ...block,
                id: block.id ?? `${documentId}-block-${index}`,
                block_id: block.block_id ?? `block-${index}`,
                document_id: documentId,
                block_index: index,
            }));
        }

        const codeLanguage = this.resolveCodeLanguage(metadata);
        if (!codeLanguage) {
            return [];
        }

        return chunks.map((chunk, index) => ({
            id: `${documentId}-code-${index}`,
            document_id: documentId,
            block_id: `chunk-${index}`,
            block_index: index,
            language: codeLanguage,
            content: chunk.content,
            source_url: metadata.source_url,
        }));
    }

    private async addKeywords(documentId: string, title: string, content: string): Promise<void> {
        if (!this.vectorDatabase) {
            return;
        }

        const titleKeywords = this.extractKeywords(title);
        const contentKeywords = this.extractKeywords(content);

        const rows = [
            ...this.buildKeywordRows(titleKeywords, 'title'),
            ...this.buildKeywordRows(contentKeywords, 'content'),
        ];

        if (rows.length === 0) {
            return;
        }

        await this.vectorDatabase.addKeywords(documentId, rows);
    }

    private buildKeywordRows(
        keywords: string[],
        source: 'title' | 'content'
    ): Array<{ keyword: string; source: 'title' | 'content'; frequency: number }> {
        const counts = new Map<string, number>();
        for (const keyword of keywords) {
            counts.set(keyword, (counts.get(keyword) || 0) + 1);
        }

        return Array.from(counts.entries()).map(([keyword, frequency]) => ({
            keyword,
            source,
            frequency,
        }));
    }

    private extractKeywords(content: string): string[] {
        const words = content
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && word.length < 20)
            .filter(word => !this.isStopWord(word));

        return words;
    }

    private isStopWord(word: string): boolean {
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
            'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does',
            'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that',
            'these', 'those', 'from', 'up', 'down', 'out', 'off', 'over', 'under', 'again',
            'further', 'then', 'once'
        ]);
        return stopWords.has(word);
    }

    private async keywordSearchFallback(
        queryText: string,
        existing: DocumentDiscoveryResult[]
    ): Promise<DocumentDiscoveryResult[]> {
        const vectorDbReady = await this.ensureVectorDbReady();
        if (!vectorDbReady || !this.vectorDatabase) {
            return [];
        }

        const keywords = this.extractKeywords(queryText);
        if (keywords.length === 0) {
            return [];
        }

        const results = await this.vectorDatabase.queryByKeywords(keywords);
        if (results.length === 0) {
            return [];
        }

        const existingIds = new Set(existing.map(result => result.id));
        const maxScore = Math.max(...results.map(result => result.score), 1);
        const keywordResults: DocumentDiscoveryResult[] = [];

        for (const result of results) {
            if (existingIds.has(result.document_id)) {
                continue;
            }

            const document = await this.vectorDatabase.getDocument(result.document_id);
            if (!document) {
                continue;
            }

            keywordResults.push({
                id: document.id,
                title: document.title,
                score: result.score / maxScore,
                updated_at: document.updated_at,
                chunks_count: document.chunks_count,
            });
        }

        return keywordResults;
    }

    /**
     * Add code blocks to the vector database for a document
     * Now uses batch embedding API for improved performance
     * @param documentId - The document ID to associate code blocks with
     * @param codeBlocks - Array of code blocks to add
     * @param metadata - Additional metadata to attach to code blocks
     */
    async addCodeBlocks(documentId: string, codeBlocks: CodeBlock[], metadata: Record<string, any> = {}): Promise<void> {
        if (!this.useVectorDb || !this.vectorDatabase) {
            logger.warn('Vector DB not enabled, skipping code block storage');
            return;
        }

        try {
            const vectorDbReady = await this.ensureVectorDbReady();
            if (!vectorDbReady) {
                logger.warn('Vector DB not ready, skipping code block storage');
                return;
            }

            // Generate embeddings in batch for better performance
            let embeddings: number[][] = [];
            const codeBlockContents = codeBlocks.map(cb => cb.content);

            try {
                // Use batch API if available
                if (this.embeddingProvider.generateEmbeddings) {
                    embeddings = await this.embeddingProvider.generateEmbeddings(codeBlockContents);
                } else {
                    // Fallback to individual requests
                    for (const content of codeBlockContents) {
                        const embedding = await this.embeddingProvider.generateEmbedding(content);
                        embeddings.push(embedding);
                    }
                }
            } catch (error) {
                logger.warn('Failed to generate embeddings in batch for code blocks, falling back to sequential:', error);
                // Fallback: process individually and skip failed ones
                embeddings = [];
                for (const content of codeBlockContents) {
                    try {
                        const embedding = await this.embeddingProvider.generateEmbedding(content);
                        embeddings.push(embedding);
                    } catch (individualError) {
                        logger.warn('Failed to generate embedding for code block, skipping:', individualError);
                        embeddings.push([]); // Push empty embedding as placeholder
                    }
                }
            }

            const codeBlocksWithEmbeddings: Array<{ block: CodeBlock; embedding: number[] }> = [];
            let skippedBlocks = 0;
            for (let i = 0; i < codeBlocks.length; i++) {
                const codeBlock = codeBlocks[i];
                const embedding = embeddings[i];

                // Skip code blocks without embeddings
                if (!embedding || embedding.length === 0) {
                    skippedBlocks += 1;
                    continue;
                }

                codeBlocksWithEmbeddings.push({ block: codeBlock, embedding });
            }
            if (skippedBlocks > 0) {
                logger.warn(`Skipped ${skippedBlocks} code blocks without embeddings`);
            }

            if (codeBlocksWithEmbeddings.length > 0) {
                const rows: Omit<CodeBlockV1, 'id' | 'created_at'>[] = codeBlocksWithEmbeddings.map(({ block, embedding }) => ({
                    document_id: documentId,
                    block_id: block.block_id,
                    block_index: block.block_index,
                    language: block.language,
                    content: block.content,
                    content_length: block.content.length,
                    embedding,
                    source_url: block.source_url ?? metadata.source_url ?? null,
                }));

                await this.vectorDatabase.addCodeBlocks(rows);
            } else {
                logger.warn('No code blocks with embeddings to add');
            }
        } catch (error) {
            logger.error('Failed to add code blocks:', error);
            // Continue without code blocks - non-critical error
        }
    }

    /**
     * Get performance and cache statistics
     */
    getStats(): {
        features: {
            indexing: boolean;
            vectorDb: boolean;
            parallelProcessing: boolean;
            streaming: boolean;
            tagGeneration: boolean;
            generatedTagsInQuery: boolean;
        };
        vectorDatabase?: {
            type: 'lance';
            path: string;
        };
        embedding_cache?: unknown;
    } {
        const stats: {
            features: {
                indexing: boolean;
                vectorDb: boolean;
                parallelProcessing: boolean;
                streaming: boolean;
                tagGeneration: boolean;
                generatedTagsInQuery: boolean;
            };
            vectorDatabase?: {
                type: 'lance';
                path: string;
            };
            embedding_cache?: unknown;
        } = {
            features: {
                indexing: this.useIndexing,
                vectorDb: this.useVectorDb,
                parallelProcessing: this.useParallelProcessing,
                streaming: this.useStreaming,
                tagGeneration: this.useTagGeneration,
                generatedTagsInQuery: this.useGeneratedTagsInQuery
            }
        };

        if (this.useVectorDb && this.vectorDatabase) {
            stats.vectorDatabase = {
                type: 'lance',
                path: process.env.MCP_LANCE_DB_PATH || 'default'
            };
        }

        if (this.embeddingProvider && typeof this.embeddingProvider.getCacheStats === 'function') {
            stats.embedding_cache = this.embeddingProvider.getCacheStats();
        }

        return stats;
    }
}
