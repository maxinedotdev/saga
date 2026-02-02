/**
 * Integration tests for DocumentManager with Vector Database
 * Tests for integration with Lance DB (tasks 9.4, 9.5)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createVectorDatabase } from '../vector-db/index.js';
import { withBaseDirAndDocumentManager, withTempDir } from './test-utils.js';

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

    describe('Migration Tests', () => {
        it('should migrate documents from JSON to vector DB', { timeout: 60000 }, async () => {
            await withTempDir('migrate-test-', async (tempDir) => {
                const dataDir = path.join(tempDir, 'data');
                const lanceDir = path.join(tempDir, 'lancedb');

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

                const { migrateFromJson } = await import('../vector-db/index.js');
                const vectorDB = createVectorDatabase(lanceDir);

                try {
                    await vectorDB.initialize();

                    const migrationResult = await migrateFromJson(vectorDB, tempDir);
                    expect(migrationResult.success).toBe(true);
                    expect(migrationResult.documentsMigrated).toBe(10);
                    expect(migrationResult.chunksMigrated).toBe(10);
                    expect(migrationResult.errors.length).toBe(0);

                    const chunk = await vectorDB.getChunk('doc-0-chunk-0');
                    expect(chunk).not.toBeNull();
                    expect(chunk?.id).toBe('doc-0-chunk-0');

                    for (let i = 10; i < 50; i++) {
                        createTestDocument(
                            `doc-${i}`,
                            `Test Document ${i}`,
                            `This is test document ${i} with sample content for migration testing.`
                        );
                    }

                    const migrationResult2 = await migrateFromJson(vectorDB, tempDir);
                    expect(migrationResult2.success).toBe(true);
                    expect(migrationResult2.documentsMigrated).toBe(40);

                    for (let i = 50; i < 100; i++) {
                        createTestDocument(
                            `doc-${i}`,
                            `Test Document ${i}`,
                            `This is test document ${i} with sample content for migration testing.`
                        );
                    }

                    const migrationResult3 = await migrateFromJson(vectorDB, tempDir);
                    expect(migrationResult3.success).toBe(true);
                    expect(migrationResult3.documentsMigrated).toBe(50);

                    await vectorDB.close();
                } catch (error) {
                    if (error instanceof Error && error.message.includes('LanceDB is not available')) {
                        // LanceDB not available, skip test
                        return;
                    }
                    throw error;
                }
            });
        });
    });
});
