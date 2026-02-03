/**
 * Vector Database Module Exports
 *
 * Exports all vector database implementations and optimization components.
 */

// LanceDB implementations
import * as path from 'path';
import { getDefaultDataDir, expandHomeDir } from '../utils.js';
import { LanceDBV1 } from './lance-db-v1.js';

export { LanceDBV1 };

export function createVectorDatabase(dbPath?: string): LanceDBV1 {
    const envPath = process.env.MCP_LANCE_DB_PATH;
    const resolvedPath = dbPath ?? (envPath ? expandHomeDir(envPath) : path.join(getDefaultDataDir(), 'lancedb'));
    return new LanceDBV1(resolvedPath);
}

// HNSW Indexing
export {
    HNSWIndexConfig,
    IVF_PQIndexConfig,
    VectorIndexConfig,
    HNSWEnvironmentConfig,
    getHNSWConfigFromEnv,
    calculateHNSWParams,
    calculateIVF_PQ_Params,
    getVectorIndexConfig,
    createHNSWIndexConfig,
    estimateHNSWMemoryUsage,
    validateHNSWConfig,
    getIndexTypeName,
} from './hnsw-index.js';

// Connection Pooling
export {
    LanceDBConnection,
    ConnectionPoolConfig,
    ConnectionPoolStats,
    PoolEnvironmentConfig,
    getPoolConfigFromEnv,
    LanceDBConnectionPool,
    ConnectionPoolFactory,
    getGlobalPoolFactory,
} from './connection-pool.js';

// LRU Cache
export {
    CacheEntry,
    LRUCacheConfig,
    LRUCacheStats,
    LRUCache,
    DocumentCacheEntry,
    ChunkCacheEntry,
    QueryCacheEntry,
    DocumentCache,
    ChunkCache,
    QueryResultCache,
    CacheEnvironmentConfig,
    getCacheConfigFromEnv,
} from './lru-cache.js';

// Query Cache (Multi-level)
export {
    L1CacheConfig,
    L2CacheConfig,
    QueryCacheConfig,
    QueryCacheStats,
    QueryCache,
    getQueryCacheConfigFromEnv,
    createQueryCache,
} from './query-cache.js';

// Query Optimizer
export {
    QueryStepType,
    QueryStep,
    QueryPlan,
    OptimizationResult,
    QueryPerformanceMetrics,
    QueryOptimizerConfig,
    QueryOptimizer,
    QueryMetricsCollector,
    createQueryOptimizer,
    getGlobalMetricsCollector,
} from './query-optimizer.js';

// Backup Manager
export {
    BackupConfig,
    BackupMetadata,
    BackupStats,
    BackupManager,
    getBackupConfigFromEnv,
    createBackupManager,
} from './backup-manager.js';

// Integrity Validator
export {
    ValidationSeverity,
    ValidationIssue,
    ValidationReport,
    ValidatorConfig,
    ValidationDatabase,
    IntegrityValidator,
    getValidatorConfigFromEnv,
    createIntegrityValidator,
} from './integrity-validator.js';
