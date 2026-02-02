/**
 * API-based reranking implementation
 * Supports multiple providers: Cohere, Jina AI, OpenAI, and custom endpoints
 */

import type { Reranker, RerankerConfig, RerankOptions, RerankResult, RerankerProviderType } from '../types.js';

/**
 * API response format for Cohere rerank API
 */
interface CohereRerankResponse {
    id: string;
    results: Array<{
        index: number;
        relevance_score: number;
    }>;
}

/**
 * API response format for OpenAI-compatible rerank API
 */
interface OpenAIRerankResponse {
    results: Array<{
        index: number;
        relevance_score: number;
    }>;
}

/**
 * API-based reranker implementation
 */
export class ApiReranker implements Reranker {
    private config: RerankerConfig;
    private ready: boolean = true;

    constructor(config: Partial<RerankerConfig>) {
        // Apply defaults for missing values
        this.config = {
            provider: config.provider || 'cohere',
            apiKey: config.apiKey || '',
            model: config.model || 'rerank-multilingual-v3.0',
            baseUrl: config.baseUrl || 'https://api.cohere.ai/v1',
            timeout: config.timeout || 30000,
            maxCandidates: config.maxCandidates || 50,
            topK: config.topK || 10,
        };
    }

    /**
     * Rerank documents using the configured API provider
     * @param query - The search query
     * @param documents - Array of document contents to rerank
     * @param options - Optional reranking configuration
     * @returns Promise resolving to sorted reranking results
     */
    async rerank(
        query: string,
        documents: string[],
        options?: RerankOptions
    ): Promise<RerankResult[]> {
        if (!this.ready) {
            throw new Error('Reranker is not ready');
        }

        if (documents.length === 0) {
            return [];
        }

        const topK = options?.topK ?? this.config.topK;
        const maxCandidates = Math.min(
            documents.length,
            options?.maxCandidates ?? this.config.maxCandidates
        );

        // Limit documents to maxCandidates
        const documentsToRerank = documents.slice(0, maxCandidates);

        try {
            let results: RerankResult[];

            switch (this.config.provider) {
                case 'cohere':
                    results = await this.rerankWithCohere(query, documentsToRerank, topK);
                    break;
                case 'jina':
                    results = await this.rerankWithJina(query, documentsToRerank, topK);
                    break;
                case 'openai':
                    results = await this.rerankWithOpenAI(query, documentsToRerank, topK);
                    break;
                case 'custom':
                    results = await this.rerankWithCustom(query, documentsToRerank, topK);
                    break;
                default:
                    throw new Error(`Unsupported provider: ${this.config.provider}`);
            }

            return results;
        } catch (error) {
            console.error('Reranking failed:', error);
            throw error;
        }
    }

    /**
     * Check if the reranker is ready to use
     * @returns True if the reranker is initialized and ready
     */
    isReady(): boolean {
        return this.ready && !!this.config.apiKey;
    }

    /**
     * Get information about the reranker model
     * @returns Object containing model name and type
     */
    getModelInfo(): { name: string; type: 'api' | 'local' } {
        return {
            name: this.config.model,
            type: 'api',
        };
    }

    /**
     * Rerank using Cohere API
     */
    private async rerankWithCohere(
        query: string,
        documents: string[],
        topK: number
    ): Promise<RerankResult[]> {
        const url = `${this.config.baseUrl}/rerank`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json',
                    'X-Client-Name': 'saga-mcp',
                },
                body: JSON.stringify({
                    model: this.config.model,
                    query,
                    documents,
                    top_n: topK,
                    return_documents: false,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Cohere API error (${response.status}): ${error}`);
            }

            const data: CohereRerankResponse = await response.json();

            return data.results.map((result) => ({
                index: result.index,
                score: result.relevance_score,
            }));
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Rerank using Jina AI API
     */
    private async rerankWithJina(
        query: string,
        documents: string[],
        topK: number
    ): Promise<RerankResult[]> {
        const url = `${this.config.baseUrl}/rerank`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.config.model,
                    query,
                    documents,
                    top_n: topK,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Jina AI API error (${response.status}): ${error}`);
            }

            const data: CohereRerankResponse = await response.json();

            return data.results.map((result) => ({
                index: result.index,
                score: result.relevance_score,
            }));
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Rerank using OpenAI-compatible API
     */
    private async rerankWithOpenAI(
        query: string,
        documents: string[],
        topK: number
    ): Promise<RerankResult[]> {
        const url = `${this.config.baseUrl}/rerank`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.config.model,
                    query,
                    documents,
                    top_n: topK,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`OpenAI API error (${response.status}): ${error}`);
            }

            const data: OpenAIRerankResponse = await response.json();

            return data.results.map((result) => ({
                index: result.index,
                score: result.relevance_score,
            }));
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Rerank using custom API endpoint
     */
    private async rerankWithCustom(
        query: string,
        documents: string[],
        topK: number
    ): Promise<RerankResult[]> {
        const url = `${this.config.baseUrl}/rerank`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };

            // Add authorization if API key is provided
            if (this.config.apiKey) {
                headers['Authorization'] = `Bearer ${this.config.apiKey}`;
            }

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: this.config.model,
                    query,
                    documents,
                    top_n: topK,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Custom API error (${response.status}): ${error}`);
            }

            const data: CohereRerankResponse | OpenAIRerankResponse = await response.json();

            // Handle both response formats
            const results = 'results' in data ? data.results : [];

            return results.map((result) => ({
                index: result.index,
                score: result.relevance_score,
            }));
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
