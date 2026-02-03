/**
 * Saga v1.0.0 Database Schema Types
 *
 * TypeScript interfaces for the new v1.0.0 database schema.
 * This schema uses flattened metadata, normalized tables, and LanceDB
 * as the single source of truth.
 */

// ============================================================================
// Document Types
// ============================================================================

/**
 * Document row in LanceDB
 * Stores document-level metadata and search fields
 */
export interface DocumentV1 {
    /** Primary Key - UUID v4 */
    id: string;
    /** Document title */
    title: string;
    /** Full document content */
    content: string;
    /** SHA-256 hash for deduplication (16 chars) */
    content_hash: string;
    /** Character count */
    content_length: number;
    /** Source type */
    source: 'upload' | 'crawl' | 'api';
    /** Original filename if uploaded */
    original_filename: string | null;
    /** File extension if uploaded */
    file_extension: string | null;
    /** Crawl session ID if crawled */
    crawl_id: string | null;
    /** Crawl URL if crawled */
    crawl_url: string | null;
    /** Document author */
    author: string | null;
    /** Document description */
    description: string | null;
    /** Content type (e.g., 'documentation', 'tutorial') */
    content_type: string | null;
    /** ISO 8601 timestamp - created at */
    created_at: string;
    /** ISO 8601 timestamp - last updated */
    updated_at: string;
    /** ISO 8601 timestamp - processed */
    processed_at: string;
    /** Number of chunks */
    chunks_count: number;
    /** Number of code blocks */
    code_blocks_count: number;
    /** Document status */
    status: 'active' | 'archived' | 'deleted';
}

/**
 * Document tag relationship
 * Many-to-many relationship for tags
 */
export interface DocumentTagV1 {
    /** Primary Key - UUID v4 */
    id: string;
    /** Foreign key to documents.id */
    document_id: string;
    /** Tag value (lowercase) */
    tag: string;
    /** True if AI-generated tag */
    is_generated: boolean;
    /** ISO 8601 timestamp */
    created_at: string;
}

/**
 * Document language relationship
 * Many-to-many relationship for languages
 */
export interface DocumentLanguageV1 {
    /** Primary Key - UUID v4 */
    id: string;
    /** Foreign key to documents.id */
    document_id: string;
    /** ISO 639-1 code (e.g., 'en', 'no') */
    language_code: string;
    /** ISO 8601 timestamp */
    created_at: string;
}

// ============================================================================
// Chunk Types
// ============================================================================

/**
 * Chunk row in LanceDB
 * Stores text chunks with embeddings. Metadata flattened for type safety.
 */
export interface ChunkV1 {
    /** Primary Key - UUID v4 */
    id: string;
    /** Foreign key to documents.id */
    document_id: string;
    /** Position within document */
    chunk_index: number;
    /** Character start position */
    start_position: number;
    /** Character end position */
    end_position: number;
    /** Chunk text content */
    content: string;
    /** Character count */
    content_length: number;
    /** Vector embedding (fixed dimension) */
    embedding: number[];
    /** Context before/after chunk */
    surrounding_context: string | null;
    /** AI-generated topic */
    semantic_topic: string | null;
    /** ISO 8601 timestamp */
    created_at: string;
}

// ============================================================================
// Code Block Types
// ============================================================================

/**
 * Code block row in LanceDB
 * Stores code blocks with embeddings. Language-specific search optimized.
 */
export interface CodeBlockV1 {
    /** Primary Key - UUID v4 */
    id: string;
    /** Foreign key to documents.id */
    document_id: string;
    /** Original block identifier */
    block_id: string;
    /** Position within document */
    block_index: number;
    /** Normalized language tag */
    language: string;
    /** Code text */
    content: string;
    /** Character count */
    content_length: number;
    /** Vector embedding (fixed dimension) */
    embedding: number[];
    /** Original source URL */
    source_url: string | null;
    /** ISO 8601 timestamp */
    created_at: string;
}

// ============================================================================
// Keyword Types
// ============================================================================

/**
 * Keyword row in LanceDB (inverted index)
 * Inverted index for keyword search
 */
export interface KeywordV1 {
    /** Primary Key - UUID v4 */
    id: string;
    /** Lowercase keyword */
    keyword: string;
    /** Foreign key to documents.id */
    document_id: string;
    /** Where keyword was found */
    source: 'title' | 'content';
    /** Occurrence count */
    frequency: number;
    /** ISO 8601 timestamp */
    created_at: string;
}

// ============================================================================
// Schema Version Types
// ============================================================================

/**
 * Schema version tracking
 */
export interface SchemaVersionV1 {
    /** Auto-increment */
    id: number;
    /** Semantic version (e.g., '1.0.0') */
    version: string;
    /** ISO 8601 timestamp */
    applied_at: string;
    /** Migration description */
    description: string;
}

// ============================================================================
// Index Configuration Types
// ============================================================================

/**
 * Vector index configuration
 */
export type VectorIndexConfig =
    | {
          /** Index type */
          type: 'hnsw_sq';
          /** Distance metric */
          metricType: 'cosine' | 'l2' | 'dot';
          /** Max connections per node */
          M: number;
          /** Build-time search depth */
          efConstruction: number;
      }
    | {
          /** Index type */
          type: 'ivf_pq';
          /** Distance metric */
          metricType: 'cosine' | 'l2' | 'dot';
          /** Number of IVF partitions */
          num_partitions: number;
          /** Number of sub-vectors for PQ */
          num_sub_vectors: number;
      };

/**
 * Scalar index configuration
 */
export interface ScalarIndexConfig {
    /** Index type */
    type: 'btree';
    /** Replace existing index */
    replaceExisting?: boolean;
}

/**
 * Index creation parameters
 */
export interface IndexCreationParams {
    /** Table name */
    table: string;
    /** Column name */
    column: string;
    /** Index configuration */
    config: VectorIndexConfig | ScalarIndexConfig;
    /** Optional timeout in milliseconds */
    timeout?: number;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Query options for document search
 */
export interface QueryOptionsV1 {
    /** Maximum number of results */
    limit?: number;
    /** Offset for pagination */
    offset?: number;
    /** Include document metadata */
    include_metadata?: boolean;
    /** Metadata filters */
    filters?: MetadataFilterV1;
    /** Use reranking */
    useReranking?: boolean;
}

/**
 * Metadata filter for v1 schema
 */
export interface MetadataFilterV1 {
    /** Filter by tags */
    tags?: string[];
    /** Filter by languages */
    languages?: string[];
    /** Filter by source type */
    source?: ('upload' | 'crawl' | 'api')[];
    /** Filter by crawl session ID */
    crawl_id?: string;
    /** Filter by author */
    author?: string;
    /** Filter by content type */
    content_type?: string;
    /** Filter by status */
    status?: ('active' | 'archived' | 'deleted')[];
    /** Filter by creation date (after) */
    created_after?: string;
    /** Filter by creation date (before) */
    created_before?: string;
    /** Filter by update date (after) */
    updated_after?: string;
    /** Filter by update date (before) */
    updated_before?: string;
}

/**
 * Query result with document metadata
 */
export interface QueryResultV1 {
    /** Document ID */
    document_id: string;
    /** Document title */
    title: string;
    /** Similarity score (0-1) */
    score: number;
    /** Chunk information */
    chunk?: {
        /** Chunk ID */
        id: string;
        /** Chunk content */
        content: string;
        /** Chunk index */
        chunk_index: number;
    };
    /** Document metadata */
    metadata?: DocumentMetadataV1;
}

/**
 * Document metadata for query results
 */
export interface DocumentMetadataV1 {
    /** Document author */
    author: string | null;
    /** Document description */
    description: string | null;
    /** Content type */
    content_type: string | null;
    /** Source type */
    source: 'upload' | 'crawl' | 'api';
    /** Document tags */
    tags: string[];
    /** Document languages */
    languages: string[];
    /** Creation timestamp */
    created_at: string;
    /** Update timestamp */
    updated_at: string;
    /** Number of chunks */
    chunks_count: number;
    /** Number of code blocks */
    code_blocks_count: number;
}

/**
 * Pagination metadata
 */
export interface QueryPaginationV1 {
    /** Total documents */
    total_documents: number;
    /** Number of results returned */
    returned: number;
    /** Whether there are more results */
    has_more: boolean;
    /** Next offset for pagination */
    next_offset: number | null;
}

/**
 * Complete query response
 */
export interface QueryResponseV1 {
    /** Query results */
    results: QueryResultV1[];
    /** Pagination metadata */
    pagination: QueryPaginationV1;
}

// ============================================================================
// Performance Types
// ============================================================================

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
    /** Query latency percentiles */
    queryLatency: {
        /** 50th percentile */
        p50: number;
        /** 95th percentile */
        p95: number;
        /** 99th percentile */
        p99: number;
    };
    /** Index build time in milliseconds */
    indexBuildTime: number;
    /** Memory usage in bytes */
    memoryUsage: {
        /** Heap memory */
        heap: number;
        /** RSS memory */
        rss: number;
        /** External memory */
        external: number;
    };
    /** Storage usage in bytes */
    storageUsage: {
        /** Data size */
        data: number;
        /** Indexes size */
        indexes: number;
        /** Total size */
        total: number;
    };
    /** Concurrency metrics */
    concurrency: {
        /** Active queries */
        activeQueries: number;
        /** Active writes */
        activeWrites: number;
    };
}

/**
 * Performance targets
 */
export interface PerformanceTargets {
    /** Query latency targets in milliseconds */
    queryLatency: {
        /** Vector search */
        vectorSearch: number;
        /** Scalar filter */
        scalarFilter: number;
        /** Tag filter */
        tagFilter: number;
        /** Keyword search */
        keywordSearch: number;
        /** Combined query */
        combinedQuery: number;
    };
    /** Index build time targets in milliseconds */
    indexBuildTime: {
        /** 10K vectors */
        tenK: number;
        /** 100K vectors */
        hundredK: number;
        /** 1M vectors */
        oneM: number;
        /** 10M vectors */
        tenM: number;
    };
    /** Memory usage targets in bytes */
    memoryUsage: {
        /** 100K documents */
        hundredK: number;
        /** 1M documents */
        oneM: number;
    };
    /** Concurrency targets */
    concurrency: {
        /** Concurrent writes */
        concurrentWrites: number;
        /** Concurrent reads */
        concurrentReads: number;
        /** Mixed workload */
        mixedWorkload: number;
    };
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Memory cache configuration
 */
export interface MemoryCacheConfig {
    /** Document cache configuration */
    documentCache: {
        /** Maximum cache size */
        maxSize: number;
        /** Time to live in milliseconds */
        ttl: number;
    };
    /** Query cache configuration */
    queryCache: {
        /** Maximum cache size */
        maxSize: number;
        /** Time to live in milliseconds */
        ttl: number;
    };
    /** Connection pool configuration */
    connectionPool: {
        /** Maximum connections */
        maxConnections: number;
        /** Idle timeout in milliseconds */
        idleTimeout: number;
    };
}

/**
 * Cache entry
 */
export interface CacheEntry<T> {
    /** Cache key */
    key: string;
    /** Cached value */
    value: T;
    /** Timestamp */
    timestamp: number;
    /** Access count */
    accessCount: number;
}

// ============================================================================
// Database Statistics Types
// ============================================================================

/**
 * Database statistics
 */
export interface DatabaseStats {
    /** Schema version */
    schemaVersion: string;
    /** Number of documents */
    documentCount: number;
    /** Number of chunks */
    chunkCount: number;
    /** Number of code blocks */
    codeBlockCount: number;
    /** Number of tags */
    tagCount: number;
    /** Number of languages */
    languageCount: number;
    /** Number of keywords */
    keywordCount: number;
    /** Storage usage in bytes */
    storageUsage: {
        /** Documents table */
        documents: number;
        /** Chunks table */
        chunks: number;
        /** Code blocks table */
        codeBlocks: number;
        /** Keywords table */
        keywords: number;
        /** Total */
        total: number;
    };
    /** Index information */
    indexes: {
        /** Vector indexes */
        vector: string[];
        /** Scalar indexes */
        scalar: string[];
    };
}

// ============================================================================
// LanceDB Type Aliases
// ============================================================================

/**
 * LanceDB connection type
 */
export type LanceDB = any;

/**
 * LanceDB table type
 */
export type LanceTable = any;
