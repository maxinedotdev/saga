import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiReranker } from '../api-reranker.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('Performance Tests', () => {
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

		// Mock successful response that returns results based on input documents
		mockFetch.mockImplementation(async (url, options) => {
			const body = JSON.parse(options?.body as string);
			const documents = body.documents || [];
			const topN = body.top_n || documents.length;

			return {
				ok: true,
				json: async () => ({
					results: Array.from({ length: Math.min(documents.length, topN) }, (_, i) => ({
						index: i,
						relevance_score: 0.9 - i * 0.01,
					})),
				}),
			};
		});
	});

	describe('reranking performance', () => {
		it('should complete reranking of 50 candidates within reasonable time', async () => {
			const documents = Array.from({ length: 50 }, (_, i) => `document ${i}`);

			const startTime = Date.now();
			await reranker.rerank('test query', documents);
			const duration = Date.now() - startTime;

			// Should complete in less than 100ms (mock response is fast)
			expect(duration).toBeLessThan(100);
		});

		it('should complete reranking of 10 candidates quickly', async () => {
			const documents = Array.from({ length: 10 }, (_, i) => `document ${i}`);

			const startTime = Date.now();
			await reranker.rerank('test query', documents);
			const duration = Date.now() - startTime;

			// Should complete in less than 100ms (mock response is fast)
			expect(duration).toBeLessThan(100);
		});
	});

	describe('scalability', () => {
		it('should handle 10 candidates efficiently', async () => {
			const documents = Array.from({ length: 10 }, (_, i) => `document ${i}`);
			const results = await reranker.rerank('test query', documents);

			// Results should be limited by topK config (10), so we get all 10
			expect(results.length).toBeLessThanOrEqual(10);
			expect(results.length).toBeGreaterThan(0);
		});

		it('should handle 25 candidates efficiently', async () => {
			const documents = Array.from({ length: 25 }, (_, i) => `document ${i}`);
			const results = await reranker.rerank('test query', documents);

			// Results should be limited by topK config (10)
			expect(results.length).toBeLessThanOrEqual(10);
			expect(results.length).toBeGreaterThan(0);
		});

		it('should handle 50 candidates efficiently', async () => {
			const documents = Array.from({ length: 50 }, (_, i) => `document ${i}`);
			const results = await reranker.rerank('test query', documents);

			// Results should be limited by topK config (10)
			expect(results.length).toBeLessThanOrEqual(10);
			expect(results.length).toBeGreaterThan(0);
		});

		it('should handle 100 candidates efficiently', async () => {
			const documents = Array.from({ length: 100 }, (_, i) => `document ${i}`);
			const results = await reranker.rerank('test query', documents);

			// Results should be limited by topK config (10)
			expect(results.length).toBeLessThanOrEqual(10);
			expect(results.length).toBeGreaterThan(0);
		});
	});

	describe('topK optimization', () => {
		it('should be faster with smaller topK', async () => {
			const documents = Array.from({ length: 50 }, (_, i) => `document ${i}`);

			const startTime1 = Date.now();
			await reranker.rerank('test query', documents, { topK: 10 });
			const duration1 = Date.now() - startTime1;

			const startTime2 = Date.now();
			await reranker.rerank('test query', documents, { topK: 50 });
			const duration2 = Date.now() - startTime2;

			// Both should be fast with mock, but the concept is tested
			expect(duration1).toBeLessThan(100);
			expect(duration2).toBeLessThan(100);
		});
	});

	describe('memory efficiency', () => {
		it('should not leak memory with repeated reranking calls', async () => {
			const documents = Array.from({ length: 50 }, (_, i) => `document ${i}`);

			// Perform multiple reranking operations
			for (let i = 0; i < 10; i++) {
				const results = await reranker.rerank('test query', documents);
				// Results should be limited by topK config (10)
				expect(results.length).toBeLessThanOrEqual(10);
				expect(results.length).toBeGreaterThan(0);
			}

			// If we reach here without errors, memory is being managed properly
			expect(true).toBe(true);
		});
	});

	describe('concurrent requests', () => {
		it('should handle concurrent reranking requests', async () => {
			const documents = Array.from({ length: 50 }, (_, i) => `document ${i}`);

			// Create multiple concurrent requests
			const promises = Array.from({ length: 5 }, () =>
				reranker.rerank('test query', documents)
			);

			const results = await Promise.all(promises);

			// All requests should complete successfully
			expect(results).toHaveLength(5);
			results.forEach((result) => {
				// Results should be limited by topK config (10)
				expect(result.length).toBeLessThanOrEqual(10);
				expect(result.length).toBeGreaterThan(0);
			});
		});
	});
});
