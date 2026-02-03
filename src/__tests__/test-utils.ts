import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeBlock, Document, DocumentChunk, EmbeddingProvider } from '../types.js';
import { ChunkV1, CodeBlockV1 } from '../types/database-v1.js';
import { createLazyEmbeddingProvider, clearEmbeddingProviderCache } from '../embedding-provider.js';
import { DocumentManager } from '../document-manager.js';
import { LanceDBV1 } from '../vector-db/index.js';
import { MockEmbeddingProvider } from './mock-embedding-provider.js';

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
        // Clear embedding provider config to force use of MockEmbeddingProvider in tests
        // Also set similarity threshold to 0 to allow all results through
        return withEnv({
            MCP_BASE_DIR: dir,
            MCP_EMBEDDING_PROVIDER: undefined,
            MCP_EMBEDDING_BASE_URL: undefined,
            MCP_SIMILARITY_THRESHOLD: '0.0'
        }, async () => fn(dir));
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

    // Check if tests should use mock provider
    const useMock = process.env.MCP_USE_MOCK_EMBEDDINGS === 'true' || !providerEnv;

    if (useMock) {
        console.error('[test-utils] Using MockEmbeddingProvider for tests');
        return new MockEmbeddingProvider(384);
    }

    if (providerEnv === 'openai') {
        if (!process.env.MCP_EMBEDDING_BASE_URL) {
            console.error('[test-utils] MCP_EMBEDDING_PROVIDER=openai but MCP_EMBEDDING_BASE_URL is not set. Falling back to MockEmbeddingProvider.');
            return new MockEmbeddingProvider(384);
        }

        try {
            // Use global cache from embedding-provider.ts to prevent model reloading across tests
            const provider = createLazyEmbeddingProvider();
            console.error('[test-utils] Using global cached embedding provider');
            return provider;
        } catch (error) {
            console.error('[test-utils] Failed to create OpenAI-compatible embedding provider. Falling back to MockEmbeddingProvider.');
            return new MockEmbeddingProvider(384);
        }
    }

    // Default to mock provider
    console.error('[test-utils] Unknown provider type or no configuration. Using MockEmbeddingProvider.');
    return new MockEmbeddingProvider(384);
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
    fn: (vectorDb: LanceDBV1) => Promise<T> | T,
    prefix: string = 'vector-test-'
): Promise<T> => {
    const embeddingDim = process.env.MCP_EMBEDDING_DIMENSION ?? process.env.MCP_EMBEDDING_DIM ?? '384';
    return withEnv({ MCP_EMBEDDING_DIMENSION: embeddingDim, MCP_EMBEDDING_DIM: embeddingDim }, async () => {
        const dir = createTempDir(prefix);
        const vectorDb = new LanceDBV1(dir);
        await vectorDb.initialize();

        try {
            return await fn(vectorDb);
        } finally {
            await vectorDb.close();
            removeTempDir(dir);
        }
    });
};

type DocumentManagerHarness = {
    vectorDb: LanceDBV1;
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
        const embeddingProvider = options.embeddingProvider ?? createTestEmbeddingProvider();
        const embeddingDim = process.env.MCP_EMBEDDING_DIMENSION ?? process.env.MCP_EMBEDDING_DIM ?? '384';
        return withEnv({ MCP_EMBEDDING_DIMENSION: embeddingDim, MCP_EMBEDDING_DIM: embeddingDim }, async () => {
            const vectorDbPath = path.join(baseDir, 'lancedb');
            const vectorDb = new LanceDBV1(vectorDbPath);
            await vectorDb.initialize();
            const documentManager = new DocumentManager(embeddingProvider, vectorDb);

            try {
                return await fn({ vectorDb, documentManager, embeddingProvider, baseDir });
            } finally {
                await vectorDb.close();
            }
        });
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

export const createTestEmbedding = (seed: number, dimensions?: number): number[] => {
    const resolvedDim = dimensions ?? parseInt(process.env.MCP_EMBEDDING_DIMENSION ?? process.env.MCP_EMBEDDING_DIM ?? '384', 10);
    const embedding: number[] = [];
    for (let i = 0; i < resolvedDim; i++) {
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
): Omit<ChunkV1, 'created_at'> => ({
    id,
    document_id: documentId,
    chunk_index: 0,
    start_position: 0,
    end_position: content.length,
    content,
    content_length: content.length,
    embedding: embeddings ?? [],
    surrounding_context: (metadata as Record<string, any>).surrounding_context ?? null,
    semantic_topic: (metadata as Record<string, any>).semantic_topic ?? null,
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
): Omit<CodeBlockV1, 'created_at'> => ({
    id,
    document_id: documentId,
    block_id: blockId,
    block_index: 0,
    language,
    content,
    content_length: content.length,
    embedding: embedding ?? [],
    source_url: sourceUrl ?? (metadata as Record<string, any>).source_url ?? null,
});
