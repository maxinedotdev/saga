import type { EmbeddingProvider, EmbeddingProviderConfig, ProviderHealth } from './types.js';
import { EmbeddingCache } from './embeddings/embedding-cache.js';
// Timeout imports: fetchWithTimeout wraps native fetch with AbortController-based timeout,
// RequestTimeoutError is thrown when timeout is exceeded, getRequestTimeout retrieves
// the configured timeout for 'embedding' operation type (falls back through hierarchy:
// MCP_EMBEDDING_TIMEOUT_MS → MCP_REQUEST_TIMEOUT_MS → default 30000ms)
import { fetchWithTimeout, RequestTimeoutError, getRequestTimeout } from './utils/http-timeout.js';

// ============================================================================
// Multi-Provider Configuration and Health Management
// ============================================================================

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RECOVERY_TIMEOUT_MS = 300000; // 5 minutes

/**
 * Parse multi-provider configuration from environment variable
 * Returns null if not set or invalid
 */
export function parseMultiEmbeddingProviderConfig(): EmbeddingProviderConfig[] | null {
    const configJson = process.env.MCP_EMBEDDING_PROVIDERS;
    if (!configJson) {
        return null;
    }

    try {
        const config = JSON.parse(configJson) as EmbeddingProviderConfig[];
        
        // Validate the configuration
        if (!Array.isArray(config)) {
            console.error('[MultiEmbeddingProvider] MCP_EMBEDDING_PROVIDERS must be a JSON array');
            return null;
        }

        if (config.length === 0) {
            console.error('[MultiEmbeddingProvider] MCP_EMBEDDING_PROVIDERS array is empty');
            return null;
        }

        for (const entry of config) {
            if (!entry.provider || entry.provider !== 'openai') {
                console.error(`[MultiEmbeddingProvider] Invalid provider type: ${entry.provider}. Only 'openai' is supported.`);
                return null;
            }
            if (typeof entry.priority !== 'number') {
                console.error(`[MultiEmbeddingProvider] Priority must be a number for provider: ${entry.provider}`);
                return null;
            }
            if (entry.provider === 'openai' && !entry.baseUrl) {
                console.error(`[MultiEmbeddingProvider] OpenAI provider requires baseUrl`);
                return null;
            }
        }

        // Sort by priority (lower = higher priority)
        config.sort((a, b) => a.priority - b.priority);

        console.error(`[MultiEmbeddingProvider] Loaded ${config.length} providers by priority: ${config.map(p => `${p.provider}(pri=${p.priority})`).join(', ')}`);
        return config;
    } catch (error) {
        console.error('[MultiEmbeddingProvider] Failed to parse MCP_EMBEDDING_PROVIDERS:', error);
        return null;
    }
}

/**
 * Check if multi-provider configuration is available
 */
export function hasMultiEmbeddingProviderConfig(): boolean {
    return parseMultiEmbeddingProviderConfig() !== null;
}

/**
 * Provider health manager for tracking failures and recovery
 */
class ProviderHealthManager {
    private health: ProviderHealth;
    private failureThreshold: number;
    private recoveryTimeoutMs: number;

    constructor(
        failureThreshold: number = DEFAULT_FAILURE_THRESHOLD,
        recoveryTimeoutMs: number = DEFAULT_RECOVERY_TIMEOUT_MS
    ) {
        this.health = {
            isHealthy: true,
            consecutiveFailures: 0,
        };
        this.failureThreshold = failureThreshold;
        this.recoveryTimeoutMs = recoveryTimeoutMs;
    }

    markSuccess(): void {
        if (this.health.consecutiveFailures > 0) {
            console.error(`[ProviderHealth] Provider recovered after ${this.health.consecutiveFailures} failures`);
        }
        this.health.consecutiveFailures = 0;
        this.health.isHealthy = true;
        this.health.lastSuccessTime = Date.now();
    }

    markFailure(): void {
        this.health.consecutiveFailures++;
        this.health.lastFailureTime = Date.now();

        if (this.health.consecutiveFailures >= this.failureThreshold) {
            if (this.health.isHealthy) {
                console.error(`[ProviderHealth] Provider marked unhealthy after ${this.health.consecutiveFailures} consecutive failures`);
            }
            this.health.isHealthy = false;
        }
    }

    isHealthy(): boolean {
        // If unhealthy, check if recovery timeout has passed
        if (!this.health.isHealthy && this.health.lastFailureTime) {
            const timeSinceFailure = Date.now() - this.health.lastFailureTime;
            if (timeSinceFailure >= this.recoveryTimeoutMs) {
                console.error('[ProviderHealth] Recovery timeout passed, marking provider as healthy again');
                this.health.isHealthy = true;
                this.health.consecutiveFailures = 0;
            }
        }
        return this.health.isHealthy;
    }

    getHealth(): ProviderHealth {
        return { ...this.health };
    }
}

/**
 * Multi-provider embedding provider that implements fallback logic
 */
export class MultiEmbeddingProvider implements EmbeddingProvider {
    private providers: Array<{
        config: EmbeddingProviderConfig;
        instance: EmbeddingProvider;
        health: ProviderHealthManager;
    }> = [];
    private dimensions: number | null = null;
    private currentProviderIndex = 0;

    constructor(
        configs: EmbeddingProviderConfig[],
        private createProviderFn: (config: EmbeddingProviderConfig) => EmbeddingProvider
    ) {
        const failureThreshold = parseInt(process.env.MCP_PROVIDER_FAILURE_THRESHOLD || '3', 10);
        const recoveryTimeout = parseInt(process.env.MCP_PROVIDER_RECOVERY_TIMEOUT || '300000', 10);

        for (const config of configs) {
            const instance = createProviderFn(config);
            this.providers.push({
                config,
                instance,
                health: new ProviderHealthManager(failureThreshold, recoveryTimeout),
            });
        }

        console.error(`[MultiEmbeddingProvider] Initialized with ${configs.length} providers`);
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const startIndex = this.currentProviderIndex;
        const attemptedProviders: string[] = [];

        for (let i = 0; i < this.providers.length; i++) {
            const providerIndex = (startIndex + i) % this.providers.length;
            const { config, instance, health } = this.providers[providerIndex];

            // Skip unhealthy providers
            if (!health.isHealthy()) {
                console.error(`[MultiEmbeddingProvider] Skipping unhealthy provider: ${config.provider}`);
                attemptedProviders.push(`${config.provider} (unhealthy)`);
                continue;
            }

            try {
                console.error(`[MultiEmbeddingProvider] Trying provider: ${config.provider}`);
                const embedding = await instance.generateEmbedding(text);

                // Validate dimensions on first success
                if (this.dimensions === null) {
                    this.dimensions = embedding.length;
                    console.error(`[MultiEmbeddingProvider] Established dimensions: ${this.dimensions}`);
                } else if (embedding.length !== this.dimensions) {
                    console.warn(`[MultiEmbeddingProvider] Dimension mismatch! ${config.provider} returned ${embedding.length} dims, expected ${this.dimensions}`);
                    // Still use it, but warn
                }

                // Mark success and update current index
                health.markSuccess();
                this.currentProviderIndex = providerIndex;

                console.error(`[MultiEmbeddingProvider] Success with provider: ${config.provider}`);
                return embedding;
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error(`[MultiEmbeddingProvider] Provider ${config.provider} failed: ${errorMsg}`);
                health.markFailure();
                attemptedProviders.push(`${config.provider} (failed: ${errorMsg})`);
            }
        }

        throw new Error(`All embedding providers failed. Attempted: ${attemptedProviders.join(', ')}`);
    }

    isAvailable(): boolean {
        // Check if any provider is healthy and available
        return this.providers.some(({ instance, health }) => 
            health.isHealthy() && instance.isAvailable()
        );
    }

    getModelName(): string {
        // Return a summary of all providers
        const names = this.providers.map(({ config }) => 
            `${config.provider}(pri=${config.priority})`
        );
        return `MultiProvider[${names.join(', ')}]`;
    }

    getDimensions(): number {
        // Return dimensions from first available provider, or default
        for (const { instance, health } of this.providers) {
            if (health.isHealthy()) {
                const dims = instance.getDimensions();
                if (dims > 0) return dims;
            }
        }
        return this.dimensions || 384; // Default fallback
    }

    getCacheStats(): any {
        // Aggregate cache stats from all providers
        const stats: Record<string, any> = {};
        for (const { config, instance } of this.providers) {
            if (instance.getCacheStats) {
                stats[config.provider] = instance.getCacheStats();
            }
        }
        return { multiProvider: true, providers: stats };
    }

    /**
     * Get health status of all providers
     */
    getProviderHealth(): Array<{ provider: string; health: ProviderHealth }> {
        return this.providers.map(({ config, health }) => ({
            provider: config.provider,
            health: health.getHealth(),
        }));
    }
}

// ============================================================================
// Singleton Provider Instance Management
// ============================================================================

let cachedEmbeddingProvider: EmbeddingProvider | null = null;
let cachedProviderConfig: string | null = null;
let providerCreationCount = 0;

/**
 * Get a cached embedding provider instance based on configuration
 * This ensures only one provider is created and reused across the application
 */
function getCachedEmbeddingProvider(createFn: () => EmbeddingProvider): EmbeddingProvider {
    const currentConfig = JSON.stringify({
        multiConfig: parseMultiEmbeddingProviderConfig(),
        baseUrl: process.env.MCP_EMBEDDING_BASE_URL,
        model: process.env.MCP_EMBEDDING_MODEL,
        apiKey: process.env.MCP_EMBEDDING_API_KEY ? '[REDACTED]' : undefined,
    });

    // Return cached instance if config hasn't changed
    if (cachedEmbeddingProvider && cachedProviderConfig === currentConfig) {
        return cachedEmbeddingProvider;
    }

    // Create new instance and cache it
    providerCreationCount++;
    cachedEmbeddingProvider = createFn();
    cachedProviderConfig = currentConfig;

    return cachedEmbeddingProvider;
}

const DEFAULT_LOCAL_OPENAI_BASE_URL = 'http://127.0.0.1:1234';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-multilingual-e5-large-instruct';

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

function stripV1Suffix(url: string): string {
    return normalizeBaseUrl(url).replace(/\/v1$/, '');
}

function ensureOpenAiBaseUrl(url: string): string {
    const normalized = normalizeBaseUrl(url);
    return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

function resolveOpenAiEmbeddingConfig(modelName?: string): { baseUrl: string; model: string; apiKey?: string } {
    const baseUrl = process.env.MCP_EMBEDDING_BASE_URL;
    if (!baseUrl) {
        throw new Error('MCP_EMBEDDING_BASE_URL is required for OpenAI-compatible embeddings.');
    }

    const defaultModel =
        stripV1Suffix(baseUrl) === DEFAULT_LOCAL_OPENAI_BASE_URL
            ? DEFAULT_OPENAI_EMBEDDING_MODEL
            : null;
    const resolvedModel = modelName || process.env.MCP_EMBEDDING_MODEL || defaultModel;

    if (!resolvedModel) {
        throw new Error('MCP_EMBEDDING_MODEL is required when MCP_EMBEDDING_BASE_URL is not a known default.');
    }

    return {
        baseUrl: ensureOpenAiBaseUrl(baseUrl),
        model: resolvedModel,
        apiKey: process.env.MCP_EMBEDDING_API_KEY,
    };
}

/**
 * Embedding provider using OpenAI-compatible /v1/embeddings endpoints
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
    private dimensions: number | null = null;
    private cache: EmbeddingCache | null = null;
    private instanceId: string;

    constructor(
        private baseUrl: string,
        private modelName: string,
        private apiKey?: string
    ) {
        this.instanceId = `${this.constructor.name}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        
        if (process.env.MCP_CACHE_ENABLED !== 'false') {
            try {
                this.cache = new EmbeddingCache();
            } catch (error) {
                console.warn('[OpenAiEmbeddingProvider] Failed to initialize cache:', error);
            }
        }
    }

    async generateEmbedding(text: string): Promise<number[]> {
        if (this.cache) {
            const cachedEmbedding = await this.cache.getEmbedding(text);
            if (cachedEmbedding) {
                return cachedEmbedding;
            }
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.apiKey) {
            headers.Authorization = `Bearer ${this.apiKey}`;
        }

        // Retrieve the timeout for embedding operations using the configured hierarchy:
        // MCP_EMBEDDING_TIMEOUT_MS → MCP_REQUEST_TIMEOUT_MS → default (30000ms)
        const timeoutMs = getRequestTimeout('embedding');
        const url = `${this.baseUrl}/embeddings`;

        try {
            // Use fetchWithTimeout to enforce the timeout via AbortController
            const response = await fetchWithTimeout(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: this.modelName,
                    input: text,
                }),
                timeoutMs,
            });

            const payloadText = await response.text();
            if (!response.ok) {
                throw new Error(`OpenAI-compatible embeddings request failed (${response.status}): ${payloadText}`);
            }

            let payload: any;
            try {
                payload = JSON.parse(payloadText);
            } catch {
                throw new Error(`OpenAI-compatible embeddings response was not JSON: ${payloadText}`);
            }

            if (payload?.error) {
                const message = typeof payload.error === 'string' ? payload.error : payload.error?.message;
                throw new Error(`OpenAI-compatible embeddings response error: ${message ?? payloadText}`);
            }

            const embedding = payload?.data?.[0]?.embedding;
            if (!Array.isArray(embedding)) {
                throw new Error('OpenAI-compatible embeddings response missing embedding data.');
            }

            const vector = embedding.map((value: unknown) => Number(value));
            if (vector.some(value => Number.isNaN(value))) {
                throw new Error('OpenAI-compatible embeddings response contains non-numeric values.');
            }

            this.dimensions = vector.length;

            if (this.cache) {
                await this.cache.setEmbedding(text, vector);
            }

            return vector;
        } catch (error) {
            // Handle timeout errors specifically - log with details and re-throw
            if (error instanceof RequestTimeoutError) {
                console.error(`[OpenAiEmbeddingProvider] Request timed out after ${error.timeoutMs}ms: ${url}`);
            }
            throw error;
        }
    }

    isAvailable(): boolean {
        return true;
    }

    getModelName(): string {
        return this.modelName;
    }

    getDimensions(): number {
        return this.dimensions ?? 0;
    }

    getCacheStats(): any {
        return this.cache ? this.cache.getCacheStats() : null;
    }
}

/**
 * Create a single embedding provider from config
 */
function createProviderFromConfig(config: EmbeddingProviderConfig): EmbeddingProvider {
    if (config.provider === 'openai') {
        if (!config.baseUrl) {
            throw new Error('OpenAI provider requires baseUrl');
        }
        return new OpenAiEmbeddingProvider(
            config.baseUrl,
            config.model || 'text-embedding-3-small',
            config.apiKey
        );
    }
    throw new Error(`Unsupported provider type: ${config.provider}. Only 'openai' is supported.`);
}

/**
 * Factory function to create the best available embedding provider
 * Supports both single-provider (legacy) and multi-provider modes
 * Uses singleton pattern to ensure only one provider instance is created
 */
export async function createEmbeddingProvider(modelName?: string): Promise<EmbeddingProvider> {
    const provider = getCachedEmbeddingProvider(() => {
        // Check for multi-provider configuration first
        const multiConfig = parseMultiEmbeddingProviderConfig();
        if (multiConfig) {
            console.error('[createEmbeddingProvider] Using multi-provider mode');
            return new MultiEmbeddingProvider(multiConfig, createProviderFromConfig);
        }

        // Legacy single-provider mode - only OpenAI is supported
        console.error('[createEmbeddingProvider] Using legacy single-provider mode');
        const config = resolveOpenAiEmbeddingConfig(modelName);
        return new OpenAiEmbeddingProvider(config.baseUrl, config.model, config.apiKey);
    });

    // Test the provider setup (only on first creation)
    try {
        await provider.generateEmbedding('test');
        console.error('[createEmbeddingProvider] Provider test successful');
    } catch (error) {
        console.error('[createEmbeddingProvider] Provider test failed:', error);
        // Don't throw - the provider might still work for real requests
    }

    return provider;
}

/**
 * Create embedding provider with specific model
 */
export async function createEmbeddingProviderWithModel(modelName: string): Promise<EmbeddingProvider> {
    return createEmbeddingProvider(modelName);
}

/**
 * Clear the cached embedding provider instance
 * Useful for testing or when configuration changes dynamically
 */
export function clearEmbeddingProviderCache(): void {
    cachedEmbeddingProvider = null;
    cachedProviderConfig = null;
    console.error('[EmbeddingProvider] Cache cleared');
}

/**
 * Check if an embedding provider instance is cached
 * Useful for debugging and monitoring
 */
export function isEmbeddingProviderCached(): boolean {
    return cachedEmbeddingProvider !== null;
}

/**
 * Create embedding provider with lazy initialization (no immediate test)
 * Supports both single-provider (legacy) and multi-provider modes
 * Uses singleton pattern to ensure only one provider instance is created
 */
export function createLazyEmbeddingProvider(modelName?: string): EmbeddingProvider {
    return getCachedEmbeddingProvider(() => {
        // Check for multi-provider configuration first
        const multiConfig = parseMultiEmbeddingProviderConfig();
        if (multiConfig) {
            console.error('[createLazyEmbeddingProvider] Using multi-provider mode');
            return new MultiEmbeddingProvider(multiConfig, createProviderFromConfig);
        }

        // Legacy single-provider mode - only OpenAI is supported
        console.error('[createLazyEmbeddingProvider] Using legacy single-provider mode');
        const config = resolveOpenAiEmbeddingConfig(modelName);
        return new OpenAiEmbeddingProvider(config.baseUrl, config.model, config.apiKey);
    });
}
