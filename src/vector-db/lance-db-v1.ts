/**
 * Saga v1.0.0 LanceDB Implementation
 *
 * New LanceDB implementation for the v1.0.0 schema with flattened metadata,
 * normalized tables, and LanceDB as the single source of truth.
 */

import * as crypto from 'crypto';
import * as lancedb from '@lancedb/lancedb';
import { Index } from '@lancedb/lancedb';
import { getLogger } from '../utils.js';
import type {
    DocumentV1,
    DocumentTagV1,
    DocumentLanguageV1,
    ChunkV1,
    CodeBlockV1,
    KeywordV1,
    QueryOptionsV1,
    QueryResultV1,
    QueryResponseV1,
    QueryPaginationV1,
    DocumentMetadataV1,
    DatabaseStats,
    LanceDB,
    LanceTable
} from '../types/database-v1.js';

const logger = getLogger('LanceDBV1');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
    return crypto.randomUUID();
}

/**
 * Get current ISO 8601 timestamp
 */
function getCurrentTimestamp(): string {
    return new Date().toISOString();
}

/**
 * Generate a sample embedding vector for schema inference
 * Creates a 1536-dimensional vector with float32 values (all zeros)
 * This allows LanceDB to properly infer the embedding field type
 */
function generateSampleEmbedding(dim: number = 1536): number[] {
    return new Array(dim).fill(0);
}

/**
 * Calculate SHA-256 hash of content (truncated to 16 chars)
 */
function calculateContentHash(content: string): string {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return hash.substring(0, 16);
}

/**
 * Calculate dynamic IVF_PQ parameters based on vector count and dimension
 */
function calculateIVF_PQ_Params(vectorCount: number, embeddingDim: number) {
    const numPartitions = Math.max(16, Math.floor(Math.sqrt(vectorCount)));
    const numSubVectors = Math.max(4, Math.floor(embeddingDim / 16));
    
    return {
        type: 'ivf_pq',
        metricType: 'cosine',
        num_partitions: Math.min(numPartitions, 2048),
        num_sub_vectors: Math.min(numSubVectors, 256)
    };
}

/**
 * Retry logic with exponential backoff
 */
async function withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 5,
    baseDelayMs: number = 100
): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            const isCommitConflict = error instanceof Error &&
                (error.message.includes('commit conflict') ||
                 error.message.includes('Transaction'));
            
            if (!isCommitConflict || attempt === maxRetries) {
                throw error;
            }
            
            const delay = Math.min(5000, baseDelayMs * Math.pow(2, attempt));
            logger.warn(`${operationName} conflict on attempt ${attempt + 1}, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw new Error(`${operationName} failed after ${maxRetries} retries`);
}

// ============================================================================
// LanceDBV1 Class
// ============================================================================

/**
 * LanceDB v1.0.0 implementation
 * 
 * Provides a complete database interface for the new v1.0.0 schema with:
 * - Flattened metadata
 * - Normalized tables
 * - LanceDB as single source of truth
 * - Dynamic IVF_PQ indexes
 * - Comprehensive scalar indexes
 */
export class LanceDBV1 {
    private db: LanceDB | null = null;
    private dbPath: string;
    private initialized: boolean = false;
    private embeddingDim: number;
    
    // Table references
    private documentsTable: LanceTable | null = null;
    private documentTagsTable: LanceTable | null = null;
    private documentLanguagesTable: LanceTable | null = null;
    private chunksTable: LanceTable | null = null;
    private codeBlocksTable: LanceTable | null = null;
    private keywordsTable: LanceTable | null = null;
    private schemaVersionTable: LanceTable | null = null;
    
    /**
     * Create a new LanceDBV1 instance
     * 
     * @param dbPath - Path to the LanceDB database directory
     * @param options - Configuration options
     */
    constructor(
        dbPath: string,
        options: {
            embeddingDim?: number;
        } = {}
    ) {
        this.dbPath = dbPath;
        this.embeddingDim = options.embeddingDim || 1536;
    }
    
    /**
     * Initialize the database connection and schema
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            logger.info('Database already initialized');
            return;
        }
        
        logger.info(`Initializing LanceDB v1.0.0 at: ${this.dbPath}`);
        
        try {
            // Connect to database
            this.db = await lancedb.connect(this.dbPath);
            
            // Open or create tables
            await this.openOrCreateTables();
            
            // Check if indexes need to be created
            await this.ensureIndexes();
            
            this.initialized = true;
            logger.info('LanceDB v1.0.0 initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize LanceDB v1.0.0:', error);
            throw new Error(`LanceDB v1.0.0 initialization failed: ${error}`);
        }
    }
    
    /**
     * Open or create all required tables
     */
    private async openOrCreateTables(): Promise<void> {
        const tableNames = [
            'documents',
            'document_tags',
            'document_languages',
            'chunks',
            'code_blocks',
            'keywords',
            'schema_version'
        ];
        
        for (const tableName of tableNames) {
            try {
                const table = await this.db!.openTable(tableName);
                this.setTableReference(tableName, table);
                logger.debug(`Opened existing table: ${tableName}`);
            } catch (error) {
                if ((error as Error).message.includes('Table not found')) {
                    logger.debug(`Creating new table: ${tableName}`);
                    let sampleData: any[] = [];
                    
                    // Create sample data for schema inference
                    switch (tableName) {
                        case 'documents':
                            sampleData = [{
                                id: generateUUID(),
                                title: '',
                                content_hash: '',
                                content_length: 0,
                                source: 'upload',
                                original_filename: '',
                                file_extension: '',
                                crawl_id: '',
                                crawl_url: '',
                                author: '',
                                description: '',
                                content_type: '',
                                created_at: getCurrentTimestamp(),
                                updated_at: getCurrentTimestamp(),
                                processed_at: getCurrentTimestamp(),
                                chunks_count: 0,
                                code_blocks_count: 0,
                                status: 'active'
                            }];
                            break;
                        case 'document_tags':
                            sampleData = [{
                                id: generateUUID(),
                                document_id: '',
                                tag: '',
                                is_generated: false,
                                created_at: getCurrentTimestamp()
                            }];
                            break;
                        case 'document_languages':
                            sampleData = [{
                                id: generateUUID(),
                                document_id: '',
                                language_code: '',
                                created_at: getCurrentTimestamp()
                            }];
                            break;
                        case 'chunks':
                            sampleData = [{
                                id: generateUUID(),
                                document_id: '',
                                chunk_index: 0,
                                start_position: 0,
                                end_position: 0,
                                content: '',
                                content_length: 0,
                                embedding: generateSampleEmbedding(),
                                surrounding_context: '',
                                semantic_topic: '',
                                created_at: getCurrentTimestamp()
                            }];
                            break;
                        case 'code_blocks':
                            sampleData = [{
                                id: generateUUID(),
                                document_id: '',
                                block_id: '',
                                block_index: 0,
                                language: '',
                                content: '',
                                content_length: 0,
                                embedding: generateSampleEmbedding(),
                                source_url: '',
                                created_at: getCurrentTimestamp()
                            }];
                            break;
                        case 'keywords':
                            sampleData = [{
                                id: generateUUID(),
                                keyword: '',
                                document_id: '',
                                source: 'title',
                                frequency: 0,
                                created_at: getCurrentTimestamp()
                            }];
                            break;
                        case 'schema_version':
                            sampleData = [{
                                id: 0,
                                version: '',
                                applied_at: getCurrentTimestamp(),
                                description: ''
                            }];
                            break;
                    }
                    
                    const table = await this.db!.createTable(tableName, sampleData);
                    this.setTableReference(tableName, table);
                } else {
                    throw error;
                }
            }
        }
    }
    
    /**
     * Set table reference by name
     */
    private setTableReference(tableName: string, table: LanceTable): void {
        switch (tableName) {
            case 'documents':
                this.documentsTable = table;
                break;
            case 'document_tags':
                this.documentTagsTable = table;
                break;
            case 'document_languages':
                this.documentLanguagesTable = table;
                break;
            case 'chunks':
                this.chunksTable = table;
                break;
            case 'code_blocks':
                this.codeBlocksTable = table;
                break;
            case 'keywords':
                this.keywordsTable = table;
                break;
            case 'schema_version':
                this.schemaVersionTable = table;
                break;
        }
    }
    
    /**
     * Ensure indexes exist on all tables
     */
    private async ensureIndexes(): Promise<void> {
        // Create scalar indexes if they don't exist
        await this.createScalarIndexesIfNotExists();
        
        // Create vector indexes if data exists and indexes don't
        await this.createVectorIndexesIfNotExists();
    }
    
    /**
     * Create scalar indexes if they don't exist
     */
    private async createScalarIndexesIfNotExists(): Promise<void> {
        const scalarIndexes = [
            { table: 'documents', columns: ['id', 'content_hash', 'source', 'crawl_id', 'status', 'created_at'] },
            { table: 'chunks', columns: ['document_id', 'chunk_index', 'created_at'] },
            { table: 'code_blocks', columns: ['document_id', 'block_index', 'language', 'created_at'] },
            { table: 'document_tags', columns: ['document_id', 'tag'] },
            { table: 'document_languages', columns: ['document_id', 'language_code'] },
            { table: 'keywords', columns: ['keyword', 'document_id'] }
        ];
        
        for (const { table, columns } of scalarIndexes) {
            const tableRef = this.getTableReference(table);
            if (!tableRef) continue;
            
            for (const column of columns) {
                try {
                    await tableRef.createIndex(column, { config: Index.btree() });
                    logger.debug(`Created scalar index on ${table}.${column}`);
                } catch (error) {
                    // Index might already exist
                    if ((error as Error).message.includes('already exists')) {
                        logger.debug(`Scalar index already exists on ${table}.${column}`);
                    } else {
                        logger.warn(`Failed to create scalar index on ${table}.${column}:`, error);
                    }
                }
            }
        }
    }
    
    /**
     * Create vector indexes if data exists and indexes don't
     */
    private async createVectorIndexesIfNotExists(): Promise<void> {
        const vectorTables = ['chunks', 'code_blocks'];
        
        for (const tableName of vectorTables) {
            const tableRef = this.getTableReference(tableName);
            if (!tableRef) continue;
            
            try {
                const count = await tableRef.countRows();
                
                if (count > 0) {
                    const config = calculateIVF_PQ_Params(count, this.embeddingDim);
                    
                    try {
                        await tableRef.createIndex('embedding', {
                            type: config.type,
                            metricType: config.metricType,
                            num_partitions: config.num_partitions,
                            num_sub_vectors: config.num_sub_vectors
                        });
                        logger.info(`Created vector index on ${tableName} with partitions=${config.num_partitions}, sub_vectors=${config.num_sub_vectors}`);
                    } catch (error) {
                        if ((error as Error).message.includes('already exists')) {
                            logger.debug(`Vector index already exists on ${tableName}`);
                        } else {
                            logger.warn(`Failed to create vector index on ${tableName}:`, error);
                        }
                    }
                }
            } catch (error) {
                logger.warn(`Failed to check vector index for ${tableName}:`, error);
            }
        }
    }
    
    /**
     * Get table reference by name
     */
    private getTableReference(tableName: string): LanceTable | null {
        switch (tableName) {
            case 'documents':
                return this.documentsTable;
            case 'document_tags':
                return this.documentTagsTable;
            case 'document_languages':
                return this.documentLanguagesTable;
            case 'chunks':
                return this.chunksTable;
            case 'code_blocks':
                return this.codeBlocksTable;
            case 'keywords':
                return this.keywordsTable;
            case 'schema_version':
                return this.schemaVersionTable;
            default:
                return null;
        }
    }
    
    /**
     * Add a document with tags and languages
     * 
     * @param doc - Document to add
     * @returns The document ID
     */
    async addDocument(doc: Omit<DocumentV1, 'id' | 'created_at' | 'updated_at' | 'processed_at'>): Promise<string> {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        const documentId = generateUUID();
        const now = getCurrentTimestamp();
        
        return withRetry(async () => {
            // Create document
            const document: DocumentV1 = {
                id: documentId,
                ...doc,
                created_at: now,
                updated_at: now,
                processed_at: now
            };
            
            await this.documentsTable!.add([document]);
            
            logger.debug(`Added document: ${documentId}`);
            return documentId;
        }, 'addDocument');
    }
    
    /**
     * Add chunks in batches
     * 
     * @param chunks - Chunks to add
     * @param batchSize - Batch size for insertion (default: 1000)
     */
    async addChunks(chunks: Omit<ChunkV1, 'id' | 'created_at'>[], batchSize: number = 1000): Promise<void> {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        const now = getCurrentTimestamp();
        
        return withRetry(async () => {
            for (let i = 0; i < chunks.length; i += batchSize) {
                const batch = chunks.slice(i, i + batchSize);
                const chunksWithIds: ChunkV1[] = batch.map(chunk => ({
                    id: generateUUID(),
                    ...chunk,
                    created_at: now
                }));
                
                await this.chunksTable!.add(chunksWithIds);
                logger.debug(`Added ${chunksWithIds.length} chunks (batch ${Math.floor(i / batchSize) + 1})`);
            }
        }, 'addChunks');
    }
    
    /**
     * Add code blocks in batches
     * 
     * @param blocks - Code blocks to add
     * @param batchSize - Batch size for insertion (default: 1000)
     */
    async addCodeBlocks(blocks: Omit<CodeBlockV1, 'id' | 'created_at'>[], batchSize: number = 1000): Promise<void> {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        const now = getCurrentTimestamp();
        
        return withRetry(async () => {
            for (let i = 0; i < blocks.length; i += batchSize) {
                const batch = blocks.slice(i, i + batchSize);
                const blocksWithIds: CodeBlockV1[] = batch.map(block => ({
                    id: generateUUID(),
                    ...block,
                    created_at: now
                }));
                
                await this.codeBlocksTable!.add(blocksWithIds);
                logger.debug(`Added ${blocksWithIds.length} code blocks (batch ${Math.floor(i / batchSize) + 1})`);
            }
        }, 'addCodeBlocks');
    }
    
    /**
     * Query by vector embedding
     * 
     * @param embedding - Query vector embedding
     * @param options - Query options
     * @returns Query results
     */
    async queryByVector(
        embedding: number[],
        options: QueryOptionsV1 = {}
    ): Promise<QueryResponseV1> {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        const limit = options.limit || 10;
        const offset = options.offset || 0;
        const includeMetadata = options.include_metadata ?? true;
        
        try {
            // Perform vector search
            const query = this.chunksTable!.search(embedding).limit(limit + offset);
            
            // Apply filters if provided
            if (options.filters) {
                const conditions: string[] = [];
                
                if (options.filters.tags && options.filters.tags.length > 0) {
                    const tags = options.filters.tags.map(t => `'${t.toLowerCase()}'`).join(', ');
                    conditions.push(`document_id IN (SELECT document_id FROM document_tags WHERE tag IN (${tags}))`);
                }
                
                if (options.filters.languages && options.filters.languages.length > 0) {
                    const languages = options.filters.languages.map(l => `'${l.toLowerCase()}'`).join(', ');
                    conditions.push(`document_id IN (SELECT document_id FROM document_languages WHERE language_code IN (${languages}))`);
                }
                
                if (options.filters.source && options.filters.source.length > 0) {
                    const sources = options.filters.source.map(s => `'${s}'`).join(', ');
                    conditions.push(`document_id IN (SELECT id FROM documents WHERE source IN (${sources}))`);
                }
                
                if (options.filters.crawl_id) {
                    conditions.push(`document_id IN (SELECT id FROM documents WHERE crawl_id = '${options.filters.crawl_id}')`);
                }
                
                if (options.filters.status && options.filters.status.length > 0) {
                    const statuses = options.filters.status.map(s => `'${s}'`).join(', ');
                    conditions.push(`document_id IN (SELECT id FROM documents WHERE status IN (${statuses}))`);
                }
                
                if (conditions.length > 0) {
                    query.where(conditions.join(' AND '));
                }
            }
            
            const results = await query.toArray();
            
            // Build query results
            const queryResults: QueryResultV1[] = [];
            const documentIds = new Set<string>();
            
            for (const row of results.slice(offset)) {
                const documentId = row.document_id;
                documentIds.add(documentId);
                
                const result: QueryResultV1 = {
                    document_id: documentId,
                    title: '', // Will be filled below
                    score: row._distance ? (2 - row._distance) / 2 : 1,
                    chunk: {
                        id: row.id,
                        content: row.content,
                        chunk_index: row.chunk_index
                    }
                };
                
                queryResults.push(result);
            }
            
            // Fetch document metadata if requested
            if (includeMetadata && documentIds.size > 0) {
                const documents = await this.documentsTable!
                    .query()
                    .where(`id IN (${Array.from(documentIds).map(id => `'${id}'`).join(', ')})`)
                    .toArray();
                
                const documentMap = new Map(documents.map((doc: any) => [doc.id, doc]));
                
                // Batch fetch all tags and languages in single queries (fix N+1 problem)
                const allTags = await this.documentTagsTable!
                    .query()
                    .where(`document_id IN (${Array.from(documentIds).map(id => `'${id}'`).join(', ')})`)
                    .toArray();
                
                const allLanguages = await this.documentLanguagesTable!
                    .query()
                    .where(`document_id IN (${Array.from(documentIds).map(id => `'${id}'`).join(', ')})`)
                    .toArray();
                
                // Build maps for efficient lookup
                const tagsMap = new Map<string, string[]>();
                for (const tag of allTags) {
                    const docId = tag.document_id;
                    if (!tagsMap.has(docId)) {
                        tagsMap.set(docId, []);
                    }
                    tagsMap.get(docId)!.push(tag.tag);
                }
                
                const languagesMap = new Map<string, string[]>();
                for (const lang of allLanguages) {
                    const docId = lang.document_id;
                    if (!languagesMap.has(docId)) {
                        languagesMap.set(docId, []);
                    }
                    languagesMap.get(docId)!.push(lang.language_code);
                }
                
                for (const result of queryResults) {
                    const doc = documentMap.get(result.document_id);
                    if (doc) {
                        result.title = (doc as any).title;
                        
                        if (includeMetadata) {
                            result.metadata = {
                                author: (doc as any).author,
                                description: (doc as any).description,
                                content_type: (doc as any).content_type,
                                source: (doc as any).source,
                                tags: tagsMap.get(result.document_id) || [],
                                languages: languagesMap.get(result.document_id) || [],
                                created_at: (doc as any).created_at,
                                updated_at: (doc as any).updated_at,
                                chunks_count: (doc as any).chunks_count,
                                code_blocks_count: (doc as any).code_blocks_count
                            };
                        }
                    }
                }
            }
            
            // Calculate pagination (only count rows if needed for pagination)
            let pagination: QueryPaginationV1;
            if (offset > 0 || queryResults.length >= limit) {
                // Only count if we might need pagination info
                const totalCount = await this.chunksTable!.countRows();
                pagination = {
                    total_documents: totalCount,
                    returned: queryResults.length,
                    has_more: offset + limit < totalCount,
                    next_offset: offset + limit < totalCount ? offset + limit : null
                };
            } else {
                // Skip expensive countRows() call for simple queries
                pagination = {
                    total_documents: queryResults.length,
                    returned: queryResults.length,
                    has_more: queryResults.length >= limit,
                    next_offset: queryResults.length >= limit ? offset + limit : null
                };
            }
            
            return {
                results: queryResults,
                pagination
            };
        } catch (error) {
            logger.error('Error querying by vector:', error);
            throw new Error(`Vector query failed: ${error}`);
        }
    }
    
    /**
     * Get all chunks for a document
     * 
     * @param documentId - Document ID
     * @returns Array of chunks
     */
    async queryByDocumentId(documentId: string): Promise<ChunkV1[]> {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        try {
            const results = await this.chunksTable!
                .query()
                .where(`document_id = '${documentId}'`)
                .toArray();
            
            return results.map((row: any) => ({
                id: row.id,
                document_id: row.document_id,
                chunk_index: row.chunk_index,
                start_position: row.start_position,
                end_position: row.end_position,
                content: row.content,
                content_length: row.content_length,
                embedding: row.embedding,
                surrounding_context: row.surrounding_context,
                semantic_topic: row.semantic_topic,
                created_at: row.created_at
            })).sort((a: any, b: any) => a.chunk_index - b.chunk_index);
        } catch (error) {
            logger.error(`Error querying chunks for document ${documentId}:`, error);
            throw new Error(`Document query failed: ${error}`);
        }
    }
    
    /**
     * Search by tags
     * 
     * @param tags - Array of tags to search for
     * @returns Array of document IDs
     */
    async queryByTags(tags: string[]): Promise<string[]> {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        try {
            const tagConditions = tags.map(t => `'${t.toLowerCase()}'`).join(', ');
            const results = await this.documentTagsTable!
                .query()
                .where(`tag IN (${tagConditions})`)
                .toArray();
            
            // Return unique document IDs
            const documentIds = new Set(results.map((r: any) => r.document_id));
            return Array.from(documentIds) as string[];
        } catch (error) {
            logger.error('Error querying by tags:', error);
            throw new Error(`Tag query failed: ${error}`);
        }
    }
    
    /**
     * Search by keywords using inverted index
     * 
     * @param keywords - Array of keywords to search for
     * @returns Array of document IDs with scores
     */
    async queryByKeywords(keywords: string[]): Promise<Array<{ document_id: string; score: number }>> {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        try {
            const keywordConditions = keywords.map(k => `'${k.toLowerCase()}'`).join(', ');
            const results = await this.keywordsTable!
                .query()
                .where(`keyword IN (${keywordConditions})`)
                .toArray();
            
            // Aggregate scores by document ID
            const documentScores = new Map<string, number>();
            
            for (const result of results) {
                const currentScore = documentScores.get(result.document_id) || 0;
                documentScores.set(result.document_id, currentScore + result.frequency);
            }
            
            // Convert to array and sort by score
            return Array.from(documentScores.entries())
                .map(([document_id, score]) => ({ document_id, score }))
                .sort((a, b) => b.score - a.score);
        } catch (error) {
            logger.error('Error querying by keywords:', error);
            throw new Error(`Keyword query failed: ${error}`);
        }
    }
    
    /**
     * Get document metadata
     * 
     * @param documentId - Document ID
     * @returns Document metadata or null if not found
     */
    async getDocument(documentId: string): Promise<DocumentV1 | null> {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        try {
            const results = await this.documentsTable!
                .query()
                .where(`id = '${documentId}'`)
                .limit(1)
                .toArray();
            
            if (results.length === 0) {
                return null;
            }
            
            return results[0] as DocumentV1;
        } catch (error) {
            logger.error(`Error getting document ${documentId}:`, error);
            throw new Error(`Document get failed: ${error}`);
        }
    }
    
    /**
     * Delete a document and all related data
     * 
     * @param documentId - Document ID to delete
     */
    async deleteDocument(documentId: string): Promise<void> {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        return withRetry(async () => {
            // Delete chunks
            await this.chunksTable!.delete(`document_id = '${documentId}'`);
            
            // Delete code blocks
            await this.codeBlocksTable!.delete(`document_id = '${documentId}'`);
            
            // Delete tags
            await this.documentTagsTable!.delete(`document_id = '${documentId}'`);
            
            // Delete languages
            await this.documentLanguagesTable!.delete(`document_id = '${documentId}'`);
            
            // Delete keywords
            await this.keywordsTable!.delete(`document_id = '${documentId}'`);
            
            // Delete document
            await this.documentsTable!.delete(`id = '${documentId}'`);
            
            logger.debug(`Deleted document: ${documentId}`);
        }, 'deleteDocument');
    }
    
    /**
     * Get database statistics
     * 
     * @returns Database statistics
     */
    async getStats(): Promise<DatabaseStats> {
        if (!this.initialized) {
            throw new Error('Database not initialized');
        }
        
        try {
            const documentCount = await this.documentsTable!.countRows();
            const chunkCount = await this.chunksTable!.countRows();
            const codeBlockCount = await this.codeBlocksTable!.countRows();
            const tagCount = await this.documentTagsTable!.countRows();
            const languageCount = await this.documentLanguagesTable!.countRows();
            const keywordCount = await this.keywordsTable!.countRows();
            
            // Get schema version
            const schemaVersions = await this.schemaVersionTable!.query().toArray();
            const schemaVersion = schemaVersions.length > 0 
                ? schemaVersions[schemaVersions.length - 1].version 
                : 'unknown';
            
            return {
                schemaVersion,
                documentCount,
                chunkCount,
                codeBlockCount,
                tagCount,
                languageCount,
                keywordCount,
                storageUsage: {
                    documents: 0, // Would need to query file system
                    chunks: 0,
                    codeBlocks: 0,
                    keywords: 0,
                    total: 0
                },
                indexes: {
                    vector: ['chunks.embedding', 'code_blocks.embedding'],
                    scalar: [
                        'documents.id',
                        'documents.content_hash',
                        'documents.source',
                        'documents.crawl_id',
                        'documents.status',
                        'documents.created_at',
                        'chunks.document_id',
                        'chunks.chunk_index',
                        'chunks.created_at',
                        'code_blocks.document_id',
                        'code_blocks.block_index',
                        'code_blocks.language',
                        'code_blocks.created_at',
                        'document_tags.document_id',
                        'document_tags.tag',
                        'document_languages.document_id',
                        'document_languages.language_code',
                        'keywords.keyword',
                        'keywords.document_id'
                    ]
                }
            };
        } catch (error) {
            logger.error('Error getting database stats:', error);
            throw new Error(`Stats query failed: ${error}`);
        }
    }
    
    /**
     * Close the database connection
     */
    async close(): Promise<void> {
        if (this.db) {
            try {
                await this.db.close();
                logger.info('LanceDB v1.0.0 connection closed');
            } catch (error) {
                logger.error('Error closing LanceDB v1.0.0:', error);
            }
        }
        this.initialized = false;
    }
    
    /**
     * Check if database is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }
}
