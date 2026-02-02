import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiReranker } from '../api-reranker.js';
import { getRerankingConfig, isRerankingEnabled } from '../config.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('ApiReranker', () => {
	let reranker: ApiReranker;

	beforeEach(() => {
		vi.clearAllMocks();
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
		vi.restoreAllMocks();
	});

	describe('constructor', () => {
		it('should create reranker with default config', () => {
			const defaultReranker = new ApiReranker({
				provider: 'cohere',
				apiKey: 'test-key',
			});

			const modelInfo = defaultReranker.getModelInfo();
			expect(modelInfo.type).toBe('api');
			// Model name will be the default from config
			expect(modelInfo.name).toBeTruthy();
		});

		it('should create reranker with custom config', () => {
			const customReranker = new ApiReranker({
				provider: 'jina',
				apiKey: 'custom-key',
				model: 'jina-reranker-v1',
				baseUrl: 'https://api.jina.ai/v1',
				timeout: 10000,
				maxCandidates: 100,
				topK: 20,
			});

			expect(customReranker.getModelInfo()).toMatchObject({
				name: 'jina-reranker-v1',
				type: 'api',
			});
		});

		it('should return model info', () => {
			const modelInfo = reranker.getModelInfo();

			expect(modelInfo).toEqual({
				name: 'rerank-multilingual-v3.0',
				type: 'api',
			});
		});
	});

	describe('rerank method', () => {
		it('should rerank documents successfully', async () => {
			const documents = ['doc1', 'doc2', 'doc3'];
			const mockResponse = {
				results: [
					{ index: 2, relevance_score: 0.95 },
					{ index: 0, relevance_score: 0.82 },
					{ index: 1, relevance_score: 0.75 },
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const results = await reranker.rerank('test query', documents);

			expect(results).toHaveLength(3);
			expect(results[0].index).toBe(2);
			expect(results[0].score).toBe(0.95);
			expect(results[1].index).toBe(0);
			expect(results[1].score).toBe(0.82);
			expect(results[2].index).toBe(1);
			expect(results[2].score).toBe(0.75);
		});

		it('should handle empty documents array', async () => {
			const results = await reranker.rerank('test query', []);

			expect(results).toEqual([]);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('should respect topK option', async () => {
			const documents = ['doc1', 'doc2', 'doc3', 'doc4', 'doc5'];

			// Mock that respects top_n parameter
			mockFetch.mockImplementationOnce(async (url, options) => {
				const body = JSON.parse(options?.body as string);
				const topN = body.top_n || 5;

				return {
					ok: true,
					json: async () => ({
						results: [
							{ index: 2, relevance_score: 0.95 },
							{ index: 0, relevance_score: 0.82 },
							{ index: 1, relevance_score: 0.75 },
							{ index: 3, relevance_score: 0.70 },
							{ index: 4, relevance_score: 0.65 },
						].slice(0, topN),
					}),
				};
			});

			const results = await reranker.rerank('test query', documents, { topK: 2 });

			expect(results).toHaveLength(2);
			expect(results[0].index).toBe(2);
			expect(results[1].index).toBe(0);
		});

		it('should handle API errors gracefully', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 400,
				statusText: 'Bad Request',
			});

			await expect(reranker.rerank('test query', ['doc1'])).rejects.toThrow();
		});

		it('should handle network errors', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			await expect(reranker.rerank('test query', ['doc1'])).rejects.toThrow();
		});
	});

	describe('provider support', () => {
		it('should use Cohere API format', async () => {
			const cohereReranker = new ApiReranker({
				provider: 'cohere',
				apiKey: 'test-key',
				model: 'rerank-multilingual-v3.0',
				baseUrl: 'https://api.cohere.ai/v1',
				timeout: 30000,
				maxCandidates: 50,
				topK: 10,
			});

			const mockResponse = {
				results: [{ index: 0, relevance_score: 0.9 }],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			await cohereReranker.rerank('query', ['doc']);

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('/rerank'),
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'Authorization': 'Bearer test-key',
						'Content-Type': 'application/json',
					}),
					body: expect.stringContaining('query'),
				})
			);
		});

		it('should use Jina AI API format', async () => {
			const jinaReranker = new ApiReranker({
				provider: 'jina',
				apiKey: 'test-key',
				model: 'jina-reranker-v1',
				baseUrl: 'https://api.jina.ai/v1',
				timeout: 30000,
				maxCandidates: 50,
				topK: 10,
			});

			const mockResponse = {
				results: [{ index: 0, relevance_score: 0.9 }],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			await jinaReranker.rerank('query', ['doc']);

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('/rerank'),
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'Authorization': 'Bearer test-key',
						'Content-Type': 'application/json',
					}),
				})
			);
		});

		it('should use OpenAI API format', async () => {
			const openaiReranker = new ApiReranker({
				provider: 'openai',
				apiKey: 'test-key',
				model: 'gpt-4o-mini',
				baseUrl: 'https://api.openai.com/v1',
				timeout: 30000,
				maxCandidates: 50,
				topK: 10,
			});

			const mockResponse = {
				results: [{ index: 0, relevance_score: 0.9 }],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			await openaiReranker.rerank('query', ['doc']);

			expect(mockFetch).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'Authorization': 'Bearer test-key',
						'Content-Type': 'application/json',
					}),
				})
			);
		});
	});
});

describe('Configuration', () => {
	describe('getRerankingConfig', () => {
		it('should load config from environment variables', () => {
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

			// Cleanup
			delete process.env.MCP_RERANKING_ENABLED;
			delete process.env.MCP_RERANKING_PROVIDER;
			delete process.env.MCP_RERANKING_BASE_URL;
			delete process.env.MCP_RERANKING_API_KEY;
			delete process.env.MCP_RERANKING_MODEL;
			delete process.env.MCP_RERANKING_CANDIDATES;
			delete process.env.MCP_RERANKING_TOP_K;
			delete process.env.MCP_RERANKING_TIMEOUT;
		});

		it('should use default values when env vars are not set', () => {
			delete process.env.MCP_RERANKING_ENABLED;
			delete process.env.MCP_RERANKING_PROVIDER;
			delete process.env.MCP_RERANKING_BASE_URL;
			delete process.env.MCP_RERANKING_API_KEY;
			delete process.env.MCP_RERANKING_MODEL;
			delete process.env.MCP_RERANKING_CANDIDATES;
			delete process.env.MCP_RERANKING_TOP_K;
			delete process.env.MCP_RERANKING_TIMEOUT;
			
			// Disable auto-configuration and enabled flag to test default values
			process.env.MCP_RERANKING_AUTO_CONFIGURE_MLX = 'false';
			process.env.MCP_RERANKING_PROVIDER = 'cohere';
			process.env.MCP_RERANKING_ENABLED = 'false';  // Disable to avoid validation error

			const config = getRerankingConfig();

			expect(config.provider).toBe('cohere');
			expect(config.baseUrl).toBe('https://api.cohere.ai/v1');
			expect(config.model).toBe('rerank-multilingual-v3.0');
			expect(config.maxCandidates).toBe(50);
			expect(config.topK).toBe(10);
			expect(config.timeout).toBe(30000);

			delete process.env.MCP_RERANKING_AUTO_CONFIGURE_MLX;
			delete process.env.MCP_RERANKING_PROVIDER;
			delete process.env.MCP_RERANKING_ENABLED;
		});

		it('should parse boolean enabled correctly', () => {
			process.env.MCP_RERANKING_ENABLED = 'true';
			process.env.MCP_RERANKING_API_KEY = 'test-key';
			expect(isRerankingEnabled()).toBe(true);

			process.env.MCP_RERANKING_ENABLED = 'false';
			expect(isRerankingEnabled()).toBe(false);

			delete process.env.MCP_RERANKING_ENABLED;
			delete process.env.MCP_RERANKING_API_KEY;
		});

		it('should parse numeric values correctly', () => {
			process.env.MCP_RERANKING_ENABLED = 'false';
			process.env.MCP_RERANKING_CANDIDATES = '100';
			process.env.MCP_RERANKING_TOP_K = '20';
			process.env.MCP_RERANKING_TIMEOUT = '60000';

			const config = getRerankingConfig();

			expect(config.maxCandidates).toBe(100);
			expect(config.topK).toBe(20);
			expect(config.timeout).toBe(60000);

			delete process.env.MCP_RERANKING_ENABLED;
			delete process.env.MCP_RERANKING_CANDIDATES;
			delete process.env.MCP_RERANKING_TOP_K;
			delete process.env.MCP_RERANKING_TIMEOUT;
		});
	});

	describe('isRerankingEnabled', () => {
		it('should return true when enabled', () => {
			process.env.MCP_RERANKING_ENABLED = 'true';
			process.env.MCP_RERANKING_API_KEY = 'test-key';
			expect(isRerankingEnabled()).toBe(true);

			delete process.env.MCP_RERANKING_ENABLED;
			delete process.env.MCP_RERANKING_API_KEY;
		});

		it('should return false when disabled', () => {
			process.env.MCP_RERANKING_ENABLED = 'false';
			process.env.MCP_RERANKING_API_KEY = 'test-key';
			expect(isRerankingEnabled()).toBe(false);

			delete process.env.MCP_RERANKING_ENABLED;
			delete process.env.MCP_RERANKING_API_KEY;
		});

		it('should return false when API key is missing', () => {
			process.env.MCP_RERANKING_ENABLED = 'true';
			process.env.MCP_RERANKING_PROVIDER = 'cohere';  // Set provider to cohere to avoid MLX auto-config
			delete process.env.MCP_RERANKING_API_KEY;
			expect(isRerankingEnabled()).toBe(false);

			delete process.env.MCP_RERANKING_ENABLED;
			delete process.env.MCP_RERANKING_PROVIDER;
		});

		it('should return true by default when not set', () => {
			delete process.env.MCP_RERANKING_ENABLED;
			process.env.MCP_RERANKING_API_KEY = 'test-key';
			expect(isRerankingEnabled()).toBe(true);

			delete process.env.MCP_RERANKING_API_KEY;
		});
	});
});
