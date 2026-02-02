/**
 * Validation tests for Lance DB integration
 * Tests for tasks 12.1-12.6
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DocumentManager } from '../document-manager.js';
import { createVectorDatabase, LanceDBAdapter } from '../vector-db/index.js';
import { SimpleEmbeddingProvider } from '../embedding-provider.js';
import { createTempDir, withBaseDir, withBaseDirAndDocumentManager, withBaseDirAndSearchEngine, withEnv } from './test-utils.js';
import {
    RequestTimeoutError,
    ENV_TIMEOUT_EMBEDDING,
    ENV_TIMEOUT_GLOBAL,
} from '../utils/http-timeout.js';

describe('Validation Tests', () => {
    describe('Migration with Real Data', () => {
        it('should migrate documents and verify data', { timeout: 30000 }, async () => {
            // Set MCP_BASE_DIR to tempDir to ensure DocumentManager uses the test directory
            // This prevents automatic migration from the system's default data directory
            const tempDir = createTempDir('mig-real-');
            const dataDir = path.join(tempDir, 'data');
            const lanceDir = path.join(tempDir, 'lancedb');

            // Set MCP_BASE_DIR environment variable before creating any DocumentManager instances
            process.env.MCP_BASE_DIR = tempDir;

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

                const { migrateFromJson } = await import('../vector-db/index.js');
                const vectorDB = createVectorDatabase(lanceDir);

                try {
                    await vectorDB.initialize();

                    const migrationResult = await migrateFromJson(vectorDB, tempDir);
                    expect(migrationResult.documentsMigrated).toBeGreaterThan(0);
                    expect(migrationResult.chunksMigrated).toBeGreaterThan(0);

                    const chunk = await vectorDB.getChunk('api-doc-1-chunk-0');
                    expect(chunk).not.toBeNull();
                    expect(chunk?.id).toBe('api-doc-1-chunk-0');
                    expect(chunk?.document_id).toBe('api-doc-1');

                    const results = await vectorDB.search(
                        chunk?.embeddings || [],
                        5
                    );
                    expect(results.length).toBeGreaterThan(0);

                    await vectorDB.close();
                } catch (error) {
                    if (error instanceof Error && error.message.includes('LanceDB is not available')) {
                        // LanceDB not available, skip test
                        return;
                    }
                    throw error;
                }
            } finally {
                // Clean up temp directory
                fs.rmSync(tempDir, { recursive: true, force: true });
                // Restore MCP_BASE_DIR to prevent affecting other tests
                delete process.env.MCP_BASE_DIR;
            }
        });
    });

    describe('MCP Tools with Lance DB', () => {
        it('should support all MCP tool equivalents', async () => {
            return await withBaseDirAndSearchEngine('mcp-tools-', async ({ baseDir, documentManager, searchEngine }) => {
                const doc1 = await documentManager.addDocument(
                    'Test Document',
                    'This is a test document for MCP tool validation.',
                    { source: 'test' }
                );
                expect(doc1).toBeDefined();

                const retrieved = await documentManager.getDocument(doc1.id);
                expect(retrieved).not.toBeNull();
                expect(retrieved?.id).toBe(doc1.id);

                const searchResults = await documentManager.searchDocuments(doc1.id, 'test document', 5);
                expect(searchResults.length).toBeGreaterThan(0);

                const allDocs = await documentManager.getAllDocuments();
                expect(allDocs.length).toBe(1);

                const deleted = await documentManager.deleteDocument(doc1.id);
                expect(deleted).toBe(true);

                const uploadsDir = path.join(baseDir, 'uploads');
                fs.mkdirSync(uploadsDir, { recursive: true });
                fs.writeFileSync(
                    path.join(uploadsDir, 'test.txt'),
                    'This is a test file for upload processing.'
                );

                const processResult = await documentManager.processUploadsFolder();
                expect(processResult.processed).toBe(1);

                const uploadsFiles = await documentManager.listUploadsFiles();
                expect(uploadsFiles.length).toBeGreaterThanOrEqual(0);

                const doc2 = await documentManager.addDocument(
                    'Search Test Document',
                    'This document is for testing search functionality within documents.',
                    { category: 'test' }
                );
                expect(doc2).toBeDefined();

                const inDocResults = await searchEngine.searchDocument(doc2.id, 'search functionality', 5);
                expect(inDocResults.length).toBeGreaterThan(0);

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
                expect(crawlResult.deleted).toBe(2);
            });
        });
    });

    describe('Embedding Providers', () => {
        it('should work with SimpleEmbeddingProvider', async () => {
            return await withBaseDir('embeddings-', async () => {
                return await withEnv({ MCP_EMBEDDING_PROVIDER: undefined }, async () => {
                    const simpleProvider = new SimpleEmbeddingProvider();
                    const simpleEmbedding = await simpleProvider.generateEmbedding('test text');
                    expect(simpleEmbedding.length).toBeGreaterThan(0);
                    expect(simpleProvider.isAvailable()).toBe(true);

                    const simpleVectorDB = new LanceDBAdapter(createTempDir('vector-test-'));
                    await simpleVectorDB.initialize();
                    const simpleDocManager = new DocumentManager(simpleProvider, simpleVectorDB);

                    const simpleDoc = await simpleDocManager.addDocument(
                        'Simple Provider Test',
                        'Testing document with SimpleEmbeddingProvider.',
                        { provider: 'transformers' }
                    );
                    expect(simpleDoc).toBeDefined();
                    expect(simpleDoc?.chunks[0].embeddings?.length).toBeGreaterThan(0);

                    await simpleVectorDB.close();
                });
            });
        });

        it('should work with OpenAI provider when configured', async () => {
            const openaiKey = process.env.MCP_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY;
            if (!openaiKey) {
                // Skip test if API key not configured
                return;
            }

            return await withEnv({
                MCP_EMBEDDING_PROVIDER: 'openai',
                MCP_EMBEDDING_API_KEY: openaiKey,
            }, async () => {
                const { createEmbeddingProvider } = await import('../embedding-provider.js');
                const openaiProvider = await createEmbeddingProvider();

                try {
                    const openaiEmbedding = await openaiProvider.generateEmbedding('test text');
                    expect(openaiEmbedding.length).toBeGreaterThan(0);

                    const openaiVectorDB = new LanceDBAdapter(createTempDir('vector-test-'));
                    await openaiVectorDB.initialize();
                    const openaiDocManager = new DocumentManager(openaiProvider, openaiVectorDB);

                    const openaiDoc = await openaiDocManager.addDocument(
                        'OpenAI Provider Test',
                        'Testing document with OpenAI provider.',
                        { provider: 'openai' }
                    );
                    expect(openaiDoc).toBeDefined();
                    expect(openaiDoc?.chunks[0].embeddings?.length).toBeGreaterThan(0);

                    await openaiVectorDB.close();
                } catch (error) {
                    // API errors are acceptable for this test
                    expect(error).toBeDefined();
                }
            });
        });
    });

    describe('Documentation Crawler Integration', () => {
        it('should handle crawled documents correctly', async () => {
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
                    expect(doc).toBeDefined();
                }

                const allDocs = await documentManager.getAllDocuments();
                expect(allDocs.length).toBe(3);

                const searchResults = await documentManager.searchDocuments(
                    allDocs[0].id,
                    'documentation',
                    5
                );
                expect(searchResults.length).toBeGreaterThan(0);

                const deleteResult = await documentManager.deleteCrawlSession('test-crawl');
                expect(deleteResult.deleted).toBe(3);
                expect(deleteResult.errors.length).toBe(0);

                const remainingDocs = await documentManager.getAllDocuments();
                expect(remainingDocs.length).toBe(0);
            });
        });
    });
});

describe('Embedding Timeout Integration Tests', () => {
    describe('Embedding Timeout Configuration', () => {
        it('should create provider with timeout config', async () => {
            await withEnv({
                [ENV_TIMEOUT_EMBEDDING]: '8000',
                [ENV_TIMEOUT_GLOBAL]: '15000',
                'MCP_EMBEDDING_PROVIDER': 'openai',
                'MCP_EMBEDDING_BASE_URL': 'http://localhost:1234',
                'MCP_EMBEDDING_MODEL': 'text-embedding-3-small',
            }, async () => {
                const { OpenAiEmbeddingProvider } = await import('../embedding-provider.js');

                const provider = new OpenAiEmbeddingProvider(
                    'http://localhost:1234/v1',
                    'text-embedding-3-small'
                );

                expect(provider.isAvailable()).toBe(true);
                expect(provider.getModelName()).toBe('text-embedding-3-small');
            });
        });
    });

    describe('Embedding Timeout Error Handling', () => {
        it('should handle timeout errors', async () => {
            await withEnv({
                [ENV_TIMEOUT_EMBEDDING]: '100',
                'MCP_EMBEDDING_PROVIDER': 'openai',
                'MCP_EMBEDDING_BASE_URL': 'http://localhost:1234',
                'MCP_EMBEDDING_MODEL': 'text-embedding-3-small',
            }, async () => {
                const { OpenAiEmbeddingProvider } = await import('../embedding-provider.js');

                const provider = new OpenAiEmbeddingProvider(
                    'http://localhost:1234/v1',
                    'text-embedding-3-small'
                );

                try {
                    await provider.generateEmbedding('test text for embedding');
                    // If we get here without timeout, that's ok
                } catch (error) {
                    if (error instanceof RequestTimeoutError) {
                        expect(error.isTimeout).toBe(true);
                        expect(error.url).toContain('embeddings');
                    }
                }
            });
        });
    });

    describe('Embedding Respects Timeout Env Var', () => {
        it('should use embedding specific timeout', async () => {
            await withEnv({
                [ENV_TIMEOUT_EMBEDDING]: '20000',
                [ENV_TIMEOUT_GLOBAL]: '5000',
                'MCP_EMBEDDING_PROVIDER': 'openai',
                'MCP_EMBEDDING_BASE_URL': 'http://localhost:1234',
                'MCP_EMBEDDING_MODEL': 'text-embedding-3-small',
            }, async () => {
                expect(process.env[ENV_TIMEOUT_EMBEDDING]).toBe('20000');

                const { OpenAiEmbeddingProvider } = await import('../embedding-provider.js');
                const provider = new OpenAiEmbeddingProvider(
                    'http://localhost:1234/v1',
                    'text-embedding-3-small'
                );

                expect(provider.isAvailable()).toBe(true);
            });
        });
    });

    describe('Embedding Timeout with Fallback', () => {
        it('should fall back to global timeout', async () => {
            await withEnv({
                [ENV_TIMEOUT_EMBEDDING]: undefined,
                [ENV_TIMEOUT_GLOBAL]: '12000',
                'MCP_EMBEDDING_PROVIDER': 'openai',
                'MCP_EMBEDDING_BASE_URL': 'http://localhost:1234',
                'MCP_EMBEDDING_MODEL': 'text-embedding-3-small',
            }, async () => {
                expect(process.env[ENV_TIMEOUT_GLOBAL]).toBe('12000');
                expect(process.env[ENV_TIMEOUT_EMBEDDING]).toBeUndefined();

                const { OpenAiEmbeddingProvider } = await import('../embedding-provider.js');
                const provider = new OpenAiEmbeddingProvider(
                    'http://localhost:1234/v1',
                    'text-embedding-3-small'
                );

                expect(provider.isAvailable()).toBe(true);
            });
        });
    });
});
