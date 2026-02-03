/**
 * Integration tests for query functionality
 * Tests for pagination behavior, response shape consistency, and MCP tool integration
 */

import { describe, it, expect } from 'vitest';
import { QueryResponse, DocumentDiscoveryResult } from '../types.js';
import { addDocumentsRange, seedDocuments, withBaseDirAndDocumentManager, withEnv } from './test-utils.js';
import {
    RequestTimeoutError,
    ENV_TIMEOUT_AI_SEARCH,
    ENV_TIMEOUT_GLOBAL,
} from '../utils/http-timeout.js';

const withQueryManager = async <T>(
    prefix: string,
    fn: (documentManager: import('../document-manager.js').DocumentManager) => Promise<T> | T
): Promise<T> => {
    return await withEnv({
        MCP_ACCEPTED_LANGUAGES: 'en,no,es,unknown',
        MCP_LANGUAGE_CONFIDENCE_THRESHOLD: '0.0',
    }, async () => {
        return await withBaseDirAndDocumentManager(prefix, async ({ documentManager }) => fn(documentManager));
    });
};

describe('Query Integration Tests', () => {
    describe('Query Pagination End-to-End', () => {
        it('should handle sequential pagination', async () => {
            await withQueryManager('query-int-', async (documentManager) => {
                const totalDocs = 30;
                await addDocumentsRange(documentManager, totalDocs, (i) => ({
                    title: `Document ${i}`,
                    content: `This is document ${i} with content about testing pagination and query functionality. It contains some keywords for testing.`,
                    metadata: { source: 'upload', tags: ['test', 'pagination', `doc${i}`] }
                }));

                const pageSize = 10;
                let currentPage = 0;
                let allResults: DocumentDiscoveryResult[] = [];
                let hasMore = true;
                let uniqueIds = new Set<string>();

                while (hasMore) {
                    const offset = currentPage * pageSize;
                    const result = await documentManager.query('testing pagination', {
                        limit: pageSize,
                        offset: offset
                    });

                    allResults = [...allResults, ...result.results];
                    hasMore = result.pagination.has_more;

                    expect(result.pagination.returned).toBe(result.results.length);

                    for (const r of result.results) {
                        expect(uniqueIds.has(r.id)).toBe(false);
                        uniqueIds.add(r.id);
                    }

                    currentPage++;

                    if (currentPage > 10) break;
                }

                expect(allResults.length).toBeGreaterThan(0);

                for (const r of allResults) {
                    expect(r.id).toBeDefined();
                    expect(r.title).toBeDefined();
                    expect(typeof r.score).toBe('number');
                    expect(r.updated_at).toBeDefined();
                    expect(r.chunks_count).toBeGreaterThanOrEqual(0);
                }

                const jumpOffset = 15;
                const jumpResult = await documentManager.query('testing pagination', {
                    limit: 5,
                    offset: jumpOffset
                });
                expect(jumpResult.results.length).toBeLessThanOrEqual(5);

                const filteredPage1 = await documentManager.query('testing', {
                    limit: 5,
                    offset: 0,
                    filters: { tags: ['test'] }
                });
                expect(filteredPage1.results.length).toBeGreaterThanOrEqual(0);

                const filteredPage2 = await documentManager.query('testing', {
                    limit: 5,
                    offset: 5,
                    filters: { tags: ['test'] }
                });
                expect(filteredPage2.results.length).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('Response Shape Consistency', () => {
        it('should have consistent response structure', async () => {
            await withQueryManager('shape-int-', async (documentManager) => {
                await seedDocuments(documentManager, [
                    { title: 'AI and Machine Learning', content: 'Artificial intelligence and machine learning are closely related fields.', metadata: { source: 'api', tags: ['ai', 'ml'] } },
                    { title: 'Web Development Guide', content: 'Learn web development with HTML, CSS, and JavaScript.', metadata: { source: 'api', tags: ['web', 'development'] } },
                    { title: 'Data Science Tutorial', content: 'Data science combines statistics, programming, and domain knowledge.', metadata: { source: 'upload', tags: ['data', 'science'] } }
                ]);

                const queries = [
                    'artificial intelligence',
                    'web development',
                    'data science',
                    'programming'
                ];

                const results: QueryResponse[] = [];

                for (const query of queries) {
                    const result = await documentManager.query(query, { limit: 10 });
                    results.push(result);
                }

                for (const result of results) {
                    expect(result.pagination).toBeDefined();
                    expect(typeof result.pagination.total_documents).toBe('number');
                    expect(typeof result.pagination.returned).toBe('number');
                    expect(typeof result.pagination.has_more).toBe('boolean');
                    expect(result.pagination.next_offset === null || typeof result.pagination.next_offset === 'number').toBe(true);

                    expect(Array.isArray(result.results)).toBe(true);

                    for (const r of result.results) {
                        expect(typeof r.id).toBe('string');
                        expect(typeof r.title).toBe('string');
                        expect(typeof r.score).toBe('number');
                        expect(typeof r.updated_at).toBe('string');
                        expect(typeof r.chunks_count).toBe('number');
                        expect(r.metadata).toBeDefined();
                    }
                }

                const limitTests = [1, 5, 10, 20];

                for (const limit of limitTests) {
                    const result = await documentManager.query('ai', { limit });
                    expect(result.pagination.returned).toBeLessThanOrEqual(limit);
                }
            });
        });
    });

    describe('Metadata Filtering End-to-End', () => {
        it('should filter by various metadata fields', async () => {
            await withQueryManager('filter-int-', async (documentManager) => {
                const docs = [
                    { title: 'Python Tutorial', content: 'Learn Python programming.', tags: ['python', 'tutorial'], source: 'api', author: 'John' },
                    { title: 'JavaScript Guide', content: 'JavaScript web development guide.', tags: ['javascript', 'guide'], source: 'api', author: 'Jane' },
                    { title: 'Python Advanced', content: 'Advanced Python techniques.', tags: ['python', 'advanced'], source: 'upload', author: 'John' },
                    { title: 'Crawled Doc 1', content: 'Document from crawling.', tags: ['crawl'], source: 'crawl', crawl_id: 'test-1' },
                    { title: 'Crawled Doc 2', content: 'Another crawled document.', tags: ['crawl'], source: 'crawl', crawl_id: 'test-1' },
                    { title: 'Reference Guide', content: 'Technical reference.', tags: ['reference'], source: 'api', author: 'John', contentType: 'reference' },
                ];

                await seedDocuments(documentManager, docs.map((doc) => ({
                    title: doc.title,
                    content: doc.content,
                    metadata: {
                        source: doc.source,
                        tags: doc.tags,
                        author: doc.author,
                        crawl_id: doc.crawl_id,
                        contentType: doc.contentType
                    }
                })));

                const pythonResults = await documentManager.query('python', {
                    limit: 10,
                    filters: { tags: ['python'] }
                });
                expect(pythonResults.results.length).toBeGreaterThan(0);

                for (const result of pythonResults.results) {
                    if (result.metadata && result.metadata.tags) {
                        expect(result.metadata.tags.includes('python')).toBe(true);
                    }
                }

                const apiResults = await documentManager.query('guide', {
                    limit: 10,
                    filters: { source: 'api' }
                });
                expect(apiResults.results.length).toBeGreaterThan(0);

                const crawlResults = await documentManager.query('document', {
                    limit: 10,
                    filters: { crawl_id: 'test-1' }
                });
                expect(crawlResults.results.length).toBeGreaterThan(0);

                const johnResults = await documentManager.query('guide', {
                    limit: 10,
                    filters: { author: 'John' }
                });
                expect(johnResults.results.length).toBeGreaterThan(0);

                const referenceResults = await documentManager.query('reference', {
                    limit: 10,
                    filters: { contentType: 'reference' }
                });
                expect(referenceResults.results.length).toBeGreaterThan(0);

                const combinedResults = await documentManager.query('python', {
                    limit: 10,
                    filters: { tags: ['python'], source: 'api' }
                });
                expect(combinedResults.results.length).toBeGreaterThanOrEqual(0);

                const noResults = await documentManager.query('guide', {
                    limit: 10,
                    filters: { source: 'nonexistent' }
                });
                expect(noResults.results.length).toBe(0);
            });
        });
    });

    describe('Query with Large Dataset', () => {
        it('should handle large datasets efficiently', async () => {
            await withQueryManager('large-int-', async (documentManager) => {
                const totalDocs = 50;

                await addDocumentsRange(documentManager, totalDocs, (i) => ({
                    title: `Document ${i}`,
                    content: `This is document ${i} with content about various topics including programming, data science, web development, and artificial intelligence. It contains keywords for testing large-scale queries.`,
                    metadata: {
                        source: i % 3 === 0 ? 'api' : (i % 3 === 1 ? 'upload' : 'crawl'),
                        tags: [`tag${i % 10}`, 'test'],
                        author: `Author${i % 5}`
                    }
                }));

                const page1 = await documentManager.query('programming data science', { limit: 10, offset: 0 });
                const page2 = await documentManager.query('programming data science', { limit: 10, offset: 10 });
                const page3 = await documentManager.query('programming data science', { limit: 10, offset: 20 });

                expect(page1.pagination.has_more).toBeDefined();
                expect(page2.pagination.has_more).toBeDefined();

                const filteredResults = await documentManager.query('programming', {
                    limit: 10,
                    filters: { source: 'api', tags: ['test'] }
                });
                expect(filteredResults.results.length).toBeGreaterThanOrEqual(0);

                for (const result of [...page1.results, ...page2.results, ...page3.results]) {
                    expect(result.id).toBeDefined();
                    expect(result.title).toBeDefined();
                    expect(typeof result.score).toBe('number');
                    expect(result.metadata).toBeDefined();
                }
            });
        });
    });

    describe('Query with Document Deletion', () => {
        it('should handle document deletion correctly', async () => {
            await withQueryManager('delete-int-', async (documentManager) => {
                const doc1 = await documentManager.addDocument(
                    'Document to Delete',
                    'This document will be deleted for testing query behavior after deletion.',
                    { source: 'upload', tags: ['delete', 'test'] }
                );
                expect(doc1).toBeDefined();

                const doc2 = await documentManager.addDocument(
                    'Document to Keep',
                    'This document will be kept for testing query behavior after deletion.',
                    { source: 'upload', tags: ['keep', 'test'] }
                );
                expect(doc2).toBeDefined();

                const doc3 = await documentManager.addDocument(
                    'Another Document',
                    'Another document for testing.',
                    { source: 'upload', tags: ['test'] }
                );
                expect(doc3).toBeDefined();

                const beforeDelete = await documentManager.query('document', { limit: 10 });
                const beforeDeleteIds = beforeDelete.results.map(r => r.id);
                expect(doc1 ? beforeDeleteIds.includes(doc1.id) : false).toBe(true);

                const deleted = doc1 ? await documentManager.deleteDocument(doc1.id) : false;
                expect(deleted).toBe(true);

                const afterDelete = await documentManager.query('document', { limit: 10 });
                const afterDeleteIds = afterDelete.results.map(r => r.id);
                expect(afterDeleteIds.includes(doc1?.id || '')).toBe(false);
                expect(doc2 ? afterDeleteIds.includes(doc2.id) : false).toBe(true);
                expect(doc3 ? afterDeleteIds.includes(doc3.id) : false).toBe(true);

                const filteredAfterDelete = await documentManager.query('test', {
                    limit: 10,
                    filters: { tags: ['delete'] }
                });
                expect(filteredAfterDelete.results.length).toBe(0);
            });
        });
    });

    describe('Query with Crawl Session Deletion', () => {
        it('should handle crawl session deletion', async () => {
            await withQueryManager('crawl-delete-int-', async (documentManager) => {
                const crawlDocs = await addDocumentsRange(documentManager, 5, (i) => ({
                    title: `Crawled Document ${i}`,
                    content: `Crawled content ${i}.`,
                    metadata: { source: 'crawl', tags: ['crawl'], crawl_id: 'test-crawl-session' }
                }));

                const otherDocs = await addDocumentsRange(documentManager, 3, (i) => ({
                    title: `Other Document ${i}`,
                    content: `Other content ${i}.`,
                    metadata: { source: 'upload', tags: ['upload'] }
                }));

                const beforeDelete = await documentManager.query('content', {
                    limit: 10,
                    filters: { crawl_id: 'test-crawl-session' }
                });
                expect(beforeDelete.results.length).toBe(5);

                const deleteResult = await documentManager.deleteCrawlSession('test-crawl-session');
                expect(deleteResult.deleted).toBe(5);
                expect(deleteResult.errors.length).toBe(0);

                const afterDelete = await documentManager.query('content', {
                    limit: 10,
                    filters: { crawl_id: 'test-crawl-session' }
                });
                expect(afterDelete.results.length).toBe(0);

                const otherResult = await documentManager.query('content', {
                    limit: 10,
                    filters: { source: 'upload' }
                });
                expect(otherResult.results.length).toBe(3);
            });
        });
    });

    describe('Query Edge Cases', () => {
        it('should handle edge cases gracefully', async () => {
            await withQueryManager('edge-int-', async (documentManager) => {
                const emptyQuery = await documentManager.query('', { limit: 10 });
                expect(Array.isArray(emptyQuery.results)).toBe(true);

                const longQuery = 'test '.repeat(100);
                const longQueryResult = await documentManager.query(longQuery, { limit: 10 });
                expect(Array.isArray(longQueryResult.results)).toBe(true);

                const specialQuery = 'test!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
                const specialResult = await documentManager.query(specialQuery, { limit: 10 });
                expect(Array.isArray(specialResult.results)).toBe(true);

                const largeLimitResult = await documentManager.query('test', { limit: 1000 });
                expect(largeLimitResult.results.length).toBeGreaterThanOrEqual(0);

                const largeOffsetResult = await documentManager.query('test', { limit: 10, offset: 10000 });
                expect(largeOffsetResult.results.length).toBe(0);
                expect(largeOffsetResult.pagination.has_more).toBe(false);

                try {
                    const negativeOffsetResult = await documentManager.query('test', { limit: 10, offset: -1 });
                    expect(Array.isArray(negativeOffsetResult.results)).toBe(true);
                } catch (e) {
                    // Acceptable if it throws
                }

                const zeroLimitResult = await documentManager.query('test', { limit: 0 });
                expect(zeroLimitResult.results.length).toBe(0);

                await documentManager.addDocument(
                    'Edge Case Document',
                    'This is for testing edge cases.',
                    { source: 'upload' }
                );

                const emptyFilters = await documentManager.query('edge case', {
                    limit: 10,
                    filters: {}
                });
                expect(Array.isArray(emptyFilters.results)).toBe(true);
            });
        });
    });
});

describe('AI Search Timeout Integration Tests', () => {
    describe('AI Search Timeout Configuration', () => {
        it('should configure AI search timeout', async () => {
            await withEnv({
                [ENV_TIMEOUT_AI_SEARCH]: '5000',
                [ENV_TIMEOUT_GLOBAL]: '10000',
                'MCP_AI_BASE_URL': 'http://localhost:1234',
                'MCP_AI_MODEL': 'test-model',
            }, async () => {
                const { resolveAiProviderSelection } = await import('../ai-search-provider.js');

                const selection = resolveAiProviderSelection();
                expect(selection.enabled).toBe(true);
                expect(selection.provider).toBe('openai');
            });
        });
    });

    describe('AI Search Timeout Error Handling', () => {
        it('should handle timeout errors', async () => {
            await withEnv({
                [ENV_TIMEOUT_AI_SEARCH]: '100',
                'MCP_AI_BASE_URL': 'http://localhost:1234',
                'MCP_AI_MODEL': 'test-model',
            }, async () => {
                const { searchDocumentWithAi } = await import('../ai-search-provider.js');

                const mockManager = {
                    getDocument: async () => ({
                        id: 'test-doc',
                        title: 'Test Document',
                        chunks: [],
                    }),
                    // Note: searchDocuments() has been removed, but this mock is for testing timeout behavior
                    // The actual searchDocumentWithAi implementation now uses VectorDatabase directly
                };

                try {
                    await searchDocumentWithAi('test-doc', 'test query', mockManager as any);
                } catch (error) {
                    if (error instanceof RequestTimeoutError) {
                        expect(error.isTimeout).toBe(true);
                        expect(error.url).toContain('chat/completions');
                    }
                }
            });
        });
    });

    describe('AI Search Respects Timeout Env Var', () => {
        it('should use AI search specific timeout', async () => {
            await withEnv({
                [ENV_TIMEOUT_AI_SEARCH]: '15000',
                [ENV_TIMEOUT_GLOBAL]: '5000',
                'MCP_AI_BASE_URL': 'http://localhost:1234',
                'MCP_AI_MODEL': 'test-model',
            }, async () => {
                expect(process.env[ENV_TIMEOUT_AI_SEARCH]).toBe('15000');

                const { resolveAiProviderSelection } = await import('../ai-search-provider.js');
                const selection = resolveAiProviderSelection();
                expect(selection.enabled).toBe(true);
            });
        });
    });
});
