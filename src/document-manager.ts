import { existsSync, mkdirSync } from "fs";
import { writeFile, readFile, copyFile, readdir, unlink } from "fs/promises";
import * as path from "path";
import { glob } from "glob";
import { createHash } from 'crypto';
import { Document, DocumentChunk, DocumentSummary, SearchResult, CodeBlock, EmbeddingProvider, QueryOptions, QueryResponse, DocumentDiscoveryResult, MetadataFilter } from './types.js';
import { SimpleEmbeddingProvider } from './embedding-provider.js';
import { IntelligentChunker } from './intelligent-chunker.js';
import { extractText } from 'unpdf';
import { getDefaultDataDir, expandHomeDir } from './utils.js';
import { DocumentIndex } from './indexing/document-index.js';
import type { VectorDatabase } from './vector-db/lance-db.js';
import { createVectorDatabase, migrateFromJson } from './vector-db/index.js';

/**
 * Document manager that handles document operations with chunking, indexing, and embeddings
 */
export class DocumentManager {
    private dataDir: string;
    private uploadsDir: string;
    private embeddingProvider: EmbeddingProvider;
    private intelligentChunker: IntelligentChunker;
    private documentIndex: DocumentIndex | null = null;
    private vectorDatabase: VectorDatabase | null = null;
    private vectorDbInitPromise: Promise<void> | null = null;
    private useIndexing: boolean;
    private useVectorDb: boolean;
    private useParallelProcessing: boolean;
    private useStreaming: boolean;
    private useTagGeneration: boolean;
    private useGeneratedTagsInQuery: boolean;
    
    constructor(embeddingProvider?: EmbeddingProvider, vectorDatabase?: VectorDatabase) {
        console.error('[DocumentManager] Constructor START');
        const startTime = Date.now();

        // Always use default paths
        const baseDir = getDefaultDataDir();
        this.dataDir = path.join(baseDir, 'data');
        this.uploadsDir = path.join(baseDir, 'uploads');
        console.error(`[DocumentManager] Data dir: ${this.dataDir}, Uploads dir: ${this.uploadsDir}`);
        
        this.embeddingProvider = embeddingProvider || new SimpleEmbeddingProvider();
        this.intelligentChunker = new IntelligentChunker(this.embeddingProvider);
        console.error(`[DocumentManager] Embedding provider initialized`);
        
        // Feature flags with fallback
        this.useIndexing = process.env.MCP_INDEXING_ENABLED !== 'false';
        this.useVectorDb = process.env.MCP_VECTOR_DB !== 'inmemory';
        this.useParallelProcessing = process.env.MCP_PARALLEL_ENABLED !== 'false';
        this.useStreaming = process.env.MCP_STREAMING_ENABLED !== 'false';
        this.useTagGeneration = process.env.MCP_TAG_GENERATION_ENABLED === 'true';
        this.useGeneratedTagsInQuery = process.env.MCP_GENERATED_TAGS_IN_QUERY === 'true';
        console.error(`[DocumentManager] Feature flags - Indexing: ${this.useIndexing}, VectorDB: ${this.useVectorDb}, Parallel: ${this.useParallelProcessing}, Streaming: ${this.useStreaming}, TagGeneration: ${this.useTagGeneration}, GeneratedTagsInQuery: ${this.useGeneratedTagsInQuery}`);
        
        console.error('[DocumentManager] Ensuring data directories...');
        this.ensureDataDir();
        this.ensureUploadsDir();
        console.error('[DocumentManager] Data directories ensured');
        
        // Initialize indexing with error handling
        if (this.useIndexing) {
            try {
                console.error('[DocumentManager] Creating DocumentIndex...');
                this.documentIndex = new DocumentIndex(this.dataDir);
                console.error('[DocumentManager] Indexing enabled');
            } catch (error) {
                console.warn('[DocumentManager] Indexing disabled due to error:', error);
                this.useIndexing = false;
            }
        }
        
        // Initialize vector database with error handling
        // Note: We initialize asynchronously in the background to avoid blocking the constructor
        if (this.useVectorDb) {
            console.error('[DocumentManager] Creating vector database...');
            this.vectorDatabase = vectorDatabase || this.createVectorDatabase();
            console.error('[DocumentManager] Starting vector database initialization in background...');
            // Initialize asynchronously without blocking constructor, but store the promise
            this.vectorDbInitPromise = this.initializeVectorDatabase().catch(error => {
                console.error('[DocumentManager] Vector database initialization failed:', error);
                this.useVectorDb = false;
                this.vectorDatabase = null;
                this.vectorDbInitPromise = null;
                throw error;
            });
            console.error('[DocumentManager] Vector database initialization started (async, non-blocking)');
        }

        const endTime = Date.now();
        console.error(`[DocumentManager] Constructor END - took ${endTime - startTime}ms`);
    }

    /**
     * Create and initialize vector database instance
     */
    private createVectorDatabase(): VectorDatabase {
        const dbType = process.env.MCP_VECTOR_DB || 'lance';
        const dbPathEnv = process.env.MCP_LANCE_DB_PATH;
        const defaultDataDir = getDefaultDataDir();
        const dbPath = dbPathEnv ? expandHomeDir(dbPathEnv) : path.join(defaultDataDir, 'lancedb');
        return createVectorDatabase(dbType, dbPath);
    }

    /**
     * Initialize vector database with automatic migration
     */
    private async initializeVectorDatabase(): Promise<void> {
        console.error('[DocumentManager] initializeVectorDatabase START');
        const startTime = Date.now();

        if (!this.vectorDatabase) {
            console.error('[DocumentManager] initializeVectorDatabase END - no vector database');
            return;
        }

        try {
            console.error('[DocumentManager] Calling vectorDatabase.initialize()...');
            await this.vectorDatabase.initialize();
            console.error('[DocumentManager] vectorDatabase.initialize() completed');

            // Attempt migration if needed
            // Check if we should migrate (basic check - can be enhanced)
            const dataDir = this.dataDir;
            const { existsSync } = await import('fs');

            // Simple heuristic: if we have JSON files and vector DB is new, migrate
            if (existsSync(dataDir)) {
                try {
                    console.error('[DocumentManager] Checking for migration...');
                    const { readdir } = await import('fs/promises');
                    const files = await readdir(dataDir);
                    const jsonFiles = files.filter(f => f.endsWith('.json'));

                    if (jsonFiles.length > 0) {
                        console.error(`[DocumentManager] Found ${jsonFiles.length} JSON documents, attempting migration...`);
                        const result = await migrateFromJson(this.vectorDatabase, getDefaultDataDir());
                        if (result.success) {
                            console.error(`[DocumentManager] Migration completed: ${result.documentsMigrated} documents, ${result.chunksMigrated} chunks`);
                        } else {
                            console.warn(`[DocumentManager] Migration encountered errors: ${result.errors.join(', ')}`);
                        }
                    } else {
                        console.error('[DocumentManager] No JSON files found, skipping migration');
                    }
                } catch (migrationError) {
                    console.warn('[DocumentManager] Migration attempt failed:', migrationError);
                    // Continue without migration - data might already be migrated or issues can be handled later
                }
            }
        } catch (error) {
            console.error('[DocumentManager] Failed to initialize vector database:', error);
            throw error;
        }

        const endTime = Date.now();
        console.error(`[DocumentManager] initializeVectorDatabase END - took ${endTime - startTime}ms`);
    }

    /**
     * Initialize the document index (lazy initialization)
     */
    private async ensureIndexInitialized(): Promise<void> {
        if (this.documentIndex && this.useIndexing) {
            await this.documentIndex.initialize(this.dataDir);
        }
    }

    /**
     * Ensure vector database is initialized before use
     * This waits for async initialization to complete with a timeout
     */
    private async ensureVectorDbReady(): Promise<boolean> {
        if (!this.useVectorDb || !this.vectorDatabase) {
            return false;
        }

        // If there's an ongoing initialization, wait for it (with timeout)
        if (this.vectorDbInitPromise) {
            console.error('[DocumentManager] Waiting for vector DB initialization...');
            try {
                const timeoutPromise = new Promise<never>((_, reject) => {
                    setTimeout(() => {
                        reject(new Error('Vector DB initialization timeout (30s)'));
                    }, 30000); // 30 second timeout
                });

                await Promise.race([this.vectorDbInitPromise, timeoutPromise]);
                console.error('[DocumentManager] Vector DB initialization completed');
            } catch (error) {
                console.error('[DocumentManager] Vector DB initialization failed or timed out:', error);
                // Disable vector DB if initialization fails
                this.useVectorDb = false;
                this.vectorDatabase = null;
                this.vectorDbInitPromise = null;
                return false;
            }
        }

        // Check if vector DB is actually initialized
        const isInitialized = (this.vectorDatabase as any).isInitialized?.() ?? true;
        if (!isInitialized) {
            console.error('[DocumentManager] Vector DB exists but not initialized');
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

    private getDocumentPath(id: string): string {
        return path.join(this.dataDir, `${id}.json`);
    }

    private getDocumentMdPath(id: string): string {
        return path.join(this.dataDir, `${id}.md`);
    }

    async addDocument(title: string, content: string, metadata: Record<string, any> = {}): Promise<Document> {
        // Check for duplicate content if indexing is enabled
        if (this.useIndexing && this.documentIndex) {
            await this.ensureIndexInitialized();
            const duplicateId = this.documentIndex.findDuplicateContent(content);
            if (duplicateId) {
                console.warn(`[DocumentManager] Duplicate content detected, existing document: ${duplicateId}`);
                // Optionally, you might want to return the existing document or throw an error
                // For now, we'll continue with creating a new document
            }
        }

        const id = this.generateId(content);
        const now = new Date().toISOString();

        // Create chunks using intelligent chunker with environment variable overrides
        // Use -1 to use intelligent chunker's content-type-specific defaults
        const envChunkSize = parseInt(process.env.MCP_CHUNK_SIZE || '-1');
        const envChunkOverlap = parseInt(process.env.MCP_CHUNK_OVERLAP || '-1');
        
        const chunkOptions: any = {
            adaptiveSize: true,
            addContext: true
        };

        // Only set maxSize and overlap if environment variables are not -1
        if (envChunkSize > 0) {
            chunkOptions.maxSize = envChunkSize;
        }
        if (envChunkOverlap > 0) {
            chunkOptions.overlap = envChunkOverlap;
        }

        const chunks = await this.intelligentChunker.createChunks(id, content, chunkOptions);

        const document: Document = {
            id,
            title,
            content,
            metadata,
            chunks,
            created_at: now,
            updated_at: now,
        };

        const filePath = this.getDocumentPath(id);
        await writeFile(filePath, JSON.stringify(document, null, 2));

        // Create markdown file with the document content
        const mdFilePath = this.getDocumentMdPath(id);
        const mdContent = `# ${title}\n\n${content}`;
        await writeFile(mdFilePath, mdContent, 'utf-8');

        // Add to index if enabled
        if (this.useIndexing && this.documentIndex) {
            this.documentIndex.addDocument(id, filePath, content, chunks, title, metadata);
        }

        // Generate tags in background if enabled
        if (this.useTagGeneration) {
            this.generateTagsForDocument(id, title, content);
        }

        // Add chunks to vector database if enabled
        if (this.useVectorDb && this.vectorDatabase) {
            try {
                console.error(`[DocumentManager] Adding chunks to vector DB - useVectorDb: ${this.useVectorDb}, vectorDatabase exists: ${!!this.vectorDatabase}`);
                
                // Ensure vector DB is ready before adding chunks
                const vectorDbReady = await this.ensureVectorDbReady();
                if (!vectorDbReady) {
                    console.error('[DocumentManager] Vector DB not ready, skipping chunk indexing');
                    return document;
                }
                
                // Check if vector DB is initialized (diagnostic)
                const isInitialized = (this.vectorDatabase as any).isInitialized?.() ?? true;
                console.error(`[DocumentManager] Vector DB initialized: ${isInitialized}`);
                
                // Filter chunks that have embeddings
                const chunksWithEmbeddings = chunks.filter(chunk => chunk.embeddings && chunk.embeddings.length > 0);
                console.error(`[DocumentManager] Total chunks: ${chunks.length}, Chunks with embeddings: ${chunksWithEmbeddings.length}`);
                
                if (chunksWithEmbeddings.length > 0) {
                    console.error(`[DocumentManager] Calling addChunks for ${chunksWithEmbeddings.length} chunks...`);
                    await this.vectorDatabase.addChunks(chunksWithEmbeddings);
                    console.error(`[DocumentManager] Successfully added ${chunksWithEmbeddings.length} chunks to vector DB`);
                } else {
                    console.warn(`[DocumentManager] No chunks with embeddings to add to vector DB (total: ${chunks.length})`);
                }
            } catch (error) {
                console.error('[DocumentManager] FAILED to add chunks to vector database. Error:', error);
                console.error('[DocumentManager] Error details:', {
                    message: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    name: error instanceof Error ? error.name : undefined
                });
                // Continue without vector DB - non-critical error
            }
        } else {
            console.warn(`[DocumentManager] Vector DB not enabled or not available. useVectorDb: ${this.useVectorDb}, vectorDatabase: ${!!this.vectorDatabase}`);
        }

        return document;
    }

    async getDocument(id: string): Promise<Document | null> {
        if (this.useIndexing && this.documentIndex) {
            await this.ensureIndexInitialized();
            
            // Use index for O(1) lookup
            const filePath = this.documentIndex.findDocument(id);
            if (!filePath) {
                return null;
            }
            
            try {
                const data = await readFile(filePath, 'utf-8');
                return JSON.parse(data);
            } catch {
                // File might have been deleted, remove from index
                this.documentIndex.removeDocument(id);
                return null;
            }
        }
        
        // Fallback to original method
        try {
            const data = await readFile(this.getDocumentPath(id), 'utf-8');
            return JSON.parse(data);
        } catch {
            return null;
        }
    }
    
    async getOnlyContentDocument(id: string): Promise<string | null> {
        const document = await this.getDocument(id);
        return document ? document.content : null;
    }

    async getAllDocuments(): Promise<Document[]> {
        if (this.useIndexing && this.documentIndex) {
            await this.ensureIndexInitialized();
            
            // Use index for faster lookup
            const documentIds = this.documentIndex.getAllDocumentIds();
            const documents: Document[] = [];
            
            for (const id of documentIds) {
                const document = await this.getDocument(id);
                if (document) {
                    documents.push(document);
                }
            }
            
            return documents;
        }
        
        // Fallback to original method
        // Use forward slashes for glob pattern to work on all platforms
        const globPattern = this.dataDir.replace(/\\/g, '/') + "/*.json";
        const files = await glob(globPattern);
        const documents: Document[] = [];

        for (const file of files) {
            try {
                const data = await readFile(file, 'utf-8');
                const document = JSON.parse(data);
                if (document.id) { // Only include valid documents
                    documents.push(document);
                }
            } catch {
                // Skip invalid files
            }
        }

        return documents;
    }

    private async listDocumentIds(): Promise<string[]> {
        if (this.useIndexing && this.documentIndex) {
            await this.ensureIndexInitialized();
            const ids = this.documentIndex.getAllDocumentIds();
            return ids.sort();
        }

        const globPattern = this.dataDir.replace(/\\/g, '/') + "/*.json";
        const files = await glob(globPattern);
        return files
            .map(file => path.basename(file, ".json"))
            .filter(id => id !== "document-index")
            .sort();
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

        const documentIds = await this.listDocumentIds();
        const total = documentIds.length;
        const slice = documentIds.slice(offset, offset + limit);
        const documents: DocumentSummary[] = [];

        for (const id of slice) {
            const document = await this.getDocument(id);
            if (!document) {
                continue;
            }

            const summary: DocumentSummary = {
                id: document.id,
                title: typeof document.title === "string" ? document.title : "",
                created_at: document.created_at,
                updated_at: document.updated_at,
                content_length: typeof document.content === "string" ? document.content.length : 0,
                chunks_count: Array.isArray(document.chunks) ? document.chunks.length : 0,
            };

            if (includeMetadata) {
                summary.metadata = document.metadata;
            }

            if (includePreview && previewLength > 0 && typeof document.content === "string") {
                const preview = document.content.substring(0, previewLength);
                summary.content_preview = document.content.length > previewLength ? `${preview}...` : preview;
            }

            documents.push(summary);
        }

        return { total, documents };
    }

    async searchDocuments(documentId: string, query: string, limit = 10): Promise<SearchResult[]> {
        const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);

        // Get similarity threshold from environment variable
        const similarityThreshold = parseFloat(process.env.MCP_SIMILARITY_THRESHOLD || '0.0');

        // Use vector database if available
        if (this.useVectorDb && this.vectorDatabase) {
            try {
                const results = await this.vectorDatabase.search(
                    queryEmbedding,
                    limit,
                    `document_id = '${documentId}'`
                );
                // Filter by similarity threshold
                return results.filter(result => result.score >= similarityThreshold);
            } catch (error) {
                console.warn('[DocumentManager] Vector database search failed, falling back to in-memory:', error);
                // Fall through to in-memory search
            }
        }

        // Fallback to in-memory search
        const document = await this.getDocument(documentId);
        if (!document) {
            return [];
        }

        const results: SearchResult[] = document.chunks
            .filter(chunk => chunk.embeddings && chunk.embeddings.length > 0)
            .map(chunk => ({
                chunk,
                score: this.cosineSimilarity(queryEmbedding, chunk.embeddings!)
            }))
            .filter(result => result.score >= similarityThreshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return results;
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private generateId(content: string): string {
        return createHash('sha256')
            .update(content)
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
                console.error(`[DocumentManager] Generating tags for document ${documentId}...`);
                const tags = await this.generateTags(title, content);
                
                if (tags.length > 0) {
                    // Update document metadata with generated tags
                    const document = await this.getDocument(documentId);
                    if (document) {
                        document.metadata.tags_generated = tags;
                        document.updated_at = new Date().toISOString();
                        
                        // Save updated document
                        const filePath = this.getDocumentPath(documentId);
                        await writeFile(filePath, JSON.stringify(document, null, 2));
                        
                        // Update index if enabled
                        if (this.useIndexing && this.documentIndex) {
                            await this.ensureIndexInitialized();
                            this.documentIndex.addDocument(
                                documentId,
                                filePath,
                                document.content,
                                document.chunks,
                                document.title,
                                document.metadata
                            );
                        }
                        
                        console.error(`[DocumentManager] Generated ${tags.length} tags for document ${documentId}: ${tags.join(', ')}`);
                    }
                }
            } catch (error) {
                console.error(`[DocumentManager] Failed to generate tags for document ${documentId}:`, error);
            }
        });
    }

    /**
     * Generate tags using configured AI provider
     */
    private async generateTags(title: string, content: string): Promise<string[]> {
        console.error('[DocumentManager] generateTags START');
        console.error(`[DocumentManager] Title: ${title}, Content length: ${content.length}`);
        
        // Truncate content if too long (keep first 2000 chars for context)
        const truncatedContent = content.length > 2000 ? content.substring(0, 2000) + '...' : content;
        
        const system = 'You are an expert document tagger. Generate relevant tags for the given document. Return only a JSON array of tag strings. Tags should be concise, descriptive, and relevant to the document content. Do not include markdown or extra text.';
        const user = `Document title: ${title}\n\nDocument content:\n${truncatedContent}\n\nGenerate 5-10 relevant tags for this document.`;

        // Check for OpenAI-compatible provider
        const baseUrl = process.env.MCP_AI_BASE_URL;
        let model = process.env.MCP_AI_MODEL;
        const apiKey = process.env.MCP_AI_API_KEY;

        console.error(`[DocumentManager] AI Provider Config - baseUrl: ${baseUrl || 'NOT SET'}, model: ${model || 'NOT SET'}, apiKey: ${apiKey ? 'SET' : 'NOT SET'}`);

        if (baseUrl) {
            // Provide default model based on base URL if not specified
            if (!model) {
                if (baseUrl.includes('synthetic.new')) {
                    model = 'hf:zai-org/glm-4.7';
                    console.error(`[DocumentManager] Using default model for synthetic.new: ${model}`);
                } else {
                    model = 'ministral-3-8b-instruct-2512';
                    console.error(`[DocumentManager] Using default model for LM Studio: ${model}`);
                }
            }
            
            try {
                console.error('[DocumentManager] Attempting to generate tags via OpenAI-compatible API...');
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
                console.error(`[DocumentManager] API Response status: ${response.status}, body: ${payloadText.substring(0, 200)}`);
                
                if (!response.ok) {
                    throw new Error(`OpenAI request failed (${response.status}): ${payloadText}`);
                }
                
                const payload = JSON.parse(payloadText);
                const responseText = payload?.choices?.[0]?.message?.content || '';
                console.error(`[DocumentManager] AI response text: ${responseText}`);
                
                const tags = this.parseTagsFromResponse(responseText);
                console.error(`[DocumentManager] Parsed tags: ${JSON.stringify(tags)}`);
                
                if (tags.length === 0) {
                    console.warn('[DocumentManager] Tag generation returned empty array. This may be expected if MCP_TAG_GENERATION_ENABLED is not set to true, or if the AI provider could not generate valid tags.');
                }
                
                return tags;
            } catch (error) {
                console.error('[DocumentManager] Failed to generate tags with OpenAI provider:', error);
                console.warn('[DocumentManager] Tag generation returned empty array due to error.');
                return [];
            }
        }

        console.warn('[DocumentManager] AI provider not configured. MCP_AI_BASE_URL must be set to enable tag generation.');
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
                console.error(`[DocumentManager] Using streaming for large PDF: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
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
                console.error(`[DocumentManager] Using streaming for large text file: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
                const buffer = await this.readFileStreaming(filePath);
                return buffer.toString('utf-8');
            } else {
                return await readFile(filePath, 'utf-8');
            }
        } catch (error) {
            throw new Error(`Failed to read text file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async processUploadsFolder(): Promise<{ processed: number; errors: string[] }> {
        const supportedExtensions = ['.txt', '.md', '.pdf'];
        const errors: string[] = [];
        let processed = 0;

        try {
            // Get all supported files from uploads directory
            const pattern = this.uploadsDir.replace(/\\/g, '/') + "/*{.txt,.md,.pdf}";
            const files = await glob(pattern);

            for (const filePath of files) {
                try {
                    const fileName = path.basename(filePath);
                    const fileExtension = path.extname(fileName).toLowerCase();

                    if (!supportedExtensions.includes(fileExtension)) {
                        continue;
                    }

                    let content: string;

                    // Extract content based on file type
                    if (fileExtension === '.pdf') {
                        content = await this.extractTextFromPdf(filePath);
                    } else {
                        // For .txt and .md files, use streaming if enabled
                        content = await this.readTextFile(filePath);
                    }

                    if (!content.trim()) {
                        errors.push(`File ${fileName} is empty or contains no extractable text`);
                        continue;
                    }

                    // Create document title from filename (without extension)
                    const title = path.basename(fileName, fileExtension);

                    // Check if document with this filename already exists and remove it
                    const existingDoc = await this.findDocumentByTitle(title);
                    if (existingDoc) {
                        await this.removeDocument(existingDoc.id);
                    }

                    // Create new document with embeddings
                    const document = await this.addDocument(title, content, {
                        source: 'upload',
                        originalFilename: fileName,
                        fileExtension: fileExtension,
                        processedAt: new Date().toISOString()
                    });

                    // Copy original file to data directory with same name as JSON file (keep backup in uploads)
                    const documentId = document.id;
                    const destinationFileName = `${documentId}${fileExtension}`;
                    const destinationPath = path.join(this.dataDir, destinationFileName);
                    
                    try {
                        await copyFile(filePath, destinationPath);
                        console.error(`[DocumentManager] Copied ${fileName} to ${destinationFileName} (keeping backup in uploads)`);
                    } catch (copyError) {
                        errors.push(`Warning: Could not copy file ${fileName} to data directory: ${copyError instanceof Error ? copyError.message : String(copyError)}`);
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

    private async findDocumentByTitle(title: string): Promise<Document | null> {
        const documents = await this.getAllDocuments();
        return documents.find(doc => doc.title === title) || null;
    }

    private async removeDocument(documentId: string): Promise<void> {
        try {
            const documentPath = this.getDocumentPath(documentId);
            if (existsSync(documentPath)) {
                await import('fs/promises').then(fs => fs.unlink(documentPath));
            }
        } catch (error) {
            // Ignore errors when removing non-existent files
        }
    }

    async listUploadsFiles(): Promise<{ name: string; size: number; modified: string; supported: boolean }[]> {
        const supportedExtensions = ['.txt', '.md', '.pdf'];
        const files: { name: string; size: number; modified: string; supported: boolean }[] = [];

        try {
            const pattern = this.uploadsDir.replace(/\\/g, '/') + "/*";
            const filePaths = await glob(pattern);

            for (const filePath of filePaths) {
                const stats = await import('fs/promises').then(fs => fs.stat(filePath));
                if (stats.isFile()) {
                    const fileName = path.basename(filePath);
                    const fileExtension = path.extname(fileName).toLowerCase();
                    
                    files.push({
                        name: fileName,
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        supported: supportedExtensions.includes(fileExtension)
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
            const documentPath = this.getDocumentPath(documentId);
            let deletedMainFile = false;

            // Delete main JSON file
            if (existsSync(documentPath)) {
                await unlink(documentPath);
                deletedMainFile = true;
                console.error(`[DocumentManager] Deleted JSON file: ${documentId}.json`);
            }

            // Delete associated markdown file
            const mdPath = this.getDocumentMdPath(documentId);
            if (existsSync(mdPath)) {
                await unlink(mdPath);
                console.error(`[DocumentManager] Deleted markdown file: ${documentId}.md`);
            }

            // Delete associated original files (any extension except .json)
            try {
                const files = await readdir(this.dataDir);
                for (const file of files) {
                    if (file.startsWith(documentId) && !file.endsWith('.json')) {
                        const filePath = path.join(this.dataDir, file);
                        await unlink(filePath);
                        console.error(`[DocumentManager] Deleted associated file: ${file}`);
                    }
                }
            } catch (fileError) {
                console.error(`[DocumentManager] Warning: Could not delete associated files for ${documentId}: ${fileError instanceof Error ? fileError.message : String(fileError)}`);
            }

            // Remove from index if enabled
            if (this.useIndexing && this.documentIndex) {
                this.documentIndex.removeDocument(documentId);
            }

            // Remove from vector database if enabled
            if (this.useVectorDb && this.vectorDatabase) {
                try {
                    await this.vectorDatabase.removeChunks(documentId);
                } catch (error) {
                    console.warn(`[DocumentManager] Failed to remove chunks from vector database for ${documentId}:`, error);
                    // Continue - non-critical error
                }
            }

            return deletedMainFile;
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

        // Try vector search first
        let results: DocumentDiscoveryResult[] = [];
        
        if (this.useVectorDb && this.vectorDatabase) {
            const vectorDbReady = await this.ensureVectorDbReady();
            if (vectorDbReady) {
                try {
                    const queryEmbedding = await this.embeddingProvider.generateEmbedding(queryText);
                    const vectorResults = await this.vectorDatabase.search(
                        queryEmbedding,
                        limit + offset + 10, // Get extra results for filtering
                        this.buildFilterQuery(filters)
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
                    const similarityThreshold = parseFloat(process.env.MCP_SIMILARITY_THRESHOLD || '0.3');
                    results = Array.from(docScoreMap.entries())
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
                    console.warn('[DocumentManager] Vector search failed, falling back to keyword search:', error);
                }
            }
        }
        
        // Fall back to keyword search if vector search returned insufficient results
        const minVectorResults = Math.max(1, Math.floor(limit / 2));
        if (results.length < minVectorResults && this.useIndexing && this.documentIndex) {
            await this.ensureIndexInitialized();
            const keywordDocIds = this.documentIndex.searchByCombinedCriteria(queryText);
            
            // Apply metadata filters to keyword results
            let filteredDocIds = Array.from(keywordDocIds);
            if (filters.tags && filters.tags.length > 0) {
                const tagResults = this.documentIndex.searchByTags(filters.tags);
                filteredDocIds = filteredDocIds.filter(id => tagResults.has(id));
            }
            if (filters.source) {
                const sourceResults = this.documentIndex.searchBySource(filters.source);
                filteredDocIds = filteredDocIds.filter(id => sourceResults.has(id));
            }
            if (filters.crawl_id) {
                const crawlResults = this.documentIndex.searchByCrawlId(filters.crawl_id);
                filteredDocIds = filteredDocIds.filter(id => crawlResults.has(id));
            }
            
            // Build keyword results
            const keywordResults: DocumentDiscoveryResult[] = [];
            for (const docId of filteredDocIds) {
                // Skip if already in vector results
                if (results.some(r => r.id === docId)) continue;
                
                const searchFields = this.documentIndex!.getDocumentSearchFields(docId);
                if (searchFields) {
                    keywordResults.push({
                        id: docId,
                        title: searchFields.title,
                        score: 0.5, // Default score for keyword matches
                        updated_at: searchFields.source_metadata.processedAt,
                        chunks_count: searchFields.keywords.length
                    });
                }
            }
            
            // Merge results: vector results first, then keyword results
            results = [...results, ...keywordResults];
        }
        
        // Fetch document details for all results
        const finalResults: DocumentDiscoveryResult[] = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const document = await this.getDocument(result.id);
            if (document) {
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
     * Build filter query string for vector database search
     */
    private buildFilterQuery(filters: MetadataFilter): string {
        const conditions: string[] = [];
        
        if (filters.tags && filters.tags.length > 0) {
            const tags = filters.tags.map(t => `'${t}'`).join(', ');
            // Include both regular tags and generated tags in filter
            conditions.push(`(tags IN [${tags}] OR tags_generated IN [${tags}])`);
        }
        
        if (filters.source) {
            conditions.push(`source = '${filters.source}'`);
        }
        
        if (filters.crawl_id) {
            conditions.push(`crawl_id = '${filters.crawl_id}'`);
        }
        
        if (filters.author) {
            conditions.push(`author = '${filters.author}'`);
        }
        
        if (filters.contentType) {
            conditions.push(`contentType = '${filters.contentType}'`);
        }
        
        return conditions.length > 0 ? conditions.join(' AND ') : '';
    }

    /**
     * Add code blocks to the vector database for a document
     * @param documentId - The document ID to associate code blocks with
     * @param codeBlocks - Array of code blocks to add
     * @param metadata - Additional metadata to attach to code blocks
     */
    async addCodeBlocks(documentId: string, codeBlocks: CodeBlock[], metadata: Record<string, any> = {}): Promise<void> {
        if (!this.useVectorDb || !this.vectorDatabase) {
            console.warn('[DocumentManager] Vector DB not enabled, skipping code block storage');
            return;
        }

        try {
            const vectorDbReady = await this.ensureVectorDbReady();
            if (!vectorDbReady) {
                console.warn('[DocumentManager] Vector DB not ready, skipping code block storage');
                return;
            }

            // Check if the vector database supports code blocks
            const addCodeBlocksMethod = (this.vectorDatabase as any).addCodeBlocks;
            if (typeof addCodeBlocksMethod !== 'function') {
                console.warn('[DocumentManager] Vector database does not support code blocks, skipping');
                return;
            }

            // Generate embeddings for code blocks
            const codeBlocksWithEmbeddings: CodeBlock[] = [];
            for (const codeBlock of codeBlocks) {
                try {
                    const embedding = await this.embeddingProvider.generateEmbedding(codeBlock.content);
                    codeBlocksWithEmbeddings.push({
                        ...codeBlock,
                        document_id: documentId,
                        embedding,
                        metadata: {
                            ...codeBlock.metadata,
                            ...metadata,
                        },
                    });
                } catch (error) {
                    console.warn(`[DocumentManager] Failed to generate embedding for code block: ${error}`);
                }
            }

            if (codeBlocksWithEmbeddings.length > 0) {
                await addCodeBlocksMethod.call(this.vectorDatabase, codeBlocksWithEmbeddings);
                console.log(`[DocumentManager] Added ${codeBlocksWithEmbeddings.length} code blocks to vector database`);
            }
        } catch (error) {
            console.error('[DocumentManager] Failed to add code blocks:', error);
            // Continue without code blocks - non-critical error
        }
    }

    /**
     * Get performance and cache statistics
     */
    getStats(): any {
        const stats: any = {
            features: {
                indexing: this.useIndexing,
                vectorDb: this.useVectorDb,
                parallelProcessing: this.useParallelProcessing,
                streaming: this.useStreaming,
                tagGeneration: this.useTagGeneration,
                generatedTagsInQuery: this.useGeneratedTagsInQuery
            }
        };

        if (this.useIndexing && this.documentIndex) {
            stats.indexing = this.documentIndex.getStats();
        }

        if (this.useVectorDb && this.vectorDatabase) {
            stats.vectorDatabase = {
                type: process.env.MCP_VECTOR_DB || 'lance',
                path: process.env.MCP_LANCE_DB_PATH || 'default'
            };
        }

        if (this.embeddingProvider && typeof this.embeddingProvider.getCacheStats === 'function') {
            stats.embedding_cache = this.embeddingProvider.getCacheStats();
        }

        return stats;
    }
}
