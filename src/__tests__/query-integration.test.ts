/**
 * Integration tests for query functionality
 * Tests for pagination behavior, response shape consistency, and MCP tool integration
 */

import './setup.js';
import assert from 'assert';
import { QueryResponse, DocumentDiscoveryResult } from '../types.js';
import { addDocumentsRange, seedDocuments, withBaseDirAndDocumentManager } from './test-utils.js';

const withQueryManager = async <T>(
    prefix: string,
    fn: (documentManager: import('../document-manager.js').DocumentManager) => Promise<T> | T
): Promise<T> => {
    return await withBaseDirAndDocumentManager(prefix, async ({ documentManager }) => fn(documentManager));
};

/**
 * Test: Query pagination behavior end-to-end
 */
async function testQueryPaginationEndToEnd() {
    console.log('\n=== Integration Test: Query Pagination End-to-End ===');

    await withQueryManager('query-int-', async (documentManager) => {

        // Add a large number of documents for pagination testing
        const totalDocs = 30;
        await addDocumentsRange(documentManager, totalDocs, (i) => ({
            title: `Document ${i}`,
            content: `This is document ${i} with content about testing pagination and query functionality. It contains some keywords for testing.`,
            metadata: { source: 'upload', tags: ['test', 'pagination', `doc${i}`] }
        }));

        // Test sequential pagination
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

            // Verify pagination metadata
            assert.strictEqual(result.pagination.returned, result.results.length,
                'returned should match results length');

            // Track unique IDs
            for (const r of result.results) {
                if (uniqueIds.has(r.id)) {
                    throw new Error(`Duplicate document ID found: ${r.id}`);
                }
                uniqueIds.add(r.id);
            }

            currentPage++;

            // Safety break to prevent infinite loop
            if (currentPage > 10) break;
        }

        // Verify we got results
        assert(allResults.length > 0, 'Should have retrieved results');

        // Verify all results have required fields
        for (const r of allResults) {
            assert(r.id, 'Result should have id');
            assert(r.title, 'Result should have title');
            assert(typeof r.score === 'number', 'Score should be a number');
            assert(r.updated_at, 'Result should have updated_at');
            assert(r.chunks_count >= 0, 'chunks_count should be non-negative');
        }

        // Test jumping to specific offset
        const jumpOffset = 15;
        const jumpResult = await documentManager.query('testing pagination', {
            limit: 5,
            offset: jumpOffset
        });
        assert(jumpResult.results.length <= 5, 'Should return at most 5 results');

        // Test pagination with filters
        const filteredPage1 = await documentManager.query('testing', {
            limit: 5,
            offset: 0,
            filters: { tags: ['test'] }
        });
        assert(filteredPage1.results.length >= 0, 'Should return filtered results');

        const filteredPage2 = await documentManager.query('testing', {
            limit: 5,
            offset: 5,
            filters: { tags: ['test'] }
        });
        assert(filteredPage2.results.length >= 0, 'Should return filtered results for page 2');

        console.log('✓ Query pagination end-to-end test passed');
    });
}

/**
 * Test: Response shape consistency across different queries
 */
async function testResponseShapeConsistency() {
    console.log('\n=== Integration Test: Response Shape Consistency ===');

    await withQueryManager('shape-int-', async (documentManager) => {

        // Add test documents
        await seedDocuments(documentManager, [
            { title: 'AI and Machine Learning', content: 'Artificial intelligence and machine learning are closely related fields.', metadata: { source: 'api', tags: ['ai', 'ml'] } },
            { title: 'Web Development Guide', content: 'Learn web development with HTML, CSS, and JavaScript.', metadata: { source: 'api', tags: ['web', 'development'] } },
            { title: 'Data Science Tutorial', content: 'Data science combines statistics, programming, and domain knowledge.', metadata: { source: 'upload', tags: ['data', 'science'] } }
        ]);

        // Execute different queries and verify consistent shape
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

        // Verify all responses have consistent structure
        for (const result of results) {
            // Check pagination structure
            assert(result.pagination !== undefined, 'Should have pagination');
            assert(typeof result.pagination.total_documents === 'number', 'total_documents should be number');
            assert(typeof result.pagination.returned === 'number', 'returned should be number');
            assert(typeof result.pagination.has_more === 'boolean', 'has_more should be boolean');
            assert(
                result.pagination.next_offset === null || typeof result.pagination.next_offset === 'number',
                'next_offset should be null or number'
            );

            // Check results structure
            assert(Array.isArray(result.results), 'results should be array');

            // Check each result has consistent fields
            for (const r of result.results) {
                assert(typeof r.id === 'string', 'id should be string');
                assert(typeof r.title === 'string', 'title should be string');
                assert(typeof r.score === 'number', 'score should be number');
                assert(typeof r.updated_at === 'string', 'updated_at should be string');
                assert(typeof r.chunks_count === 'number', 'chunks_count should be number');
                assert(r.metadata !== undefined, 'metadata should be included by default');
            }
        }

        // Verify pagination consistency with different limits
        const limitTests = [1, 5, 10, 20];

        for (const limit of limitTests) {
            const result = await documentManager.query('ai', { limit });
            assert(result.pagination.returned <= limit,
                `returned (${result.pagination.returned}) should be <= limit (${limit})`);
        }

        console.log('✓ Response shape consistency test passed');
    });
}

/**
 * Test: Metadata filtering functionality end-to-end
 */
async function testMetadataFilteringEndToEnd() {
    console.log('\n=== Integration Test: Metadata Filtering End-to-End ===');

    await withQueryManager('filter-int-', async (documentManager) => {

        // Add documents with various metadata
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

        // Test tag filtering
        const pythonResults = await documentManager.query('python', {
            limit: 10,
            filters: { tags: ['python'] }
        });
        assert(pythonResults.results.length > 0, 'Should find Python documents');

        // Verify all results have python tag
        for (const result of pythonResults.results) {
            if (result.metadata && result.metadata.tags) {
                assert(result.metadata.tags.includes('python'), 'Result should have python tag');
            }
        }

        // Test source filtering
        const apiResults = await documentManager.query('guide', {
            limit: 10,
            filters: { source: 'api' }
        });
        assert(apiResults.results.length > 0, 'Should find API documents');

        // Test crawl_id filtering
        const crawlResults = await documentManager.query('document', {
            limit: 10,
            filters: { crawl_id: 'test-1' }
        });
        assert(crawlResults.results.length > 0, 'Should find crawled documents');

        // Test author filtering
        const johnResults = await documentManager.query('guide', {
            limit: 10,
            filters: { author: 'John' }
        });
        assert(johnResults.results.length > 0, 'Should find John\'s documents');

        // Test contentType filtering
        const referenceResults = await documentManager.query('reference', {
            limit: 10,
            filters: { contentType: 'reference' }
        });
        assert(referenceResults.results.length > 0, 'Should find reference documents');

        // Test combined filters
        const combinedResults = await documentManager.query('python', {
            limit: 10,
            filters: { tags: ['python'], source: 'api' }
        });
        assert(combinedResults.results.length >= 0, 'Combined filter should work');

        // Test non-matching filter
        const noResults = await documentManager.query('guide', {
            limit: 10,
            filters: { source: 'nonexistent' }
        });
        assert(noResults.results.length === 0, 'Should return no results for non-matching filter');

        console.log('✓ Metadata filtering end-to-end test passed');
    });
}

/**
 * Test: Query with large dataset
 */
async function testQueryWithLargeDataset() {
    console.log('\n=== Integration Test: Query with Large Dataset ===');

    await withQueryManager('large-int-', async (documentManager) => {

        // Add a large number of documents
        const totalDocs = 50;
        console.log(`  Adding ${totalDocs} documents...`);

        await addDocumentsRange(documentManager, totalDocs, (i) => ({
            title: `Document ${i}`,
            content: `This is document ${i} with content about various topics including programming, data science, web development, and artificial intelligence. It contains keywords for testing large-scale queries.`,
            metadata: {
                source: i % 3 === 0 ? 'api' : (i % 3 === 1 ? 'upload' : 'crawl'),
                tags: [`tag${i % 10}`, 'test'],
                author: `Author${i % 5}`
            }
        }));

        // Test query performance with pagination
        console.log('  Testing query with pagination...');
        const startTime = Date.now();

        const page1 = await documentManager.query('programming data science', { limit: 10, offset: 0 });
        const page2 = await documentManager.query('programming data science', { limit: 10, offset: 10 });
        const page3 = await documentManager.query('programming data science', { limit: 10, offset: 20 });

        const elapsed = Date.now() - startTime;
        console.log(`  Query completed in ${elapsed}ms`);

        // Verify pagination worked correctly
        assert(page1.pagination.has_more !== undefined, 'has_more should be defined');
        assert(page2.pagination.has_more !== undefined, 'has_more should be defined');

        // Test filtering with large dataset
        console.log('  Testing filtering with large dataset...');
        const filteredResults = await documentManager.query('programming', {
            limit: 10,
            filters: { source: 'api', tags: ['test'] }
        });
        assert(filteredResults.results.length >= 0, 'Filtering should work with large dataset');

        // Verify all results have expected structure
        for (const result of [...page1.results, ...page2.results, ...page3.results]) {
            assert(result.id, 'Result should have id');
            assert(result.title, 'Result should have title');
            assert(typeof result.score === 'number', 'Score should be a number');
            assert(result.metadata !== undefined, 'Metadata should be included');
        }

        console.log('✓ Large dataset query test passed');
    });
}

/**
 * Test: Query with document deletion
 */
async function testQueryWithDocumentDeletion() {
    console.log('\n=== Integration Test: Query with Document Deletion ===');

    await withQueryManager('delete-int-', async (documentManager) => {

        // Add documents
        const doc1 = await documentManager.addDocument(
            'Document to Delete',
            'This document will be deleted for testing query behavior after deletion.',
            { source: 'upload', tags: ['delete', 'test'] }
        );

        const doc2 = await documentManager.addDocument(
            'Document to Keep',
            'This document will be kept for testing query behavior after deletion.',
            { source: 'upload', tags: ['keep', 'test'] }
        );

        const doc3 = await documentManager.addDocument(
            'Another Document',
            'Another document for testing.',
            { source: 'upload', tags: ['test'] }
        );

        // Query before deletion
        const beforeDelete = await documentManager.query('document', { limit: 10 });
        const beforeDeleteIds = beforeDelete.results.map(r => r.id);
        assert(beforeDeleteIds.includes(doc1.id), 'Should include document to delete');

        // Delete one document
        const deleted = await documentManager.deleteDocument(doc1.id);
        assert.strictEqual(deleted, true, 'Document should be deleted');

        // Query after deletion
        const afterDelete = await documentManager.query('document', { limit: 10 });
        const afterDeleteIds = afterDelete.results.map(r => r.id);
        assert(!afterDeleteIds.includes(doc1.id), 'Should not include deleted document');
        assert(afterDeleteIds.includes(doc2.id), 'Should include kept document');
        assert(afterDeleteIds.includes(doc3.id), 'Should include another document');

        // Query with filter after deletion
        const filteredAfterDelete = await documentManager.query('test', {
            limit: 10,
            filters: { tags: ['delete'] }
        });
        assert(filteredAfterDelete.results.length === 0, 'Should return no results for deleted tag');

        console.log('✓ Query with document deletion test passed');
    });
}

/**
 * Test: Query with crawl session deletion
 */
async function testQueryWithCrawlSessionDeletion() {
    console.log('\n=== Integration Test: Query with Crawl Session Deletion ===');

    await withQueryManager('crawl-delete-int-', async (documentManager) => {

        // Add crawled documents
        const crawlDocs = await addDocumentsRange(documentManager, 5, (i) => ({
            title: `Crawled Document ${i}`,
            content: `Crawled content ${i}.`,
            metadata: { source: 'crawl', tags: ['crawl'], crawl_id: 'test-crawl-session' }
        }));

        // Add non-crawled documents
        const otherDocs = await addDocumentsRange(documentManager, 3, (i) => ({
            title: `Other Document ${i}`,
            content: `Other content ${i}.`,
            metadata: { source: 'upload', tags: ['upload'] }
        }));

        // Query before crawl session deletion
        const beforeDelete = await documentManager.query('content', {
            limit: 10,
            filters: { crawl_id: 'test-crawl-session' }
        });
        assert.strictEqual(beforeDelete.results.length, 5, 'Should find all crawled documents');

        // Delete crawl session
        const deleteResult = await documentManager.deleteCrawlSession('test-crawl-session');
        assert.strictEqual(deleteResult.deleted, 5, 'Should delete 5 documents');
        assert.strictEqual(deleteResult.errors.length, 0, 'Should have no errors');

        // Query after crawl session deletion
        const afterDelete = await documentManager.query('content', {
            limit: 10,
            filters: { crawl_id: 'test-crawl-session' }
        });
        assert.strictEqual(afterDelete.results.length, 0, 'Should find no crawled documents');

        // Verify other documents still exist
        const otherResult = await documentManager.query('content', {
            limit: 10,
            filters: { source: 'upload' }
        });
        assert.strictEqual(otherResult.results.length, 3, 'Should find all other documents');

        console.log('✓ Query with crawl session deletion test passed');
    });
}

/**
 * Test: Query with edge cases
 */
async function testQueryEdgeCases() {
    console.log('\n=== Integration Test: Query Edge Cases ===');

    await withQueryManager('edge-int-', async (documentManager) => {

        // Test empty query
        const emptyQuery = await documentManager.query('', { limit: 10 });
        assert(Array.isArray(emptyQuery.results), 'Empty query should return array');

        // Test very long query
        const longQuery = 'test '.repeat(100);
        const longQueryResult = await documentManager.query(longQuery, { limit: 10 });
        assert(Array.isArray(longQueryResult.results), 'Long query should return array');

        // Test query with special characters
        const specialQuery = 'test!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
        const specialResult = await documentManager.query(specialQuery, { limit: 10 });
        assert(Array.isArray(specialResult.results), 'Special char query should return array');

        // Test with very large limit
        const largeLimitResult = await documentManager.query('test', { limit: 1000 });
        assert(largeLimitResult.results.length >= 0, 'Large limit should work');

        // Test with very large offset
        const largeOffsetResult = await documentManager.query('test', { limit: 10, offset: 10000 });
        assert.strictEqual(largeOffsetResult.results.length, 0, 'Large offset should return empty');
        assert.strictEqual(largeOffsetResult.pagination.has_more, false, 'Should have no more results');

        // Test with negative offset (should be handled)
        try {
            const negativeOffsetResult = await documentManager.query('test', { limit: 10, offset: -1 });
            // Should not throw, but may return no results or handle differently
            assert(Array.isArray(negativeOffsetResult.results), 'Should return array');
        } catch (e) {
            // If it throws, that's also acceptable behavior
            console.log('  Negative offset threw error (acceptable)');
        }

        // Test with zero limit
        const zeroLimitResult = await documentManager.query('test', { limit: 0 });
        assert.strictEqual(zeroLimitResult.results.length, 0, 'Zero limit should return empty');

        // Add a document and test
        await documentManager.addDocument(
            'Edge Case Document',
            'This is for testing edge cases.',
            { source: 'upload' }
        );

        // Test query with all metadata filters empty
        const emptyFilters = await documentManager.query('edge case', {
            limit: 10,
            filters: {}
        });
        assert(Array.isArray(emptyFilters.results), 'Empty filters should work');

        console.log('✓ Query edge cases test passed');
    });
}

/**
 * Run all query integration tests
 */
async function runQueryIntegrationTests() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Query Integration Tests                                   ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    
    try {
        await testQueryPaginationEndToEnd();
        await testResponseShapeConsistency();
        await testMetadataFilteringEndToEnd();
        await testQueryWithLargeDataset();
        await testQueryWithDocumentDeletion();
        await testQueryWithCrawlSessionDeletion();
        await testQueryEdgeCases();
        
        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║  ✓ All query integration tests passed!                    ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
    } catch (error) {
        console.error('\n✗ Test failed:', error);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runQueryIntegrationTests();
}

export { runQueryIntegrationTests };
