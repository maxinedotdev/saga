// Types for the MCP Documentation Server

export interface CodeBlock {
    id: string;
    document_id: string;
    block_id: string;
    block_index: number;
    language: string;
    content: string;
    embedding?: number[];
    metadata?: Record<string, any>;
    source_url?: string;
}

export interface DocumentChunk {
    id: string;
    document_id: string;
    chunk_index: number;
    content: string;
    embeddings?: number[];
    start_position: number;
    end_position: number;
    metadata?: Record<string, any>;
}

export interface Document {
    id: string;
    title: string;
    content: string;
    metadata: Record<string, any>;
    chunks: DocumentChunk[];
    created_at: string;
    updated_at: string;
}

export interface DocumentSummary {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    content_length: number;
    chunks_count: number;
    metadata?: Record<string, any>;
    content_preview?: string;
}

export interface SearchResult {
    chunk: DocumentChunk;
    score: number;
}

export interface CodeBlockSearchResult {
    code_block: CodeBlock;
    score: number;
}

// Legacy interfaces for backward compatibility
export interface DocumentMetadata {
    id: string;
    title: string;
    author?: string;
    tags?: string[];
    createdAt: Date;
    updatedAt: Date;
    size: number;
    contentType: string;
    description?: string;
}

export interface LegacyDocument extends DocumentMetadata {
    content: string;
    embedding?: number[];
}

export interface LegacySearchResult {
    document: LegacyDocument;
    score: number;
    relevance: number;
}

export interface SearchOptions {
    limit?: number;
    threshold?: number;
    includeContent?: boolean;
    filters?: {
        tags?: string[];
        author?: string;
        contentType?: string;
    };
}

export interface AddDocumentRequest {
    title: string;
    content: string;
    metadata?: {
        author?: string;
        tags?: string[];
        description?: string;
        contentType?: string;
    };
}

export interface SearchRequest {
    query: string;
    options?: SearchOptions;
}

export interface EmbeddingProvider {
    generateEmbedding(text: string): Promise<number[]>;
    isAvailable(): boolean;
    getModelName(): string;
    getDimensions(): number;
    getCacheStats?(): any; // Optional method for cache statistics
}

export interface DocumentStorage {
    save(document: Document): Promise<void>;
    load(id: string): Promise<Document | null>;
    list(): Promise<DocumentMetadata[]>;
    delete(id: string): Promise<boolean>;
    search(embedding: number[], options?: SearchOptions): Promise<SearchResult[]>;
}

export interface ServerConfig {
    dataDir?: string;
    embeddingProvider?: EmbeddingProvider;
    maxDocumentSize?: number;
    defaultSearchLimit?: number;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    tagGeneration?: TagGenerationConfig;
}

/**
 * Configuration for automatic tag generation
 */
export interface TagGenerationConfig {
    enabled: boolean;
    useGeneratedTagsInQuery: boolean;
}

// Document Discovery Types for query-first discovery

/**
 * Document summary result from a query operation
 * Contains only essential information without full content
 */
export interface DocumentDiscoveryResult {
    id: string;
    title: string;
    score: number;
    updated_at: string;
    chunks_count: number;
    metadata?: Record<string, any>;
}

/**
 * Pagination metadata for query results
 */
export interface QueryPagination {
    total_documents: number;
    returned: number;
    has_more: boolean;
    next_offset: number | null;
}

/**
 * Complete query response with results and pagination metadata
 */
export interface QueryResponse {
    results: DocumentDiscoveryResult[];
    pagination: QueryPagination;
}

/**
 * Query options for filtering and pagination
 */
export interface QueryOptions {
    limit?: number;
    offset?: number;
    include_metadata?: boolean;
    filters?: MetadataFilter;
}

/**
 * Metadata filter for query operations
 */
export interface MetadataFilter {
    tags?: string[];
    source?: string;
    crawl_id?: string;
    author?: string;
    contentType?: string;
    languages?: string[]; // Filter by language codes (ISO 639-1)
    [key: string]: any;
}

/**
 * Source metadata for tracking document origin
 */
export interface SourceMetadata {
    source: 'upload' | 'crawl' | 'api';
    originalFilename?: string;
    fileExtension?: string;
    crawl_id?: string;
    crawl_url?: string;
    processedAt: string;
}

/**
 * Document-level search fields for indexing
 */
export interface DocumentSearchFields {
    id: string;
    title: string;
    tags: string[];
    tags_generated?: string[];
    source_metadata: SourceMetadata;
    keywords: string[];
}

// ============================================================================
// Multi-Provider Configuration Types
// ============================================================================

/**
 * Provider type for embeddings
 */
export type EmbeddingProviderType = 'transformers' | 'openai';

/**
 * Configuration for a single embedding provider in multi-provider setup
 */
export interface EmbeddingProviderConfig {
    provider: EmbeddingProviderType;
    priority: number; // Lower = higher priority
    // transformers-specific
    modelName?: string;
    // openai-specific
    baseUrl?: string;
    model?: string;
    apiKey?: string;
}

/**
 * Provider type for AI search
 */
export type AiProviderType = 'openai';

/**
 * Configuration for a single AI search provider in multi-provider setup
 */
export interface AiSearchProviderConfig {
    provider: AiProviderType;
    priority: number; // Lower = higher priority
    baseUrl: string;
    model: string;
    apiKey?: string;
    maxChunks?: number;
}

/**
 * Health tracking for a provider
 */
export interface ProviderHealth {
    isHealthy: boolean;
    consecutiveFailures: number;
    lastFailureTime?: number;
    lastSuccessTime?: number;
}

/**
 * Generic multi-provider manager interface
 */
export interface MultiProviderManager<T, P> {
    providers: Array<{ config: T; instance: P; health: ProviderHealth }>;
    tryNext(): Promise<P | null>;
    markSuccess(providerIndex: number): void;
    markFailure(providerIndex: number): void;
    getHealthyProvider(): P | null;
}
