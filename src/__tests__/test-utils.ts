import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeBlock, Document, DocumentChunk, EmbeddingProvider } from '../types.js';
import { createLazyEmbeddingProvider, clearEmbeddingProviderCache } from '../embedding-provider.js';
import { DocumentManager } from '../document-manager.js';
import { LanceDBAdapter } from '../vector-db/index.js';

type EnvMap = Record<string, string | undefined>;

/**
 * Clear all embedding provider caches (global cache)
 * Useful for test isolation when configuration changes
 */
export function clearTestEmbeddingProviderCache(): void {
    clearEmbeddingProviderCache();
    console.error('[test-utils] Global embedding provider cache cleared');
}

export const createTempDir = (prefix: string): string => {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
};

export const removeTempDir = (dir: string): void => {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
        // If directory is not empty (ENOTEMPTY) or busy, log but don't throw
        // This can happen when LanceDB files are still being released
        // Temp directories will be cleaned up by the OS eventually
        if (error instanceof Error && 'code' in error) {
            const errorCode = error.code;
            if (errorCode === 'ENOTEMPTY' || errorCode === 'EBUSY' || errorCode === 'EPERM') {
                console.warn(`[test-utils] Could not remove temp directory (will be cleaned by OS): ${dir} (${errorCode})`);
            } else {
                console.warn(`[test-utils] Failed to remove temp directory: ${dir}`, error);
            }
        } else {
            console.warn(`[test-utils] Failed to remove temp directory: ${dir}`, error);
        }
    }
};

export const withTempDir = async <T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> => {
    const dir = createTempDir(prefix);
    try {
        return await fn(dir);
    } finally {
        removeTempDir(dir);
    }
};

export const withEnv = async <T>(env: EnvMap, fn: () => Promise<T> | T): Promise<T> => {
    const previous: EnvMap = {};
    for (const [key, value] of Object.entries(env)) {
        previous[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    try {
        return await fn();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
};

export const withBaseDir = async <T>(prefix: string, fn: (dir: string) => Promise<T> | T): Promise<T> => {
    return withTempDir(prefix, async (dir) => {
        return withEnv({ MCP_BASE_DIR: dir }, async () => fn(dir));
    });
};

export const isLanceDbAvailable = async (): Promise<boolean> => {
    try {
        await import('@lancedb/lancedb');
        return true;
    } catch {
        return false;
    }
};

export const createTestEmbeddingProvider = (): EmbeddingProvider => {
    const providerEnv = process.env.MCP_EMBEDDING_PROVIDER?.toLowerCase();

    if (providerEnv === 'openai') {
        if (!process.env.MCP_EMBEDDING_BASE_URL) {
            throw new Error('[test-utils] MCP_EMBEDDING_PROVIDER=openai but MCP_EMBEDDING_BASE_URL is not set. Tests require an OpenAI-compatible embedding provider.');
        }

        try {
            // Use global cache from embedding-provider.ts to prevent model reloading across tests
            const provider = createLazyEmbeddingProvider();
            console.error('[test-utils] Using global cached embedding provider');
            return provider;
        } catch (error) {
            throw new Error('[test-utils] Failed to create OpenAI-compatible embedding provider. Tests require a valid embedding provider configuration.');
        }
    }

    throw new Error('[test-utils] Tests require MCP_EMBEDDING_PROVIDER=openai and MCP_EMBEDDING_BASE_URL to be set. SimpleEmbeddingProvider has been removed.');
};

/**
 * Warm up the embedding provider by generating a test embedding
 * This ensures the model is loaded before tests start
 */
export async function warmupEmbeddingProvider(): Promise<void> {
    const provider = createTestEmbeddingProvider();
    console.error('[test-utils] Warming up embedding provider...');
    
    try {
        // Generate a test embedding to ensure the model is loaded
        const testEmbedding = await provider.generateEmbedding('test');
        console.error(`[test-utils] Embedding provider warmed up successfully (${testEmbedding.length} dimensions)`);
    } catch (error) {
        console.error('[test-utils] Failed to warm up embedding provider:', error);
        throw error;
    }
}

export const withVectorDb = async <T>(
    fn: (vectorDb: LanceDBAdapter) => Promise<T> | T,
    prefix: string = 'vector-test-'
): Promise<T> => {
    const dir = createTempDir(prefix);
    const vectorDb = new LanceDBAdapter(dir);
    await vectorDb.initialize();

    try {
        return await fn(vectorDb);
    } finally {
        await vectorDb.close();
        removeTempDir(dir);
    }
};

type DocumentManagerHarness = {
    vectorDb: LanceDBAdapter;
    documentManager: DocumentManager;
    embeddingProvider: EmbeddingProvider;
};

export const withDocumentManager = async <T>(
    fn: (ctx: DocumentManagerHarness) => Promise<T> | T,
    options: { embeddingProvider?: EmbeddingProvider; vectorDbPrefix?: string } = {}
): Promise<T> => {
    const embeddingProvider = options.embeddingProvider ?? createTestEmbeddingProvider();

    return withVectorDb(async (vectorDb) => {
        const documentManager = new DocumentManager(embeddingProvider, vectorDb);
        return await fn({ vectorDb, documentManager, embeddingProvider });
    }, options.vectorDbPrefix);
};

export const withBaseDirAndDocumentManager = async <T>(
    basePrefix: string,
    fn: (ctx: DocumentManagerHarness & { baseDir: string }) => Promise<T> | T,
    options: { embeddingProvider?: EmbeddingProvider; vectorDbPrefix?: string } = {}
): Promise<T> => {
    return withBaseDir(basePrefix, async (baseDir) => {
        return await withDocumentManager((ctx) => fn({ ...ctx, baseDir }), options);
    });
};

type SeedDocumentInput = {
    title: string;
    content: string;
    metadata?: Record<string, any>;
};

export const seedDocuments = async (
    documentManager: DocumentManager,
    docs: SeedDocumentInput[]
): Promise<{ documents: Document[]; ids: string[] }> => {
    const documents: Document[] = [];

    for (const doc of docs) {
        const created = await documentManager.addDocument(
            doc.title,
            doc.content,
            doc.metadata ?? {}
        );
        if (created) {
            documents.push(created);
        }
    }

    return { documents, ids: documents.map(doc => doc.id) };
};

export const addDocumentsRange = async (
    documentManager: DocumentManager,
    count: number,
    build: (index: number) => SeedDocumentInput
): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
        const doc = build(i);
        const created = await documentManager.addDocument(
            doc.title,
            doc.content,
            doc.metadata ?? {}
        );
        if (created) {
            ids.push(created.id);
        }
    }
    return ids;
};

export const createTestEmbedding = (seed: number, dimensions: number = 384): number[] => {
    const embedding: number[] = [];
    for (let i = 0; i < dimensions; i++) {
        const value = Math.sin(seed * i * 0.1) * Math.cos(seed * i * 0.05);
        embedding.push(value);
    }
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / norm);
};

export const createTestChunk = (
    id: string,
    documentId: string,
    content: string,
    embeddings?: number[],
    metadata: Record<string, unknown> = { test: true }
): DocumentChunk => ({
    id,
    document_id: documentId,
    chunk_index: 0,
    content,
    embeddings,
    start_position: 0,
    end_position: content.length,
    metadata
});

export const createTestCodeBlock = (
    id: string,
    documentId: string,
    blockId: string,
    language: string,
    content: string,
    embedding?: number[],
    metadata: Record<string, unknown> = { test: true },
    sourceUrl: string = 'https://example.com'
): CodeBlock => ({
    id,
    document_id: documentId,
    block_id: blockId,
    block_index: 0,
    language,
    content,
    embedding,
    metadata,
    source_url: sourceUrl
});
