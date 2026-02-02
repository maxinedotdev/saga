/**
 * HNSW (Hierarchical Navigable Small World) Index Implementation
 *
 * Provides dynamic HNSW parameter calculation and index creation for LanceDB.
 * HNSW offers 2-5x faster query latency compared to IVF_PQ with better recall.
 */

import { getLogger } from '../utils.js';

const logger = getLogger('HNSWIndex');

/**
 * HNSW index configuration
 */
export interface HNSWIndexConfig {
    /** Index type */
    type: 'hnsw';
    /** Distance metric */
    metricType: 'cosine' | 'l2' | 'dot';
    /** Max connections per node */
    M: number;
    /** Build-time search depth */
    efConstruction: number;
    /** Query-time search depth */
    ef: number;
}

/**
 * IVF_PQ index configuration (for fallback)
 */
export interface IVF_PQIndexConfig {
    /** Index type */
    type: 'ivf_pq';
    /** Distance metric */
    metricType: 'cosine' | 'l2' | 'dot';
    /** Number of IVF partitions */
    num_partitions: number;
    /** Number of sub-vectors for PQ */
    num_sub_vectors: number;
}

/**
 * Union type for index configurations
 */
export type VectorIndexConfig = HNSWIndexConfig | IVF_PQIndexConfig;

/**
 * HNSW environment configuration
 */
export interface HNSWEnvironmentConfig {
    /** Whether to use HNSW indexes (default: true) */
    useHNSW: boolean;
    /** Default M parameter */
    defaultM: number;
    /** Default efConstruction parameter */
    defaultEfConstruction: number;
    /** Default ef parameter */
    defaultEf: number;
    /** Vector count threshold for medium dataset (1M) */
    mediumThreshold: number;
    /** Vector count threshold for large dataset (10M) */
    largeThreshold: number;
}

/**
 * Get HNSW configuration from environment variables
 */
export function getHNSWConfigFromEnv(): HNSWEnvironmentConfig {
    return {
        useHNSW: process.env.MCP_USE_HNSW !== 'false',
        defaultM: parseInt(process.env.MCP_HNSW_M || '16', 10),
        defaultEfConstruction: parseInt(process.env.MCP_HNSW_EF_CONSTRUCTION || '200', 10),
        defaultEf: parseInt(process.env.MCP_HNSW_EF || '50', 10),
        mediumThreshold: parseInt(process.env.MCP_HNSW_MEDIUM_THRESHOLD || '1000000', 10),
        largeThreshold: parseInt(process.env.MCP_HNSW_LARGE_THRESHOLD || '10000000', 10),
    };
}

/**
 * Calculate HNSW parameters based on vector count
 *
 * Scales parameters dynamically:
 * - Small datasets (< 1M): M=16, efConstruction=200, ef=50
 * - Medium datasets (1M-10M): M=32, efConstruction=400, ef=100
 * - Large datasets (> 10M): M=64, efConstruction=800, ef=200
 *
 * @param vectorCount - Number of vectors in the dataset
 * @param config - Environment configuration
 * @returns HNSW index configuration
 */
export function calculateHNSWParams(
    vectorCount: number,
    config: Partial<HNSWEnvironmentConfig> = {}
): HNSWIndexConfig {
    const fullConfig = { ...getHNSWConfigFromEnv(), ...config };

    let M = fullConfig.defaultM;
    let efConstruction = fullConfig.defaultEfConstruction;
    let ef = fullConfig.defaultEf;

    if (vectorCount > fullConfig.largeThreshold) {
        M = 64;
        efConstruction = 800;
        ef = 200;
        logger.debug(`Using large dataset HNSW params: M=${M}, efConstruction=${efConstruction}, ef=${ef}`);
    } else if (vectorCount > fullConfig.mediumThreshold) {
        M = 32;
        efConstruction = 400;
        ef = 100;
        logger.debug(`Using medium dataset HNSW params: M=${M}, efConstruction=${efConstruction}, ef=${ef}`);
    } else {
        logger.debug(`Using small dataset HNSW params: M=${M}, efConstruction=${efConstruction}, ef=${ef}`);
    }

    return {
        type: 'hnsw',
        metricType: 'cosine',
        M,
        efConstruction,
        ef,
    };
}

/**
 * Calculate IVF_PQ parameters based on vector count and dimension
 *
 * @param vectorCount - Number of vectors in the dataset
 * @param embeddingDim - Dimension of the embedding vectors
 * @returns IVF_PQ index configuration
 */
export function calculateIVF_PQ_Params(
    vectorCount: number,
    embeddingDim: number
): IVF_PQIndexConfig {
    const numPartitions = Math.max(16, Math.floor(Math.sqrt(vectorCount)));
    const numSubVectors = Math.max(4, Math.floor(embeddingDim / 16));

    return {
        type: 'ivf_pq',
        metricType: 'cosine',
        num_partitions: Math.min(numPartitions, 2048),
        num_sub_vectors: Math.min(numSubVectors, 256),
    };
}

/**
 * Get the appropriate vector index configuration based on settings
 *
 * @param vectorCount - Number of vectors in the dataset
 * @param embeddingDim - Dimension of the embedding vectors
 * @param preferHNSW - Whether to prefer HNSW over IVF_PQ
 * @returns Vector index configuration
 */
export function getVectorIndexConfig(
    vectorCount: number,
    embeddingDim: number,
    preferHNSW: boolean = true
): VectorIndexConfig {
    const envConfig = getHNSWConfigFromEnv();

    if (preferHNSW && envConfig.useHNSW) {
        return calculateHNSWParams(vectorCount, envConfig);
    }

    return calculateIVF_PQ_Params(vectorCount, embeddingDim);
}

/**
 * Create HNSW index configuration for LanceDB
 *
 * @param config - HNSW configuration
 * @returns LanceDB index configuration object
 */
export function createHNSWIndexConfig(config: HNSWIndexConfig): Record<string, any> {
    return {
        type: 'hnsw',
        metricType: config.metricType,
        m: config.M,
        efConstruction: config.efConstruction,
    };
}

/**
 * Estimate memory usage for HNSW index
 *
 * @param vectorCount - Number of vectors
 * @param embeddingDim - Dimension of each vector
 * @param config - HNSW configuration
 * @returns Estimated memory usage in bytes
 */
export function estimateHNSWMemoryUsage(
    vectorCount: number,
    embeddingDim: number,
    config: HNSWIndexConfig
): number {
    // HNSW uses approximately 2-3x more memory than IVF_PQ
    // Base calculation: vectors * dimensions * 4 bytes (float32)
    const baseVectorMemory = vectorCount * embeddingDim * 4;

    // Graph overhead: M * 2 * vectorCount * 8 bytes (pointers + distances)
    const graphMemory = config.M * 2 * vectorCount * 8;

    // Total with 2.5x multiplier for HNSW overhead
    return Math.ceil((baseVectorMemory + graphMemory) * 2.5);
}

/**
 * Validate HNSW configuration
 *
 * @param config - Configuration to validate
 * @returns Validation result
 */
export function validateHNSWConfig(config: Partial<HNSWIndexConfig>): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (config.M !== undefined) {
        if (config.M < 4 || config.M > 128) {
            errors.push('M must be between 4 and 128');
        }
        // Check if M is power of 2 (M & (M-1) === 0 for powers of 2, excluding 0)
        if (config.M > 0 && (config.M & (config.M - 1)) !== 0) {
            logger.warn('M is not a power of 2, which may impact performance');
        }
    }

    if (config.efConstruction !== undefined) {
        if (config.efConstruction < 50 || config.efConstruction > 1000) {
            errors.push('efConstruction must be between 50 and 1000');
        }
    }

    if (config.ef !== undefined) {
        if (config.ef < 10 || config.ef > 1000) {
            errors.push('ef must be between 10 and 1000');
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Get index type display name
 *
 * @param config - Vector index configuration
 * @returns Human-readable index type name
 */
export function getIndexTypeName(config: VectorIndexConfig): string {
    if (config.type === 'hnsw') {
        return `HNSW(M=${config.M}, ef=${config.ef})`;
    }
    return `IVF_PQ(partitions=${config.num_partitions}, sub_vectors=${config.num_sub_vectors})`;
}
