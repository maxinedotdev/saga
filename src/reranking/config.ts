/**
 * Configuration management for reranking functionality
 */

import type { RerankerConfig, RerankerProviderType } from '../types.js';
import { isAppleSilicon, getDefaultModelPath } from './apple-silicon-detection.js';

export type RerankingRuntimeConfig = RerankerConfig & {
    enabled: boolean;
    mlxModelPath: string;
    mlxUvPath: string;
    mlxPythonPath: string;
};

/**
 * Default reranking configuration values
 */
const DEFAULT_CONFIG = {
    enabled: true,  // Opt-out by default (enabled by default)
    provider: 'cohere' as RerankerProviderType,
    baseUrl: 'https://api.cohere.ai/v1',  // Default to Cohere
    apiKey: '',
    model: 'rerank-multilingual-v3.0',
    maxCandidates: 50,
    topK: 10,
    timeout: 30000,
    // MLX-specific configuration
    mlxModelPath: '',  // Path to MLX model directory (auto-detected on Apple Silicon)
    mlxUvPath: 'uv',  // Path to UV executable
    mlxPythonPath: 'python3',  // Path to Python executable (deprecated, for backward compatibility)
    autoConfigureMlx: true,  // Enable auto-configuration of MLX on Apple Silicon
};

/**
 * Load reranking configuration from environment variables
 * @returns Reranking configuration
 */
function loadConfig(): RerankingRuntimeConfig {
    // Check if auto-configuration is enabled (default: true)
    const autoConfigureMlx = process.env.MCP_RERANKING_AUTO_CONFIGURE_MLX !== 'false';
    
    // Auto-detect Apple Silicon and configure MLX if enabled
    let provider: RerankerProviderType;
    let mlxModelPath: string;
    
    if (autoConfigureMlx && isAppleSilicon()) {
        // Auto-configure MLX on Apple Silicon
        console.error('[MLX Auto-Config] Apple Silicon detected, auto-configuring MLX provider');
        
        // Use MLX as default provider on Apple Silicon unless explicitly overridden
        provider = (process.env.MCP_RERANKING_PROVIDER as RerankerProviderType) || 'mlx';
        
        // Set default model path unless explicitly overridden (empty string counts as override)
        const envModelPath = process.env.MCP_RERANKING_MLX_MODEL_PATH;
        mlxModelPath = envModelPath !== undefined ? envModelPath : getDefaultModelPath();
    } else {
        // Use default provider
        provider = (process.env.MCP_RERANKING_PROVIDER as RerankerProviderType) || DEFAULT_CONFIG.provider;
        mlxModelPath = process.env.MCP_RERANKING_MLX_MODEL_PATH || DEFAULT_CONFIG.mlxModelPath;
    }
    
    return {
        // Feature flag - opt-out by default (enabled unless explicitly set to 'false')
        enabled: process.env.MCP_RERANKING_ENABLED !== 'false',

        // API configuration
        provider,
        baseUrl: process.env.MCP_RERANKING_BASE_URL || DEFAULT_CONFIG.baseUrl,
        apiKey: process.env.MCP_RERANKING_API_KEY || DEFAULT_CONFIG.apiKey,
        model: process.env.MCP_RERANKING_MODEL || DEFAULT_CONFIG.model,

        // Performance tuning
        maxCandidates: parseInt(process.env.MCP_RERANKING_CANDIDATES || DEFAULT_CONFIG.maxCandidates.toString(), 10),
        topK: parseInt(process.env.MCP_RERANKING_TOP_K || DEFAULT_CONFIG.topK.toString(), 10),
        timeout: parseInt(process.env.MCP_RERANKING_TIMEOUT || DEFAULT_CONFIG.timeout.toString(), 10),

        // MLX-specific configuration
        mlxModelPath,
        mlxUvPath: process.env.MCP_RERANKING_MLX_UV_PATH || DEFAULT_CONFIG.mlxUvPath,
        mlxPythonPath: process.env.MCP_RERANKING_MLX_PYTHON_PATH || DEFAULT_CONFIG.mlxPythonPath,
    };
}

/**
 * Reranking configuration loaded from environment variables
 * Reloaded on each access for testing support
 */
export const RERANKING_CONFIG: RerankingRuntimeConfig = loadConfig();

/**
 * Get full reranking runtime configuration (including MLX-specific fields)
 * @returns Validated runtime reranking configuration
 */
export function getRerankingRuntimeConfig(): RerankingRuntimeConfig {
    const config = loadConfig();

    if (config.enabled) {
        validateRerankingConfig();
    }

    return config;
}

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
    const validProviders: RerankerProviderType[] = ['cohere', 'jina', 'openai', 'custom', 'lmstudio', 'mlx'];
    if (!validProviders.includes(config.provider)) {
        throw new Error(
            `Invalid reranking provider: ${config.provider}. ` +
            `Must be one of: ${validProviders.join(', ')}`
        );
    }

    // Validate API key for API-based providers only
    if (
        config.provider !== 'custom' &&
        config.provider !== 'lmstudio' &&
        config.provider !== 'mlx' &&
        !config.apiKey
    ) {
        throw new Error(
            `API key is required for ${config.provider} provider. ` +
            `Set MCP_RERANKING_API_KEY environment variable.`
        );
    }

    // Validate MLX-specific configuration
    if (config.provider === 'mlx') {
        if (!config.mlxModelPath) {
            throw new Error(
                'MLX model path is required for MLX provider. ' +
                'Set MCP_RERANKING_MLX_MODEL_PATH environment variable.'
            );
        }
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

    // Validate base URL (only for API-based providers)
    if (config.provider !== 'mlx') {
        if (!config.baseUrl) {
            throw new Error('MCP_RERANKING_BASE_URL must be set');
        }

        try {
            new URL(config.baseUrl);
        } catch (error) {
            throw new Error(`Invalid MCP_RERANKING_BASE_URL: ${config.baseUrl}`);
        }
    }
}

/**
 * Get reranking configuration with defaults applied
 * @returns Validated reranking configuration
 */
export function getRerankingConfig(): RerankerConfig {
    const config = getRerankingRuntimeConfig();

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
    
    // For MLX provider, check model path instead of API key
    if (config.provider === 'mlx') {
        return config.enabled && !!config.mlxModelPath;
    }
    
    return config.enabled && !!config.apiKey;
}
