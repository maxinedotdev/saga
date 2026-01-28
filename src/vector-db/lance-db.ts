/**
 * Vector Database Implementation
 * 
 * Provides an abstraction layer for vector storage and retrieval with
 * support for both LanceDB and in-memory storage as fallback.
 */

import * as path from "path";
import * as os from "os";
import { DocumentChunk, SearchResult, CodeBlock, CodeBlockSearchResult } from "../types.js";
import { getLogger } from "../utils.js";
import * as lancedb from "@lancedb/lancedb";
import { Index } from "@lancedb/lancedb";

const logger = getLogger("VectorDB");

/**
 * Vector database interface for storing and searching document chunks
 */
export interface VectorDatabase {
    /**
     * Initialize the vector database connection
     */
    initialize(): Promise<void>;

    /**
     * Add document chunks to the vector database
     * @param chunks - Array of document chunks with embeddings
     */
    addChunks(chunks: DocumentChunk[]): Promise<void>;

    /**
     * Remove all chunks for a specific document
     * @param documentId - Document ID to remove chunks for
     */
    removeChunks(documentId: string): Promise<void>;

    /**
     * Search for similar chunks using vector similarity
     * @param queryEmbedding - Query vector embedding
     * @param limit - Maximum number of results to return
     * @param filter - Optional SQL filter expression
     */
    search(queryEmbedding: number[], limit: number, filter?: string): Promise<SearchResult[]>;

    /**
     * Get a specific chunk by ID
     * @param chunkId - Chunk identifier
     */
    getChunk(chunkId: string): Promise<DocumentChunk | null>;

    /**
     * Close the database connection
     */
    close(): Promise<void>;
}

/**
 * LanceDB adapter implementation
 * Uses LanceDB for scalable, disk-based vector storage with HNSW indexing
 */
export class LanceDBAdapter implements VectorDatabase {
    private db: any = null;
    private table: any = null;
    private codeBlocksTable: any = null;
    private dbPath: string;
    private tableName: string;
    private codeBlocksTableName: string = "code_blocks";
    private initialized: boolean = false;
    private metadataSchemaKeys: Set<string> | null = null;

    constructor(dbPath: string, tableName: string = "chunks") {
        this.dbPath = dbPath;
        this.tableName = tableName;
    }

    async initialize(): Promise<void> {
        const startTime = Date.now();

        if (this.initialized) {
            return;
        }

        try {
            this.db = await lancedb.connect(this.dbPath);

            // Try to open existing table - will be created on first addChunks if it doesn't exist
            try {
                this.table = await this.db.openTable(this.tableName);
                logger.info(`Opened existing table: ${this.tableName}`);

                // Check if table has data and create vector index if needed
                const count = await this.table.countRows();
                if (count > 0) {
                    try {
                        // Add timeout to prevent hanging on index creation
                        const indexCreationPromise = this.table.createIndex("embedding", {
                            type: "ivf_pq",
                            metricType: "cosine",
                            num_partitions: 256,
                            num_sub_vectors: 16
                        });

                        const timeoutPromise = new Promise<never>((_, reject) => {
                            setTimeout(() => {
                                reject(new Error('Index creation timed out after 30 seconds'));
                            }, 30000); // 30 second timeout
                        });

                        await Promise.race([indexCreationPromise, timeoutPromise]);
                        logger.info("Created vector index on 'embedding' column");
                    } catch (error) {
                        // Index might already exist or timed out, which is fine
                        const isTimeout = error instanceof Error && error.message.includes('timed out');
                        if (isTimeout) {
                            console.warn('[LanceDBAdapter] Index creation timed out, continuing without index (search will still work but may be slower)');
                        } else {
                            logger.debug("Vector index already exists or creation failed:", error);
                        }
                    }
                }
            } catch (tableError) {
                // Table doesn't exist yet - will be created when first data is added
                this.table = null;
            }

            // Try to open code_blocks table - will be created on first addCodeBlocks if it doesn't exist
            try {
                this.codeBlocksTable = await this.db.openTable(this.codeBlocksTableName);
                logger.info(`Opened existing code_blocks table: ${this.codeBlocksTableName}`);

                // Check if code_blocks table has data and create indexes if needed
                const codeBlocksCount = await this.codeBlocksTable.countRows();

                if (codeBlocksCount > 0) {
                    // Create scalar indexes on document_id and language
                    try {
                        await this.codeBlocksTable.createIndex("document_id", { config: Index.btree() });
                        logger.info("Created scalar index on 'document_id' column");
                    } catch (error) {
                        logger.debug("Scalar index on document_id already exists or creation failed:", error);
                    }

                    try {
                        await this.codeBlocksTable.createIndex("language", { config: Index.btree() });
                        logger.info("Created scalar index on 'language' column");
                    } catch (error) {
                        logger.debug("Scalar index on language already exists or creation failed:", error);
                    }

                    // Create vector index on embedding
                    try {
                        const indexCreationPromise = this.codeBlocksTable.createIndex("embedding", {
                            type: "ivf_pq",
                            metricType: "cosine",
                            num_partitions: 256,
                            num_sub_vectors: 16
                        });

                        const timeoutPromise = new Promise<never>((_, reject) => {
                            setTimeout(() => {
                                reject(new Error('Code blocks index creation timed out after 30 seconds'));
                            }, 30000);
                        });

                        await Promise.race([indexCreationPromise, timeoutPromise]);
                        logger.info("Created vector index on code_blocks 'embedding' column");
                    } catch (error) {
                        const isTimeout = error instanceof Error && error.message.includes('timed out');
                        if (isTimeout) {
                            console.warn('[LanceDBAdapter] Code blocks index creation timed out, continuing without index');
                        } else {
                            logger.debug("Code blocks vector index already exists or creation failed:", error);
                        }
                    }
                }
            } catch (codeBlocksTableError) {
                // Table doesn't exist yet - will be created when first code blocks are added
                this.codeBlocksTable = null;
            }

            this.initialized = true;
            logger.info("LanceDB initialized successfully");
        } catch (error) {
            logger.error("Failed to initialize LanceDB:", error);
            throw new Error(`LanceDB initialization failed: ${error}`);
        }
    }

    async addChunks(chunks: DocumentChunk[]): Promise<void> {
        if (!this.initialized) {
            throw new Error("LanceDB not initialized");
        }

        try {
            const filteredChunks = chunks.filter(chunk => chunk.embeddings && chunk.embeddings.length > 0);
            if (filteredChunks.length === 0) {
                logger.warn("No chunks with embeddings provided, skipping LanceDB add");
                return;
            }

            const metadataSchemaKeys = this.table
                ? await this.resolveMetadataSchemaKeys()
                : this.collectMetadataKeys(filteredChunks);

            // Create table on first data insertion if it doesn't exist
            if (!this.table) {
                const orderedChunks = this.prioritizeChunkForSchemaInference(filteredChunks, metadataSchemaKeys);
                logger.info(`Creating table '${this.tableName}' with ${filteredChunks.length} initial chunks`);
                const data = orderedChunks.map(chunk => ({
                    id: chunk.id,
                    document_id: chunk.document_id,
                    chunk_index: chunk.chunk_index,
                    content: chunk.content,
                    embedding: chunk.embeddings || [],
                    metadata: this.normalizeMetadata(chunk.metadata, metadataSchemaKeys),
                    start_position: chunk.start_position,
                    end_position: chunk.end_position
                }));

                this.table = await this.db.createTable(this.tableName, data);
                this.metadataSchemaKeys = metadataSchemaKeys;
                
                // Create vector index after initial data is added
                try {
                    const indexCreationPromise = this.table.createIndex("embedding", {
                        type: "ivf_pq",
                        metricType: "cosine",
                        num_partitions: 256,
                        num_sub_vectors: 16
                    });

                    const timeoutPromise = new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(new Error('Index creation timed out after 30 seconds'));
                        }, 30000); // 30 second timeout
                    });

                    await Promise.race([indexCreationPromise, timeoutPromise]);
                    logger.info("Created vector index on 'embedding' column");
                } catch (error) {
                    const isTimeout = error instanceof Error && error.message.includes('timed out');
                    if (isTimeout) {
                        console.warn('[LanceDBAdapter] Index creation timed out, continuing without index (search will still work but may be slower)');
                    } else {
                        logger.debug("Vector index creation failed (may already exist):", error);
                    }
                }
            } else {
                // Table already exists, just add data
                const data = filteredChunks.map(chunk => ({
                    id: chunk.id,
                    document_id: chunk.document_id,
                    chunk_index: chunk.chunk_index,
                    content: chunk.content,
                    embedding: chunk.embeddings || [],
                    metadata: this.normalizeMetadata(chunk.metadata, metadataSchemaKeys),
                    start_position: chunk.start_position,
                    end_position: chunk.end_position
                }));

                await this.table.add(data);
            }
            
            logger.debug(`Added ${filteredChunks.length} chunks to LanceDB`);
        } catch (error) {
            logger.error("Failed to add chunks to LanceDB:", error);
            throw new Error(`Failed to add chunks: ${error}`);
        }
    }

    async removeChunks(documentId: string): Promise<void> {
        if (!this.initialized) {
            throw new Error("LanceDB not initialized");
        }
        
        if (!this.table) {
            // Table doesn't exist yet, nothing to remove
            logger.debug(`No table exists, skipping removal for document: ${documentId}`);
            return;
        }

        try {
            await this.table.delete(`document_id = '${documentId}'`);
            logger.debug(`Removed chunks for document: ${documentId}`);
        } catch (error) {
            logger.error(`Failed to remove chunks for document ${documentId}:`, error);
            throw new Error(`Failed to remove chunks: ${error}`);
        }
    }

    async search(queryEmbedding: number[], limit: number, filter?: string): Promise<SearchResult[]> {
        if (!this.initialized) {
            throw new Error("LanceDB not initialized");
        }
        
        if (!this.table) {
            // Table doesn't exist yet, return empty results
            logger.debug("No table exists, returning empty search results");
            return [];
        }

        try {
            const embeddingDimension = await this.resolveEmbeddingDimension();
            if (embeddingDimension && queryEmbedding.length !== embeddingDimension) {
                throw new Error(`Embedding dimension mismatch: table uses ${embeddingDimension}, query uses ${queryEmbedding.length}. Rebuild LanceDB or use a matching embedding model.`);
            }

            const query = this.table.search(queryEmbedding).limit(limit);
            
            if (filter) {
                query.where(filter);
            }

            const results = await query.toArray();
            
            return results.map((row: any) => ({
                chunk: {
                    id: row.id,
                    document_id: row.document_id,
                    chunk_index: row.chunk_index,
                    content: row.content,
                    embeddings: row.embedding,
                    start_position: row.start_position,
                    end_position: row.end_position,
                    metadata: row.metadata
                },
                // Normalize cosine similarity from [-1, 1] to [0, 1] for better UX
                score: row._distance ? (2 - row._distance) / 2 : 1
            })).sort((a: SearchResult, b: SearchResult) => b.score - a.score);
        } catch (error) {
            logger.error("Failed to search LanceDB:", error);
            throw new Error(`Failed to search: ${error}`);
        }
    }

    private async resolveEmbeddingDimension(): Promise<number | null> {
        if (!this.table) return null;
        try {
            const schema = await this.table.schema();
            const embeddingField = schema?.fields?.find((field: any) => field.name === 'embedding');
            const listSize = embeddingField?.type?.listSize;
            return typeof listSize === 'number' ? listSize : null;
        } catch (error) {
            logger.warn('Failed to resolve embedding dimension from LanceDB schema:', error);
            return null;
        }
    }

    private async resolveMetadataSchemaKeys(): Promise<Set<string> | null> {
        if (this.metadataSchemaKeys) {
            return this.metadataSchemaKeys;
        }
        if (!this.table) {
            return null;
        }

        try {
            const schema = await this.table.schema();
            const metadataField = schema?.fields?.find((field: any) => field.name === 'metadata');
            const children = metadataField?.type?.children;
            if (!children || !Array.isArray(children)) {
                return null;
            }
            this.metadataSchemaKeys = new Set(children.map((child: any) => child.name));
            return this.metadataSchemaKeys;
        } catch (error) {
            logger.warn('Failed to resolve metadata schema keys from LanceDB schema:', error);
            return null;
        }
    }

    private collectMetadataKeys(chunks: DocumentChunk[]): Set<string> {
        const keys = new Set<string>();
        for (const chunk of chunks) {
            if (!chunk.metadata) continue;
            for (const [key, value] of Object.entries(chunk.metadata)) {
                if (key === 'surrounding_context' || key === 'semantic_topic') {
                    continue;
                }
                const sanitized = this.sanitizeMetadataValue(value);
                if (sanitized !== null && sanitized !== undefined) {
                    keys.add(key);
                }
            }
        }
        return keys;
    }

    private prioritizeChunkForSchemaInference(
        chunks: DocumentChunk[],
        metadataSchemaKeys: Set<string> | null
    ): DocumentChunk[] {
        if (!metadataSchemaKeys || metadataSchemaKeys.size === 0 || chunks.length <= 1) {
            return chunks;
        }

        let bestIndex = 0;
        let bestScore = -1;

        for (let i = 0; i < chunks.length; i += 1) {
            const metadata = chunks[i].metadata;
            if (!metadata) continue;

            let score = 0;
            for (const key of metadataSchemaKeys) {
                if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
                    continue;
                }
                const value = this.sanitizeMetadataValue(metadata[key]);
                if (value !== null && value !== undefined) {
                    score += 1;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
                if (score === metadataSchemaKeys.size) {
                    break;
                }
            }
        }

        if (bestIndex === 0) {
            return chunks;
        }

        const reordered = chunks.slice();
        const [bestChunk] = reordered.splice(bestIndex, 1);
        reordered.unshift(bestChunk);
        return reordered;
    }

    private normalizeMetadata(
        metadata: Record<string, any> | undefined,
        allowedKeys: Set<string> | null
    ): Record<string, any> {
        if (!metadata) {
            return {};
        }

        const keys = allowedKeys ?? new Set(Object.keys(metadata));
        const normalized: Record<string, any> = {};

        for (const key of keys) {
            if (key === 'surrounding_context' || key === 'semantic_topic') {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(metadata, key)) {
                normalized[key] = null;
                continue;
            }
            const value = this.sanitizeMetadataValue(metadata[key]);
            if (value !== undefined) {
                normalized[key] = value;
            }
        }

        return normalized;
    }

    private sanitizeMetadataValue(value: any): any {
        if (value === null || value === undefined) {
            return null;
        }
        const valueType = typeof value;
        if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
            return value;
        }
        if (Array.isArray(value)) {
            const filtered = value.filter(item => {
                const itemType = typeof item;
                return itemType === 'string' || itemType === 'number' || itemType === 'boolean';
            });
            return filtered.length > 0 ? filtered : null;
        }
        return null;
    }

    async getChunk(chunkId: string): Promise<DocumentChunk | null> {
        if (!this.initialized) {
            throw new Error("LanceDB not initialized");
        }
        
        if (!this.table) {
            // Table doesn't exist yet
            return null;
        }

        try {
            const results = await this.table.query()
                .where(`id = '${chunkId}'`)
                .limit(1)
                .toArray();

            if (results.length === 0) {
                return null;
            }

            const row = results[0];
            return {
                id: row.id,
                document_id: row.document_id,
                chunk_index: row.chunk_index,
                content: row.content,
                embeddings: row.embedding,
                start_position: row.start_position,
                end_position: row.end_position,
                metadata: row.metadata
            };
        } catch (error) {
            logger.error(`Failed to get chunk ${chunkId}:`, error);
            return null;
        }
    }

    async close(): Promise<void> {
        if (this.db) {
            try {
                await this.db.close();
                logger.info("LanceDB connection closed");
            } catch (error) {
                logger.error("Error closing LanceDB:", error);
            }
        }
        this.initialized = false;
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Add code blocks to the code_blocks table
     * @param codeBlocks - Array of code blocks with embeddings to add
     */
    async addCodeBlocks(codeBlocks: CodeBlock[]): Promise<void> {
        if (!this.initialized) {
            throw new Error("LanceDB not initialized");
        }

        try {
            // Create code_blocks table on first data insertion if it doesn't exist
            if (!this.codeBlocksTable) {
                logger.info(`Creating code_blocks table with ${codeBlocks.length} initial code blocks`);
                this.codeBlocksTable = await this.db.createTable(this.codeBlocksTableName, codeBlocks.map(block => ({
                    id: block.id,
                    document_id: block.document_id,
                    block_id: block.block_id,
                    block_index: block.block_index,
                    language: block.language,
                    content: block.content,
                    embedding: block.embedding || [],
                    metadata: block.metadata || {},
                    source_url: block.source_url || '',
                })));

                // Create indexes after initial data is added
                try {
                    console.error('[LanceDBAdapter] Creating scalar indexes on initial code_blocks data...');
                    await this.codeBlocksTable.createIndex("document_id", { config: Index.btree() });
                    logger.info("Created scalar index on 'document_id' column");
                } catch (error) {
                    logger.debug("Scalar index creation failed (may already exist):", error);
                }

                try {
                    await this.codeBlocksTable.createIndex("language", { config: Index.btree() });
                    logger.info("Created scalar index on 'language' column");
                } catch (error) {
                    logger.debug("Scalar index on language creation failed (may already exist):", error);
                }

                // Create vector index with timeout
                try {
                    console.error('[LanceDBAdapter] Creating vector index on initial code_blocks data with 30 second timeout...');
                    const indexCreationPromise = this.codeBlocksTable.createIndex("embedding", {
                        type: "ivf_pq",
                        metricType: "cosine",
                        num_partitions: 256,
                        num_sub_vectors: 16
                    });

                    const timeoutPromise = new Promise<never>((_, reject) => {
                        setTimeout(() => {
                            reject(new Error('Code blocks index creation timed out after 30 seconds'));
                        }, 30000);
                    });

                    await Promise.race([indexCreationPromise, timeoutPromise]);
                    logger.info("Created vector index on code_blocks 'embedding' column");
                    console.error('[LanceDBAdapter] Code_blocks vector index created successfully');
                } catch (error) {
                    const isTimeout = error instanceof Error && error.message.includes('timed out');
                    if (isTimeout) {
                        console.warn('[LanceDBAdapter] Code blocks index creation timed out, continuing without index');
                    } else {
                        logger.debug("Code blocks vector index creation failed (may already exist):", error);
                    }
                }
            } else {
                // Table already exists, just add data
                const data = codeBlocks.map(block => ({
                    id: block.id,
                    document_id: block.document_id,
                    block_id: block.block_id,
                    block_index: block.block_index,
                    language: block.language,
                    content: block.content,
                    embedding: block.embedding || [],
                    metadata: block.metadata || {},
                    source_url: block.source_url || '',
                }));

                await this.codeBlocksTable.add(data);
            }

            logger.debug(`Added ${codeBlocks.length} code blocks to LanceDB`);
        } catch (error) {
            logger.error("Failed to add code blocks to LanceDB:", error);
            throw new Error(`Failed to add code blocks: ${error}`);
        }
    }

    /**
     * Search code blocks using vector similarity
     * @param queryEmbedding - Query vector embedding
     * @param limit - Maximum number of results to return
     * @param language - Optional language filter (e.g., 'javascript', 'python')
     */
    async searchCodeBlocks(
        queryEmbedding: number[],
        limit: number,
        language?: string
    ): Promise<CodeBlockSearchResult[]> {
        if (!this.initialized) {
            throw new Error("LanceDB not initialized");
        }

        if (!this.codeBlocksTable) {
            // Table doesn't exist yet, return empty results
            logger.debug("No code_blocks table exists, returning empty search results");
            return [];
        }

        try {
            const query = this.codeBlocksTable.search(queryEmbedding).limit(limit);

            // Apply language filter if provided
            if (language) {
                const normalizedLanguage = language.toLowerCase().trim();
                query.where(`language = '${normalizedLanguage}'`);
            }

            const results = await query.toArray();

            return results.map((row: any) => ({
                code_block: {
                    id: row.id,
                    document_id: row.document_id,
                    block_id: row.block_id,
                    block_index: row.block_index,
                    language: row.language,
                    content: row.content,
                    embedding: row.embedding,
                    metadata: row.metadata,
                    source_url: row.source_url,
                },
                // Normalize cosine similarity from [-1, 1] to [0, 1] for better UX
                score: row._distance ? (2 - row._distance) / 2 : 1,
            })).sort((a: CodeBlockSearchResult, b: CodeBlockSearchResult) => b.score - a.score);
        } catch (error) {
            logger.error("Failed to search code blocks:", error);
            throw new Error(`Failed to search code blocks: ${error}`);
        }
    }

    /**
     * Get all code blocks for a specific document
     * @param documentId - Document ID to get code blocks for
     */
    async getCodeBlocksByDocument(documentId: string): Promise<CodeBlock[]> {
        if (!this.initialized) {
            throw new Error("LanceDB not initialized");
        }

        if (!this.codeBlocksTable) {
            return [];
        }

        try {
            const results = await this.codeBlocksTable.query()
                .where(`document_id = '${documentId}'`)
                .toArray();

            return results.map((row: any) => ({
                id: row.id,
                document_id: row.document_id,
                block_id: row.block_id,
                block_index: row.block_index,
                language: row.language,
                content: row.content,
                embedding: row.embedding,
                metadata: row.metadata,
                source_url: row.source_url,
            })).sort((a: CodeBlock, b: CodeBlock) => a.block_index - b.block_index);
        } catch (error) {
            logger.error(`Failed to get code blocks for document ${documentId}:`, error);
            return [];
        }
    }
}

/**
 * Factory function to create LanceDB vector database instance
 */
export function createVectorDatabase(dbPath?: string): VectorDatabase {
    const dbPathValue = dbPath || path.join(os.homedir(), ".data", "lancedb");
    return new LanceDBAdapter(dbPathValue);
}
