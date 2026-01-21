/**
 * Integration tests for DocumentManager and SearchEngine with Vector Database
 * Tests for integration with Lance DB (tasks 9.4, 9.5)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DocumentManager } from '../document-manager.js';
import { SearchEngine } from '../search-engine.js';
import { InMemoryVectorDB, createVectorDatabase } from '../vector-db/index.js';
import { SimpleEmbeddingProvider } from '../embedding-provider.js';

async function testDocumentManagerIntegration() {
    console.log('\n=== Test 9.4: DocumentManager Integration ===');
    
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-test-'));
    process.env.MCP_BASE_DIR = tempDir;
    
    try {
        const vectorDB = new InMemoryVectorDB();
        await vectorDB.initialize();
        
        const documentManager = new DocumentManager(new SimpleEmbeddingProvider(), vectorDB);
        
        const doc1 = await documentManager.addDocument(
            'Test Document 1',
            'This is a test document about vector databases and semantic search.',
            { source: 'test' }
        );
        
        if (!doc1.id) throw new Error('Document should have ID');
        if (doc1.title !== 'Test Document 1') throw new Error('Title mismatch');
        if (doc1.chunks.length === 0) throw new Error('Document should have chunks');
        if (!doc1.chunks[0].embeddings || doc1.chunks[0].embeddings.length === 0) {
            throw new Error('Chunks should have embeddings');
        }
        
        const doc2 = await documentManager.addDocument(
            'Test Document 2',
            'Machine learning models use embeddings to represent text as vectors.',
            { source: 'test' }
        );
        
        const doc3 = await documentManager.addDocument(
            'Test Document 3',
            'Vector databases enable efficient similarity search for large datasets.',
            { source: 'test' }
        );
        
        const retrieved = await documentManager.getDocument(doc1.id);
        if (retrieved === null) throw new Error('Should retrieve document');
        if (retrieved.id !== doc1.id) throw new Error('ID mismatch');
        if (retrieved.title !== doc1.title) throw new Error('Title mismatch');
        
        const searchResults = await documentManager.searchDocuments(doc1.id, 'vector databases', 3);
        if (searchResults.length === 0) throw new Error('Should find search results');
        if (!searchResults.every(r => r.chunk.document_id === doc1.id)) {
            throw new Error('Results should be from correct document');
        }
        if (!searchResults.every(r => r.score >= 0 && r.score <= 1)) {
            throw new Error('Scores should be between 0 and 1');
        }
        
        const allDocs = await documentManager.getAllDocuments();
        if (allDocs.length !== 3) throw new Error('Should retrieve all documents');
        
        const deleted = await documentManager.deleteDocument(doc1.id);
        if (!deleted) throw new Error('Should delete document successfully');
        
        const deletedDoc = await documentManager.getDocument(doc1.id);
        if (deletedDoc !== null) throw new Error('Deleted document should not be retrievable');
        
        const chunk = await vectorDB.getChunk(doc1.chunks[0].id);
        if (chunk !== null) throw new Error('Chunks should be removed from vector DB');
        
        const crawlDocs = [];
        for (let i = 0; i < 5; i++) {
            const doc = await documentManager.addDocument(
                `Crawl Doc ${i}`,
                `Content for document ${i} in crawl session.`,
                { crawl_id: 'test-crawl-1' }
            );
            crawlDocs.push(doc.id);
        }
        
        const result = await documentManager.deleteCrawlSession('test-crawl-1');
        if (result.deleted !== 5) throw new Error('Should delete all documents in crawl session');
        if (result.errors.length !== 0) throw new Error('Should have no errors');
        
        for (const id of crawlDocs) {
            const doc = await documentManager.getDocument(id);
            if (doc !== null) throw new Error('Crawl document should be deleted');
        }
        
        await vectorDB.close();
        
        console.log('✓ DocumentManager integration tests passed');
    } finally {
        process.env.MCP_BASE_DIR = undefined;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function testSearchEngineIntegration() {
    console.log('\n=== Test 9.5: SearchEngine Integration ===');
    
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-test-'));
    process.env.MCP_BASE_DIR = tempDir;
    
    try {
        const vectorDB = new InMemoryVectorDB();
        await vectorDB.initialize();
        
        const embeddingProvider = new SimpleEmbeddingProvider();
        const documentManager = new DocumentManager(embeddingProvider, vectorDB);
        const searchEngine = new SearchEngine(documentManager, embeddingProvider);
        
        const doc1 = await documentManager.addDocument(
            'AI Fundamentals',
            'Artificial intelligence is a branch of computer science that aims to create intelligent machines.',
            { category: 'ai' }
        );
        
        const doc2 = await documentManager.addDocument(
            'Machine Learning Basics',
            'Machine learning is a subset of AI that enables systems to learn from data.',
            { category: 'ml' }
        );
        
        const doc3 = await documentManager.addDocument(
            'Deep Learning',
            'Deep learning uses neural networks with multiple layers to learn complex patterns.',
            { category: 'dl' }
        );
        
        const inDocResults = await searchEngine.searchDocument(doc1.id, 'intelligent machines', 5);
        if (inDocResults.length === 0) throw new Error('Should find results within document');
        if (!inDocResults.every(r => r.chunk.document_id === doc1.id)) {
            throw new Error('All results should be from specified document');
        }
        
        const mlResults = await searchEngine.searchDocument(doc2.id, 'data', 3);
        if (mlResults.length === 0) throw new Error('Should find ML-related results');
        
        const sortedResults = await searchEngine.searchDocument(doc1.id, 'artificial intelligence', 5);
        for (let i = 0; i < sortedResults.length - 1; i++) {
            if (sortedResults[i].score < sortedResults[i + 1].score) {
                throw new Error('Results should be sorted by score');
            }
        }
        
        const limitedResults = await searchEngine.searchDocument(doc1.id, 'computer', 2);
        if (limitedResults.length > 2) throw new Error('Should respect limit parameter');
        
        const allDocs = await documentManager.getAllDocuments();
        if (allDocs.length !== 3) throw new Error('Should have 3 documents');
        
        await vectorDB.close();
        
        console.log('✓ SearchEngine integration tests passed');
    } finally {
        process.env.MCP_BASE_DIR = undefined;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function testMigration() {
    console.log('\n=== Test 9.6: Migration Tests ===');
    
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
    const dataDir = path.join(tempDir, 'data');
    const lanceDir = path.join(tempDir, 'lancedb');
    
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        
        const createTestDocument = (id: string, title: string, content: string) => {
            const doc = {
                id,
                title,
                content,
                metadata: { source: 'test' },
                chunks: [
                    {
                        id: `${id}-chunk-0`,
                        document_id: id,
                        chunk_index: 0,
                        content,
                        embeddings: Array(384).fill(0).map((_, i) => Math.sin(id.charCodeAt(0) * i)),
                        start_position: 0,
                        end_position: content.length,
                        metadata: {}
                    }
                ],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            fs.writeFileSync(path.join(dataDir, `${id}.json`), JSON.stringify(doc, null, 2));
        };
        
        for (let i = 0; i < 10; i++) {
            createTestDocument(
                `doc-${i}`,
                `Test Document ${i}`,
                `This is test document ${i} with sample content for migration testing.`
            );
        }
        
        console.log(`  Created 10 test documents in ${dataDir}`);
        
        const { migrateFromJson } = await import('../vector-db/index.js');
        const vectorDB = createVectorDatabase('lance', lanceDir);
        
        try {
            await vectorDB.initialize();
            
            const migrationResult = await migrateFromJson(vectorDB, tempDir);
            if (!migrationResult.success) throw new Error('Migration should succeed');
            if (migrationResult.documentsMigrated !== 10) throw new Error('Should migrate 10 documents');
            if (migrationResult.chunksMigrated !== 10) throw new Error('Should migrate 10 chunks');
            if (migrationResult.errors.length !== 0) throw new Error('Should have no errors');
            
            console.log(`  ✓ Migrated ${migrationResult.documentsMigrated} documents, ${migrationResult.chunksMigrated} chunks`);
            
            const chunk = await vectorDB.getChunk('doc-0-chunk-0');
            if (chunk === null) throw new Error('Should retrieve migrated chunk');
            if (chunk.id !== 'doc-0-chunk-0') throw new Error('Migrated chunk ID should match');
            
            for (let i = 10; i < 50; i++) {
                createTestDocument(
                    `doc-${i}`,
                    `Test Document ${i}`,
                    `This is test document ${i} with sample content for migration testing.`
                );
            }
            
            const migrationResult2 = await migrateFromJson(vectorDB, tempDir);
            if (!migrationResult2.success) throw new Error('Second migration should succeed');
            if (migrationResult2.documentsMigrated !== 40) throw new Error('Should migrate 40 new documents');
            
            console.log(`  ✓ Migrated additional ${migrationResult2.documentsMigrated} documents (total: 50)`);
            
            for (let i = 50; i < 100; i++) {
                createTestDocument(
                    `doc-${i}`,
                    `Test Document ${i}`,
                    `This is test document ${i} with sample content for migration testing.`
                );
            }
            
            const migrationResult3 = await migrateFromJson(vectorDB, tempDir);
            if (!migrationResult3.success) throw new Error('Third migration should succeed');
            if (migrationResult3.documentsMigrated !== 50) throw new Error('Should migrate 50 new documents');
            
            console.log(`  ✓ Migrated additional ${migrationResult3.documentsMigrated} documents (total: 100)`);
            
            await vectorDB.close();
            
            console.log('✓ Migration tests passed');
        } catch (error) {
            if (error instanceof Error && error.message.includes('LanceDB is not available')) {
                console.log('⊘ LanceDB not available, skipping migration tests');
                console.log('⊘ Install lancedb package to run these tests: npm install lancedb');
            } else {
                throw error;
            }
        }
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function runIntegrationTests() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Integration Tests                                          ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    
    try {
        await testDocumentManagerIntegration();
        await testSearchEngineIntegration();
        await testMigration();
        
        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║  ✓ All integration tests passed!                           ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
    } catch (error) {
        console.error('\n✗ Test failed:', error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runIntegrationTests();
}

export { runIntegrationTests };
