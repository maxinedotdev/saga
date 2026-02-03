/**
 * Integration tests for DocumentManager with Vector Database
 * Tests for integration with Lance DB (tasks 9.4, 9.5)
 */

import { describe, it, expect } from 'vitest';
import { withBaseDirAndDocumentManager } from './test-utils.js';

describe('Integration Tests', () => {
    describe('DocumentManager Integration', () => {
        it('should create and manage documents', async () => {
            await withBaseDirAndDocumentManager('doc-test-', async ({ documentManager, vectorDb }) => {
                const doc1 = await documentManager.addDocument(
                    'Test Document 1',
                    'This is a test document about vector databases and semantic search.',
                    { source: 'test' }
                );

                expect(doc1).toBeDefined();
                expect(doc1?.id).toBeDefined();
                expect(doc1?.title).toBe('Test Document 1');
                expect(doc1?.chunks.length).toBeGreaterThan(0);
                expect(doc1?.chunks[0].embeddings?.length).toBeGreaterThan(0);

                const doc2 = await documentManager.addDocument(
                    'Test Document 2',
                    'Machine learning models use embeddings to represent text as vectors.',
                    { source: 'test' }
                );
                expect(doc2).toBeDefined();

                const doc3 = await documentManager.addDocument(
                    'Test Document 3',
                    'Vector databases enable efficient similarity search for large datasets.',
                    { source: 'test' }
                );
                expect(doc3).toBeDefined();

                if (!doc1) {
                    throw new Error('doc1 should be defined');
                }

                const retrieved = await documentManager.getDocument(doc1.id);
                expect(retrieved).not.toBeNull();
                expect(retrieved?.id).toBe(doc1.id);
                expect(retrieved?.title).toBe(doc1.title);

                // Test query() across all documents (document-specific search is now done via VectorDatabase directly in MCP tools)
                const queryResults = await documentManager.query('vector databases', { limit: 3 });
                expect(queryResults.results.length).toBeGreaterThan(0);
                expect(queryResults.results.every(r => r.score >= 0 && r.score <= 1)).toBe(true);

                const allDocs = await documentManager.getAllDocuments();
                expect(allDocs.length).toBe(3);

                const deleted = await documentManager.deleteDocument(doc1.id);
                expect(deleted).toBe(true);

                const deletedDoc = await documentManager.getDocument(doc1.id);
                expect(deletedDoc).toBeNull();

                const chunk = await vectorDb.getChunk(doc1.chunks[0].id);
                expect(chunk).toBeNull();

                const crawlDocs = [];
                for (let i = 0; i < 5; i++) {
                    const doc = await documentManager.addDocument(
                        `Crawl Doc ${i}`,
                        `Content for document ${i} in crawl session.`,
                        { crawl_id: 'test-crawl-1' }
                    );
                    expect(doc).toBeDefined();
                    if (doc) {
                        crawlDocs.push(doc.id);
                    }
                }

                const result = await documentManager.deleteCrawlSession('test-crawl-1');
                expect(result.deleted).toBe(5);
                expect(result.errors.length).toBe(0);

                for (const id of crawlDocs) {
                    const doc = await documentManager.getDocument(id);
                    expect(doc).toBeNull();
                }
            });
        });
    });
});
