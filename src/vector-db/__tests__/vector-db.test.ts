/**
 * Unit tests for Vector Database components
 * Tests for LanceDBV1
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { LanceDBV1, createVectorDatabase } from '../index.js';
import { ChunkV1, CodeBlockV1 } from '../../types/database-v1.js';
import {
    createTestChunk,
    createTestCodeBlock,
    createTestEmbedding,
    isLanceDbAvailable,
    withEnv,
    withVectorDb,
    withTempDir
} from '../../__tests__/test-utils.js';

// Test data
const testChunks: Array<Omit<ChunkV1, 'created_at'>> = [
    createTestChunk('chunk1', 'doc1', 'This is a test document about artificial intelligence.', createTestEmbedding(1)),
    createTestChunk('chunk2', 'doc1', 'Machine learning is a subset of AI.', createTestEmbedding(2)),
    createTestChunk('chunk3', 'doc2', 'Natural language processing is important.', createTestEmbedding(3)),
    createTestChunk('chunk4', 'doc2', 'Vector databases enable efficient similarity search.', createTestEmbedding(4)),
    createTestChunk('chunk5', 'doc3', 'Embeddings represent text as numerical vectors.', createTestEmbedding(5))
];

const testCodeBlocks: Array<Omit<CodeBlockV1, 'created_at'>> = [
    createTestCodeBlock('cb1', 'doc1', 'block-1', 'javascript', 'const x = 1;\nconsole.log(x);', createTestEmbedding(10)),
    createTestCodeBlock('cb2', 'doc1', 'block-1', 'python', 'x = 1\nprint(x)', createTestEmbedding(11)),
    createTestCodeBlock('cb3', 'doc1', 'block-2', 'typescript', 'const x: number = 1;\nconsole.log(x);', createTestEmbedding(12)),
    createTestCodeBlock('cb4', 'doc2', 'block-3', 'python', 'def hello():\n    print("Hello")', createTestEmbedding(13)),
    createTestCodeBlock('cb5', 'doc2', 'block-4', 'javascript', 'function hello() {\n    console.log("Hello");\n}', createTestEmbedding(14))
];

describe('Vector Database Unit Tests', () => {
    let lanceDbAvailable: boolean;

    beforeAll(async () => {
        lanceDbAvailable = await isLanceDbAvailable();
    });

    const testEmbeddingDim = 384;

    describe('LanceDBV1', () => {
        it('should initialize and add chunks', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withTempDir('lance-test-', async (tempDir) => {
                const lanceDB = new LanceDBV1(tempDir, { embeddingDim: testEmbeddingDim });
                
                // Test initialization
                await lanceDB.initialize();
                expect(lanceDB.isInitialized()).toBe(true);
                
                // Test addChunks
                await lanceDB.addChunks([testChunks[0], testChunks[1]]);
                let chunk = await lanceDB.getChunk('chunk1');
                expect(chunk).not.toBeNull();
                expect(chunk?.id).toBe('chunk1');
                
                await lanceDB.close();
            });
        });

        it('should remove chunks', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withTempDir('lance-test-', async (tempDir) => {
                const lanceDB = new LanceDBV1(tempDir, { embeddingDim: testEmbeddingDim });
                await lanceDB.initialize();
                
                await lanceDB.addChunks([testChunks[0]]);
                await lanceDB.removeChunks('doc1');
                const chunk = await lanceDB.getChunk('chunk1');
                expect(chunk).toBeNull();
                
                await lanceDB.close();
            });
        });

        it('should search and return results', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withTempDir('lance-test-', async (tempDir) => {
                const lanceDB = new LanceDBV1(tempDir, { embeddingDim: testEmbeddingDim });
                await lanceDB.initialize();
                
                await lanceDB.addChunks(testChunks);
                const results = await lanceDB.search(createTestEmbedding(1), 2);
                expect(results.length).toBeGreaterThan(0);
                expect(results.every(r => r.score >= 0 && r.score <= 1)).toBe(true);
                
                await lanceDB.close();
            });
        });

        it('should search with filter', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withTempDir('lance-test-', async (tempDir) => {
                const lanceDB = new LanceDBV1(tempDir, { embeddingDim: testEmbeddingDim });
                await lanceDB.initialize();
                
                await lanceDB.addChunks(testChunks);
                const filteredResults = await lanceDB.search(createTestEmbedding(1), 5, "document_id = 'doc2'");
                expect(filteredResults.every(r => r.chunk.document_id === 'doc2')).toBe(true);
                
                await lanceDB.close();
            });
        });

        it('should get chunk by ID', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withTempDir('lance-test-', async (tempDir) => {
                const lanceDB = new LanceDBV1(tempDir, { embeddingDim: testEmbeddingDim });
                await lanceDB.initialize();
                
                await lanceDB.addChunks([testChunks[2]]);
                const chunk = await lanceDB.getChunk('chunk3');
                expect(chunk).not.toBeNull();
                expect(chunk?.content).toBe(testChunks[2].content);
                
                await lanceDB.close();
            });
        });
    });

    describe('Factory Function', () => {
        it('should create LanceDBV1', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withEnv({ MCP_EMBEDDING_DIM: String(testEmbeddingDim) }, async () => {
                await withTempDir('factory-test-', async (tempDir) => {
                    const lanceDB = createVectorDatabase(tempDir);
                    expect(lanceDB).toBeInstanceOf(LanceDBV1);
                    await lanceDB.close();
                });
            });
        });

        it('should create LanceDBV1 with default path', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withEnv({ MCP_EMBEDDING_DIM: String(testEmbeddingDim) }, async () => {
                const defaultDB = createVectorDatabase();
                expect(defaultDB).toBeInstanceOf(LanceDBV1);
                await defaultDB.close();
            });
        });

        it('should work correctly with factory-created instance', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withEnv({ MCP_EMBEDDING_DIM: String(testEmbeddingDim) }, async () => {
                await withTempDir('factory-test-', async (tempDir) => {
                    const lanceDB = createVectorDatabase(tempDir);
                    await lanceDB.initialize();
                    await lanceDB.addChunks([testChunks[0]]);
                    const chunk = await lanceDB.getChunk('chunk1');
                    expect(chunk).not.toBeNull();
                    await lanceDB.close();
                });
            });
        });
    });

    describe('Error Handling', () => {
        it('should throw error when not initialized', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withTempDir('error-test-', async (tempDir) => {
                const lanceDB = new LanceDBV1(tempDir, { embeddingDim: testEmbeddingDim });
                
                await expect(lanceDB.addChunks([testChunks[0]])).rejects.toThrow('not initialized');
            });
        });

        it('should return null for non-existent chunk', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withTempDir('error-test-', async (tempDir) => {
                const lanceDB = new LanceDBV1(tempDir, { embeddingDim: testEmbeddingDim });
                await lanceDB.initialize();
                
                const chunk = await lanceDB.getChunk('non-existent');
                expect(chunk).toBeNull();
                
                await lanceDB.close();
            });
        });

        it('should return empty results for empty database', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withTempDir('error-test-', async (tempDir) => {
                const lanceDB = new LanceDBV1(tempDir, { embeddingDim: testEmbeddingDim });
                await lanceDB.initialize();
                
                const emptyResults = await lanceDB.search(createTestEmbedding(1), 5);
                expect(emptyResults.length).toBe(0);
                
                await lanceDB.close();
            });
        });

        it('should only return chunks with embeddings', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withTempDir('error-test-', async (tempDir) => {
                const lanceDB = new LanceDBV1(tempDir, { embeddingDim: testEmbeddingDim });
                await lanceDB.initialize();
                
                const chunkWithoutEmbedding = createTestChunk('no-embed', 'doc1', 'No embedding here');
                await lanceDB.addChunks([chunkWithoutEmbedding, testChunks[0]]);
                const results = await lanceDB.search(createTestEmbedding(1), 5);
                expect(results.length).toBe(1);
                
                await lanceDB.close();
            });
        });
    });

    describe('Code Block Extraction and Storage', () => {
        it('should add and retrieve code blocks', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withVectorDb(async (lanceDB) => {
                await lanceDB.addCodeBlocks([testCodeBlocks[0], testCodeBlocks[1], testCodeBlocks[2]]);

                const doc1CodeBlocks = await lanceDB.getCodeBlocksByDocument('doc1');
                expect(doc1CodeBlocks.length).toBe(3);
                expect(doc1CodeBlocks.every(cb => cb.document_id === 'doc1')).toBe(true);
            }, 'codeblock-test-');
        });

        it('should sort code blocks by block_index', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withVectorDb(async (lanceDB) => {
                await lanceDB.addCodeBlocks([testCodeBlocks[0], testCodeBlocks[1], testCodeBlocks[2]]);

                const doc1CodeBlocks = await lanceDB.getCodeBlocksByDocument('doc1');
                for (let i = 0; i < doc1CodeBlocks.length - 1; i++) {
                    expect(doc1CodeBlocks[i].block_index).toBeLessThanOrEqual(doc1CodeBlocks[i + 1].block_index);
                }
            }, 'codeblock-test-');
        });

        it('should have normalized language tags', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withVectorDb(async (lanceDB) => {
                await lanceDB.addCodeBlocks([testCodeBlocks[0], testCodeBlocks[1], testCodeBlocks[2]]);

                const doc1CodeBlocks = await lanceDB.getCodeBlocksByDocument('doc1');
                const jsBlock = doc1CodeBlocks.find(cb => cb.language === 'javascript');
                expect(jsBlock).toBeDefined();
                const tsBlock = doc1CodeBlocks.find(cb => cb.language === 'typescript');
                expect(tsBlock).toBeDefined();
            }, 'codeblock-test-');
        });
    });

    describe('Code Block Search with Language Filtering', () => {
        it('should search without language filter', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withVectorDb(async (lanceDB) => {
                await lanceDB.addCodeBlocks(testCodeBlocks);

                const allResults = await lanceDB.searchCodeBlocks(createTestEmbedding(10), 10);
                expect(allResults.length).toBeGreaterThan(0);
                expect(allResults.every(r => r.score >= 0 && r.score <= 1)).toBe(true);
            }, 'codeblock-search-test-');
        });

        it('should search with language filter for javascript', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withVectorDb(async (lanceDB) => {
                await lanceDB.addCodeBlocks(testCodeBlocks);

                const jsResults = await lanceDB.searchCodeBlocks(createTestEmbedding(10), 10, 'javascript');
                expect(jsResults.every(r => r.code_block.language === 'javascript')).toBe(true);
            }, 'codeblock-search-test-');
        });

        it('should search with language filter for python', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withVectorDb(async (lanceDB) => {
                await lanceDB.addCodeBlocks(testCodeBlocks);

                const pythonResults = await lanceDB.searchCodeBlocks(createTestEmbedding(10), 10, 'python');
                expect(pythonResults.every(r => r.code_block.language === 'python')).toBe(true);
            }, 'codeblock-search-test-');
        });

        it('should handle case-insensitive language matching', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withVectorDb(async (lanceDB) => {
                await lanceDB.addCodeBlocks(testCodeBlocks);

                const jsResultsUpperCase = await lanceDB.searchCodeBlocks(createTestEmbedding(10), 10, 'JavaScript');
                expect(jsResultsUpperCase.every(r => r.code_block.language === 'javascript')).toBe(true);
            }, 'codeblock-search-test-');
        });

        it('should return empty results for non-existent language', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withVectorDb(async (lanceDB) => {
                await lanceDB.addCodeBlocks(testCodeBlocks);

                const emptyResults = await lanceDB.searchCodeBlocks(createTestEmbedding(10), 10, 'rust');
                expect(emptyResults.length).toBe(0);
            }, 'codeblock-search-test-');
        });
    });

    describe('Code Block Multi-Language Variant Handling', () => {
        it('should handle multi-language variants', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withVectorDb(async (lanceDB) => {
                const multiLangBlocks: Array<Omit<CodeBlockV1, 'created_at'>> = [
                    createTestCodeBlock('ml1', 'doc1', 'tabbed-1', 'javascript', 'const x = 1;', createTestEmbedding(20)),
                    createTestCodeBlock('ml2', 'doc1', 'tabbed-1', 'python', 'x = 1', createTestEmbedding(21)),
                    createTestCodeBlock('ml3', 'doc1', 'tabbed-1', 'typescript', 'const x: number = 1;', createTestEmbedding(22)),
                ];

                await lanceDB.addCodeBlocks(multiLangBlocks);

                const docBlocks = await lanceDB.getCodeBlocksByDocument('doc1');
                expect(docBlocks.length).toBe(3);

                const groupedByBlockId = docBlocks.reduce((acc, cb) => {
                    if (!acc[cb.block_id]) {
                        acc[cb.block_id] = [];
                    }
                    acc[cb.block_id].push(cb);
                    return acc;
                }, {} as Record<string, CodeBlockV1[]>);

                expect(groupedByBlockId['tabbed-1']?.length).toBe(3);

                const languages = groupedByBlockId['tabbed-1']!.map(cb => cb.language);
                expect(languages).toContain('javascript');
                expect(languages).toContain('python');
                expect(languages).toContain('typescript');
            }, 'codeblock-multilang-test-');
        });

        it('should return variants in search results', async () => {
            if (!lanceDbAvailable) {
                return;
            }

            await withVectorDb(async (lanceDB) => {
                const multiLangBlocks: Array<Omit<CodeBlockV1, 'created_at'>> = [
                    createTestCodeBlock('ml1', 'doc1', 'tabbed-1', 'javascript', 'const x = 1;', createTestEmbedding(20)),
                    createTestCodeBlock('ml2', 'doc1', 'tabbed-1', 'python', 'x = 1', createTestEmbedding(21)),
                    createTestCodeBlock('ml3', 'doc1', 'tabbed-1', 'typescript', 'const x: number = 1;', createTestEmbedding(22)),
                ];

                await lanceDB.addCodeBlocks(multiLangBlocks);

                const searchResults = await lanceDB.searchCodeBlocks(createTestEmbedding(20), 10);
                const tabbedBlockResults = searchResults.filter(r => r.code_block.block_id === 'tabbed-1');
                expect(tabbedBlockResults.length).toBeGreaterThan(0);
            }, 'codeblock-multilang-test-');
        });
    });
});
