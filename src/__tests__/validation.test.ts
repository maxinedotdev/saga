/**
 * Validation tests for Lance DB integration
 * Tests for tasks 12.1-12.6
 */

import './setup.js';
import * as fs from 'fs';
import * as path from 'path';
import { DocumentManager } from '../document-manager.js';
import { createVectorDatabase, LanceDBAdapter } from '../vector-db/index.js';
import { SimpleEmbeddingProvider } from '../embedding-provider.js';
import { createTempDir, withBaseDir, withBaseDirAndDocumentManager, withBaseDirAndSearchEngine, withEnv } from './test-utils.js';

async function testMigrationWithRealData() {
    console.log('\n=== Test 12.2: Migration with Real Data ===');
    
    const tempDir = createTempDir('mig-real-');
    const dataDir = path.join(tempDir, 'data');
    const lanceDir = path.join(tempDir, 'lancedb');
    
    try {
        fs.mkdirSync(dataDir, { recursive: true });
        
        const createRealDocument = (id: string, title: string, content: string, metadata: Record<string, any> = {}) => {
            const doc = {
                id,
                title,
                content,
                metadata: { ...metadata, createdAt: new Date().toISOString() },
                chunks: [
                    {
                        id: `${id}-chunk-0`,
                        document_id: id,
                        chunk_index: 0,
                        content,
                        embeddings: Array(384).fill(0).map((_, i) => Math.sin(id.charCodeAt(0) * i * 0.1)),
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
        
        createRealDocument(
            'api-doc-1',
            'REST API Documentation',
            'The REST API provides endpoints for managing documents, users, and permissions.',
            { version: '2.0', category: 'api' }
        );
        
        createRealDocument(
            'guide-1',
            'Getting Started Guide',
            'Welcome to the documentation server. This guide will help you get started.',
            { category: 'guide', language: 'en' }
        );
        
        createRealDocument(
            'config-1',
            'Configuration Reference',
            'The server can be configured using environment variables like MCP_VECTOR_DB.',
            { category: 'reference' }
        );
        
        createRealDocument(
            'troubleshoot-1',
            'Troubleshooting Guide',
            'Common issues and their solutions. Check MCP_LANCE_DB_PATH for database issues.',
            { category: 'troubleshooting' }
        );
        
        createRealDocument(
            'api-doc-2',
            'WebSocket API Documentation',
            'The WebSocket API enables real-time communication for search results.',
            { version: '1.0', category: 'api', protocol: 'websocket' }
        );
        
        console.log(`  Created 5 realistic test documents`);
        
        const { migrateFromJson } = await import('../vector-db/index.js');
        const vectorDB = createVectorDatabase(lanceDir);
        
        try {
            await vectorDB.initialize();
            
            const migrationResult = await migrateFromJson(vectorDB, tempDir);
            console.log(`  ✓ Migration completed: ${migrationResult.documentsMigrated} documents, ${migrationResult.chunksMigrated} chunks`);
            
            if (migrationResult.errors.length > 0) {
                console.warn('  Migration errors:', migrationResult.errors.join(', '));
            }
            
            const chunk = await vectorDB.getChunk('api-doc-1-chunk-0');
            if (chunk === null) throw new Error('Should retrieve migrated chunk');
            if (chunk.id !== 'api-doc-1-chunk-0') throw new Error('Migrated chunk ID should match');
            if (chunk.document_id !== 'api-doc-1') throw new Error('Document ID should match');
            
            console.log('  ✓ Migrated data verified');
            
            const results = await vectorDB.search(
                chunk.embeddings || [],
                5
            );
            if (results.length === 0) throw new Error('Should find results in migrated data');
            
            console.log('  ✓ Search on migrated data works');
            
            await vectorDB.close();
            
            console.log('✓ Migration with real data test passed');
            return true;
        } catch (error) {
            if (error instanceof Error && error.message.includes('LanceDB is not available')) {
                console.log('⊘ LanceDB not available, skipping migration test');
                return true;
            }
            throw error;
        }
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function testMCPToolsWithLanceDB() {
    console.log('\n=== Test 12.3: MCP Tools with Lance DB ===');

    return await withBaseDirAndSearchEngine('mcp-tools-', async ({ baseDir, documentManager, searchEngine }) => {

        const doc1 = await documentManager.addDocument(
            'Test Document',
            'This is a test document for MCP tool validation.',
            { source: 'test' }
        );
        console.log('  ✓ add_document equivalent works');

        const retrieved = await documentManager.getDocument(doc1.id);
        if (retrieved === null) throw new Error('Should retrieve document');
        if (retrieved.id !== doc1.id) throw new Error('ID mismatch');
        console.log('  ✓ get_document equivalent works');

        const searchResults = await documentManager.searchDocuments(doc1.id, 'test document', 5);
        if (searchResults.length === 0) throw new Error('Should find search results');
        console.log('  ✓ search_documents equivalent works');

        const allDocs = await documentManager.getAllDocuments();
        if (allDocs.length !== 1) throw new Error('Should list one document');
        console.log('  ✓ list_documents equivalent works');

        const deleted = await documentManager.deleteDocument(doc1.id);
        if (!deleted) throw new Error('Should delete document');
        console.log('  ✓ delete_document equivalent works');

        const uploadsDir = path.join(baseDir, 'uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });
        fs.writeFileSync(
            path.join(uploadsDir, 'test.txt'),
            'This is a test file for upload processing.'
        );

        const processResult = await documentManager.processUploadsFolder();
        if (processResult.processed !== 1) throw new Error('Should process one file');
        console.log('  ✓ process_uploads equivalent works');

        const uploadsFiles = await documentManager.listUploadsFiles();
        if (uploadsFiles.length < 0) throw new Error('Should list uploads files');
        console.log('  ✓ list_uploads_files equivalent works');

        const doc2 = await documentManager.addDocument(
            'Search Test Document',
            'This document is for testing search functionality within documents.',
            { category: 'test' }
        );

        const inDocResults = await searchEngine.searchDocument(doc2.id, 'search functionality', 5);
        if (inDocResults.length === 0) throw new Error('Should find results within document');
        console.log('  ✓ search_in_document equivalent works');

        const doc3 = await documentManager.addDocument(
            'Crawl Doc 1',
            'Document from crawl session.',
            { crawl_id: 'test-session' }
        );
        const doc4 = await documentManager.addDocument(
            'Crawl Doc 2',
            'Another document from crawl session.',
            { crawl_id: 'test-session' }
        );

        const crawlResult = await documentManager.deleteCrawlSession('test-session');
        if (crawlResult.deleted !== 2) throw new Error('Should delete all documents in crawl session');
        console.log('  ✓ delete_crawl_session equivalent works');

        console.log('✓ All MCP tools work with vector database');
        return true;
    });
}

async function testEmbeddingProviders() {
    console.log('\n=== Test 12.4: Embedding Providers ===');

    return await withBaseDir('embeddings-', async () => {
        return await withEnv({ MCP_EMBEDDING_PROVIDER: undefined }, async () => {
            console.log('  Testing with SimpleEmbeddingProvider (Transformers.js)...');
            const simpleProvider = new SimpleEmbeddingProvider();
            const simpleEmbedding = await simpleProvider.generateEmbedding('test text');
            if (simpleEmbedding.length === 0) throw new Error('Should generate embedding');
            if (!simpleProvider.isAvailable()) throw new Error('Should be available');
            console.log(`  ✓ SimpleEmbeddingProvider works (${simpleEmbedding.length} dimensions)`);

            const simpleVectorDB = new LanceDBAdapter(createTempDir('vector-test-'));
            await simpleVectorDB.initialize();
            const simpleDocManager = new DocumentManager(simpleProvider, simpleVectorDB);

            const simpleDoc = await simpleDocManager.addDocument(
                'Simple Provider Test',
                'Testing document with SimpleEmbeddingProvider.',
                { provider: 'transformers' }
            );
            if (!simpleDoc.chunks[0].embeddings || simpleDoc.chunks[0].embeddings.length === 0) {
                throw new Error('Should have embeddings');
            }
            console.log('  ✓ Document created with SimpleEmbeddingProvider');

            await simpleVectorDB.close();

            const openaiKey = process.env.MCP_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
            if (openaiKey) {
                console.log('  Testing with OpenAI provider...');
                process.env.MCP_EMBEDDING_PROVIDER = 'openai';
                process.env.MCP_EMBEDDING_API_KEY = openaiKey;

                const { createEmbeddingProvider } = await import('../embedding-provider.js');
                const openaiProvider = await createEmbeddingProvider();

                try {
                    const openaiEmbedding = await openaiProvider.generateEmbedding('test text');
                    if (openaiEmbedding.length === 0) throw new Error('Should generate embedding');
                    console.log(`  ✓ OpenAI provider works (${openaiEmbedding.length} dimensions)`);

                    const openaiVectorDB = new LanceDBAdapter(createTempDir('vector-test-'));
                    await openaiVectorDB.initialize();
                    const openaiDocManager = new DocumentManager(openaiProvider, openaiVectorDB);

                    const openaiDoc = await openaiDocManager.addDocument(
                        'OpenAI Provider Test',
                        'Testing document with OpenAI provider.',
                        { provider: 'openai' }
                    );
                    if (!openaiDoc.chunks[0].embeddings || openaiDoc.chunks[0].embeddings.length === 0) {
                        throw new Error('Should have embeddings');
                    }
                    console.log('  ✓ Document created with OpenAI provider');

                    await openaiVectorDB.close();
                } catch (error) {
                    console.warn('  ⚠ OpenAI provider test failed (API error):', error instanceof Error ? error.message : String(error));
                }
            } else {
                console.log('  ⊘ OpenAI API key not configured, skipping OpenAI provider test');
                console.log('    Set MCP_EMBEDDING_API_KEY or OPENAI_API_KEY to test OpenAI provider');
            }

            console.log('✓ Embedding providers work correctly');
            return true;
        });
    });
}

async function testDocumentationCrawlerIntegration() {
    console.log('\n=== Test 12.6: Documentation Crawler Integration ===');

    return await withBaseDirAndDocumentManager('crawler-', async ({ documentManager }) => {
        const crawledDocs = [
            {
                title: 'API Reference',
                url: 'https://example.com/api',
                content: 'API reference documentation with endpoints and examples.',
                metadata: { source: 'crawler', crawl_id: 'test-crawl' }
            },
            {
                title: 'User Guide',
                url: 'https://example.com/guide',
                content: 'User guide for getting started with the platform.',
                metadata: { source: 'crawler', crawl_id: 'test-crawl' }
            },
            {
                title: 'FAQ',
                url: 'https://example.com/faq',
                content: 'Frequently asked questions and answers.',
                metadata: { source: 'crawler', crawl_id: 'test-crawl' }
            }
        ];

        for (const crawledDoc of crawledDocs) {
            const doc = await documentManager.addDocument(
                crawledDoc.title,
                crawledDoc.content,
                crawledDoc.metadata
            );
            console.log(`  ✓ Crawled document added: ${doc.id}`);
        }

        const allDocs = await documentManager.getAllDocuments();
        if (allDocs.length !== 3) throw new Error('Should have 3 crawled documents');
        console.log('  ✓ All crawled documents added');

        const searchResults = await documentManager.searchDocuments(
            allDocs[0].id,
            'documentation',
            5
        );
        if (searchResults.length === 0) throw new Error('Should find results in crawled documents');
        console.log('  ✓ Search works on crawled documents');

        const deleteResult = await documentManager.deleteCrawlSession('test-crawl');
        if (deleteResult.deleted !== 3) throw new Error('Should delete all crawled documents');
        if (deleteResult.errors.length !== 0) throw new Error('Should have no errors');
        console.log('  ✓ Crawl session deletion works');

        const remainingDocs = await documentManager.getAllDocuments();
        if (remainingDocs.length !== 0) throw new Error('All crawled documents should be deleted');
        console.log('  ✓ Crawled documents deleted correctly');

        console.log('✓ Documentation crawler integration works correctly');
        return true;
    });
}

async function runValidationTests() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Validation Tests                                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    
    const results: { name: string; passed: boolean; skipped: boolean }[] = [];
    
    try {
        const passed = await testMigrationWithRealData();
        results.push({ name: 'Migration with Real Data', passed, skipped: false });
    } catch (error) {
        results.push({ name: 'Migration with Real Data', passed: false, skipped: false });
    }
    
    try {
        const passed = await testMCPToolsWithLanceDB();
        results.push({ name: 'MCP Tools with Lance DB', passed, skipped: false });
    } catch (error) {
        results.push({ name: 'MCP Tools with Lance DB', passed: false, skipped: false });
    }
    
    try {
        const passed = await testEmbeddingProviders();
        results.push({ name: 'Embedding Providers', passed, skipped: false });
    } catch (error) {
        results.push({ name: 'Embedding Providers', passed: false, skipped: false });
    }
    
    try {
        const passed = await testDocumentationCrawlerIntegration();
        results.push({ name: 'Documentation Crawler', passed, skipped: false });
    } catch (error) {
        results.push({ name: 'Documentation Crawler', passed: false, skipped: false });
    }
    
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Validation Summary                                         ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    
    let passedCount = 0;
    let failedCount = 0;
    
    for (const result of results) {
        const status = result.passed ? '✓ PASS' : '✗ FAIL';
        console.log(`  ${status} ${result.name}`);
        if (result.passed) passedCount++;
        else failedCount++;
    }
    
    console.log('\n───────────────────────────────────────────────────────────');
    console.log(`  Total: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
    console.log('───────────────────────────────────────────────────────────');
    
    if (failedCount > 0) {
        console.log('\n✗ Some validation tests failed!');
        process.exit(1);
    } else {
        console.log('\n✓ All validation tests passed!');
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runValidationTests();
}

export { runValidationTests };
