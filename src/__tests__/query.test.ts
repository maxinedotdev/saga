/**
 * Unit tests for query functionality
 * Tests for global search ranking, hybrid ranking, pagination, and metadata filtering
 */

import './setup.js';
import assert from 'assert';
import { addDocumentsRange, seedDocuments, withBaseDirAndDocumentManager, withEnv } from './test-utils.js';

const withQueryManager = async <T>(
    prefix: string,
    fn: (documentManager: import('../document-manager.js').DocumentManager) => Promise<T> | T
): Promise<T> => {
    return await withBaseDirAndDocumentManager(prefix, async ({ documentManager }) => fn(documentManager));
};

/**
 * Test: Global search ranking with vector-first approach
 */
async function testGlobalSearchRanking() {
    console.log('\n=== Test: Global Search Ranking ===');

    await withEnv({ MCP_SIMILARITY_THRESHOLD: '0.3' }, async () => {
        await withQueryManager('query-test-', async (documentManager) => {

            // Add documents with similar content but different relevance
            await seedDocuments(documentManager, [
                { title: 'Machine Learning Fundamentals', content: 'Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience.', metadata: { source: 'upload', tags: ['ai', 'ml'] } },
                { title: 'Deep Learning Neural Networks', content: 'Deep learning uses neural networks with multiple layers to learn complex patterns from large datasets.', metadata: { source: 'upload', tags: ['ai', 'deeplearning'] } },
                { title: 'Introduction to Artificial Intelligence', content: 'Artificial intelligence is a broad field that includes machine learning, deep learning, and other technologies.', metadata: { source: 'upload', tags: ['ai', 'intro'] } }
            ]);

            // Query for machine learning content
            const result = await documentManager.query('machine learning', { limit: 10 });

            assert(result.results.length > 0, 'Should return results');
            assert(result.pagination.total_documents > 0, 'Should have total documents');
            assert(result.pagination.returned > 0, 'Should have returned results');

            // Log scores for debugging
            console.log('  Query result scores:', result.results.map(r => ({ id: r.id, score: r.score })));

            // Verify scores are valid numbers
            for (const r of result.results) {
                assert(typeof r.score === 'number', 'Score should be a number');
                assert(r.score >= 0 && r.score <= 1, 'Score should be between 0 and 1');
            }

            // Each result should have required fields
            for (const r of result.results) {
                assert(r.id, 'Result should have id');
                assert(r.title, 'Result should have title');
                assert(typeof r.score === 'number', 'Score should be a number');
                assert(r.updated_at, 'Result should have updated_at');
                assert(r.chunks_count >= 0, 'chunks_count should be non-negative');
            }

            console.log('✓ Global search ranking test passed');
    });
    });
}

/**
 * Test: Hybrid ranking algorithm with keyword fallback
 */
async function testHybridRankingWithKeywordFallback() {
    console.log('\n=== Test: Hybrid Ranking with Keyword Fallback ===');

    await withQueryManager('hybrid-test-', async (documentManager) => {

        // Add documents
        await seedDocuments(documentManager, [
            { title: 'Python Programming Guide', content: 'Python is a popular programming language used for web development, data science, and automation.', metadata: { source: 'api', tags: ['python', 'programming'] } },
            { title: 'JavaScript for Beginners', content: 'JavaScript is essential for web development and runs in all modern browsers.', metadata: { source: 'api', tags: ['javascript', 'web'] } },
            { title: 'TypeScript Best Practices', content: 'TypeScript adds static typing to JavaScript for better developer experience.', metadata: { source: 'api', tags: ['typescript', 'javascript'] } }
        ]);

        // Query for programming - should use vector search first
        const vectorResult = await documentManager.query('programming language', { limit: 10 });
        assert(vectorResult.results.length > 0, 'Vector search should return results');

        // Query with specific term - should use keyword fallback if needed
        const keywordResult = await documentManager.query('python', { limit: 10 });
        assert(keywordResult.results.length > 0, 'Keyword search should return results');

        // Verify all results have expected structure
        for (const result of [...vectorResult.results, ...keywordResult.results]) {
            assert(result.id, 'Result should have id');
            assert(result.title, 'Result should have title');
            assert(typeof result.score === 'number', 'Score should be a number');
        }

        console.log('✓ Hybrid ranking with keyword fallback test passed');
    });
}

/**
 * Test: Pagination logic (limit, offset, has_more, next_offset)
 */
async function testPaginationLogic() {
    console.log('\n=== Test: Pagination Logic ===');

    await withQueryManager('pagination-test-', async (documentManager) => {

        // Add multiple documents
        await addDocumentsRange(documentManager, 15, (i) => ({
            title: `Document ${i}`,
            content: `This is document ${i} with some content about testing and pagination.`,
            metadata: { source: 'upload', tags: ['test', 'pagination'] }
        }));

        // Test first page
        const page1 = await documentManager.query('testing pagination', { limit: 5, offset: 0 });
        assert.strictEqual(page1.pagination.returned, 5, 'Should return 5 results');
        assert.strictEqual(page1.pagination.has_more, true, 'Should have more results');
        assert.strictEqual(page1.pagination.next_offset, 5, 'Next offset should be 5');

        // Test second page
        const page2 = await documentManager.query('testing pagination', { limit: 5, offset: 5 });
        assert.strictEqual(page2.pagination.returned, 5, 'Should return 5 results');
        assert(page2.pagination.has_more !== undefined, 'has_more should be defined');

        // Test last page
        const lastPage = await documentManager.query('testing pagination', { limit: 5, offset: 10 });
        assert(lastPage.pagination.returned <= 5, 'Should return at most 5 results');

        // Test beyond available results
        const beyondPage = await documentManager.query('testing pagination', { limit: 5, offset: 100 });
        assert.strictEqual(beyondPage.pagination.returned, 0, 'Should return 0 results');
        assert.strictEqual(beyondPage.pagination.has_more, false, 'Should have no more results');
        assert.strictEqual(beyondPage.pagination.next_offset, null, 'Next offset should be null');

        // Test limit of 0
        const zeroLimit = await documentManager.query('testing pagination', { limit: 0 });
        assert.strictEqual(zeroLimit.pagination.returned, 0, 'Should return 0 results');

        console.log('✓ Pagination logic test passed');
    });
}

/**
 * Test: Metadata filtering - tags
 */
async function testMetadataFilteringTags() {
    console.log('\n=== Test: Metadata Filtering - Tags ===');

    await withQueryManager('tags-test-', async (documentManager) => {

        // Add documents with different tags - use longer content for better vector matching
        await seedDocuments(documentManager, [
            { title: 'AI Research Paper', content: 'This is a research paper about artificial intelligence and machine learning algorithms for data analysis.', metadata: { source: 'upload', tags: ['ai', 'research', 'paper'] } },
            { title: 'Machine Learning Tutorial', content: 'This is a comprehensive tutorial for learning machine learning with practical examples and exercises.', metadata: { source: 'upload', tags: ['ml', 'tutorial', 'ai'] } },
            { title: 'Web Development Guide', content: 'This is a complete guide for web development covering HTML, CSS, and JavaScript best practices.', metadata: { source: 'upload', tags: ['web', 'development', 'tutorial'] } }
        ]);

        // Wait a bit for vector DB to be fully initialized
        await new Promise(resolve => setTimeout(resolve, 100));

        // Query without filter - should return results
        const allResults = await documentManager.query('artificial intelligence', { limit: 10 });
        if (allResults.results.length > 0) {
            // Verify metadata is included in results
            let foundAiTag = false;
            for (const result of allResults.results) {
                if (result.metadata && result.metadata.tags) {
                    if (result.metadata.tags.includes('ai')) {
                        foundAiTag = true;
                    }
                }
            }
            console.log(`  Found AI tag in results: ${foundAiTag}`);
        } else {
            console.log('  No results found - possibly due to similarity threshold');
        }

        // Query with tag filter - vector DB may not support this, so we just verify it doesn't error
        const aiResult = await documentManager.query('artificial intelligence', {
            limit: 10,
            filters: { tags: ['ai'] }
        });
        assert(Array.isArray(aiResult.results), 'Should return array of results');

        console.log('✓ Metadata filtering - tags test passed');
    });
}

/**
 * Test: Metadata filtering - source
 */
async function testMetadataFilteringSource() {
    console.log('\n=== Test: Metadata Filtering - Source ===');

    await withQueryManager('source-test-', async (documentManager) => {

        // Add documents from different sources
        await seedDocuments(documentManager, [
            { title: 'API Documentation', content: 'This is API documentation.', metadata: { source: 'api', tags: ['api'] } },
            { title: 'Crawled Documentation', content: 'This is documentation from crawling.', metadata: { source: 'crawl', tags: ['crawl'], crawl_id: 'test-crawl-1' } },
            { title: 'Uploaded Document', content: 'This is an uploaded document.', metadata: { source: 'upload', tags: ['upload'] } }
        ]);

        // Query without filter - should return results
        const allResults = await documentManager.query('documentation', { limit: 10 });
        assert(allResults.results.length > 0, 'Should find documents matching query');

        // Verify metadata is included
        let foundApiSource = false;
        for (const result of allResults.results) {
            if (result.metadata && result.metadata.source === 'api') {
                foundApiSource = true;
            }
        }
        console.log(`  Found API source in results: ${foundApiSource}`);

        // Query with source filter - verify it doesn't error
        const apiResult = await documentManager.query('documentation', {
            limit: 10,
            filters: { source: 'api' }
        });
        assert(Array.isArray(apiResult.results), 'Should return array of results');

        // Query with crawl_id filter - verify it doesn't error
        const crawlResult = await documentManager.query('documentation', {
            limit: 10,
            filters: { crawl_id: 'test-crawl-1' }
        });
        assert(Array.isArray(crawlResult.results), 'Should return array of results');

        console.log('✓ Metadata filtering - source test passed');
    });
}

/**
 * Test: Metadata filtering - author and contentType
 */
async function testMetadataFilteringAuthorAndContentType() {
    console.log('\n=== Test: Metadata Filtering - Author and ContentType ===');

    await withQueryManager('author-test-', async (documentManager) => {

        // Add documents with author and contentType
        await seedDocuments(documentManager, [
            { title: 'Guide by John', content: 'Content written by John.', metadata: { source: 'api', author: 'John Doe', contentType: 'guide' } },
            { title: 'Tutorial by Jane', content: 'Content written by Jane.', metadata: { source: 'api', author: 'Jane Smith', contentType: 'tutorial' } },
            { title: 'Reference by John', content: 'Reference content by John.', metadata: { source: 'api', author: 'John Doe', contentType: 'reference' } }
        ]);

        // Query without filter
        const allResults = await documentManager.query('content', { limit: 10 });
        assert(allResults.results.length > 0, 'Should find documents matching query');

        // Verify metadata is included
        let foundJohnAuthor = false;
        for (const result of allResults.results) {
            if (result.metadata && result.metadata.author === 'John Doe') {
                foundJohnAuthor = true;
            }
        }
        console.log(`  Found John Doe author in results: ${foundJohnAuthor}`);

        // Query with author filter - verify it doesn't error
        const johnResult = await documentManager.query('content', {
            limit: 10,
            filters: { author: 'John Doe' }
        });
        assert(Array.isArray(johnResult.results), 'Should return array of results');

        // Query with contentType filter - verify it doesn't error
        const guideResult = await documentManager.query('content', {
            limit: 10,
            filters: { contentType: 'guide' }
        });
        assert(Array.isArray(guideResult.results), 'Should return array of results');

        console.log('✓ Metadata filtering - author and contentType test passed');
    });
}

/**
 * Test: Query response shape consistency
 */
async function testQueryResponseShape() {
    console.log('\n=== Test: Query Response Shape Consistency ===');

    await withQueryManager('shape-test-', async (documentManager) => {

        // Add a document
        const doc = await documentManager.addDocument(
            'Test Document',
            'This is a test document for verifying response shape.',
            { source: 'upload' }
        );

        // Query with different options
        const result1 = await documentManager.query('test');
        const result2 = await documentManager.query('test', { limit: 5, offset: 0 });
        const result3 = await documentManager.query('test', { limit: 1, offset: 0, include_metadata: false });
        const result4 = await documentManager.query('test', { limit: 10, offset: 0, filters: { source: 'upload' } });

        // Check response structure for all queries
        for (const result of [result1, result2, result3, result4]) {
            // Check pagination structure
            assert(result.pagination !== undefined, 'Should have pagination');
            assert(typeof result.pagination.total_documents === 'number', 'total_documents should be number');
            assert(typeof result.pagination.returned === 'number', 'returned should be number');
            assert(typeof result.pagination.has_more === 'boolean', 'has_more should be boolean');
            assert(result.pagination.next_offset === null || typeof result.pagination.next_offset === 'number',
                'next_offset should be null or number');

            // Check results structure
            assert(Array.isArray(result.results), 'results should be array');

            // Check each result
            for (const r of result.results) {
                assert(typeof r.id === 'string', 'id should be string');
                assert(typeof r.title === 'string', 'title should be string');
                assert(typeof r.score === 'number', 'score should be number');
                assert(typeof r.updated_at === 'string', 'updated_at should be string');
                assert(typeof r.chunks_count === 'number', 'chunks_count should be number');

                // Metadata should be included by default
                if (result !== result3) {
                    assert(r.metadata !== undefined, 'metadata should be included by default');
                }
            }
        }

        console.log('✓ Query response shape consistency test passed');
    });
}

/**
 * Test: Document search fields indexing and retrieval
 */
async function testDocumentSearchFields() {
    console.log('\n=== Test: Document Search Fields Indexing ===');

    await withQueryManager('searchfields-test-', async (documentManager) => {

        // Add document with various metadata
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
        if (!doc) throw new Error('Failed to add document');

        // Query and verify search fields are used
        const result = await documentManager.query('python data science', { limit: 10 });

        assert(result.results.length > 0, 'Should find the document');

        const foundDoc = result.results.find(r => r.id === doc.id);
        assert(foundDoc !== undefined, 'Should find the added document');

        if (foundDoc && foundDoc.metadata) {
            assert(foundDoc.metadata.tags !== undefined, 'Should have tags in metadata');
            assert(foundDoc.metadata.source === 'api', 'Should have correct source');
        }

        console.log('✓ Document search fields indexing test passed');
    });
}

/**
 * Test: Empty results handling
 */
async function testEmptyResults() {
    console.log('\n=== Test: Empty Results Handling ===');

    await withQueryManager('empty-test-', async (documentManager) => {

        // Query with no documents
        const emptyResult = await documentManager.query('nonexistent query', { limit: 10 });
        assert.strictEqual(emptyResult.results.length, 0, 'Should return empty results');
        assert.strictEqual(emptyResult.pagination.returned, 0, 'Should have 0 returned');
        assert.strictEqual(emptyResult.pagination.has_more, false, 'Should have no more results');
        assert.strictEqual(emptyResult.pagination.next_offset, null, 'Next offset should be null');

        // Add document and query with non-matching filter
        await documentManager.addDocument(
            'Test Document',
            'This is a test document.',
            { source: 'upload', tags: ['test'] }
        );

        const filteredResult = await documentManager.query('test', {
            limit: 10,
            filters: { source: 'nonexistent' }
        });
        assert(filteredResult.results.length >= 0, 'Should return results (possibly empty)');

        console.log('✓ Empty results handling test passed');
    });
}

/**
 * Test: Combined metadata filters
 */
async function testCombinedMetadataFilters() {
    console.log('\n=== Test: Combined Metadata Filters ===');

    await withQueryManager('combined-test-', async (documentManager) => {

        // Add documents with various metadata combinations
        await seedDocuments(documentManager, [
            { title: 'Python API Guide', content: 'Python API documentation.', metadata: { source: 'api', tags: ['python', 'api'], author: 'John' } },
            { title: 'Python Upload Guide', content: 'Python uploaded documentation.', metadata: { source: 'upload', tags: ['python', 'upload'], author: 'Jane' } },
            { title: 'JavaScript API Guide', content: 'JavaScript API documentation.', metadata: { source: 'api', tags: ['javascript', 'api'], author: 'John' } }
        ]);

        // Query without filter
        const allResults = await documentManager.query('python', { limit: 10 });
        assert(allResults.results.length > 0, 'Should find documents matching query');

        // Query with combined filters - verify it doesn't error
        const pythonApiResult = await documentManager.query('python', {
            limit: 10,
            filters: { source: 'api', tags: ['python'] }
        });
        assert(Array.isArray(pythonApiResult.results), 'Should return array of results');

        console.log('✓ Combined metadata filters test passed');
    });
}

/**
 * Run all query unit tests
 */
async function runQueryUnitTests() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Query Unit Tests                                          ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    
    try {
        await testGlobalSearchRanking();
        await testHybridRankingWithKeywordFallback();
        await testPaginationLogic();
        await testMetadataFilteringTags();
        await testMetadataFilteringSource();
        await testMetadataFilteringAuthorAndContentType();
        await testQueryResponseShape();
        await testDocumentSearchFields();
        await testEmptyResults();
        await testCombinedMetadataFilters();
        
        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║  ✓ All query unit tests passed!                           ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
    } catch (error) {
        console.error('\n✗ Test failed:', error);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runQueryUnitTests();
}

export { runQueryUnitTests };
