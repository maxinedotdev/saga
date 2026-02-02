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
                case 'lmstudio':
                    results = await this.rerankWithLMStudio(query, documentsToRerank, topK);
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
        // LM Studio and custom providers don't require API key
        if (this.config.provider === 'lmstudio' || this.config.provider === 'custom') {
            return this.ready;
        }
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

    /**
     * Rerank using LM Studio via chat completions endpoint
     * LM Studio doesn't support /v1/rerank, so we use /v1/chat/completions
     * with a carefully crafted prompt to rank documents by relevance
     */
    private async rerankWithLMStudio(
        query: string,
        documents: string[],
        topK: number
    ): Promise<RerankResult[]> {
        const url = `${this.config.baseUrl}/chat/completions`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            // Build a prompt that asks the model to rank documents
            const documentsList = documents
                .map((doc, idx) => `[Document ${idx}]: ${doc.substring(0, 500)}${doc.length > 500 ? '...' : ''}`)
                .join('\n\n');

            const systemPrompt = `You are a document reranking assistant. Your task is to rank documents by their relevance to a given query.

Your response must be a valid JSON array with the following format:
[
  {"index": 0, "score": 0.95},
  {"index": 1, "score": 0.87},
  ...
]

Where:
- "index" is the original document index (0 to ${documents.length - 1})
- "score" is a relevance score between 0.0 and 1.0 (higher = more relevant)

Rank ALL documents provided. Do not omit any. The scores should reflect relative relevance to the query.`;

            const userPrompt = `Query: ${query}

Documents to rank:
${documentsList}

Return the rankings as a JSON array with index and score for each document.`;

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
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    temperature: 0.1, // Low temperature for consistent ranking
                    max_tokens: 2000,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`LM Studio API error (${response.status}): ${error}`);
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;

            if (!content) {
                throw new Error('LM Studio returned empty response');
            }

            // Parse JSON from the response
            let rankings: Array<{ index: number; score: number }>;
            try {
                // Try to extract JSON from the response (in case there's additional text)
                const jsonMatch = content.match(/\[[\s\S]*\]/);
                const jsonStr = jsonMatch ? jsonMatch[0] : content;
                rankings = JSON.parse(jsonStr);
            } catch (parseError) {
                console.error('Failed to parse LM Studio response:', content);
                throw new Error(`Failed to parse reranking results: ${parseError}`);
            }

            // Validate rankings
            if (!Array.isArray(rankings)) {
                throw new Error('LM Studio returned invalid format: expected array');
            }

            // Ensure all documents are ranked
            const rankedIndices = new Set(rankings.map((r) => r.index));
            if (rankedIndices.size !== documents.length) {
                console.warn(
                    `LM Studio ranked ${rankedIndices.size} of ${documents.length} documents. ` +
                    'Missing documents will receive score 0.0'
                );
                // Add missing documents with score 0
                for (let i = 0; i < documents.length; i++) {
                    if (!rankedIndices.has(i)) {
                        rankings.push({ index: i, score: 0.0 });
                    }
                }
            }

            // Sort by score descending and take topK
            rankings.sort((a, b) => b.score - a.score);

            return rankings.slice(0, topK).map((r) => ({
                index: r.index,
                score: r.score,
            }));
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
