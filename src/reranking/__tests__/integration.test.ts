import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiReranker } from '../api-reranker.js';
import { getRerankingConfig, isRerankingEnabled } from '../config.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('Reranking Integration', () => {
	let reranker: ApiReranker;

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset environment variables
		process.env.MCP_RERANKING_ENABLED = 'true';
		process.env.MCP_RERANKING_PROVIDER = 'cohere';
		process.env.MCP_RERANKING_BASE_URL = 'https://api.cohere.ai/v1';
		process.env.MCP_RERANKING_API_KEY = 'test-key';
		process.env.MCP_RERANKING_MODEL = 'rerank-multilingual-v3.0';
		process.env.MCP_RERANKING_CANDIDATES = '50';
		process.env.MCP_RERANKING_TOP_K = '10';
		process.env.MCP_RERANKING_TIMEOUT = '30000';

		reranker = new ApiReranker({
			provider: 'cohere',
			apiKey: 'test-key',
			model: 'rerank-multilingual-v3.0',
			baseUrl: 'https://api.cohere.ai/v1',
			timeout: 30000,
			maxCandidates: 50,
			topK: 10,
		});
	});

	afterEach(() => {
		// Clean up environment variables
		delete process.env.MCP_RERANKING_ENABLED;
		delete process.env.MCP_RERANKING_PROVIDER;
		delete process.env.MCP_RERANKING_BASE_URL;
		delete process.env.MCP_RERANKING_API_KEY;
		delete process.env.MCP_RERANKING_MODEL;
		delete process.env.MCP_RERANKING_CANDIDATES;
		delete process.env.MCP_RERANKING_TOP_K;
		delete process.env.MCP_RERANKING_TIMEOUT;
	});

	describe('two-stage retrieval workflow', () => {
		it('should demonstrate full reranking workflow', async () => {
			// Simulate Stage 1: Vector search candidates
			const candidates = [
				'document 1 about Python programming',
				'document 2 about JavaScript frameworks',
				'document 3 about database design',
				'document 4 about API development',
				'document 5 about testing strategies',
			];

			// Mock reranking API response
			const mockRerankResponse = {
				results: [
					{ index: 4, relevance_score: 0.95 },
					{ index: 2, relevance_score: 0.88 },
					{ index: 0, relevance_score: 0.82 },
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockRerankResponse,
			});

			// Stage 2: Rerank candidates
			const query = 'how to test code effectively';
			const results = await reranker.rerank(query, candidates, { topK: 3 });

			// Verify reranking results
			expect(results).toHaveLength(3);
			expect(results[0].index).toBe(4); // 'document 5' - highest score
			expect(results[0].score).toBe(0.95);
			expect(results[1].index).toBe(2); // 'document 3'
			expect(results[1].score).toBe(0.88);
			expect(results[2].index).toBe(0); // 'document 1'
			expect(results[2].score).toBe(0.82);
		});

		it('should handle multilingual queries', async () => {
			const candidates = [
				'dette er norsk tekst om programmering',
				'this is english text about development',
				'dette er mer om database design',
			];

			const mockRerankResponse = {
				results: [
					{ index: 0, relevance_score: 0.92 },
					{ index: 2, relevance_score: 0.85 },
					{ index: 1, relevance_score: 0.78 },
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockRerankResponse,
			});

			const results = await reranker.rerank('hvordan teste jeg kode?', candidates);

			expect(results).toHaveLength(3);
			expect(results[0].index).toBe(0);
		});

		it('should handle code snippet queries', async () => {
			const candidates = [
				'function example() { return true; }',
				'const x = 5;',
				'if (condition) { doSomething(); }',
			];

			const mockRerankResponse = {
				results: [
					{ index: 0, relevance_score: 0.91 },
					{ index: 2, relevance_score: 0.84 },
					{ index: 1, relevance_score: 0.77 },
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockRerankResponse,
			});

			const results = await reranker.rerank('how to create a function?', candidates);

			expect(results).toHaveLength(3);
			expect(results[0].index).toBe(0);
		});
	});

	describe('graceful degradation', () => {
		it('should handle API errors gracefully', async () => {
			const candidates = ['doc1', 'doc2', 'doc3'];

			mockFetch.mockRejectedValueOnce(new Error('API error'));

			await expect(reranker.rerank('test query', candidates)).rejects.toThrow();
		});
	});

	describe('configuration integration', () => {
		it('should load configuration from environment', () => {
			process.env.MCP_RERANKING_ENABLED = 'true';
			process.env.MCP_RERANKING_PROVIDER = 'cohere';
			process.env.MCP_RERANKING_BASE_URL = 'https://api.cohere.ai/v1';
			process.env.MCP_RERANKING_API_KEY = 'test-key';
			process.env.MCP_RERANKING_MODEL = 'rerank-multilingual-v3.0';
			process.env.MCP_RERANKING_CANDIDATES = '50';
			process.env.MCP_RERANKING_TOP_K = '10';
			process.env.MCP_RERANKING_TIMEOUT = '30000';

			const config = getRerankingConfig();

			expect(config.provider).toBe('cohere');
			expect(config.baseUrl).toBe('https://api.cohere.ai/v1');
			expect(config.apiKey).toBe('test-key');
			expect(config.model).toBe('rerank-multilingual-v3.0');
			expect(config.maxCandidates).toBe(50);
			expect(config.topK).toBe(10);
			expect(config.timeout).toBe(30000);
		});

		it('should check if reranking is enabled', () => {
			process.env.MCP_RERANKING_ENABLED = 'true';
			process.env.MCP_RERANKING_API_KEY = 'test-key';
			expect(isRerankingEnabled()).toBe(true);

			process.env.MCP_RERANKING_ENABLED = 'false';
			expect(isRerankingEnabled()).toBe(false);
		});
	});
});
