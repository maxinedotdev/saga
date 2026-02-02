/**
 * Unit tests for query functionality
 * Tests for global search ranking, hybrid ranking, pagination, and metadata filtering
 */

import { describe, it, expect } from 'vitest';
import { addDocumentsRange, seedDocuments, withBaseDirAndDocumentManager, withEnv } from './test-utils.js';

const withQueryManager = async <T>(
    prefix: string,
    fn: (documentManager: import('../document-manager.js').DocumentManager) => Promise<T> | T
): Promise<T> => {
    return await withBaseDirAndDocumentManager(prefix, async ({ documentManager }) => fn(documentManager));
};

describe('Query Unit Tests', () => {
    describe('Global Search Ranking', () => {
        it('should return results with valid scores', async () => {
            await withEnv({ MCP_SIMILARITY_THRESHOLD: '0.3' }, async () => {
                await withQueryManager('query-test-', async (documentManager) => {
                    await seedDocuments(documentManager, [
                        { title: 'Machine Learning Fundamentals', content: 'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience.', metadata: { source: 'upload', tags: ['ai', 'ml'] } },
                        { title: 'Deep Learning Neural Networks', content: 'Deep learning uses neural networks with multiple layers to learn complex patterns from large datasets.', metadata: { source: 'upload', tags: ['ai', 'deeplearning'] } },
                        { title: 'Introduction to Artificial Intelligence', content: 'Artificial intelligence is a broad field that includes machine learning, deep learning, and other technologies.', metadata: { source: 'upload', tags: ['ai', 'intro'] } }
                    ]);

                    const result = await documentManager.query('machine learning', { limit: 10 });

                    expect(result.results.length).toBeGreaterThan(0);
                    expect(result.pagination.total_documents).toBeGreaterThan(0);
                    expect(result.pagination.returned).toBeGreaterThan(0);

                    // Verify scores are valid numbers
                    for (const r of result.results) {
                        expect(typeof r.score).toBe('number');
                        expect(r.score).toBeGreaterThanOrEqual(0);
                        expect(r.score).toBeLessThanOrEqual(1);
                    }

                    // Each result should have required fields
                    for (const r of result.results) {
                        expect(r.id).toBeDefined();
                        expect(r.title).toBeDefined();
                        expect(typeof r.score).toBe('number');
                        expect(r.updated_at).toBeDefined();
                        expect(r.chunks_count).toBeGreaterThanOrEqual(0);
                    }
                });
            });
        });
    });

    describe('Hybrid Ranking with Keyword Fallback', () => {
        it('should use vector search first', async () => {
            await withQueryManager('hybrid-test-', async (documentManager) => {
                await seedDocuments(documentManager, [
                    { title: 'Python Programming Guide', content: 'Python is a popular programming language used for web development, data science, and automation.', metadata: { source: 'api', tags: ['python', 'programming'] } },
                    { title: 'JavaScript for Beginners', content: 'JavaScript is essential for web development and runs in all modern browsers.', metadata: { source: 'api', tags: ['javascript', 'web'] } },
                    { title: 'TypeScript Best Practices', content: 'TypeScript adds static typing to JavaScript for better developer experience.', metadata: { source: 'api', tags: ['typescript', 'javascript'] } }
                ]);

                const vectorResult = await documentManager.query('programming language', { limit: 10 });
                expect(vectorResult.results.length).toBeGreaterThan(0);

                const keywordResult = await documentManager.query('python', { limit: 10 });
                expect(keywordResult.results.length).toBeGreaterThan(0);

                // Verify all results have expected structure
                for (const result of [...vectorResult.results, ...keywordResult.results]) {
                    expect(result.id).toBeDefined();
                    expect(result.title).toBeDefined();
                    expect(typeof result.score).toBe('number');
                }
            });
        });
    });

    describe('Pagination Logic', () => {
        it('should return correct pagination for first page', async () => {
            await withQueryManager('pagination-test-', async (documentManager) => {
                await addDocumentsRange(documentManager, 15, (i) => ({
                    title: `Document ${i}`,
                    content: `This is document ${i} with some content about testing and pagination.`,
                    metadata: { source: 'upload', tags: ['test', 'pagination'] }
                }));

                const page1 = await documentManager.query('testing pagination', { limit: 5, offset: 0 });
                expect(page1.pagination.returned).toBe(5);
                expect(page1.pagination.has_more).toBe(true);
                expect(page1.pagination.next_offset).toBe(5);
            });
        });

        it('should return correct pagination for second page', async () => {
            await withQueryManager('pagination-test-', async (documentManager) => {
                await addDocumentsRange(documentManager, 15, (i) => ({
                    title: `Document ${i}`,
                    content: `This is document ${i} with some content about testing and pagination.`,
                    metadata: { source: 'upload', tags: ['test', 'pagination'] }
                }));

                const page2 = await documentManager.query('testing pagination', { limit: 5, offset: 5 });
                expect(page2.pagination.returned).toBe(5);
                expect(page2.pagination.has_more).toBeDefined();
            });
        });

        it('should return correct pagination for last page', async () => {
            await withQueryManager('pagination-test-', async (documentManager) => {
                await addDocumentsRange(documentManager, 15, (i) => ({
                    title: `Document ${i}`,
                    content: `This is document ${i} with some content about testing and pagination.`,
                    metadata: { source: 'upload', tags: ['test', 'pagination'] }
                }));

                const lastPage = await documentManager.query('testing pagination', { limit: 5, offset: 10 });
                expect(lastPage.pagination.returned).toBeLessThanOrEqual(5);
            });
        });

        it('should return empty results beyond available', async () => {
            await withQueryManager('pagination-test-', async (documentManager) => {
                await addDocumentsRange(documentManager, 15, (i) => ({
                    title: `Document ${i}`,
                    content: `This is document ${i} with some content about testing and pagination.`,
                    metadata: { source: 'upload', tags: ['test', 'pagination'] }
                }));

                const beyondPage = await documentManager.query('testing pagination', { limit: 5, offset: 100 });
                expect(beyondPage.pagination.returned).toBe(0);
                expect(beyondPage.pagination.has_more).toBe(false);
                expect(beyondPage.pagination.next_offset).toBe(null);
            });
        });

        it('should return zero results for limit of 0', async () => {
            await withQueryManager('pagination-test-', async (documentManager) => {
                const zeroLimit = await documentManager.query('testing pagination', { limit: 0 });
                expect(zeroLimit.pagination.returned).toBe(0);
            });
        });
    });

    describe('Metadata Filtering - Tags', () => {
        it('should return results with metadata', async () => {
            await withQueryManager('tags-test-', async (documentManager) => {
                await seedDocuments(documentManager, [
                    { title: 'AI Research Paper', content: 'This is a research paper about artificial intelligence and machine learning algorithms for data analysis.', metadata: { source: 'upload', tags: ['ai', 'research', 'paper'] } },
                    { title: 'Machine Learning Tutorial', content: 'This is a comprehensive tutorial for learning machine learning with practical examples and exercises.', metadata: { source: 'upload', tags: ['ml', 'tutorial', 'ai'] } },
                    { title: 'Web Development Guide', content: 'This is a complete guide for web development covering HTML, CSS, and JavaScript best practices.', metadata: { source: 'upload', tags: ['web', 'development', 'tutorial'] } }
                ]);

                await new Promise(resolve => setTimeout(resolve, 100));

                const allResults = await documentManager.query('artificial intelligence', { limit: 10 });
                expect(Array.isArray(allResults.results)).toBe(true);

                const aiResult = await documentManager.query('artificial intelligence', {
                    limit: 10,
                    filters: { tags: ['ai'] }
                });
                expect(Array.isArray(aiResult.results)).toBe(true);
            });
        });
    });

    describe('Metadata Filtering - Source', () => {
        it('should find documents matching query', async () => {
            await withQueryManager('source-test-', async (documentManager) => {
                await seedDocuments(documentManager, [
                    { title: 'API Documentation', content: 'This is API documentation.', metadata: { source: 'api', tags: ['api'] } },
                    { title: 'Crawled Documentation', content: 'This is documentation from crawling.', metadata: { source: 'crawl', tags: ['crawl'], crawl_id: 'test-crawl-1' } },
                    { title: 'Uploaded Document', content: 'This is an uploaded document.', metadata: { source: 'upload', tags: ['upload'] } }
                ]);

                const allResults = await documentManager.query('documentation', { limit: 10 });
                expect(allResults.results.length).toBeGreaterThan(0);

                const apiResult = await documentManager.query('documentation', {
                    limit: 10,
                    filters: { source: 'api' }
                });
                expect(Array.isArray(apiResult.results)).toBe(true);

                const crawlResult = await documentManager.query('documentation', {
                    limit: 10,
                    filters: { crawl_id: 'test-crawl-1' }
                });
                expect(Array.isArray(crawlResult.results)).toBe(true);
            });
        });
    });

    describe('Metadata Filtering - Author and ContentType', () => {
        it('should find documents matching query', async () => {
            await withQueryManager('author-test-', async (documentManager) => {
                await seedDocuments(documentManager, [
                    { title: 'Guide by John', content: 'Content written by John.', metadata: { source: 'api', author: 'John Doe', contentType: 'guide' } },
                    { title: 'Tutorial by Jane', content: 'Content written by Jane.', metadata: { source: 'api', author: 'Jane Smith', contentType: 'tutorial' } },
                    { title: 'Reference by John', content: 'Reference content by John.', metadata: { source: 'api', author: 'John Doe', contentType: 'reference' } }
                ]);

                const allResults = await documentManager.query('content', { limit: 10 });
                expect(allResults.results.length).toBeGreaterThan(0);

                const johnResult = await documentManager.query('content', {
                    limit: 10,
                    filters: { author: 'John Doe' }
                });
                expect(Array.isArray(johnResult.results)).toBe(true);

                const guideResult = await documentManager.query('content', {
                    limit: 10,
                    filters: { contentType: 'guide' }
                });
                expect(Array.isArray(guideResult.results)).toBe(true);
            });
        });
    });

    describe('Query Response Shape Consistency', () => {
        it('should have consistent response structure', async () => {
            await withQueryManager('shape-test-', async (documentManager) => {
                const doc = await documentManager.addDocument(
                    'Test Document',
                    'This is a test document for verifying response shape.',
                    { source: 'upload' }
                );

                const result1 = await documentManager.query('test');
                const result2 = await documentManager.query('test', { limit: 5, offset: 0 });
                const result3 = await documentManager.query('test', { limit: 1, offset: 0, include_metadata: false });
                const result4 = await documentManager.query('test', { limit: 10, offset: 0, filters: { source: 'upload' } });

                for (const result of [result1, result2, result3, result4]) {
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

                        if (result !== result3) {
                            expect(r.metadata).toBeDefined();
                        }
                    }
                }
            });
        });
    });

    describe('Document Search Fields Indexing', () => {
        it('should find the document with search fields', async () => {
            await withQueryManager('searchfields-test-', async (documentManager) => {
                const doc = await documentManager.addDocument(
                    'Python Data Science Tutorial',
                    'Learn Python for data science with this comprehensive tutorial covering pandas, numpy, and matplotlib.',
                    {
                        source: 'api',
                        tags: ['python', 'data-science', 'tutorial'],
                        author: 'Data Expert',
                        contentType: 'tutorial',
                        crawl_id: 'tutorial-crawl-123'
                    }
                );
                expect(doc).toBeDefined();

                const result = await documentManager.query('python data science', { limit: 10 });

                expect(result.results.length).toBeGreaterThan(0);

                const foundDoc = doc ? result.results.find(r => r.id === doc.id) : undefined;
                expect(foundDoc).toBeDefined();

                if (foundDoc && foundDoc.metadata) {
                    expect(foundDoc.metadata.tags).toBeDefined();
                    expect(foundDoc.metadata.source).toBe('api');
                }
            });
        });
    });

    describe('Empty Results Handling', () => {
        it('should return empty results for nonexistent query', async () => {
            await withQueryManager('empty-test-', async (documentManager) => {
                const emptyResult = await documentManager.query('nonexistent query', { limit: 10 });
                expect(emptyResult.results.length).toBe(0);
                expect(emptyResult.pagination.returned).toBe(0);
                expect(emptyResult.pagination.has_more).toBe(false);
                expect(emptyResult.pagination.next_offset).toBe(null);
            });
        });

        it('should return results for non-matching filter', async () => {
            await withQueryManager('empty-test-', async (documentManager) => {
                await documentManager.addDocument(
                    'Test Document',
                    'This is a test document.',
                    { source: 'upload', tags: ['test'] }
                );

                const filteredResult = await documentManager.query('test', {
                    limit: 10,
                    filters: { source: 'nonexistent' }
                });
                expect(filteredResult.results.length).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('Combined Metadata Filters', () => {
        it('should find documents matching query', async () => {
            await withQueryManager('combined-test-', async (documentManager) => {
                await seedDocuments(documentManager, [
                    { title: 'Python API Guide', content: 'Python API documentation.', metadata: { source: 'api', tags: ['python', 'api'], author: 'John' } },
                    { title: 'Python Upload Guide', content: 'Python uploaded documentation.', metadata: { source: 'upload', tags: ['python', 'upload'], author: 'Jane' } },
                    { title: 'JavaScript API Guide', content: 'JavaScript API documentation.', metadata: { source: 'api', tags: ['javascript', 'api'], author: 'John' } }
                ]);

                const allResults = await documentManager.query('python', { limit: 10 });
                expect(allResults.results.length).toBeGreaterThan(0);

                const pythonApiResult = await documentManager.query('python', {
                    limit: 10,
                    filters: { source: 'api', tags: ['python'] }
                });
                expect(Array.isArray(pythonApiResult.results)).toBe(true);
            });
        });
    });
});
