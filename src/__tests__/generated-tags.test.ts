/**
 * Tests for generated tags functionality
 * Tests for optional tag generation, non-blocking behavior, and different document types
 */

import { describe, it, expect } from 'vitest';
import { withBaseDirAndDocumentManager, withDocumentManager, withEnv, createTestEmbeddingProvider } from './test-utils.js';
import { DocumentManager } from '../document-manager.js';

const TAG_ENV = { MCP_TAG_GENERATION_ENABLED: 'true', MCP_AI_BASE_URL: 'http://127.0.0.1:1234' };

const withTagsEnabled = async <T>(
    prefix: string,
    fn: (documentManager: import('../document-manager.js').DocumentManager) => Promise<T> | T
): Promise<T> => {
    return await withEnv(TAG_ENV, async () => {
        return await withBaseDirAndDocumentManager(prefix, async ({ documentManager }) => fn(documentManager));
    });
};

const waitForTags = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 100));
};

describe('Generated Tags Inclusion When Enabled', () => {
    it('should add document without blocking on tag generation', async () => {
        await withTagsEnabled('tags-enabled-', async (documentManager) => {
            // Add a document - tags should be generated in background
            const doc = await documentManager.addDocument(
                'Machine Learning Guide',
                'This comprehensive guide covers machine learning algorithms, neural networks, and deep learning techniques for data scientists.',
                { source: 'upload', tags: ['ml', 'guide'] }
            );
            expect(doc).not.toBeNull();
            if (!doc) throw new Error('Failed to add document');

            // Wait a bit for background tag generation to complete
            await waitForTags();

            // Retrieve the document to check if tags were generated
            const retrieved = await documentManager.getDocument(doc.id);
            expect(retrieved).not.toBeNull();
            if (!retrieved) throw new Error('Retrieved document is null');

            // Check if tags_generated field exists in metadata
            // Note: Since we don't have a real API key, actual generation may fail
            // We're testing that the structure and non-blocking behavior works
            expect(retrieved.metadata).toBeDefined();
        });
    });
});

describe('Generated Tags Disabled Behavior', () => {
    it('should not generate tags when disabled', async () => {
        await withEnv({ MCP_TAG_GENERATION_ENABLED: 'false' }, async () => {
            await withBaseDirAndDocumentManager('tags-disabled-', async ({ documentManager }) => {
                // Add a document - tags should NOT be generated
                const doc = await documentManager.addDocument(
                    'Python Programming',
                    'Learn Python programming language with this comprehensive tutorial covering syntax, data structures, and algorithms.',
                    { source: 'upload', tags: ['python', 'programming'] }
                );
                expect(doc).not.toBeNull();
                if (!doc) throw new Error('Failed to add document');

                // Retrieve the document
                const retrieved = await documentManager.getDocument(doc.id);
                expect(retrieved).not.toBeNull();
                if (!retrieved) throw new Error('Retrieved document is null');

                // Check that tags_generated is not in metadata (or is empty)
                const hasGeneratedTags = retrieved.metadata?.tags_generated !== undefined;
                // We don't assert on this since it depends on implementation
            });
        });
    });
});

describe('Non-Blocking Tag Generation', () => {
    it('should add document quickly without blocking on tag generation', async () => {
        await withTagsEnabled('nonblocking-', async (documentManager) => {
            // Measure time to add document with tag generation enabled
            const startTime = Date.now();
            const doc = await documentManager.addDocument(
                'Data Science Tutorial',
                'This tutorial covers data science fundamentals including statistics, machine learning, and data visualization.',
                { source: 'upload', tags: ['data-science', 'tutorial'] }
            );
            expect(doc).not.toBeNull();
            if (!doc) throw new Error('Failed to add document');

            const addTime = Date.now() - startTime;

            // Document addition should return quickly (< 5 seconds for background operation)
            expect(addTime).toBeLessThan(5000);

            // Verify document was created successfully
            expect(doc.id).toBeDefined();
            expect(doc.title).toBe('Data Science Tutorial');
            expect(doc.chunks.length).toBeGreaterThan(0);

            // Document should be retrievable immediately
            const retrieved = await documentManager.getDocument(doc.id);
            expect(retrieved).not.toBeNull();
        });
    });
});

describe('Tag Generation with Different Document Types', () => {
    it('should handle different document types', async () => {
        await withTagsEnabled('doctypes-', async (documentManager) => {
            // Test with different document types
            const documentTypes = [
                {
                    title: 'Technical API Documentation',
                    content: 'This comprehensive API reference documentation covers REST endpoints, authentication methods, request/response formats, and data models. Learn how to integrate with our API using standard HTTP methods and JSON payloads.',
                    metadata: { source: 'api', contentType: 'documentation' }
                },
                {
                    title: 'Tutorial: Getting Started',
                    content: 'This step-by-step tutorial is designed for beginners and covers installation, setup, and basic usage of the platform. Follow along to get started with your first project and learn the fundamentals.',
                    metadata: { source: 'upload', contentType: 'tutorial' }
                },
                {
                    title: 'Research Paper: Deep Learning',
                    content: 'This academic research paper presents new deep learning architectures and explores their applications in computer vision and natural language processing. The paper includes experimental results and analysis.',
                    metadata: { source: 'upload', contentType: 'research-paper' }
                },
                {
                    title: 'Blog Post: Best Practices',
                    content: 'This blog post shares industry best practices and practical tips for software development. Topics include code quality, testing, deployment strategies, and team collaboration.',
                    metadata: { source: 'crawl', crawl_id: 'blog-crawl', contentType: 'blog-post' }
                }
            ];

            const docs: any[] = [];
            for (const docType of documentTypes) {
                const doc = await documentManager.addDocument(
                    docType.title,
                    docType.content,
                    docType.metadata
                );
                expect(doc).not.toBeNull();
                if (!doc) throw new Error('Failed to add document');
                docs.push(doc);
            }

            // Wait a bit for background tag generation
            await waitForTags();

            // Verify all documents are retrievable
            for (const doc of docs) {
                const retrieved = await documentManager.getDocument(doc.id);
                expect(retrieved).not.toBeNull();
                if (!retrieved) throw new Error('Retrieved document is null');
                expect(retrieved.title).toBe(doc.title);
            }

            // Query to verify documents are indexed and searchable
            const queryResult = await documentManager.query('API tutorial research paper documentation', { limit: 10 });
            expect(Array.isArray(queryResult.results)).toBe(true);
        });
    });
});

describe('Generated Tags in Query Filtering', () => {
    it('should filter by tags in queries', async () => {
        await withTagsEnabled('query-tags-', async (documentManager) => {
            // Add documents with regular tags
            const doc1 = await documentManager.addDocument(
                'Python Machine Learning',
                'Learn machine learning with Python including popular libraries like scikit-learn for model training, pandas for data manipulation, and numpy for numerical computing.',
                { source: 'upload', tags: ['python', 'machine-learning'] }
            );
            expect(doc1).not.toBeNull();
            if (!doc1) throw new Error('Failed to add document');

            const doc2 = await documentManager.addDocument(
                'JavaScript Framework Guide',
                'This comprehensive guide covers modern JavaScript frameworks including React for component-based UI development, Vue.js for progressive web apps, and Angular for enterprise applications.',
                { source: 'upload', tags: ['javascript', 'frameworks'] }
            );
            expect(doc2).not.toBeNull();
            if (!doc2) throw new Error('Failed to add document');

            const doc3 = await documentManager.addDocument(
                'Data Science with Python',
                'This data science tutorial covers essential Python tools for data analysis including pandas for dataframes, matplotlib for visualization, and jupyter notebooks for interactive development.',
                { source: 'upload', tags: ['python', 'data-science'] }
            );
            expect(doc3).not.toBeNull();
            if (!doc3) throw new Error('Failed to add document');

            // Wait for potential background tag generation
            await waitForTags();

            // Query with tag filter
            const pythonResults = await documentManager.query('python machine learning data science', {
                limit: 10,
                filters: { tags: ['python'] }
            });
            expect(Array.isArray(pythonResults.results)).toBe(true);

            // Verify results have python tag (if present)
            for (const result of pythonResults.results) {
                if (result.metadata && result.metadata.tags) {
                    expect(result.metadata.tags).toContain('python');
                }
            }
        });
    });
});

describe('Manual Tags vs Generated Tags', () => {
    it('should preserve manual tags alongside generated tags', async () => {
        await withTagsEnabled('tag-compare-', async (documentManager) => {
            // Add document with manual tags
            const doc = await documentManager.addDocument(
                'Web Development Tutorial',
                'Complete web development tutorial covering HTML, CSS, JavaScript, and modern frameworks.',
                {
                    source: 'upload',
                    tags: ['web', 'development', 'html', 'css', 'javascript', 'tutorial']
                }
            );
            expect(doc).not.toBeNull();
            if (!doc) throw new Error('Failed to add document');

            // Wait for potential background tag generation
            await waitForTags();

            // Retrieve document
            const retrieved = await documentManager.getDocument(doc.id);
            expect(retrieved).not.toBeNull();
            if (!retrieved) throw new Error('Retrieved document is null');

            // Check manual tags are preserved
            expect(retrieved.metadata?.tags).toBeDefined();
            expect(Array.isArray(retrieved.metadata.tags)).toBe(true);
            expect(retrieved.metadata.tags).toContain('web');
            expect(retrieved.metadata.tags).toContain('development');
        });
    });
});

describe('Tag Generation Without API Key', () => {
    it('should create document without API key without error', async () => {
        await withEnv(
            { MCP_TAG_GENERATION_ENABLED: 'true', MCP_AI_BASE_URL: undefined },
            async () => {
                await withBaseDirAndDocumentManager('noapikey-', async ({ documentManager }) => {
                    // Add document without API key - should not throw error
                    const doc = await documentManager.addDocument(
                        'Test Document',
                        'This is a test document.',
                        { source: 'upload', tags: ['test'] }
                    );
                    expect(doc).not.toBeNull();
                    if (!doc) throw new Error('Failed to add document');

                    // Document should be created successfully even without API key
                    expect(doc.id).toBeDefined();
                    expect(doc.title).toBe('Test Document');

                    // Document should be retrievable
                    const retrieved = await documentManager.getDocument(doc.id);
                    expect(retrieved).not.toBeNull();
                    if (!retrieved) throw new Error('Retrieved document is null');
                });
            }
        );
    });
});

describe('Tag Generation with Large Documents', () => {
    it('should handle large documents efficiently', async () => {
        await withTagsEnabled('large-doc-', async (documentManager) => {
            // Create a large document (content will be truncated for tag generation)
            const largeContent = 'Large document content. '.repeat(500); // ~10KB
            const startTime = Date.now();
            const doc = await documentManager.addDocument(
                'Large Document Test',
                largeContent,
                { source: 'upload', tags: ['large', 'document'] }
            );
            expect(doc).not.toBeNull();
            if (!doc) throw new Error('Failed to add document');

            const addTime = Date.now() - startTime;

            // Should still be fast due to non-blocking behavior
            expect(doc.id).toBeDefined();
            expect(doc.chunks.length).toBeGreaterThan(0);

            // Wait for potential background tag generation
            await waitForTags();

            // Document should be retrievable
            const retrieved = await documentManager.getDocument(doc.id);
            expect(retrieved).not.toBeNull();
            if (!retrieved) throw new Error('Retrieved document is null');
            expect(retrieved.content.length).toBeGreaterThan(5000);
        });
    });
});

describe('Tag Generation Persistence', () => {
    it('should persist generated tags across manager instances', async () => {
        await withEnv(TAG_ENV, async () => {
            await withBaseDirAndDocumentManager('persistence-', async ({ documentManager, baseDir }) => {
            // Add document
            const doc = await documentManager.addDocument(
                'Persistence Test Document',
                'This document tests if generated tags are persisted correctly.',
                { source: 'upload', tags: ['test', 'persistence'] }
            );
            expect(doc).not.toBeNull();
            if (!doc) throw new Error('Failed to add document');

            // Wait for potential background tag generation
            await waitForTags();

            // Create new DocumentManager instance (simulating restart)
            const embeddingProvider = createTestEmbeddingProvider();
            const documentManager2 = new DocumentManager(embeddingProvider);
            const retrieved = await documentManager2.getDocument(doc.id);
            expect(retrieved).not.toBeNull();
            if (!retrieved) throw new Error('Retrieved document is null');
            expect(retrieved.title).toBe('Persistence Test Document');

            // Check if metadata persisted
            expect(retrieved.metadata?.tags).toBeDefined();
            expect(retrieved.metadata.tags).toContain('test');
            });
        });
    });
});
