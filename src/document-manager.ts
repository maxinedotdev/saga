import { existsSync, mkdirSync } from "fs";
import { writeFile, readFile, copyFile, readdir, unlink } from "fs/promises";
import * as path from "path";
import { glob } from "glob";
import { createHash } from 'crypto';
import type { Document, DocumentChunk, DocumentSummary, SearchResult, CodeBlock, EmbeddingProvider, QueryOptions, QueryResponse, DocumentDiscoveryResult, MetadataFilter, Reranker, RerankResult } from './types.js';
import { IntelligentChunker } from './intelligent-chunker.js';
import { extractText } from 'unpdf';
import { getDefaultDataDir, expandHomeDir } from './utils.js';
import { DocumentIndex } from './indexing/document-index.js';
import { extractMarkdownCodeBlocks } from './markdown-code-blocks.js';
import type { VectorDatabase } from './vector-db/lance-db.js';
import { createVectorDatabase, migrateFromJson } from './vector-db/index.js';
import { detectLanguages, getAcceptedLanguages, getLanguageConfidenceThreshold, isLanguageAllowed, getDefaultQueryLanguages } from './language-detection.js';
import { ApiReranker } from './reranking/api-reranker.js';
import { getRerankingConfig, isRerankingEnabled } from './reranking/config.js';

// ============================================
// DIAGNOSTIC LOGGING: Document Manager
// ============================================

const getTimestamp = () => new Date().toISOString();
const getMemoryUsage = () => {
    const usage = process.memoryUsage();
    return `heap=${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB, total=${(usage.heapTotal / 1024 / 1024).toFixed(2)}MB, rss=${(usage.rss / 1024 / 1024).toFixed(2)}MB`;
};

// Track active operations for debugging
const activeOperations = new Map<string, { startTime: number; operation: string }>();

const startOperation = (operationId: string, operation: string) => {
    activeOperations.set(operationId, { startTime: Date.now(), operation });
    console.error(`[DocumentManager] ${getTimestamp()} START ${operation} (id: ${operationId})`);
    console.error(`[DocumentManager] ${getTimestamp()} Memory: ${getMemoryUsage()}`);
};

const endOperation = (operationId: string, status: 'success' | 'error', error?: Error) => {
    const op = activeOperations.get(operationId);
    if (op) {
        const duration = Date.now() - op.startTime;
        console.error(`[DocumentManager] ${getTimestamp()} END ${op.operation} (id: ${operationId}) - ${status} (${duration}ms)`);
        console.error(`[DocumentManager] ${getTimestamp()} Memory: ${getMemoryUsage()}`);
        if (error) {
            console.error(`[DocumentManager] ${getTimestamp()} Error: ${error.message}`);
            console.error(`[DocumentManager] ${getTimestamp()} Stack: ${error.stack}`);
        }
        activeOperations.delete(operationId);
    }
};

// Periodic memory logging during document processing
let memoryLogInterval: NodeJS.Timeout | null = null;

const startMemoryLogging = () => {
    if (!memoryLogInterval) {
        memoryLogInterval = setInterval(() => {
            console.error(`[DocumentManager] ${getTimestamp()} Periodic memory check - ${getMemoryUsage()}`);
            console.error(`[DocumentManager] ${getTimestamp()} Active operations: ${activeOperations.size}`);
            for (const [id, op] of activeOperations.entries()) {
                const elapsed = Date.now() - op.startTime;
                console.error(`[DocumentManager] ${getTimestamp()}   - ${op.operation} (${id}): ${elapsed}ms`);
            }
        }, 30000); // Every 30 seconds
    }
};

const stopMemoryLogging = () => {
    if (memoryLogInterval) {
        clearInterval(memoryLogInterval);
        memoryLogInterval = null;
        console.error(`[DocumentManager] ${getTimestamp()} Stopped periodic memory logging`);
    }
};

// ============================================
// END DIAGNOSTIC LOGGING
// ============================================

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
    private pendingVectorChunks: Map<string, DocumentChunk[]> = new Map();
    private pendingVectorFlush = false;
    private useIndexing: boolean;
    private useVectorDb: boolean;
    private useParallelProcessing: boolean;
    private useStreaming: boolean;
    private useTagGeneration: boolean;
    private useGeneratedTagsInQuery: boolean;
    private reranker: Reranker | null = null;
    private rerankingEnabled: boolean = false;

    constructor(embeddingProvider: EmbeddingProvider, vectorDatabase?: VectorDatabase) {
        // Always use default paths
        const baseDir = getDefaultDataDir();
        this.dataDir = path.join(baseDir, 'data');
        this.uploadsDir = path.join(baseDir, 'uploads');

        this.embeddingProvider = embeddingProvider;
        this.intelligentChunker = new IntelligentChunker(this.embeddingProvider);

        // Feature flags with fallback
        this.useIndexing = process.env.MCP_INDEXING_ENABLED !== 'false';
        const vectorDbEnv = process.env.MCP_VECTOR_DB;
        const vectorDbEnabledEnv = process.env.MCP_VECTOR_DB_ENABLED;
        if (vectorDbEnv !== undefined) {
            this.useVectorDb = vectorDbEnv !== 'false';
        } else if (vectorDbEnabledEnv !== undefined) {
            this.useVectorDb = vectorDbEnabledEnv !== 'false';
        } else {
            this.useVectorDb = true;
        }
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
                console.error(`[DocumentManager] Reranker initialized with model: ${config.model}`);
            } catch (error) {
                console.error('[DocumentManager] Failed to initialize reranker:', error);
                this.rerankingEnabled = false;
                this.reranker = null;
            }
        }
        
        this.ensureDataDir();
        this.ensureUploadsDir();
        
        // Initialize indexing with error handling
        if (this.useIndexing) {
            try {
                this.documentIndex = new DocumentIndex(this.dataDir);
            } catch (error) {
                console.warn('[DocumentManager] Indexing disabled due to error:', error);
                this.useIndexing = false;
            }
        }
        
        // Initialize vector database with error handling
        // Note: We initialize asynchronously in the background to avoid blocking the constructor
        if (this.useVectorDb) {
            this.vectorDatabase = vectorDatabase || this.createVectorDatabase();
            // Initialize asynchronously without blocking constructor, but store the promise
            this.vectorDbInitPromise = this.initializeVectorDatabase().catch(error => {
                console.error('[DocumentManager] Vector database initialization failed:', error);
                this.useVectorDb = false;
                this.vectorDatabase = null;
                this.vectorDbInitPromise = null;
                // Gracefully degrade - server continues without vector search capabilities
            });
        }
    }

    /**
     * Create and initialize LanceDB vector database instance
     */
    private createVectorDatabase(): VectorDatabase {
        const dbPathEnv = process.env.MCP_LANCE_DB_PATH;
        const defaultDataDir = getDefaultDataDir();
        const dbPath = dbPathEnv ? expandHomeDir(dbPathEnv) : path.join(defaultDataDir, 'lancedb');
        return createVectorDatabase(dbPath);
    }

    /**
     * Initialize vector database with automatic migration
     */
    private async initializeVectorDatabase(): Promise<void> {
        if (!this.vectorDatabase) {
            return;
        }

        try {
            await this.vectorDatabase.initialize();

            // Attempt migration if needed
            // Check if we should migrate (basic check - can be enhanced)
            const dataDir = this.dataDir;
            const { existsSync } = await import('fs');

            // Simple heuristic: if we have JSON files and vector DB is new, migrate
            if (existsSync(dataDir)) {
                try {
                    const { readdir } = await import('fs/promises');
                    const files = await readdir(dataDir);
                    const jsonFiles = files.filter(f => f.endsWith('.json'));

                    if (jsonFiles.length > 0) {
                        const result = await migrateFromJson(this.vectorDatabase, getDefaultDataDir());
                        if (!result.success) {
                            console.warn(`[DocumentManager] Migration encountered errors: ${result.errors.join(', ')}`);
                        }
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
    async ensureVectorDbReady(): Promise<boolean> {
        const opId = `ensureVectorDbReady-${Date.now()}`;
        startOperation(opId, 'ensureVectorDbReady');
        
        console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - useVectorDb: ${this.useVectorDb}, vectorDatabase exists: ${!!this.vectorDatabase}`);
        console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - vectorDbInitPromise exists: ${!!this.vectorDbInitPromise}`);
        
        if (!this.useVectorDb) {
            console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Vector DB disabled by config`);
            endOperation(opId, 'success');
            return false;
        }
        
        if (!this.vectorDatabase) {
            console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Vector DB instance is null`);
            endOperation(opId, 'success');
            return false;
        }

        // If there's an ongoing initialization, wait for it (with retry logic)
        if (this.vectorDbInitPromise) {
            console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Waiting for initialization promise...`);
            
            const maxRetries = 3;
            const baseTimeoutMs = 30000; // 30 seconds base timeout
            
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    const timeoutMs = baseTimeoutMs * Math.pow(2, attempt); // Exponential backoff: 30s, 60s, 120s
                    console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Attempt ${attempt + 1}/${maxRetries} with ${timeoutMs}ms timeout`);
                    
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(new Error(`Vector DB initialization timeout (${timeoutMs}ms)`));
                        }, timeoutMs);
                    });

                    await Promise.race([this.vectorDbInitPromise, timeoutPromise]);
                    console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Initialization promise resolved`);
                    break; // Success, exit retry loop
                } catch (error) {
                    console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Attempt ${attempt + 1}/${maxRetries} failed:`, error);
                    
                    if (attempt === maxRetries - 1) {
                        // All retries exhausted
                        console.error('[DocumentManager] Vector DB initialization failed after all retries:', error);
                        console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Disabling vector DB due to initialization failure`);
                        // Disable vector DB if initialization fails after all retries
                        this.useVectorDb = false;
                        this.vectorDatabase = null;
                        this.vectorDbInitPromise = null;
                        endOperation(opId, 'error', error instanceof Error ? error : new Error(String(error)));
                        return false;
                    }
                    
                    // Wait before retry (exponential backoff)
                    const delayMs = Math.min(5000, 1000 * Math.pow(2, attempt));
                    console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Waiting ${delayMs}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        }

        // Check if vector DB is actually initialized
        const isInitialized = (this.vectorDatabase as any).isInitialized?.() ?? true;
        console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - isInitialized: ${isInitialized}`);
        
        if (!isInitialized) {
            console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Vector DB reports not initialized`);
            endOperation(opId, 'success');
            return false;
        }

        console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Flushing pending vector chunks...`);
        await this.flushPendingVectorChunks();
        console.error(`[DocumentManager] ${getTimestamp()} ensureVectorDbReady - Vector DB ready`);
        endOperation(opId, 'success');
        return true;
    }

    private queueVectorChunks(documentId: string, chunks: DocumentChunk[]): void {
        if (chunks.length === 0) {
            return;
        }
        this.pendingVectorChunks.set(documentId, chunks);
        console.error(`[DocumentManager] Queued ${chunks.length} chunks for deferred vector indexing (${documentId})`);
    }

    private async flushPendingVectorChunks(): Promise<void> {
        if (this.pendingVectorFlush) {
            return;
        }
        if (!this.useVectorDb || !this.vectorDatabase || this.pendingVectorChunks.size === 0) {
            return;
        }
        const isInitialized = (this.vectorDatabase as any).isInitialized?.() ?? true;
        if (!isInitialized) {
            return;
        }

        this.pendingVectorFlush = true;
        try {
            for (const [documentId, chunks] of this.pendingVectorChunks.entries()) {
                try {
                    await this.vectorDatabase.addChunks(chunks);
                    this.pendingVectorChunks.delete(documentId);
                    console.error(`[DocumentManager] Flushed ${chunks.length} deferred chunks to vector DB (${documentId})`);
                } catch (error) {
                    console.error(`[DocumentManager] Failed to flush deferred chunks for ${documentId}:`, error);
                }
            }
        } finally {
            this.pendingVectorFlush = false;
        }
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

    private getDocumentPath(id: string): string {
        return path.join(this.dataDir, `${id}.json`);
    }

    private getDocumentMdPath(id: string): string {
        return path.join(this.dataDir, `${id}.md`);
    }

    async addDocument(title: string, content: string, metadata: Record<string, any> = {}): Promise<Document | null> {
        try {
            const id = this.generateId(content);
            const now = new Date().toISOString();

            // Detect language and check allowlist
            const confidenceThreshold = getLanguageConfidenceThreshold();
            const detectedLanguages = await detectLanguages(content, confidenceThreshold);
            const acceptedLanguages = getAcceptedLanguages();
            
            // Check if language is allowed (skip ingestion if not)
            if (!isLanguageAllowed(detectedLanguages, acceptedLanguages)) {
                console.warn(`[DocumentManager] Document rejected: language '${detectedLanguages.join(', ')}' not in accepted languages list`);
                return null;
            }

            const existingDocument = await this.getDocument(id);
            if (existingDocument) {
                if (metadata && Object.keys(metadata).length > 0) {
                    existingDocument.metadata = {
                        ...existingDocument.metadata,
                        ...metadata,
                    };
                    // Update languages if not already present
                    if (!existingDocument.metadata.languages) {
                        existingDocument.metadata.languages = detectedLanguages;
                    }
                    existingDocument.updated_at = now;
                    const filePath = this.getDocumentPath(id);
                    await writeFile(filePath, JSON.stringify(existingDocument, null, 2));

                    if (this.useIndexing && this.documentIndex) {
                        await this.ensureIndexInitialized();
                        this.documentIndex.addDocument(
                            existingDocument.id,
                            filePath,
                            existingDocument.content,
                            existingDocument.chunks,
                            existingDocument.title,
                            existingDocument.metadata
                        );
                    }
                }

                return existingDocument;
            }

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

            const chunks = await this.intelligentChunker.createChunks(id, content, chunkOptions, metadata, title);

            // DIAGNOSTIC: Log chunk status immediately after creation
            console.error(`[DocumentManager]   Total chunks: ${chunks.length}`);
            const chunksWithEmbeddings = chunks.filter(c => c.embeddings && c.embeddings.length > 0);
            console.error(`[DocumentManager]   Chunks with embeddings: ${chunksWithEmbeddings.length}`);
            if (chunksWithEmbeddings.length > 0 && chunksWithEmbeddings.length < chunks.length) {
                console.error(`[DocumentManager]   WARNING: Some chunks missing embeddings!`);
                chunks.forEach((chunk, idx) => {
                    const hasEmbedding = chunk.embeddings && chunk.embeddings.length > 0;
                    if (!hasEmbedding) {
                        console.error(`[DocumentManager]     Chunk ${idx} (${chunk.id}) has NO embedding - content_length: ${chunk.content.length}`);
                    }
                });
            }

            // Add detected languages to metadata
            const metadataWithLanguages = {
                ...metadata,
                languages: detectedLanguages,
            };

            const document: Document = {
                id,
                title,
                content,
                metadata: metadataWithLanguages,
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
            console.error(`[DocumentManager] === CHUNK STORAGE START ===`);
            console.error(`[DocumentManager] useVectorDb: ${this.useVectorDb}, vectorDatabase: ${!!this.vectorDatabase}`);
            
            if (this.useVectorDb && this.vectorDatabase) {
                try {
                    console.error(`[DocumentManager] Adding chunks to vector DB - useVectorDb: ${this.useVectorDb}, vectorDatabase exists: ${!!this.vectorDatabase}`);

                    // Filter chunks that have embeddings
                    const chunksWithEmbeddings = chunks.filter(chunk => chunk.embeddings && chunk.embeddings.length > 0);
                    console.error(`[DocumentManager] Total chunks: ${chunks.length}, Chunks with embeddings: ${chunksWithEmbeddings.length}`);

                    // DIAGNOSTIC: Log details of chunks without embeddings
                    const chunksWithoutEmbeddings = chunks.filter(chunk => !chunk.embeddings || chunk.embeddings.length === 0);
                    if (chunksWithoutEmbeddings.length > 0) {
                        chunksWithoutEmbeddings.forEach((chunk, idx) => {
                            console.error(`  [${idx}] chunk_id: ${chunk.id}, chunk_index: ${chunk.chunk_index}, content_length: ${chunk.content.length}, embeddings: ${chunk.embeddings ? chunk.embeddings.length : 'null'}`);
                        });
                    }

                    // Ensure vector DB is ready before adding chunks
                    const vectorDbReady = await this.ensureVectorDbReady();
                    if (!vectorDbReady) {
                        console.error('[DocumentManager] Vector DB not ready, queueing chunk indexing');
                        console.error('[DocumentManager] Possible causes: initialization timeout, init failure, or isInitialized() returning false');
                        this.queueVectorChunks(id, chunksWithEmbeddings);
                        return document;
                    }

                    // Check if vector DB is initialized (diagnostic)
                    const isInitialized = (this.vectorDatabase as any).isInitialized?.() ?? true;
                    console.error(`[DocumentManager] Vector DB initialized: ${isInitialized}`);
                    if (!isInitialized) {
                        console.error('[DocumentManager] CRITICAL: Vector DB reports not initialized even after ensureVectorDbReady() returned true!');
                    }

                    if (chunksWithEmbeddings.length > 0) {
                        console.error(`[DocumentManager] Calling addChunks for ${chunksWithEmbeddings.length} chunks...`);
                        await this.vectorDatabase.addChunks(chunksWithEmbeddings);
                        console.error(`[DocumentManager] Successfully added ${chunksWithEmbeddings.length} chunks to vector DB`);
                    } else {
                        console.warn(`[DocumentManager] No chunks with embeddings to add to vector DB (total: ${chunks.length})`);
                        console.warn(`[DocumentManager] CRITICAL: All chunks are missing embeddings! This will cause search to fail.`);
                    }
                } catch (error) {
                    console.error('[DocumentManager] FAILED to add chunks to vector database. Error:', error);
                    console.error('[DocumentManager] Error details:', {
                        message: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        name: error instanceof Error ? error.name : undefined
                    });
                    // Queue chunks for later retry instead of silently failing
                    const chunksWithEmbeddings = chunks.filter(chunk => chunk.embeddings && chunk.embeddings.length > 0);
                    if (chunksWithEmbeddings.length > 0) {
                        console.error('[DocumentManager] Queueing chunks for deferred indexing due to error');
                        this.queueVectorChunks(id, chunksWithEmbeddings);
                    }
                    // Continue without vector DB - non-critical error
                }
            } else {
                console.warn(`[DocumentManager] Vector DB not enabled or not available. useVectorDb: ${this.useVectorDb}, vectorDatabase: ${!!this.vectorDatabase}`);
            }

            const markdownCodeBlocks = extractMarkdownCodeBlocks(content);
            if (markdownCodeBlocks.length > 0) {
                try {
                    await this.addCodeBlocks(id, markdownCodeBlocks, {
                        source: metadata.source,
                        source_url: metadata.source_url,
                        crawl_id: metadata.crawl_id,
                        contentType: metadata.contentType || metadata.content_type,
                    });
                } catch (error) {
                    console.error('[DocumentManager] Failed to add code blocks:', error);
                    // Continue without code blocks - non-critical error
                }
            }

            console.error(`[DocumentManager] === CHUNK STORAGE END ===`);
            return document;
        } catch (error) {
            console.error('[DocumentManager] UNHANDLED ERROR in addDocument:', error);
            console.error('[DocumentManager] Error details:', {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                name: error instanceof Error ? error.name : undefined
            });
            // Re-throw to allow caller to handle the error
            throw new Error(`Failed to add document: ${error instanceof Error ? error.message : String(error)}`);
        }
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

    private getSimilarityThreshold(): number {
        const raw = process.env.MCP_SIMILARITY_THRESHOLD;
        const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
        return Number.isFinite(parsed) ? parsed : 0.0;
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
                        document.metadata = {
                            ...document.metadata,
                            tags_generated: tags
                        };
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
                        await this.deleteDocument(existingDoc.id);
                    }

                    // Create new document with embeddings
                    const document = await this.addDocument(title, content, {
                        source: 'upload',
                        originalFilename: fileName,
                        fileExtension: fileExtension,
                        processedAt: new Date().toISOString()
                    });

                    // Skip if document was rejected (e.g., language not allowed)
                    if (!document) {
                        errors.push(`File ${fileName} was rejected (possibly due to language restrictions)`);
                        continue;
                    }

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
            this.pendingVectorChunks.delete(documentId);
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
        const useReranking = options.useReranking ?? this.rerankingEnabled;

        // Apply default language filters if not specified
        if (!filters.languages) {
            const defaultLanguages = getDefaultQueryLanguages();
            if (defaultLanguages) {
                filters.languages = defaultLanguages;
                console.error(`[DocumentManager] Applying default language filter: ${defaultLanguages.join(', ')}`);
            }
        }

        console.error(`[DocumentManager] query START - queryText: "${queryText}", limit: ${limit}, offset: ${offset}`);
        console.error(`[DocumentManager] useVectorDb: ${this.useVectorDb}, vectorDatabase exists: ${!!this.vectorDatabase}`);
        console.error(`[DocumentManager] useReranking: ${useReranking}, reranker exists: ${!!this.reranker}`);

        // Stage 1: Vector search with candidate retrieval (5x for reranking pool)
        let candidates: DocumentDiscoveryResult[] = [];
        const candidateLimit = useReranking ? (limit + offset) * 5 : limit + offset + 10;
        
        if (this.useVectorDb && this.vectorDatabase) {
            console.error('[DocumentManager] Attempting vector search...');
            const vectorDbReady = await this.ensureVectorDbReady();
            console.error(`[DocumentManager] vectorDbReady: ${vectorDbReady}`);
            
            if (vectorDbReady) {
                try {
                    console.error('[DocumentManager] Generating query embedding...');
                    const queryEmbedding = await this.embeddingProvider.generateEmbedding(queryText);
                    console.error(`[DocumentManager] Query embedding generated with ${queryEmbedding.length} dimensions`);

                    if (Object.keys(filters).length > 0) {
                        console.error('[DocumentManager] Metadata filters will be applied after vector search (document-level filtering)');
                    }

                    const vectorResults = await this.vectorDatabase.search(
                        queryEmbedding,
                        candidateLimit
                    );
                    
                    console.error(`[DocumentManager] Vector search returned ${vectorResults.length} results`);
                    
                    // Log individual vector results for debugging
                    if (vectorResults.length > 0) {
                        console.error('[DocumentManager] Individual vector results:');
                        for (let i = 0; i < Math.min(5, vectorResults.length); i++) {
                            const result = vectorResults[i];
                            console.error(`  [${i}] doc_id: ${result.chunk.document_id}, score: ${result.score.toFixed(4)}`);
                        }
                        if (vectorResults.length > 5) {
                            console.error(`  ... and ${vectorResults.length - 5} more`);
                        }
                    }
                    
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
                    
                    console.error(`[DocumentManager] Grouped ${docScoreMap.size} unique documents`);
                    
                    // Convert to results with average scores
                    const similarityThreshold = this.getSimilarityThreshold();
                    console.error(`[DocumentManager] Similarity threshold: ${similarityThreshold}`);
                    
                    const preFilterResults = Array.from(docScoreMap.entries())
                        .map(([docId, data]) => ({
                            id: docId,
                            title: '',
                            score: data.score / data.chunks,
                            updated_at: '',
                            chunks_count: data.chunks
                        }));
                    
                    console.error(`[DocumentManager] Pre-filter results (${preFilterResults.length}):`);
                    for (const result of preFilterResults) {
                        console.error(`  doc_id: ${result.id}, avg_score: ${result.score.toFixed(4)}, chunks: ${result.chunks_count}`);
                    }
                    
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
                    
                    console.error(`[DocumentManager] Post-filter results: ${candidates.length} documents passed threshold`);
                } catch (error) {
                    console.error('[DocumentManager] Vector search failed, falling back to keyword search:', error);
                    console.error(`[DocumentManager] Error details: ${error instanceof Error ? error.message : String(error)}`);
                }
            } else {
                console.error('[DocumentManager] Vector DB not ready, skipping vector search');
            }
        } else {
            console.error('[DocumentManager] Vector DB not enabled, skipping vector search');
        }
        
        // Fall back to keyword search if vector search returned insufficient results
        const minVectorResults = Math.max(1, Math.floor(limit / 2));
        if (candidates.length < minVectorResults && this.useIndexing && this.documentIndex) {
            await this.ensureIndexInitialized();
            const keywordDocIds = this.documentIndex.searchByCombinedCriteria(queryText);

            // Build keyword results
            const keywordResults: DocumentDiscoveryResult[] = [];
            for (const docId of keywordDocIds) {
                // Skip if already in vector results
                if (candidates.some(r => r.id === docId)) continue;
                
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
            candidates = [...candidates, ...keywordResults];
        }
        
        // Stage 2: Rerank if enabled
        let results: DocumentDiscoveryResult[] = candidates;
        if (useReranking && this.reranker && candidates.length > 0) {
            try {
                console.error('[DocumentManager] Starting reranking stage...');
                
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
                
                console.error(`[DocumentManager] Reranking completed, got ${reranked.length} results`);
                
                // Map reranked indices to results
                results = this.mapRerankedResults(reranked, candidates);
                console.error(`[DocumentManager] Reranked ${results.length} documents`);
            } catch (error) {
                console.error('[DocumentManager] Reranking failed, using vector-only results:', error);
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
