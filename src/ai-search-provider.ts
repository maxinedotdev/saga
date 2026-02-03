import { DocumentManager } from './document-manager.js';
import type { SearchResult, AiSearchProviderConfig, ProviderHealth } from './types.js';
// Timeout imports: fetchWithTimeout wraps native fetch with AbortController-based timeout,
// RequestTimeoutError is thrown when timeout is exceeded, getRequestTimeout retrieves
// the configured timeout for 'ai-search' operation type (falls back through hierarchy:
// MCP_AI_SEARCH_TIMEOUT_MS → MCP_REQUEST_TIMEOUT_MS → default 30000ms)
import {
    fetchWithTimeout,
    RequestTimeoutError,
    getRequestTimeout,
} from './utils/http-timeout.js';

const LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234';
const SYNTHETIC_BASE_URL = 'https://api.synthetic.new/openai/v1';
const DEFAULT_LOCAL_MODEL = 'ministral-3-8b-instruct-2512';
const DEFAULT_REMOTE_MODEL = 'glm-4.7';
const DEFAULT_MAX_CONTEXT_CHUNKS = 12;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_RECOVERY_TIMEOUT_MS = 300000; // 5 minutes

export type AiProviderType = 'openai';

export type AiSearchSection = {
    section_title: string;
    content: string;
    relevance_score: number;
    page_number?: number | null;
};

export type AiSearchResult = {
    search_results: string;
    relevant_sections: AiSearchSection[];
};

export type AiProviderConfigLegacy = {
    provider: AiProviderType;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    maxChunks: number;
};

export type AiProviderSelection = {
    enabled: boolean;
    provider?: AiProviderType;
    reason?: string;
    config?: AiProviderConfigLegacy;
};

// ============================================================================
// Multi-Provider Configuration and Health Management
// ============================================================================

/**
 * Parse multi-provider configuration from environment variable
 * Returns null if not set or invalid
 */
export function parseMultiAiProviderConfig(): AiSearchProviderConfig[] | null {
    const configJson = process.env.MCP_AI_PROVIDERS;
    if (!configJson) {
        return null;
    }

    try {
        const config = JSON.parse(configJson) as AiSearchProviderConfig[];
        
        // Validate the configuration
        if (!Array.isArray(config)) {
            console.error('[MultiAiProvider] MCP_AI_PROVIDERS must be a JSON array');
            return null;
        }

        if (config.length === 0) {
            console.error('[MultiAiProvider] MCP_AI_PROVIDERS array is empty');
            return null;
        }

        for (const entry of config) {
            if (!entry.provider || entry.provider !== 'openai') {
                console.error(`[MultiAiProvider] Invalid provider type: ${entry.provider}`);
                return null;
            }
            if (typeof entry.priority !== 'number') {
                console.error(`[MultiAiProvider] Priority must be a number for provider: ${entry.provider}`);
                return null;
            }
            if (!entry.baseUrl) {
                console.error(`[MultiAiProvider] Provider requires baseUrl`);
                return null;
            }
            if (!entry.model) {
                console.error(`[MultiAiProvider] Provider requires model`);
                return null;
            }
        }

        // Sort by priority (lower = higher priority)
        config.sort((a, b) => a.priority - b.priority);

        console.error(`[MultiAiProvider] Loaded ${config.length} providers by priority: ${config.map(p => `${p.provider}(pri=${p.priority})`).join(', ')}`);
        return config;
    } catch (error) {
        console.error('[MultiAiProvider] Failed to parse MCP_AI_PROVIDERS:', error);
        return null;
    }
}

/**
 * Check if multi-provider configuration is available
 */
export function hasMultiAiProviderConfig(): boolean {
    return parseMultiAiProviderConfig() !== null;
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
 * Multi-provider AI search that implements fallback logic
 */
class MultiAiSearchProvider {
    private providers: Array<{
        config: AiSearchProviderConfig;
        health: ProviderHealthManager;
    }> = [];
    private currentProviderIndex = 0;

    constructor(configs: AiSearchProviderConfig[]) {
        const failureThreshold = parseInt(process.env.MCP_PROVIDER_FAILURE_THRESHOLD || '3', 10);
        const recoveryTimeout = parseInt(process.env.MCP_PROVIDER_RECOVERY_TIMEOUT || '300000', 10);

        for (const config of configs) {
            this.providers.push({
                config,
                health: new ProviderHealthManager(failureThreshold, recoveryTimeout),
            });
        }

        console.error(`[MultiAiProvider] Initialized with ${configs.length} providers`);
    }

    async searchDocument(
        documentId: string,
        query: string,
        manager: DocumentManager
    ): Promise<{ provider: AiProviderType; model?: string; result: AiSearchResult }> {
        const startIndex = this.currentProviderIndex;
        const attemptedProviders: string[] = [];

        for (let i = 0; i < this.providers.length; i++) {
            const providerIndex = (startIndex + i) % this.providers.length;
            const { config, health } = this.providers[providerIndex];

            // Skip unhealthy providers
            if (!health.isHealthy()) {
                console.error(`[MultiAiProvider] Skipping unhealthy provider: ${config.provider} (${config.model})`);
                attemptedProviders.push(`${config.provider}/${config.model} (unhealthy)`);
                continue;
            }

            try {
                console.error(`[MultiAiProvider] Trying provider: ${config.provider} (${config.model})`);
                
                const result = await searchWithOpenAi(documentId, query, manager, {
                    provider: config.provider,
                    baseUrl: config.baseUrl,
                    model: config.model,
                    apiKey: config.apiKey,
                    maxChunks: config.maxChunks || DEFAULT_MAX_CONTEXT_CHUNKS,
                });

                // Mark success and update current index
                health.markSuccess();
                this.currentProviderIndex = providerIndex;

                console.error(`[MultiAiProvider] Success with provider: ${config.provider} (${config.model})`);
                return {
                    provider: 'openai',
                    model: config.model,
                    result,
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error(`[MultiAiProvider] Provider ${config.provider} (${config.model}) failed: ${errorMsg}`);
                health.markFailure();
                attemptedProviders.push(`${config.provider}/${config.model} (failed: ${errorMsg})`);
            }
        }

        throw new Error(`All AI providers failed. Attempted: ${attemptedProviders.join(', ')}`);
    }

    /**
     * Get health status of all providers
     */
    getProviderHealth(): Array<{ provider: string; model: string; health: ProviderHealth }> {
        return this.providers.map(({ config, health }) => ({
            provider: config.provider,
            model: config.model,
            health: health.getHealth(),
        }));
    }
}

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

function ensureOpenAiBaseUrl(url: string): string {
    const normalized = normalizeBaseUrl(url);
    return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveDefaultModel(baseUrl: string): string | null {
    const normalized = normalizeBaseUrl(baseUrl);
    if (normalized === LM_STUDIO_BASE_URL) {
        return DEFAULT_LOCAL_MODEL;
    }
    if (normalized === SYNTHETIC_BASE_URL) {
        return DEFAULT_REMOTE_MODEL;
    }
    return null;
}

function isSyntheticBaseUrl(baseUrl: string): boolean {
    return normalizeBaseUrl(baseUrl) === SYNTHETIC_BASE_URL;
}

export function resolveAiProviderSelection(): AiProviderSelection {
    // Check for multi-provider configuration first
    const multiConfig = parseMultiAiProviderConfig();
    if (multiConfig && multiConfig.length > 0) {
        console.error('[resolveAiProviderSelection] Multi-provider configuration detected');
        // Multi-provider mode - return the first (highest priority) provider as the active one
        const primaryProvider = multiConfig[0];
        return {
            enabled: true,
            provider: primaryProvider.provider,
            config: {
                provider: primaryProvider.provider,
                baseUrl: primaryProvider.baseUrl,
                model: primaryProvider.model,
                apiKey: primaryProvider.apiKey,
                maxChunks: primaryProvider.maxChunks || DEFAULT_MAX_CONTEXT_CHUNKS,
            },
        };
    }

    // Legacy single-provider configuration
    const providerEnv = process.env.MCP_AI_PROVIDER?.toLowerCase();
    let provider: AiProviderType | null = null;

    if (providerEnv === 'openai') {
        provider = providerEnv;
    } else if (providerEnv) {
        return {
            enabled: false,
            reason: `Unknown MCP_AI_PROVIDER value: ${providerEnv}`,
        };
    } else if (process.env.MCP_AI_BASE_URL) {
        provider = 'openai';
    }

    if (!provider) {
        return {
            enabled: false,
            reason: 'No AI provider configured (set MCP_AI_BASE_URL for OpenAI-compatible AI search, or use MCP_AI_PROVIDERS for multi-provider).',
        };
    }

    const baseUrl = process.env.MCP_AI_BASE_URL;
    if (!baseUrl) {
        return {
            enabled: false,
            provider,
            reason: 'MCP_AI_BASE_URL is required for OpenAI-compatible AI search.',
        };
    }

    const maxChunks = parsePositiveInt(process.env.MCP_AI_MAX_CONTEXT_CHUNKS, DEFAULT_MAX_CONTEXT_CHUNKS);
    const defaultModel = resolveDefaultModel(baseUrl);
    const model = process.env.MCP_AI_MODEL?.trim() || defaultModel;

    if (!model) {
        return {
            enabled: false,
            provider,
            reason: 'MCP_AI_MODEL is required when MCP_AI_BASE_URL is not a known default.',
        };
    }

    if (isSyntheticBaseUrl(baseUrl) && !process.env.MCP_AI_API_KEY) {
        return {
            enabled: false,
            provider,
            reason: 'MCP_AI_API_KEY is required for synthetic.new.',
        };
    }

    return {
        enabled: true,
        provider,
        config: {
            provider,
            baseUrl: normalizeBaseUrl(baseUrl),
            model,
            apiKey: process.env.MCP_AI_API_KEY,
            maxChunks,
        },
    };
}

// Multi-provider instance cache
let multiAiProvider: MultiAiSearchProvider | null = null;

export async function searchDocumentWithAi(
    documentId: string,
    query: string,
    manager: DocumentManager
): Promise<{ provider: AiProviderType; model?: string; result: AiSearchResult }> {
    // Check for multi-provider configuration first
    const multiConfig = parseMultiAiProviderConfig();
    if (multiConfig) {
        // Initialize multi-provider on first use
        if (!multiAiProvider) {
            console.error('[searchDocumentWithAi] Initializing multi-provider mode');
            multiAiProvider = new MultiAiSearchProvider(multiConfig);
        }
        return multiAiProvider.searchDocument(documentId, query, manager);
    }

    // Legacy single-provider mode
    console.error('[searchDocumentWithAi] Using legacy single-provider mode');
    const selection = resolveAiProviderSelection();
    if (!selection.enabled || !selection.provider || !selection.config) {
        throw new Error(selection.reason || 'AI provider not configured.');
    }

    const result = await searchWithOpenAi(documentId, query, manager, selection.config);
    return {
        provider: 'openai',
        model: selection.config.model,
        result,
    };
}

/**
 * Get health status of all AI providers (useful for monitoring)
 */
export function getAiProviderHealth(): Array<{ provider: string; model: string; health: ProviderHealth }> | null {
    return multiAiProvider ? multiAiProvider.getProviderHealth() : null;
}

async function searchWithOpenAi(
    documentId: string,
    query: string,
    manager: DocumentManager,
    config: AiProviderConfigLegacy
): Promise<AiSearchResult> {
    const document = await manager.getDocument(documentId);
    if (!document) {
        throw new Error(`Document with ID '${documentId}' not found. Use 'list_documents' to get available document IDs.`);
    }

    // Search within a specific document using vector database
    await manager.ensureVectorDbReady();
    const vectorDatabase = (manager as any).vectorDatabase;
    if (!vectorDatabase) {
        throw new Error('Vector database is not available.');
    }

    // Generate query embedding
    const embeddingProvider = (manager as any).embeddingProvider;
    const queryEmbedding = await embeddingProvider.generateEmbedding(query);

    // Search with document filter
    const filter = `document_id = '${documentId}'`;
    const searchResults = await vectorDatabase.search(queryEmbedding, config.maxChunks, filter);

    if (searchResults.length === 0) {
        return {
            search_results: 'No relevant content found in the document for the given query.',
            relevant_sections: [],
        };
    }

    const prompt = buildOpenAiPrompt(document.title, query, searchResults);
    const responseText = await fetchOpenAiResponse(prompt, config);
    return parseAiSearchResult(responseText);
}

function buildOpenAiPrompt(
    documentTitle: string,
    query: string,
    searchResults: SearchResult[]
): { system: string; user: string } {
    const contextBlocks = searchResults
        .map((result, index) => {
            const chunk = result.chunk;
            return [
                `Chunk ${index + 1}`,
                `chunk_index: ${chunk.chunk_index}`,
                `score: ${result.score.toFixed(4)}`,
                `content:\n${chunk.content}`,
            ].join('\n');
        })
        .join('\n\n');

    const system = [
        'You are an expert document analyst specializing in semantic search and content extraction.',
        'Return only valid JSON with these keys:',
        '- search_results (string)',
        '- relevant_sections (array of objects with section_title, content, relevance_score, page_number)',
        'Do not include markdown or extra text.',
    ].join(' ');

    const user = [
        `Document title: ${documentTitle}`,
        `Query: ${query}`,
        '',
        'Relevant chunks (ranked):',
        contextBlocks,
        '',
        'Respond with JSON only.',
    ].join('\n');

    return { system, user };
}

async function fetchOpenAiResponse(
    prompt: { system: string; user: string },
    config: AiProviderConfigLegacy
): Promise<string> {
    if (!config.baseUrl || !config.model) {
        throw new Error('OpenAI-compatible provider is missing baseUrl or model.');
    }

    const baseUrl = ensureOpenAiBaseUrl(config.baseUrl);
    const body = {
        model: config.model,
        temperature: 0.2,
        messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
        ],
    };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
    }

    // Retrieve the timeout for AI search operations using the configured hierarchy:
    // MCP_AI_SEARCH_TIMEOUT_MS → MCP_REQUEST_TIMEOUT_MS → default (30000ms)
    const timeoutMs = getRequestTimeout('ai-search');
    const url = `${baseUrl}/chat/completions`;

    let response: Response;
    try {
        // Use fetchWithTimeout to enforce the timeout via AbortController
        response = await fetchWithTimeout(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            timeoutMs,
        });
    } catch (error) {
        // Handle timeout errors specifically - re-throw with logging for visibility
        if (error instanceof RequestTimeoutError) {
            console.error(
                `[fetchOpenAiResponse] Request timed out after ${error.timeoutMs}ms to ${error.url}`
            );
            throw error;
        }
        throw error;
    }

    const payloadText = await response.text();
    if (!response.ok) {
        throw new Error(`OpenAI-compatible request failed (${response.status}): ${payloadText}`);
    }

    let payload: any;
    try {
        payload = JSON.parse(payloadText);
    } catch (error) {
        throw new Error(`OpenAI-compatible response was not JSON: ${payloadText}`);
    }

    if (payload?.error) {
        const message = typeof payload.error === 'string' ? payload.error : payload.error?.message;
        throw new Error(`OpenAI-compatible response error: ${message ?? payloadText}`);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        const fallback = payload?.choices?.[0]?.text;
        if (typeof fallback === 'string' && fallback.trim()) {
            return fallback.trim();
        }
        throw new Error('OpenAI-compatible response missing message content.');
    }

    return content.trim();
}

function parseAiSearchResult(content: string): AiSearchResult {
    const parsed = tryParseJson(content);
    if (!parsed) {
        return {
            search_results: content.trim(),
            relevant_sections: [],
        };
    }

    const search_results = typeof parsed.search_results === 'string' ? parsed.search_results : '';
    const relevant_sections = Array.isArray(parsed.relevant_sections)
        ? parsed.relevant_sections
              .map((section: any) => ({
                  section_title: typeof section?.section_title === 'string' ? section.section_title : 'Untitled',
                  content: typeof section?.content === 'string' ? section.content : '',
                  relevance_score: typeof section?.relevance_score === 'number' ? section.relevance_score : 0,
                  page_number:
                      typeof section?.page_number === 'number' ? section.page_number : null,
              }))
              .filter((section: AiSearchSection) => section.content)
        : [];

    return { search_results, relevant_sections };
}

function tryParseJson(content: string): any | null {
    try {
        return JSON.parse(content);
    } catch {
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start === -1 || end === -1 || start >= end) {
            return null;
        }
        try {
            return JSON.parse(content.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}
