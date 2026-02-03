import { createHash } from 'crypto';

/**
 * LRU Cache for embeddings to avoid recomputation of identical texts
 * Provides significant performance improvement for repeated queries
 */
export class EmbeddingCache {
    private cache: Map<string, {embedding: number[], timestamp: number, accessCount: number}>;
    private maxSize: number;
    private hits = 0;
    private misses = 0;
    private modelIdentifier: string;

    constructor(maxSize?: number, modelIdentifier?: string) {
        this.maxSize = maxSize || parseInt(process.env.MCP_CACHE_SIZE || '1000');
        this.modelIdentifier = modelIdentifier || process.env.MCP_EMBEDDING_MODEL || 'default';
        this.cache = new Map();
        console.error(`[EmbeddingCache] Initialized with size: ${this.maxSize}, model: ${this.modelIdentifier}`);
    }

    /**
     * Get embedding from cache if exists
     */
    async getEmbedding(text: string): Promise<number[] | null> {
        const hash = this.hash(text);
        const cached = this.cache.get(hash);
        
        if (cached) {
            // Update access info
            cached.timestamp = Date.now();
            cached.accessCount++;
            
            // Move to end (most recently used)
            this.cache.delete(hash);
            this.cache.set(hash, cached);
            
            this.hits++;
            return cached.embedding;
        }
        
        this.misses++;
        return null;
    }

    /**
     * Store embedding in cache
     */
    async setEmbedding(text: string, embedding: number[]): Promise<void> {
        const hash = this.hash(text);

        // Store the embedding
        if (this.cache.has(hash)) {
            this.cache.delete(hash);
        }

        this.cache.set(hash, {
            embedding: [...embedding], // Create a copy to avoid reference issues
            timestamp: Date.now(),
            accessCount: 1
        });
        
        // Evict least recently used items if needed
        while (this.cache.size > this.maxSize) {
            this.evictLRU();
        }
    }

    /**
     * Evict least recently used item
     */
    private evictLRU(): void {
        const lruKey = this.cache.keys().next().value;
        if (lruKey === undefined) {
            return;
        }
        this.cache.delete(lruKey);
    }

    /**
     * Create hash of text for cache key
     * Includes model identifier to ensure cache isolation between models
     */
    private hash(text: string): string {
        return createHash('sha256')
            .update(`${this.modelIdentifier}:${text.trim().toLowerCase()}`)
            .digest('hex')
            .substring(0, 16);
    }

    /**
     * Update the model identifier for cache key generation
     * Useful when switching models dynamically
     */
    setModelIdentifier(modelIdentifier: string): void {
        this.modelIdentifier = modelIdentifier;
        console.error(`[EmbeddingCache] Model identifier updated to: ${modelIdentifier}`);
    }

    /**
     * Get the current model identifier
     */
    getModelIdentifier(): string {
        return this.modelIdentifier;
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): {
        size: number;
        maxSize: number;
        hitRate: number;
        hits: number;
        misses: number;
        totalRequests: number;
    } {
        const totalRequests = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: totalRequests > 0 ? this.hits / totalRequests : 0,
            hits: this.hits,
            misses: this.misses,
            totalRequests
        };
    }

    /**
     * Clear the cache
     */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Resize cache (useful for dynamic memory management)
     */
    resize(newSize: number): void {
        this.maxSize = newSize;
        
        // Evict items if cache is now too large
        while (this.cache.size > this.maxSize) {
            this.evictLRU();
        }
    }

    /**
     * Get memory usage estimate in bytes
     */
    getMemoryUsage(): number {
        let totalSize = 0;
        
        for (const cached of this.cache.values()) {
            // Estimate: each number is 8 bytes, plus overhead
            totalSize += cached.embedding.length * 8 + 100; // 100 bytes overhead per entry
        }
        
        return totalSize;
    }

    /**
     * Preload embeddings for common queries (useful for warming cache)
     */
    async preload(textEmbeddingPairs: Array<{text: string, embedding: number[]}>): Promise<void> {
        console.error(`[EmbeddingCache] Preloading ${textEmbeddingPairs.length} embeddings...`);
        
        for (const pair of textEmbeddingPairs) {
            await this.setEmbedding(pair.text, pair.embedding);
        }
        
        console.error(`[EmbeddingCache] Preloaded cache, current size: ${this.cache.size}`);
    }

    /**
     * Export cache data for persistence (optional feature)
     */
    exportCache(): any {
        const entries: Array<{hash: string, text: string, embedding: number[], timestamp: number, accessCount: number}> = [];
        
        for (const [hash, data] of this.cache.entries()) {
            entries.push({
                hash,
                text: '', // We don't store original text for privacy
                embedding: data.embedding,
                timestamp: data.timestamp,
                accessCount: data.accessCount
            });
        }
        
        return {
            version: '1.0',
            maxSize: this.maxSize,
            entries,
            stats: this.getCacheStats(),
            exportedAt: new Date().toISOString()
        };
    }

    /**
     * Import cache data from persistence (optional feature)
     */
    importCache(cacheData: any): void {
        if (cacheData.version !== '1.0') {
            console.warn('[EmbeddingCache] Unsupported cache version, skipping import');
            return;
        }
        
        this.clear();
        this.maxSize = cacheData.maxSize || this.maxSize;
        
        for (const entry of cacheData.entries || []) {
            this.cache.set(entry.hash, {
                embedding: entry.embedding,
                timestamp: entry.timestamp,
                accessCount: entry.accessCount
            });
        }
        
        console.error(`[EmbeddingCache] Imported ${this.cache.size} cached embeddings`);
    }
}

// ============================================================================
// Singleton Pattern Implementation
// ============================================================================

/**
 * Module-level singleton instance of EmbeddingCache
 * This ensures cache persists across provider instances
 */
let globalEmbeddingCache: EmbeddingCache | null = null;
let globalCacheConfig: { maxSize?: number; modelIdentifier?: string } | null = null;

/**
 * Factory function that returns the singleton EmbeddingCache instance
 * Creates the cache on first call and reuses it thereafter
 * @param maxSize Optional maximum cache size (only used on first creation)
 * @param modelIdentifier Optional model identifier for cache key isolation
 * @returns The singleton EmbeddingCache instance
 */
export function getEmbeddingCache(maxSize?: number, modelIdentifier?: string): EmbeddingCache {
    const currentConfig = { maxSize, modelIdentifier };
    
    // Return cached instance if config hasn't changed
    if (globalEmbeddingCache && 
        globalCacheConfig?.maxSize === maxSize && 
        globalCacheConfig?.modelIdentifier === modelIdentifier) {
        return globalEmbeddingCache;
    }
    
    // If cache exists but config changed, update the model identifier
    if (globalEmbeddingCache && modelIdentifier) {
        globalEmbeddingCache.setModelIdentifier(modelIdentifier);
        globalCacheConfig = currentConfig;
        return globalEmbeddingCache;
    }
    
    // Create new singleton instance
    globalEmbeddingCache = new EmbeddingCache(maxSize, modelIdentifier);
    globalCacheConfig = currentConfig;
    
    console.error('[EmbeddingCache] Singleton instance created');
    return globalEmbeddingCache;
}

/**
 * Clear the global embedding cache singleton
 * Useful for testing or when configuration changes significantly
 */
export function clearEmbeddingCache(): void {
    if (globalEmbeddingCache) {
        globalEmbeddingCache.clear();
        console.error('[EmbeddingCache] Singleton cache cleared');
    }
}

/**
 * Reset the global embedding cache singleton entirely
 * This forces a new instance to be created on next getEmbeddingCache call
 * Useful for testing or complete cache invalidation
 */
export function resetEmbeddingCache(): void {
    globalEmbeddingCache = null;
    globalCacheConfig = null;
    console.error('[EmbeddingCache] Singleton instance reset');
}

/**
 * Check if a singleton embedding cache instance exists
 * @returns True if singleton instance exists
 */
export function hasEmbeddingCache(): boolean {
    return globalEmbeddingCache !== null;
}
