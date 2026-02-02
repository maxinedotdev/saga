/**
 * Configuration management for reranking functionality
 */

import type { RerankerConfig, RerankerProviderType } from '../types.js';

/**
 * Default reranking configuration values
 */
const DEFAULT_CONFIG = {
    enabled: true,  // Opt-out by default (enabled by default)
    provider: 'cohere' as RerankerProviderType,
    baseUrl: 'http://localhost:1234/v1',  // Default to LM Studio
    apiKey: '',
    model: 'rerank-multilingual-v3.0',
    maxCandidates: 50,
    topK: 10,
    timeout: 30000,
};

/**
 * Load reranking configuration from environment variables
 * @returns Reranking configuration
 */
function loadConfig(): RerankerConfig & { enabled: boolean } {
    return {
        // Feature flag - opt-out by default (enabled unless explicitly set to 'false')
        enabled: process.env.MCP_RERANKING_ENABLED !== 'false',

        // API configuration
        provider: (process.env.MCP_RERANKING_PROVIDER as RerankerProviderType) || DEFAULT_CONFIG.provider,
        baseUrl: process.env.MCP_RERANKING_BASE_URL || DEFAULT_CONFIG.baseUrl,
        apiKey: process.env.MCP_RERANKING_API_KEY || DEFAULT_CONFIG.apiKey,
        model: process.env.MCP_RERANKING_MODEL || DEFAULT_CONFIG.model,

        // Performance tuning
        maxCandidates: parseInt(process.env.MCP_RERANKING_CANDIDATES || DEFAULT_CONFIG.maxCandidates.toString(), 10),
        topK: parseInt(process.env.MCP_RERANKING_TOP_K || DEFAULT_CONFIG.topK.toString(), 10),
        timeout: parseInt(process.env.MCP_RERANKING_TIMEOUT || DEFAULT_CONFIG.timeout.toString(), 10),
    };
}

/**
 * Reranking configuration loaded from environment variables
 * Reloaded on each access for testing support
 */
export const RERANKING_CONFIG: RerankerConfig & { enabled: boolean } = loadConfig();

/**
 * Validate reranking configuration
 * @throws Error if configuration is invalid
 */
export function validateRerankingConfig(): void {
    // Reload config to support testing
    const config = loadConfig();

    // Check if reranking is enabled
    if (!config.enabled) {
        return; // No validation needed if disabled
    }

    // Validate provider
    const validProviders: RerankerProviderType[] = ['cohere', 'jina', 'openai', 'custom'];
    if (!validProviders.includes(config.provider)) {
        throw new Error(
            `Invalid reranking provider: ${config.provider}. ` +
            `Must be one of: ${validProviders.join(', ')}`
        );
    }

    // Validate API key for API-based providers (except custom which may not need it)
    if (config.provider !== 'custom' && !config.apiKey) {
        throw new Error(
            `API key is required for ${config.provider} provider. ` +
            `Set MCP_RERANKING_API_KEY environment variable.`
        );
    }

    // Validate numeric values
    if (config.maxCandidates < 1) {
        throw new Error('MCP_RERANKING_CANDIDATES must be at least 1');
    }

    if (config.topK < 1) {
        throw new Error('MCP_RERANKING_TOP_K must be at least 1');
    }

    if (config.topK > config.maxCandidates) {
        throw new Error(
            'MCP_RERANKING_TOP_K cannot be greater than MCP_RERANKING_CANDIDATES'
        );
    }

    if (config.timeout < 1000) {
        throw new Error('MCP_RERANKING_TIMEOUT must be at least 1000ms (1 second)');
    }

    // Validate base URL
    if (!config.baseUrl) {
        throw new Error('MCP_RERANKING_BASE_URL must be set');
    }

    try {
        new URL(config.baseUrl);
    } catch (error) {
        throw new Error(`Invalid MCP_RERANKING_BASE_URL: ${config.baseUrl}`);
    }
}

/**
 * Get reranking configuration with defaults applied
 * @returns Validated reranking configuration
 */
export function getRerankingConfig(): RerankerConfig {
    // Reload config to support testing
    const config = loadConfig();

    // Validate only if enabled
    if (config.enabled) {
        validateRerankingConfig();
    }

    return {
        provider: config.provider,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        maxCandidates: config.maxCandidates,
        topK: config.topK,
        timeout: config.timeout,
    };
}

/**
 * Check if reranking is enabled
 * @returns True if reranking is enabled and configured
 */
export function isRerankingEnabled(): boolean {
    // Reload config to support testing
    const config = loadConfig();
    return config.enabled && !!config.apiKey;
}
