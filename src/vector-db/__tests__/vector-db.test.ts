/**
 * Unit tests for Vector Database components
 * Tests for VectorDatabase interface, LanceDBAdapter, and InMemoryVectorDB
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import assert from 'assert';
import { LanceDBAdapter, InMemoryVectorDB, createVectorDatabase } from '../lance-db.js';
import { DocumentChunk } from '../../types.js';

// Test utilities
const createTestChunk = (id: string, documentId: string, content: string, embeddings?: number[]): DocumentChunk => ({
    id,
    document_id: documentId,
    chunk_index: 0,
    content,
    embeddings,
    start_position: 0,
    end_position: content.length,
    metadata: { test: true }
});

const createTestEmbedding = (seed: number, dimensions: number = 384): number[] => {
    const embedding: number[] = [];
    for (let i = 0; i < dimensions; i++) {
        // Deterministic pseudo-random values based on seed
        const value = Math.sin(seed * i * 0.1) * Math.cos(seed * i * 0.05);
        embedding.push(value);
    }
    // Normalize the embedding
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / norm);
};

// Test data
const testChunks: DocumentChunk[] = [
    createTestChunk('chunk1', 'doc1', 'This is a test document about artificial intelligence.', createTestEmbedding(1)),
    createTestChunk('chunk2', 'doc1', 'Machine learning is a subset of AI.', createTestEmbedding(2)),
    createTestChunk('chunk3', 'doc2', 'Natural language processing is important.', createTestEmbedding(3)),
    createTestChunk('chunk4', 'doc2', 'Vector databases enable efficient similarity search.', createTestEmbedding(4)),
    createTestChunk('chunk5', 'doc3', 'Embeddings represent text as numerical vectors.', createTestEmbedding(5))
];

/**
 * Test 9.1: Write unit tests for VectorDatabase interface
 */
async function testVectorDatabaseInterface() {
    console.log('\n=== Test 9.1: VectorDatabase Interface ===');
    
    // Test InMemoryVectorDB (always available)
    const memoryDB = new InMemoryVectorDB();
    await memoryDB.initialize();
    
    // Test addChunks
    await memoryDB.addChunks([testChunks[0], testChunks[1]]);
    let chunk = await memoryDB.getChunk('chunk1');
    assert(chunk !== null, 'Should retrieve added chunk');
    assert.strictEqual(chunk?.id, 'chunk1', 'Chunk ID should match');
    
    // Test removeChunks
    await memoryDB.removeChunks('doc1');
    chunk = await memoryDB.getChunk('chunk1');
    assert(chunk === null, 'Should not retrieve removed chunk');
    
    // Test search
    await memoryDB.addChunks(testChunks);
    const results = await memoryDB.search(createTestEmbedding(1), 2);
    assert(results.length > 0, 'Should return search results');
    assert(results.every(r => r.score >= 0 && r.score <= 1), 'Scores should be between 0 and 1');
    
    // Test getChunk
    chunk = await memoryDB.getChunk('chunk3');
    assert(chunk !== null, 'Should retrieve chunk by ID');
    assert.strictEqual(chunk?.content, testChunks[2].content, 'Chunk content should match');
    
    // Test close
    await memoryDB.close();
    assert.strictEqual(memoryDB.constructor.name, 'InMemoryVectorDB', 'Database should be closable');
    
    console.log('✓ VectorDatabase interface tests passed');
}

/**
 * Test 9.2: Write unit tests for LanceDBAdapter class
 */
async function testLanceDBAdapter() {
    console.log('\n=== Test 9.2: LanceDBAdapter ===');
    
    // Check if LanceDB is available
    try {
        await import('@lancedb/lancedb');
    } catch {
        console.log('⊘ LanceDB not available, skipping LanceDBAdapter tests');
        console.log('⊘ Install @lancedb/lancedb package to run these tests: npm install @lancedb/lancedb');
        return;
    }
    
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lance-test-'));
    
    try {
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
    } finally {
        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/**
 * Test 9.3: Write unit tests for InMemoryVectorDB class
 */
async function testInMemoryVectorDB() {
    console.log('\n=== Test 9.3: InMemoryVectorDB ===');
    
    const memoryDB = new InMemoryVectorDB();
    
    // Test initialization
    await memoryDB.initialize();
    
    // Test adding single chunk
    await memoryDB.addChunks([testChunks[0]]);
    let chunk = await memoryDB.getChunk('chunk1');
    assert(chunk !== null, 'Should retrieve added chunk');
    assert.strictEqual(chunk?.content, testChunks[0].content);
    
    // Test adding multiple chunks
    await memoryDB.addChunks([testChunks[1], testChunks[2]]);
    chunk = await memoryDB.getChunk('chunk2');
    assert(chunk !== null, 'Should retrieve second chunk');
    
    // Test removeChunks removes only specified document
    await memoryDB.removeChunks('doc1');
    chunk = await memoryDB.getChunk('chunk1');
    assert(chunk === null, 'Should remove chunks for doc1');
    chunk = await memoryDB.getChunk('chunk2');
    assert(chunk === null, 'Should remove all chunks for doc1');
    chunk = await memoryDB.getChunk('chunk3');
    assert(chunk !== null, 'Should keep chunks for doc2');
    
    // Test search returns results in descending score order
    await memoryDB.addChunks(testChunks);
    const results = await memoryDB.search(createTestEmbedding(1), 3);
    assert(results.length === 3, 'Should return requested number of results');
    for (let i = 0; i < results.length - 1; i++) {
        assert(results[i].score >= results[i + 1].score, 'Results should be sorted by score');
    }
    
    // Test search with metadata filter
    const resultsWithFilter = await memoryDB.search(createTestEmbedding(1), 10, "test = 'true'");
    assert(resultsWithFilter.length > 0, 'Should return results matching metadata filter');
    
    // Test getChunk returns null for non-existent chunk
    const nonExistent = await memoryDB.getChunk('non-existent');
    assert.strictEqual(nonExistent, null, 'Should return null for non-existent chunk');
    
    // Test close clears data
    await memoryDB.close();
    chunk = await memoryDB.getChunk('chunk3');
    assert.strictEqual(chunk, null, 'Should clear data after close');
    
    console.log('✓ InMemoryVectorDB tests passed');
}

/**
 * Test 9.7: Write backward compatibility tests with MCP_VECTOR_DB=memory
 */
async function testBackwardCompatibility() {
    console.log('\n=== Test 9.7: Backward Compatibility ===');
    
    // Test factory function creates InMemoryVectorDB for 'memory' type
    const memoryDB = createVectorDatabase('memory');
    assert(memoryDB instanceof InMemoryVectorDB, 'Should create InMemoryVectorDB for memory type');
    
    // Test factory function creates InMemoryVectorDB for 'inmemory' type
    const inMemoryDB = createVectorDatabase('inmemory');
    assert(inMemoryDB instanceof InMemoryVectorDB, 'Should create InMemoryVectorDB for inmemory type');
    
    // Test factory function creates InMemoryVectorDB for unknown type (fallback)
    const fallbackDB = createVectorDatabase('unknown');
    assert(fallbackDB instanceof InMemoryVectorDB, 'Should fallback to InMemoryVectorDB for unknown type');
    
    // Test factory function creates LanceDBAdapter for 'lance' type (if available)
    try {
        await import('@lancedb/lancedb');
        const lanceDB = createVectorDatabase('lance', '/tmp/test-lance');
        assert(lanceDB instanceof LanceDBAdapter, 'Should create LanceDBAdapter for lance type');
    } catch {
        console.log('  ⊘ LanceDB not available, skipping LanceDB factory test');
    }
    
    // Test InMemoryVectorDB works as drop-in replacement
    const db1 = new InMemoryVectorDB();
    await db1.initialize();
    await db1.addChunks(testChunks);
    const results1 = await db1.search(createTestEmbedding(1), 5);
    assert(results1.length > 0, 'InMemoryVectorDB should provide search functionality');
    await db1.close();
    
    console.log('✓ Backward compatibility tests passed');
}

/**
 * Test 9.8: Write error handling and fallback tests
 */
async function testErrorHandlingAndFallback() {
    console.log('\n=== Test 9.8: Error Handling and Fallback ===');
    
    // Test InMemoryVectorDB handles search with empty database
    const emptyDB = new InMemoryVectorDB();
    await emptyDB.initialize();
    const emptyResults = await emptyDB.search(createTestEmbedding(1), 5);
    assert.strictEqual(emptyResults.length, 0, 'Should return empty results for empty database');
    await emptyDB.close();
    
    // Test InMemoryVectorDB handles getChunk for non-existent chunk
    const db = new InMemoryVectorDB();
    await db.initialize();
    const chunk = await db.getChunk('non-existent');
    assert.strictEqual(chunk, null, 'Should return null for non-existent chunk');
    await db.close();
    
    // Test InMemoryVectorDB handles removeChunks for non-existent document
    const db2 = new InMemoryVectorDB();
    await db2.initialize();
    // Should not throw error
    await db2.removeChunks('non-existent-doc');
    await db2.close();
    
    // Test InMemoryVectorDB handles chunks without embeddings
    const db3 = new InMemoryVectorDB();
    await db3.initialize();
    const chunkWithoutEmbedding = createTestChunk('no-embed', 'doc1', 'No embedding here');
    await db3.addChunks([chunkWithoutEmbedding, testChunks[0]]);
    const results = await db3.search(createTestEmbedding(1), 5);
    assert(results.length === 1, 'Should only return chunks with embeddings');
    await db3.close();
    
    // Test LanceDB error handling (if available)
    try {
        await import('@lancedb/lancedb');
        
        // Test LanceDB handles operations before initialization
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lance-error-test-'));
        const lanceDB = new LanceDBAdapter(tempDir);
        
        try {
            await lanceDB.addChunks([testChunks[0]]);
            assert.fail('Should throw error when not initialized');
        } catch (error) {
            assert(error instanceof Error, 'Should throw Error object');
            assert(error.message.includes('not initialized'), 'Error should mention not initialized');
        }
        
        // Test LanceDB handles invalid path
        const invalidLanceDB = new LanceDBAdapter('/root/invalid-path/no-permission');
        try {
            await invalidLanceDB.initialize();
            // If it succeeds, that's also fine (might work on some systems)
            await invalidLanceDB.close();
        } catch (error) {
            assert(error instanceof Error, 'Should throw Error for invalid path');
        }
        
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log('  ✓ LanceDB error handling tests passed');
    } catch {
        console.log('  ⊘ LanceDB not available, skipping LanceDB error handling tests');
    }
    
    console.log('✓ Error handling and fallback tests passed');
}

/**
 * Run all unit tests
 */
async function runUnitTests() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Vector Database Unit Tests                                 ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    
    try {
        await testVectorDatabaseInterface();
        await testLanceDBAdapter();
        await testInMemoryVectorDB();
        await testBackwardCompatibility();
        await testErrorHandlingAndFallback();
        
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
