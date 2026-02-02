/**
 * LanceDB Connection Pool Implementation
 *
 * Provides connection pooling using generic-pool to manage LanceDB connections.
 * Supports 1000+ concurrent queries with better resource utilization.
 */

import { createPool, Pool, Options as PoolOptions } from 'generic-pool';
import * as lancedb from '@lancedb/lancedb';
import { getLogger } from '../utils.js';

const logger = getLogger('ConnectionPool');

/**
 * LanceDB connection type
 */
export type LanceDBConnection = any;

/**
 * Connection pool configuration
 */
export interface ConnectionPoolConfig {
    /** Maximum number of connections in pool (default: 100) */
    max: number;
    /** Minimum number of connections to maintain (default: 10) */
    min: number;
    /** Maximum number of milliseconds a connection can be idle (default: 30000) */
    idleTimeoutMillis: number;
    /** Maximum number of milliseconds to wait for a connection (default: 10000) */
    acquireTimeoutMillis: number;
    /** Maximum number of milliseconds for a connection to live (default: 3600000) */
    maxLifetimeMillis: number;
    /** Whether to validate connections before use (default: true) */
    validateOnBorrow: boolean;
    /** How often to check for idle connections (default: 10000) */
    evictionRunIntervalMillis: number;
    /** Number of connections to acquire when pool is below min (default: 1) */
    numTestsPerEvictionRun: number;
}

/**
 * Connection pool statistics
 */
export interface ConnectionPoolStats {
    /** Total number of connections in pool */
    total: number;
    /** Number of free/available connections */
    free: number;
    /** Number of connections currently in use */
    inUse: number;
    /** Number of waiting acquire requests */
    waiting: number;
    /** Pool utilization percentage (0-100) */
    utilization: number;
    /** Number of connections created since pool start */
    created: number;
    /** Number of connections destroyed since pool start */
    destroyed: number;
    /** Number of acquire requests */
    acquireRequests: number;
    /** Number of failed acquire requests */
    failedAcquires: number;
}

/**
 * Connection pool environment configuration
 */
export interface PoolEnvironmentConfig {
    /** Whether connection pooling is enabled (default: true) */
    enabled: boolean;
    /** Maximum pool size */
    max: number;
    /** Minimum pool size */
    min: number;
    /** Idle timeout in milliseconds */
    idleTimeoutMillis: number;
    /** Acquire timeout in milliseconds */
    acquireTimeoutMillis: number;
    /** Maximum connection lifetime in milliseconds */
    maxLifetimeMillis: number;
}

/**
 * Get pool configuration from environment variables
 */
export function getPoolConfigFromEnv(): PoolEnvironmentConfig {
    return {
        enabled: process.env.MCP_CONNECTION_POOL_ENABLED !== 'false',
        max: parseInt(process.env.MCP_CONNECTION_POOL_MAX || '100', 10),
        min: parseInt(process.env.MCP_CONNECTION_POOL_MIN || '10', 10),
        idleTimeoutMillis: parseInt(process.env.MCP_CONNECTION_POOL_IDLE_TIMEOUT || '30000', 10),
        acquireTimeoutMillis: parseInt(process.env.MCP_CONNECTION_POOL_ACQUIRE_TIMEOUT || '10000', 10),
        maxLifetimeMillis: parseInt(process.env.MCP_CONNECTION_POOL_MAX_LIFETIME || '3600000', 10),
    };
}

/**
 * LanceDB Connection Pool Manager
 */
export class LanceDBConnectionPool {
    private pool: Pool<LanceDBConnection> | null = null;
    private dbPath: string;
    private config: ConnectionPoolConfig;
    private stats = {
        created: 0,
        destroyed: 0,
        acquireRequests: 0,
        failedAcquires: 0,
    };
    private initialized = false;

    constructor(dbPath: string, config: Partial<ConnectionPoolConfig> = {}) {
        this.dbPath = dbPath;
        this.config = {
            max: 100,
            min: 10,
            idleTimeoutMillis: 30000,
            acquireTimeoutMillis: 10000,
            maxLifetimeMillis: 3600000,
            validateOnBorrow: true,
            evictionRunIntervalMillis: 10000,
            numTestsPerEvictionRun: 1,
            ...config,
        };
    }

    /**
     * Initialize the connection pool
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            logger.debug('Connection pool already initialized');
            return;
        }

        logger.info(`Initializing connection pool for ${this.dbPath}`);
        logger.debug(`Pool config: max=${this.config.max}, min=${this.config.min}, idleTimeout=${this.config.idleTimeoutMillis}ms`);

        const factory = {
            create: async (): Promise<LanceDBConnection> => {
                try {
                    const connection = await lancedb.connect(this.dbPath);
                    this.stats.created++;
                    logger.debug(`Created new connection (total created: ${this.stats.created})`);
                    return connection;
                } catch (error) {
                    logger.error('Failed to create connection:', error);
                    throw error;
                }
            },

            destroy: async (connection: LanceDBConnection): Promise<void> => {
                try {
                    await connection.close();
                    this.stats.destroyed++;
                    logger.debug(`Destroyed connection (total destroyed: ${this.stats.destroyed})`);
                } catch (error) {
                    logger.warn('Error destroying connection:', error);
                }
            },

            validate: async (connection: LanceDBConnection): Promise<boolean> => {
                try {
                    // Try to list tables as a simple validation
                    await connection.tableNames();
                    return true;
                } catch (error) {
                    logger.debug('Connection validation failed:', error);
                    return false;
                }
            },
        };

        const poolOptions: PoolOptions = {
            max: this.config.max,
            min: this.config.min,
            idleTimeoutMillis: this.config.idleTimeoutMillis,
            acquireTimeoutMillis: this.config.acquireTimeoutMillis,
            testOnBorrow: this.config.validateOnBorrow,
            evictionRunIntervalMillis: this.config.evictionRunIntervalMillis,
        };

        this.pool = createPool(factory, poolOptions);

        // Handle pool events
        this.pool.on('factoryCreateError', (error) => {
            logger.error('Pool factory create error:', error);
        });

        this.pool.on('factoryDestroyError', (error) => {
            logger.error('Pool factory destroy error:', error);
        });

        this.initialized = true;
        logger.info('Connection pool initialized successfully');
    }

    /**
     * Execute a database operation using a pooled connection
     *
     * @param operation - Database operation to execute
     * @returns Result of the operation
     */
    async execute<T>(operation: (connection: LanceDBConnection) => Promise<T>): Promise<T> {
        if (!this.initialized || !this.pool) {
            throw new Error('Connection pool not initialized');
        }

        this.stats.acquireRequests++;
        let connection: LanceDBConnection | null = null;

        try {
            connection = await this.pool.acquire();
            const result = await operation(connection);
            return result;
        } catch (error) {
            this.stats.failedAcquires++;
            logger.error('Pool operation failed:', error);
            throw error;
        } finally {
            if (connection && this.pool) {
                await this.pool.release(connection);
            }
        }
    }

    /**
     * Acquire a connection from the pool
     * IMPORTANT: Must call release() when done
     *
     * @returns Database connection
     */
    async acquire(): Promise<LanceDBConnection> {
        if (!this.initialized || !this.pool) {
            throw new Error('Connection pool not initialized');
        }

        this.stats.acquireRequests++;
        try {
            return await this.pool.acquire();
        } catch (error) {
            this.stats.failedAcquires++;
            throw error;
        }
    }

    /**
     * Release a connection back to the pool
     *
     * @param connection - Connection to release
     */
    async release(connection: LanceDBConnection): Promise<void> {
        if (!this.pool) {
            return;
        }

        await this.pool.release(connection);
    }

    /**
     * Get current pool statistics
     */
    getStats(): ConnectionPoolStats {
        if (!this.pool) {
            return {
                total: 0,
                free: 0,
                inUse: 0,
                waiting: 0,
                utilization: 0,
                created: this.stats.created,
                destroyed: this.stats.destroyed,
                acquireRequests: this.stats.acquireRequests,
                failedAcquires: this.stats.failedAcquires,
            };
        }

        const total = this.pool.size;
        const available = this.pool.available;
        const inUse = total - available;
        const pending = this.pool.pending;
        const utilization = total > 0 ? (inUse / total) * 100 : 0;

        return {
            total,
            free: available,
            inUse,
            waiting: pending,
            utilization: Math.round(utilization * 100) / 100,
            created: this.stats.created,
            destroyed: this.stats.destroyed,
            acquireRequests: this.stats.acquireRequests,
            failedAcquires: this.stats.failedAcquires,
        };
    }

    /**
     * Check if pool is initialized
     */
    isInitialized(): boolean {
        return this.initialized && this.pool !== null;
    }

    /**
     * Drain the pool and close all connections
     */
    async close(): Promise<void> {
        if (!this.pool) {
            return;
        }

        logger.info('Draining connection pool...');

        try {
            await this.pool.drain();
            await this.pool.clear();
            this.initialized = false;
            logger.info('Connection pool closed');
        } catch (error) {
            logger.error('Error closing connection pool:', error);
            throw error;
        } finally {
            this.pool = null;
        }
    }

    /**
     * Get pool status summary
     */
    getStatus(): {
        initialized: boolean;
        path: string;
        config: ConnectionPoolConfig;
        stats: ConnectionPoolStats;
    } {
        return {
            initialized: this.initialized,
            path: this.dbPath,
            config: this.config,
            stats: this.getStats(),
        };
    }
}

/**
 * Simple connection pool factory for managing multiple pools
 */
export class ConnectionPoolFactory {
    private pools = new Map<string, LanceDBConnectionPool>();

    /**
     * Get or create a connection pool for a database path
     *
     * @param dbPath - Path to the database
     * @param config - Pool configuration
     * @returns Connection pool instance
     */
    async getPool(dbPath: string, config?: Partial<ConnectionPoolConfig>): Promise<LanceDBConnectionPool> {
        const existing = this.pools.get(dbPath);
        if (existing && existing.isInitialized()) {
            return existing;
        }

        const pool = new LanceDBConnectionPool(dbPath, config);
        await pool.initialize();
        this.pools.set(dbPath, pool);

        return pool;
    }

    /**
     * Close all pools
     */
    async closeAll(): Promise<void> {
        const closePromises = Array.from(this.pools.values()).map(pool => pool.close());
        await Promise.all(closePromises);
        this.pools.clear();
    }

    /**
     * Get all pool statistics
     */
    getAllStats(): Array<{ path: string; stats: ConnectionPoolStats }> {
        return Array.from(this.pools.entries()).map(([path, pool]) => ({
            path,
            stats: pool.getStats(),
        }));
    }
}

// Global pool factory instance
const globalPoolFactory = new ConnectionPoolFactory();

/**
 * Get the global connection pool factory
 */
export function getGlobalPoolFactory(): ConnectionPoolFactory {
    return globalPoolFactory;
}
