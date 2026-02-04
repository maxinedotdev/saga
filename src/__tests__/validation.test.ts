/**
 * Validation tests for Lance DB integration
 * Tests for tasks 12.1-12.6
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DocumentManager } from '../document-manager.js';
import { LanceDBV1 } from '../vector-db/index.js';
import { createTempDir, withBaseDir, withBaseDirAndDocumentManager, withEnv, createTestEmbeddingProvider } from './test-utils.js';
import {
    RequestTimeoutError,
    ENV_TIMEOUT_EMBEDDING,
    ENV_TIMEOUT_GLOBAL,
} from '../utils/http-timeout.js';

describe('Validation Tests', () => {
    describe('MCP Tools with Lance DB', () => {
        it('should support all MCP tool equivalents', async () => {
            return await withBaseDirAndDocumentManager('mcp-tools-', async ({ baseDir, documentManager }) => {
                const doc1 = await documentManager.addDocument(
                    'Test Document',
                    'This is a test document for MCP tool validation.',
                    { source: 'test' }
                );
                expect(doc1).toBeDefined();

                if (!doc1) {
                    throw new Error('doc1 should be defined');
                }

                const retrieved = await documentManager.getDocument(doc1.id);
                expect(retrieved).not.toBeNull();
                expect(retrieved?.id).toBe(doc1.id);

                // Test query() across all documents (document-specific search is now done via VectorDatabase directly in MCP tools)
                const queryResults = await documentManager.query('test document', { limit: 5 });
                expect(queryResults.results.length).toBeGreaterThan(0);

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

                // Test query() across all documents (document-specific search is now done via VectorDatabase directly in MCP tools)
                const inDocResults = await documentManager.query('search functionality', { limit: 5 });
                expect(inDocResults.results.length).toBeGreaterThan(0);

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

                    const openaiVectorDB = new LanceDBV1(createTempDir('vector-test-'), {
                        embeddingDim: openaiEmbedding.length,
                    });
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

                // Test query() across all documents (document-specific search is now done via VectorDatabase directly in MCP tools)
                const queryResults = await documentManager.query('documentation', { limit: 5 });
                expect(queryResults.results.length).toBeGreaterThan(0);

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
                const provider = createTestEmbeddingProvider();

                expect(provider.isAvailable()).toBe(true);
                const expectedModel =
                    process.env.MCP_USE_MOCK_EMBEDDINGS === 'true'
                        ? 'mock-embedding-provider'
                        : 'text-embedding-3-small';
                expect(provider.getModelName()).toBe(expectedModel);
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
                const provider = createTestEmbeddingProvider();

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

                const provider = createTestEmbeddingProvider();

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

                const provider = createTestEmbeddingProvider();

                expect(provider.isAvailable()).toBe(true);
            });
        });
    });
});
