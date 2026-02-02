/**
 * LRU (Least Recently Used) Cache Implementation
 *
 * Provides a generic LRU cache for frequently accessed data.
 * Used for hot document and chunk caching with configurable size limits.
 */

import { getLogger } from '../utils.js';

const logger = getLogger('LRUCache');

/**
 * Cache entry metadata
 */
export interface CacheEntry<V> {
    /** Cached value */
    value: V;
    /** Timestamp when entry was created */
    createdAt: number;
    /** Timestamp when entry was last accessed */
    lastAccessed: number;
    /** Number of times this entry has been accessed */
    accessCount: number;
}

/**
 * LRU Cache configuration
 */
export interface LRUCacheConfig {
    /** Maximum number of entries in cache */
    maxSize: number;
    /** Time-to-live in milliseconds (0 = no expiration) */
    ttl?: number;
}

/**
 * Cache statistics
 */
export interface LRUCacheStats {
    /** Current number of entries */
    size: number;
    /** Maximum capacity */
    maxSize: number;
    /** Number of cache hits */
    hits: number;
    /** Number of cache misses */
    misses: number;
    /** Cache hit rate (0-1) */
    hitRate: number;
    /** Number of evictions */
    evictions: number;
    /** TTL in milliseconds */
    ttl: number;
}

/**
 * Generic LRU Cache implementation
 *
 * Uses a Map to maintain insertion order for O(1) operations.
 * Most recently accessed items are moved to the end of the Map.
 */
export class LRUCache<K, V> {
    private cache: Map<K, CacheEntry<V>>;
    private maxSize: number;
    private ttl: number;
    private stats = {
        hits: 0,
        misses: 0,
        evictions: 0,
    };

    constructor(config: LRUCacheConfig) {
        this.maxSize = config.maxSize;
        this.ttl = config.ttl || 0;
        this.cache = new Map();

        logger.debug(`Created LRU cache: maxSize=${config.maxSize}, ttl=${config.ttl || 0}ms`);
    }

    /**
     * Get a value from the cache
     *
     * @param key - Cache key
     * @returns Value or undefined if not found
     */
    get(key: K): V | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            this.stats.misses++;
            return undefined;
        }

        // Check if entry has expired
        if (this.ttl > 0 && Date.now() - entry.createdAt > this.ttl) {
            this.cache.delete(key);
            this.stats.misses++;
            return undefined;
        }

        // Move to end (most recently used)
        this.cache.delete(key);
        const updatedEntry: CacheEntry<V> = {
            ...entry,
            lastAccessed: Date.now(),
            accessCount: entry.accessCount + 1,
        };
        this.cache.set(key, updatedEntry);

        this.stats.hits++;
        return updatedEntry.value;
    }

    /**
     * Set a value in the cache
     *
     * @param key - Cache key
     * @param value - Value to cache
     */
    set(key: K, value: V): void {
        const now = Date.now();

        // If key exists, delete it first (will be re-added at end)
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Evict oldest entries if at capacity
        while (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
                this.stats.evictions++;
            }
        }

        const entry: CacheEntry<V> = {
            value,
            createdAt: now,
            lastAccessed: now,
            accessCount: 1,
        };

        this.cache.set(key, entry);
    }

    /**
     * Check if a key exists in the cache
     *
     * @param key - Cache key
     * @returns True if key exists and hasn't expired
     */
    has(key: K): boolean {
        const entry = this.cache.get(key);

        if (!entry) {
            return false;
        }

        // Check if entry has expired
        if (this.ttl > 0 && Date.now() - entry.createdAt > this.ttl) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Delete a key from the cache
     *
     * @param key - Cache key
     * @returns True if key was deleted
     */
    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    /**
     * Clear all entries from the cache
     */
    clear(): void {
        this.cache.clear();
        logger.debug('Cache cleared');
    }

    /**
     * Get the number of entries in the cache
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Get all keys in the cache (in order of recent access)
     */
    keys(): IterableIterator<K> {
        return this.cache.keys();
    }

    /**
     * Get cache statistics
     */
    getStats(): LRUCacheStats {
        const total = this.stats.hits + this.stats.misses;
        const hitRate = total > 0 ? this.stats.hits / total : 0;

        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.stats.hits,
            misses: this.stats.misses,
            hitRate: Math.round(hitRate * 1000) / 1000,
            evictions: this.stats.evictions,
            ttl: this.ttl,
        };
    }

    /**
     * Reset statistics
     */
    resetStats(): void {
        this.stats.hits = 0;
        this.stats.misses = 0;
        this.stats.evictions = 0;
    }

    /**
     * Remove expired entries (call periodically if not using get/set)
     */
    evictExpired(): number {
        if (this.ttl <= 0) {
            return 0;
        }

        const now = Date.now();
        let evicted = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.createdAt > this.ttl) {
                this.cache.delete(key);
                evicted++;
            }
        }

        if (evicted > 0) {
            logger.debug(`Evicted ${evicted} expired entries`);
        }

        return evicted;
    }

    /**
     * Get the least recently used key (oldest)
     */
    getLRUKey(): K | undefined {
        return this.cache.keys().next().value;
    }

    /**
     * Get the most recently used key (newest)
     */
    getMRUKey(): K | undefined {
        const keys = Array.from(this.cache.keys());
        return keys[keys.length - 1];
    }

    /**
     * Get a snapshot of current entries (for debugging)
     */
    getSnapshot(): Array<{ key: K; accessCount: number; age: number }> {
        const now = Date.now();
        return Array.from(this.cache.entries()).map(([key, entry]) => ({
            key,
            accessCount: entry.accessCount,
            age: now - entry.createdAt,
        }));
    }
}

/**
 * Document cache entry
 */
export interface DocumentCacheEntry {
    /** Document ID */
    id: string;
    /** Document title */
    title: string;
    /** Document content (optional) */
    content?: string;
    /** Document metadata */
    metadata?: Record<string, any>;
}

/**
 * Chunk cache entry
 */
export interface ChunkCacheEntry {
    /** Chunk ID */
    id: string;
    /** Document ID */
    documentId: string;
    /** Chunk content */
    content: string;
    /** Chunk index */
    chunkIndex: number;
    /** Surrounding context */
    surroundingContext?: string;
}

/**
 * Specialized document cache with string keys
 */
export class DocumentCache extends LRUCache<string, DocumentCacheEntry> {
    constructor(maxSize: number, ttl?: number) {
        super({ maxSize, ttl });
        logger.debug(`Created document cache: maxSize=${maxSize}`);
    }
}

/**
 * Specialized chunk cache with compound keys
 */
export class ChunkCache extends LRUCache<string, ChunkCacheEntry> {
    constructor(maxSize: number, ttl?: number) {
        super({ maxSize, ttl });
        logger.debug(`Created chunk cache: maxSize=${maxSize}`);
    }

    /**
     * Generate cache key for a chunk
     *
     * @param documentId - Document ID
     * @param chunkIndex - Chunk index
     * @returns Cache key
     */
    static generateKey(documentId: string, chunkIndex: number): string {
        return `${documentId}:${chunkIndex}`;
    }

    /**
     * Get a chunk by document ID and index
     *
     * @param documentId - Document ID
     * @param chunkIndex - Chunk index
     * @returns Chunk entry or undefined
     */
    getChunk(documentId: string, chunkIndex: number): ChunkCacheEntry | undefined {
        return this.get(ChunkCache.generateKey(documentId, chunkIndex));
    }

    /**
     * Set a chunk by document ID and index
     *
     * @param documentId - Document ID
     * @param chunkIndex - Chunk index
     * @param entry - Chunk entry
     */
    setChunk(documentId: string, chunkIndex: number, entry: ChunkCacheEntry): void {
        this.set(ChunkCache.generateKey(documentId, chunkIndex), entry);
    }
}

/**
 * Query result cache entry
 */
export interface QueryCacheEntry {
    /** Query string */
    query: string;
    /** Query results */
    results: any[];
    /** Query filters used */
    filters?: Record<string, any>;
}

/**
 * Cache for query results
 */
export class QueryResultCache extends LRUCache<string, QueryCacheEntry> {
    constructor(maxSize: number, ttl: number = 60000) {
        super({ maxSize, ttl });
        logger.debug(`Created query result cache: maxSize=${maxSize}, ttl=${ttl}ms`);
    }

    /**
     * Generate cache key for a query
     *
     * @param query - Query string
     * @param filters - Query filters
     * @returns Cache key
     */
    static generateKey(query: string, filters?: Record<string, any>): string {
        const filterStr = filters ? JSON.stringify(filters) : '';
        return `${query}:${filterStr}`;
    }

    /**
     * Get cached query results
     *
     * @param query - Query string
     * @param filters - Query filters
     * @returns Cached entry or undefined
     */
    getResults(query: string, filters?: Record<string, any>): QueryCacheEntry | undefined {
        return this.get(QueryResultCache.generateKey(query, filters));
    }

    /**
     * Cache query results
     *
     * @param query - Query string
     * @param results - Query results
     * @param filters - Query filters
     */
    cacheResults(query: string, results: any[], filters?: Record<string, any>): void {
        this.set(QueryResultCache.generateKey(query, filters), {
            query,
            results,
            filters,
        });
    }
}

/**
 * Environment-based cache configuration
 */
export interface CacheEnvironmentConfig {
    /** Document cache size */
    documentCacheSize: number;
    /** Chunk cache size */
    chunkCacheSize: number;
    /** Query result cache size */
    queryCacheSize: number;
    /** Cache TTL in milliseconds */
    cacheTtl: number;
}

/**
 * Get cache configuration from environment variables
 */
export function getCacheConfigFromEnv(): CacheEnvironmentConfig {
    return {
        documentCacheSize: parseInt(process.env.MCP_DOCUMENT_CACHE_SIZE || '1000', 10),
        chunkCacheSize: parseInt(process.env.MCP_CHUNK_CACHE_SIZE || '5000', 10),
        queryCacheSize: parseInt(process.env.MCP_QUERY_CACHE_SIZE || '100', 10),
        cacheTtl: parseInt(process.env.MCP_CACHE_TTL || '60000', 10),
    };
}
