import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodeBlock, Document, DocumentChunk, EmbeddingProvider } from '../types.js';
import { createLazyEmbeddingProvider, SimpleEmbeddingProvider } from '../embedding-provider.js';
import { DocumentManager } from '../document-manager.js';
import { LanceDBAdapter } from '../vector-db/index.js';
import { SearchEngine } from '../search-engine.js';

type EnvMap = Record<string, string | undefined>;

export const createTempDir = (prefix: string): string => {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
};

export const removeTempDir = (dir: string): void => {
    fs.rmSync(dir, { recursive: true, force: true });
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
            console.warn('[test-utils] MCP_EMBEDDING_PROVIDER=openai but MCP_EMBEDDING_BASE_URL is not set; falling back to SimpleEmbeddingProvider.');
            return new SimpleEmbeddingProvider();
        }

        try {
            return createLazyEmbeddingProvider();
        } catch (error) {
            console.warn('[test-utils] Failed to create OpenAI-compatible embedding provider; falling back to SimpleEmbeddingProvider.', error);
            return new SimpleEmbeddingProvider();
        }
    }

    return new SimpleEmbeddingProvider();
};

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

type SearchEngineHarness = DocumentManagerHarness & { searchEngine: SearchEngine };

export const withSearchEngine = async <T>(
    fn: (ctx: SearchEngineHarness) => Promise<T> | T,
    options: { embeddingProvider?: EmbeddingProvider; vectorDbPrefix?: string } = {}
): Promise<T> => {
    return withDocumentManager(async (ctx) => {
        const searchEngine = new SearchEngine(ctx.documentManager, ctx.embeddingProvider);
        return await fn({ ...ctx, searchEngine });
    }, options);
};

export const withBaseDirAndSearchEngine = async <T>(
    basePrefix: string,
    fn: (ctx: SearchEngineHarness & { baseDir: string }) => Promise<T> | T,
    options: { embeddingProvider?: EmbeddingProvider; vectorDbPrefix?: string } = {}
): Promise<T> => {
    return withBaseDir(basePrefix, async (baseDir) => {
        return await withSearchEngine((ctx) => fn({ ...ctx, baseDir }), options);
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
