/**
 * Unit tests for Vector Database components
 * Tests for LanceDBAdapter
 */

import '../../__tests__/setup.js';
import assert from 'assert';
import { LanceDBAdapter, createVectorDatabase } from '../lance-db.js';
import { DocumentChunk, CodeBlock } from '../../types.js';
import {
    createTestChunk,
    createTestCodeBlock,
    createTestEmbedding,
    isLanceDbAvailable,
    withVectorDb,
    withTempDir
} from '../../__tests__/test-utils.js';

// Test data
const testChunks: DocumentChunk[] = [
    createTestChunk('chunk1', 'doc1', 'This is a test document about artificial intelligence.', createTestEmbedding(1)),
    createTestChunk('chunk2', 'doc1', 'Machine learning is a subset of AI.', createTestEmbedding(2)),
    createTestChunk('chunk3', 'doc2', 'Natural language processing is important.', createTestEmbedding(3)),
    createTestChunk('chunk4', 'doc2', 'Vector databases enable efficient similarity search.', createTestEmbedding(4)),
    createTestChunk('chunk5', 'doc3', 'Embeddings represent text as numerical vectors.', createTestEmbedding(5))
];

const testCodeBlocks: CodeBlock[] = [
    createTestCodeBlock('cb1', 'doc1', 'block-1', 'javascript', 'const x = 1;\nconsole.log(x);', createTestEmbedding(10)),
    createTestCodeBlock('cb2', 'doc1', 'block-1', 'python', 'x = 1\nprint(x)', createTestEmbedding(11)),
    createTestCodeBlock('cb3', 'doc1', 'block-2', 'typescript', 'const x: number = 1;\nconsole.log(x);', createTestEmbedding(12)),
    createTestCodeBlock('cb4', 'doc2', 'block-3', 'python', 'def hello():\n    print("Hello")', createTestEmbedding(13)),
    createTestCodeBlock('cb5', 'doc2', 'block-4', 'javascript', 'function hello() {\n    console.log("Hello");\n}', createTestEmbedding(14))
];

/**
 * Test 9.1: Write unit tests for LanceDBAdapter class
 */
async function testLanceDBAdapter() {
    console.log('\n=== Test 9.1: LanceDBAdapter ===');
    
    if (!(await isLanceDbAvailable())) {
        console.log('⊘ LanceDB not available, skipping LanceDBAdapter tests');
        console.log('⊘ Install @lancedb/lancedb package to run these tests: npm install @lancedb/lancedb');
        return;
    }

    await withTempDir('lance-test-', async (tempDir) => {
        const lanceDB = new LanceDBAdapter(tempDir);
        
        // Test initialization
        await lanceDB.initialize();
        assert(lanceDB.isInitialized(), 'LanceDB should be initialized');
        
        // Test addChunks
        await lanceDB.addChunks([testChunks[0], testChunks[1]]);
        let chunk = await lanceDB.getChunk('chunk1');
        assert(chunk !== null, 'Should retrieve added chunk from LanceDB');
        assert.strictEqual(chunk?.id, 'chunk1', 'Chunk ID should match');
        
        // Test removeChunks
        await lanceDB.removeChunks('doc1');
        chunk = await lanceDB.getChunk('chunk1');
        assert(chunk === null, 'Should not retrieve removed chunk from LanceDB');
        
        // Test search
        await lanceDB.addChunks(testChunks);
        const results = await lanceDB.search(createTestEmbedding(1), 2);
        assert(results.length > 0, 'Should return search results from LanceDB');
        assert(results.every(r => r.score >= 0 && r.score <= 1), 'Scores should be between 0 and 1');
        
        // Test search with filter
        const filteredResults = await lanceDB.search(createTestEmbedding(1), 5, "document_id = 'doc2'");
        assert(filteredResults.every(r => r.chunk.document_id === 'doc2'), 'Filter should work correctly');
        
        // Test getChunk
        chunk = await lanceDB.getChunk('chunk3');
        assert(chunk !== null, 'Should retrieve chunk by ID from LanceDB');
        assert.strictEqual(chunk?.content, testChunks[2].content, 'Chunk content should match');
        
        // Test close
        await lanceDB.close();
        console.log('✓ LanceDBAdapter tests passed');
    });
}

/**
 * Test 9.2: Write unit tests for factory function
 */
async function testFactoryFunction() {
    console.log('\n=== Test 9.2: Factory Function ===');
    
    if (!(await isLanceDbAvailable())) {
        console.log('⊘ LanceDB not available, skipping factory function tests');
        return;
    }

    await withTempDir('factory-test-', async (tempDir) => {
        // Test factory function creates LanceDBAdapter
        const lanceDB = createVectorDatabase(tempDir);
        assert(lanceDB instanceof LanceDBAdapter, 'Should create LanceDBAdapter');
        
        // Test factory function with default path
        const defaultDB = createVectorDatabase();
        assert(defaultDB instanceof LanceDBAdapter, 'Should create LanceDBAdapter with default path');
        
        // Test that instances work correctly
        await lanceDB.initialize();
        await lanceDB.addChunks([testChunks[0]]);
        const chunk = await lanceDB.getChunk('chunk1');
        assert(chunk !== null, 'Factory-created instance should work correctly');
        await lanceDB.close();
        
        await defaultDB.close();

        console.log('✓ Factory function tests passed');
    });
}

/**
 * Test 9.3: Write error handling tests
 */
async function testErrorHandling() {
    console.log('\n=== Test 9.3: Error Handling ===');
    
    if (!(await isLanceDbAvailable())) {
        console.log('⊘ LanceDB not available, skipping error handling tests');
        return;
    }

    await withTempDir('error-test-', async (tempDir) => {
        // Test LanceDB handles operations before initialization
        const lanceDB = new LanceDBAdapter(tempDir);
        
        try {
            await lanceDB.addChunks([testChunks[0]]);
            assert.fail('Should throw error when not initialized');
        } catch (error) {
            assert(error instanceof Error, 'Should throw Error object');
            assert(error.message.includes('not initialized'), 'Error should mention not initialized');
        }
        
        // Test LanceDB handles getChunk for non-existent chunk
        await lanceDB.initialize();
        const chunk = await lanceDB.getChunk('non-existent');
        assert.strictEqual(chunk, null, 'Should return null for non-existent chunk');
        
        // Test LanceDB handles search with empty database
        const emptyResults = await lanceDB.search(createTestEmbedding(1), 5);
        assert.strictEqual(emptyResults.length, 0, 'Should return empty results for empty database');
        
        // Test LanceDB handles chunks without embeddings
        const chunkWithoutEmbedding = createTestChunk('no-embed', 'doc1', 'No embedding here');
        await lanceDB.addChunks([chunkWithoutEmbedding, testChunks[0]]);
        const results = await lanceDB.search(createTestEmbedding(1), 5);
        assert(results.length === 1, 'Should only return chunks with embeddings');
        
        await lanceDB.close();

        console.log('✓ Error handling tests passed');
    });
}

/**
 * Test: Code block extraction and storage
 */
async function testCodeBlockExtractionAndStorage() {
    console.log('\n=== Test: Code Block Extraction and Storage ===');

    if (!(await isLanceDbAvailable())) {
        console.log('⊘ LanceDB not available, skipping code block tests');
        console.log('⊘ Install @lancedb/lancedb package to run these tests: npm install @lancedb/lancedb');
        return;
    }

    await withVectorDb(async (lanceDB) => {
        // Test adding code blocks with multiple language variants
        await lanceDB.addCodeBlocks([testCodeBlocks[0], testCodeBlocks[1], testCodeBlocks[2]]);

        // Test getting code blocks by document
        const doc1CodeBlocks = await lanceDB.getCodeBlocksByDocument('doc1');
        assert(doc1CodeBlocks.length === 3, 'Should retrieve all code blocks for doc1');
        assert(doc1CodeBlocks.every(cb => cb.document_id === 'doc1'), 'All code blocks should belong to doc1');

        // Test that code blocks are sorted by block_index
        for (let i = 0; i < doc1CodeBlocks.length - 1; i++) {
            assert(doc1CodeBlocks[i].block_index <= doc1CodeBlocks[i + 1].block_index,
                'Code blocks should be sorted by block_index');
        }

        // Test that language tags are normalized
        const jsBlock = doc1CodeBlocks.find(cb => cb.language === 'javascript');
        assert(jsBlock !== undefined, 'Should find javascript code block');
        const tsBlock = doc1CodeBlocks.find(cb => cb.language === 'typescript');
        assert(tsBlock !== undefined, 'Should find typescript code block');

        // Test adding more code blocks
        await lanceDB.addCodeBlocks([testCodeBlocks[3], testCodeBlocks[4]]);

        // Test getting code blocks for another document
        const doc2CodeBlocks = await lanceDB.getCodeBlocksByDocument('doc2');
        assert(doc2CodeBlocks.length === 2, 'Should retrieve all code blocks for doc2');

        console.log('✓ Code block extraction and storage tests passed');
    }, 'codeblock-test-');
}

/**
 * Test: Code block search with language filtering
 */
async function testCodeBlockSearchWithLanguageFiltering() {
    console.log('\n=== Test: Code Block Search with Language Filtering ===');

    if (!(await isLanceDbAvailable())) {
        console.log('⊘ LanceDB not available, skipping code block search tests');
        return;
    }

    await withVectorDb(async (lanceDB) => {
        // Add test code blocks
        await lanceDB.addCodeBlocks(testCodeBlocks);

        // Test search without language filter (should return all variants)
        const allResults = await lanceDB.searchCodeBlocks(createTestEmbedding(10), 10);
        assert(allResults.length > 0, 'Should return search results');
        assert(allResults.every(r => r.score >= 0 && r.score <= 1), 'Scores should be between 0 and 1');

        // Test search with language filter for javascript
        const jsResults = await lanceDB.searchCodeBlocks(createTestEmbedding(10), 10, 'javascript');
        assert(jsResults.every(r => r.code_block.language === 'javascript'),
            'All results should be javascript when filtered');

        // Test search with language filter for python
        const pythonResults = await lanceDB.searchCodeBlocks(createTestEmbedding(10), 10, 'python');
        assert(pythonResults.every(r => r.code_block.language === 'python'),
            'All results should be python when filtered');

        // Test that case-insensitive language matching works
        const jsResultsUpperCase = await lanceDB.searchCodeBlocks(createTestEmbedding(10), 10, 'JavaScript');
        assert(jsResultsUpperCase.every(r => r.code_block.language === 'javascript'),
            'Language filter should be case-insensitive');

        // Test search with non-existent language
        const emptyResults = await lanceDB.searchCodeBlocks(createTestEmbedding(10), 10, 'rust');
        assert(emptyResults.length === 0, 'Should return empty results for non-existent language');

        console.log('✓ Code block search with language filtering tests passed');
    }, 'codeblock-search-test-');
}

/**
 * Test: Code block multi-language variant handling
 */
async function testCodeBlockMultiLanguageVariants() {
    console.log('\n=== Test: Code Block Multi-Language Variant Handling ===');

    if (!(await isLanceDbAvailable())) {
        console.log('⊘ LanceDB not available, skipping multi-language variant tests');
        return;
    }

    await withVectorDb(async (lanceDB) => {
        // Add code blocks with same block_id but different languages (simulating tabbed code)
        const multiLangBlocks: CodeBlock[] = [
            createTestCodeBlock('ml1', 'doc1', 'tabbed-1', 'javascript', 'const x = 1;', createTestEmbedding(20)),
            createTestCodeBlock('ml2', 'doc1', 'tabbed-1', 'python', 'x = 1', createTestEmbedding(21)),
            createTestCodeBlock('ml3', 'doc1', 'tabbed-1', 'typescript', 'const x: number = 1;', createTestEmbedding(22)),
        ];

        await lanceDB.addCodeBlocks(multiLangBlocks);

        // Get all code blocks for the document
        const docBlocks = await lanceDB.getCodeBlocksByDocument('doc1');
        assert(docBlocks.length === 3, 'Should retrieve all language variants');

        // Group by block_id to verify variants
        const groupedByBlockId = docBlocks.reduce((acc, cb) => {
            if (!acc[cb.block_id]) {
                acc[cb.block_id] = [];
            }
            acc[cb.block_id].push(cb);
            return acc;
        }, {} as Record<string, CodeBlock[]>);

        assert(groupedByBlockId['tabbed-1']?.length === 3,
            'Should have 3 language variants for tabbed-1');

        // Verify all languages are present
        const languages = groupedByBlockId['tabbed-1']!.map(cb => cb.language);
        assert(languages.includes('javascript'), 'Should include javascript variant');
        assert(languages.includes('python'), 'Should include python variant');
        assert(languages.includes('typescript'), 'Should include typescript variant');

        // Test search returns all variants by default
        const searchResults = await lanceDB.searchCodeBlocks(createTestEmbedding(20), 10);
        const tabbedBlockResults = searchResults.filter(r => r.code_block.block_id === 'tabbed-1');
        assert(tabbedBlockResults.length > 0, 'Should return at least one variant in search results');

        console.log('✓ Code block multi-language variant handling tests passed');
    }, 'codeblock-multilang-test-');
}

/**
 * Run all unit tests
 */
async function runUnitTests() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Vector Database Unit Tests                                 ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    try {
        await testLanceDBAdapter();
        await testFactoryFunction();
        await testErrorHandling();
        await testCodeBlockExtractionAndStorage();
        await testCodeBlockSearchWithLanguageFiltering();
        await testCodeBlockMultiLanguageVariants();

        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║  ✓ All unit tests passed!                                 ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
    } catch (error) {
        console.error('\n✗ Test failed:', error);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runUnitTests();
}

export { runUnitTests };
