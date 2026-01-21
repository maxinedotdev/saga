import { pipeline } from '@xenova/transformers';
import { EmbeddingProvider } from './types.js';
import { EmbeddingCache } from './embeddings/embedding-cache.js';

/**
 * Get the embedding dimensions for a specific model
 */
function getModelDimensions(modelName: string): number {
    const modelDimensions: Record<string, number> = {
        'Xenova/all-MiniLM-L6-v2': 384,
        'Xenova/paraphrase-multilingual-mpnet-base-v2': 768,
        // Add new models here as needed
    };
    
    // Default to 384 for unknown models (safer fallback)
    return modelDimensions[modelName] || 384;
}

const DEFAULT_LOCAL_OPENAI_BASE_URL = 'http://127.0.0.1:1234';
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-nomic-embed-text-v1.5';

type EmbeddingProviderType = 'transformers' | 'openai';

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

function resolveEmbeddingProviderType(): EmbeddingProviderType {
    const providerEnv = process.env.MCP_EMBEDDING_PROVIDER?.toLowerCase();

    if (!providerEnv || providerEnv === 'transformers') {
        return 'transformers';
    }
    if (providerEnv === 'openai') {
        return 'openai';
    }

    throw new Error(`Unknown MCP_EMBEDDING_PROVIDER value: ${providerEnv}`);
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
 * Embedding provider using Transformers.js for local embeddings
 */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
    private pipeline: any = null;
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;
    private dimensions: number;
    private cache: EmbeddingCache | null = null;

    constructor(
        private modelName: string = 'Xenova/all-MiniLM-L6-v2'
    ) { 
        this.dimensions = getModelDimensions(modelName);
        
        // Initialize cache if enabled
        if (process.env.MCP_CACHE_ENABLED !== 'false') {
            try {
                this.cache = new EmbeddingCache();
            } catch (error) {
                console.warn('[TransformersEmbeddingProvider] Failed to initialize cache:', error);
            }
        }
    }

    private async initialize(): Promise<void> {
        if (this.isInitialized) return;

        if (this.initPromise) {
            await this.initPromise;
            return;
        }

        this.initPromise = this.doInitialize();
        await this.initPromise;
    } 
    
    private async doInitialize(): Promise<void> {
        try {
            console.error(`Initializing embedding model: ${this.modelName}`);
            console.error('This may take a few minutes for larger models...');

            // Create a timeout promise
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Model initialization timed out after 5 minutes'));
                }, 5 * 60 * 1000); // 5 minutes timeout
            });

            // Race between model loading and timeout
            this.pipeline = await Promise.race([
                pipeline('feature-extraction', this.modelName),
                timeoutPromise
            ]);

            this.isInitialized = true;
            console.error('Embedding model initialized successfully');
        } catch (error) {
            console.error('Failed to initialize embedding model:', error);
            throw new Error(`Failed to initialize embedding model: ${error}`);
        }
    }

    /**
     * Pre-initialize the model in background without waiting
     * This helps avoid timeouts on first use
     */
    async preInitialize(): Promise<void> {
        if (this.isInitialized || this.initPromise) return;

        console.error(`Pre-initializing embedding model: ${this.modelName}`);
        console.error('This will happen in background to avoid timeouts...');

        // Start initialization but don't wait for it
        this.initialize().catch(error => {
            console.error('Pre-initialization failed, will retry on first use:', error);
            this.initPromise = null; // Reset to allow retry
        });
    }

    async generateEmbedding(text: string): Promise<number[]> {
        // Check cache first if available
        if (this.cache) {
            const cachedEmbedding = await this.cache.getEmbedding(text);
            if (cachedEmbedding) {
                return cachedEmbedding;
            }
        }

        await this.initialize();

        if (!this.pipeline) {
            throw new Error('Embedding pipeline not initialized');
        }

        try {
            // Generate embeddings
            const output = await this.pipeline(text, {
                pooling: 'mean',
                normalize: true,
            });

            // Convert to regular array
            const embedding = Array.from(output.data as Float32Array);
            
            // Cache the result if cache is available
            if (this.cache) {
                await this.cache.setEmbedding(text, embedding);
            }
            
            return embedding;
        } catch (error) {
            console.error('Error generating embedding:', error);
            throw new Error(`Failed to generate embedding: ${error}`);
        }
    }
    isAvailable(): boolean {
        return this.isInitialized && this.pipeline !== null;
    }

    getModelName(): string {
        return this.modelName;
    }

    getDimensions(): number {
        return this.dimensions;
    }

    /**
     * Get cache statistics if cache is enabled
     */
    getCacheStats(): any {
        return this.cache ? this.cache.getCacheStats() : null;
    }
}

/**
 * Embedding provider using OpenAI-compatible /v1/embeddings endpoints
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
    private dimensions: number | null = null;
    private cache: EmbeddingCache | null = null;

    constructor(
        private baseUrl: string,
        private modelName: string,
        private apiKey?: string
    ) {
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

        const response = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: this.modelName,
                input: text,
            }),
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
 * Simple embedding provider that uses basic text hashing
 * Used as fallback when transformers.js is not available
 */
export class SimpleEmbeddingProvider implements EmbeddingProvider {
    private readonly dimension: number;

    constructor(dimension: number = 384) { // Default to smaller, safer dimension
        this.dimension = dimension;
    }

    async generateEmbedding(text: string): Promise<number[]> {
        // Create a simple hash-based embedding
        // This is very basic and not suitable for production semantic search
        const words = text.toLowerCase().split(/\s+/);
        const embedding = new Array(this.dimension).fill(0);

        words.forEach((word, index) => {
            const hash = this.simpleHash(word);
            const position = Math.abs(hash) % this.dimension;
            embedding[position] += 1;
        });

        // Normalize the vector
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        return magnitude > 0 ? embedding.map(val => val / magnitude) : embedding;
    }

    private simpleHash(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash;
    }
    isAvailable(): boolean {
        return true;
    }

    getModelName(): string {
        return 'Simple Hash-based Embeddings';
    }

    getDimensions(): number {
        return this.dimension;
    }

    getCacheStats(): any {
        return { enabled: false, provider: 'SimpleEmbeddingProvider' };
    }
}

/**
 * Factory function to create the best available embedding provider
 */
export async function createEmbeddingProvider(modelName?: string): Promise<EmbeddingProvider> {
    const providerType = resolveEmbeddingProviderType();
    if (providerType === 'openai') {
        const config = resolveOpenAiEmbeddingConfig(modelName);
        return new OpenAiEmbeddingProvider(config.baseUrl, config.model, config.apiKey);
    }

    const defaultModel = 'Xenova/all-MiniLM-L6-v2';
    const fallbackModel = 'Xenova/paraphrase-multilingual-mpnet-base-v2';

    // For faster initialization, try the smaller model first if no specific model is requested
    const modelsToTry = modelName
        ? [modelName, fallbackModel]
        : [fallbackModel, defaultModel]; // Try smaller model first for faster startup

    for (const model of modelsToTry) {
        try {
            console.error(`Attempting to load embedding model: ${model}`);

            const provider = new TransformersEmbeddingProvider(model);

            // Create a shorter timeout for testing if model loads
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                    reject(new Error('Model test timed out'));
                }, modelName ? 3 * 60 * 1000 : 60 * 1000); // 3 min for specific model, 1 min for auto-selection
            });

            // Test if the model works with a timeout
            await Promise.race([
                provider.generateEmbedding('test'),
                timeoutPromise
            ]);

            console.error(`Successfully loaded embedding model: ${model}`);
            return provider;
        } catch (error) {
            console.error(`Failed to load model ${model}:`, error);

            // If this was the last model to try, continue to simple embeddings
            if (model === modelsToTry[modelsToTry.length - 1]) {
                break;
            }
        }
    }

    // Final fallback to simple embeddings with correct dimensions
    const lastTriedModel = modelsToTry[modelsToTry.length - 1];
    const fallbackDimensions = getModelDimensions(lastTriedModel);
    
    console.error(`All transformer models failed, falling back to simple embeddings with ${fallbackDimensions} dimensions`);
    return new SimpleEmbeddingProvider(fallbackDimensions);
}

/**
 * Create embedding provider with specific model
 */
export async function createEmbeddingProviderWithModel(modelName: string): Promise<EmbeddingProvider> {
    return createEmbeddingProvider(modelName);
}

/**
 * Create embedding provider with lazy initialization (no immediate test)
 */
export function createLazyEmbeddingProvider(modelName?: string): EmbeddingProvider {
    const providerType = resolveEmbeddingProviderType();
    if (providerType === 'openai') {
        const config = resolveOpenAiEmbeddingConfig(modelName);
        return new OpenAiEmbeddingProvider(config.baseUrl, config.model, config.apiKey);
    }

    const defaultModel = 'Xenova/all-MiniLM-L6-v2'; // Use smaller model as default for faster startup
    return new TransformersEmbeddingProvider(modelName || defaultModel);
}
