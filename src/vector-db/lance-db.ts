/**
 * Vector Database Implementation
 * 
 * Provides an abstraction layer for vector storage and retrieval with
 * support for both LanceDB and in-memory storage as fallback.
 */

import * as path from "path";
import * as os from "os";
import { DocumentChunk, SearchResult } from "../types.js";
import { getLogger } from "../utils.js";
import * as lancedb from "@lancedb/lancedb";

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
    private dbPath: string;
    private tableName: string;
    private initialized: boolean = false;

    constructor(dbPath: string, tableName: string = "chunks") {
        this.dbPath = dbPath;
        this.tableName = tableName;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            logger.info(`Initializing LanceDB at: ${this.dbPath}`);
            this.db = await lancedb.connect(this.dbPath);
            
            // Try to open existing table - will be created on first addChunks if it doesn't exist
            try {
                this.table = await this.db.openTable(this.tableName);
                logger.info(`Opened existing table: ${this.tableName}`);
                
                // Check if table has data and create vector index if needed
                const count = await this.table.countRows();
                if (count > 0) {
                    try {
                        await this.table.createIndex("embedding", {
                            type: "ivf_pq",
                            metricType: "cosine",
                            num_partitions: 256,
                            num_sub_vectors: 16
                        });
                        logger.info("Created vector index on 'embedding' column");
                    } catch (error) {
                        // Index might already exist, which is fine
                        logger.debug("Vector index already exists or creation failed:", error);
                    }
                }
            } catch {
                // Table doesn't exist yet - will be created when first data is added
                logger.info(`Table '${this.tableName}' does not exist yet, will be created on first data insertion`);
                this.table = null;
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
            // Create table on first data insertion if it doesn't exist
            if (!this.table) {
                logger.info(`Creating table '${this.tableName}' with ${chunks.length} initial chunks`);
                this.table = await this.db.createTable(this.tableName, chunks.map(chunk => ({
                    id: chunk.id,
                    document_id: chunk.document_id,
                    chunk_index: chunk.chunk_index,
                    content: chunk.content,
                    embedding: chunk.embeddings || [],
                    metadata: chunk.metadata || {},
                    start_position: chunk.start_position,
                    end_position: chunk.end_position
                })));
                
                // Create vector index after initial data is added
                try {
                    await this.table.createIndex("embedding", {
                        type: "ivf_pq",
                        metricType: "cosine",
                        num_partitions: 256,
                        num_sub_vectors: 16
                    });
                    logger.info("Created vector index on 'embedding' column");
                } catch (error) {
                    logger.debug("Vector index creation failed (may already exist):", error);
                }
            } else {
                // Table already exists, just add data
                const data = chunks.map(chunk => ({
                    id: chunk.id,
                    document_id: chunk.document_id,
                    chunk_index: chunk.chunk_index,
                    content: chunk.content,
                    embedding: chunk.embeddings || [],
                    metadata: chunk.metadata || {},
                    start_position: chunk.start_position,
                    end_position: chunk.end_position
                }));

                await this.table.add(data);
            }
            
            logger.debug(`Added ${chunks.length} chunks to LanceDB`);
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
                score: row._distance ? 1 - row._distance : 1 // Convert distance to similarity
            })).sort((a: SearchResult, b: SearchResult) => b.score - a.score);
        } catch (error) {
            logger.error("Failed to search LanceDB:", error);
            throw new Error(`Failed to search: ${error}`);
        }
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
}

/**
 * In-memory vector database implementation
 * Used as fallback when LanceDB is not available
 */
export class InMemoryVectorDB implements VectorDatabase {
    private chunks: Map<string, DocumentChunk> = new Map();
    private initialized: boolean = false;

    async initialize(): Promise<void> {
        this.initialized = true;
        logger.info("In-memory vector database initialized");
    }

    async addChunks(chunks: DocumentChunk[]): Promise<void> {
        for (const chunk of chunks) {
            this.chunks.set(chunk.id, chunk);
        }
        logger.debug(`Added ${chunks.length} chunks to in-memory DB`);
    }

    async removeChunks(documentId: string): Promise<void> {
        for (const [chunkId, chunk] of this.chunks) {
            if (chunk.document_id === documentId) {
                this.chunks.delete(chunkId);
            }
        }
        logger.debug(`Removed chunks for document: ${documentId}`);
    }

    async search(queryEmbedding: number[], limit: number, filter?: string): Promise<SearchResult[]> {
        const results: SearchResult[] = [];

        for (const chunk of this.chunks.values()) {
            // Apply filter if provided
            if (filter) {
                // Simple filter implementation - check metadata
                // This is a basic implementation, could be enhanced
                if (!this.matchesFilter(chunk, filter)) {
                    continue;
                }
            }

            // Calculate cosine similarity
            if (chunk.embeddings && chunk.embeddings.length > 0) {
                const score = this.cosineSimilarity(queryEmbedding, chunk.embeddings);
                results.push({ chunk, score });
            }
        }

        // Sort by score and limit
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, limit);
    }

    async getChunk(chunkId: string): Promise<DocumentChunk | null> {
        return this.chunks.get(chunkId) || null;
    }

    async close(): Promise<void> {
        this.chunks.clear();
        this.initialized = false;
        logger.info("In-memory vector database closed");
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

    private matchesFilter(chunk: DocumentChunk, filter: string): boolean {
        // Basic filter matching - can be enhanced
        // For now, just check if metadata matches simple patterns
        if (!chunk.metadata) return false;

        // Check if filter contains metadata key-value pairs
        const matches = filter.match(/(\w+)\s*=\s*['"]([^'"]+)['"]/g);
        if (!matches) return true; // No filter conditions

        for (const match of matches) {
            const [, key, value] = match.match(/(\w+)\s*=\s*['"]([^'"]+)['"]/) || [];
            
            // Check both metadata and direct chunk properties
            const chunkValue = chunk.metadata[key] ?? (chunk as any)[key];

            // Handle type conversion for boolean values
            if (value === 'true' || value === 'false') {
                if (chunkValue !== (value === 'true')) {
                    return false;
                }
            }
            // Handle numeric values
            else if (!isNaN(Number(value))) {
                if (chunkValue !== Number(value)) {
                    return false;
                }
            }
            // String comparison
            else if (chunkValue !== value) {
                return false;
            }
        }

        return true;
    }
}

/**
 * Factory function to create vector database instance based on configuration
 */
export function createVectorDatabase(
    dbType: string = "lance",
    dbPath?: string
): VectorDatabase {
    const type = dbType.toLowerCase();

    switch (type) {
        case "lance":
        case "lancedb":
            const dbPathValue = dbPath || path.join(os.homedir(), ".data", "lancedb");
            return new LanceDBAdapter(dbPathValue);
        
        case "memory":
        case "inmemory":
            return new InMemoryVectorDB();
        
        default:
            logger.warn(`Unknown vector database type: ${type}, falling back to in-memory`);
            return new InMemoryVectorDB();
    }
}
