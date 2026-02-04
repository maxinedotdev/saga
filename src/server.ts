#!/usr/bin/env node

import 'dotenv/config';
import { FastMCP } from "fastmcp";
import { z } from "zod";
import { createLazyEmbeddingProvider } from './embedding-provider.js';
import { DocumentManager } from './document-manager.js';
import { resolveAiProviderSelection, searchDocumentWithAi } from './ai-search-provider.js';
import { crawlDocumentation } from './documentation-crawler.js';
import { extractHtmlContent, looksLikeHtml } from './html-extraction.js';
import { getLogger } from './utils.js';
import type { Document } from './types.js';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';

const logger = getLogger('SagaServer');
const getTimestamp = () => new Date().toISOString();

logger.info(`${getTimestamp()} Server startup initiated`);
logger.info(`Process ID: ${process.pid}`);
logger.info(`Node version: ${process.version}`);
logger.info(`Platform: ${process.platform}`);

process.on('uncaughtException', (error: Error) => {
    logger.error('UNCAUGHT EXCEPTION - Process will crash');
    logger.error(error);
});

process.on('unhandledRejection', (reason: any) => {
    logger.error('UNHANDLED REJECTION');
    logger.error(reason instanceof Error ? reason : String(reason));
});

process.on('SIGTERM', () => {
    logger.info('SIGTERM: Graceful shutdown initiated');
});

process.on('SIGINT', () => {
    logger.info('SIGINT: Graceful shutdown initiated');
});

// ============================================
// MLX AUTO-CONFIGURATION
// ============================================
async function initializeMlxAutoConfig() {
    logger.info('MLX auto-configuration starting...');
    
    try {
        // Import MLX-related modules
        const { isAppleSilicon, logPlatformInfo } = await import('./reranking/apple-silicon-detection.js');
        const { downloadModel, getDefaultModelPath } = await import('./reranking/model-downloader.js');
        const { RERANKING_CONFIG } = await import('./reranking/config.js');
        
        // Log platform information
        logPlatformInfo();
        
        // Only proceed if Apple Silicon is detected and MLX provider is configured
        if (!isAppleSilicon()) {
            logger.info('MLX auto-config skipped (not Apple Silicon)');
            return;
        }
        
        if (RERANKING_CONFIG.provider !== 'mlx') {
            logger.info(`MLX auto-config skipped (provider: ${RERANKING_CONFIG.provider})`);
            return;
        }
        
        logger.info('MLX provider configured, checking model availability...');
        
        // Download model in background (don't block startup)
        const modelPath = getDefaultModelPath();
        logger.info(`MLX model path: ${modelPath}`);
        
        // Start download in background
        downloadModel({ localPath: modelPath }, (progress) => {
            if (progress.stage === 'downloading') {
                logger.info(progress.message);
            } else if (progress.stage === 'complete') {
                logger.info(progress.message);
            }
        }).then((result) => {
            if (result.success) {
                logger.info(`MLX model ${result.downloaded ? 'downloaded' : 'already exists'} at ${result.modelPath}`);
            } else {
                logger.error(`MLX model setup failed: ${result.error}`);
            }
        }).catch((error) => {
            logger.error(`MLX model setup failed: ${error}`);
        });
        
    } catch (error) {
        logger.error('MLX auto-configuration failed', error);
    }
}

// Initialize MLX auto-configuration (non-blocking)
initializeMlxAutoConfig();

// ============================================
// END MLX AUTO-CONFIGURATION
// ============================================

// ============================================
// VLLM-METAL AUTO-CONFIGURATION
// ============================================
async function initializeVllmMetalAutoConfig() {
    logger.info('vLLM-metal auto-configuration starting...');

    try {
        const { isAppleSilicon } = await import('./reranking/apple-silicon-detection.js');

        if (!isAppleSilicon()) {
            logger.info('vLLM-metal auto-config skipped (not Apple Silicon)');
            return;
        }

        if (process.env.MCP_EMBEDDING_AUTO_CONFIGURE_VLLM === 'false') {
            logger.info('vLLM-metal auto-config disabled by MCP_EMBEDDING_AUTO_CONFIGURE_VLLM');
            return;
        }

        const existingBaseUrl = process.env.MCP_EMBEDDING_BASE_URL;
        const baseUrl = existingBaseUrl
            || process.env.MCP_EMBEDDING_VLLM_BASE_URL
            || 'http://127.0.0.1:8000';
        const modelName = process.env.MCP_EMBEDDING_MODEL
            || process.env.MCP_EMBEDDING_VLLM_MODEL
            || 'llama-nemotron-embed-1b-v2';

        if (!process.env.MCP_EMBEDDING_PROVIDER) {
            process.env.MCP_EMBEDDING_PROVIDER = 'openai';
        }
        if (!process.env.MCP_EMBEDDING_BASE_URL) {
            process.env.MCP_EMBEDDING_BASE_URL = baseUrl;
        }
        if (!process.env.MCP_EMBEDDING_MODEL) {
            process.env.MCP_EMBEDDING_MODEL = modelName;
        }

        const baseUrlParsed = new URL(baseUrl);
        const isLocalBaseUrl = baseUrlParsed.hostname === '127.0.0.1' || baseUrlParsed.hostname === 'localhost';

        if (process.env.MCP_EMBEDDING_VLLM_AUTO_START === 'false') {
            logger.info('vLLM-metal auto-start disabled by MCP_EMBEDDING_VLLM_AUTO_START');
            return;
        }

        if (existingBaseUrl && !isLocalBaseUrl) {
            logger.info(`vLLM-metal auto-start skipped (MCP_EMBEDDING_BASE_URL is non-local: ${existingBaseUrl})`);
            return;
        }

        const modelPath = process.env.MCP_EMBEDDING_VLLM_MODEL_PATH
            || join(homedir(), '.saga', 'models', modelName);

        const port = process.env.MCP_EMBEDDING_VLLM_PORT
            ? Number(process.env.MCP_EMBEDDING_VLLM_PORT)
            : Number(baseUrlParsed.port || '8000');

        const startServer = (resolvedModelPath: string) => {
            const args = [
                'serve',
                resolvedModelPath,
                '--trust-remote-code',
                '--runner', 'pooling',
                '--model-impl', 'vllm',
                '--override-pooler-config', '{"pooling_type":"MEAN"}',
                '--dtype', 'float32',
                '--port', String(port),
                '--served-model-name', modelName
            ];

            logger.info(`Starting vLLM-metal server on ${baseUrlParsed.hostname}:${port} using model ${modelName}`);
            const child = spawn('vllm', args, {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
        };

        const autoDownload = process.env.MCP_EMBEDDING_VLLM_AUTO_DOWNLOAD !== 'false';
        if (!existsSync(modelPath)) {
            if (!autoDownload) {
                logger.warn(`vLLM-metal model path not found: ${modelPath}`);
                logger.warn('Set MCP_EMBEDDING_VLLM_MODEL_PATH to your HF model directory or download it before starting Saga.');
                return;
            }

            logger.info(`vLLM-metal model missing; attempting download to ${modelPath}`);
            const download = spawn(
                'huggingface-cli',
                [
                    'download',
                    'nvidia/llama-nemotron-embed-1b-v2',
                    '--local-dir',
                    modelPath,
                    '--local-dir-use-symlinks',
                    'False'
                ],
                { detached: true, stdio: 'ignore' }
            );
            download.unref();

            const pollIntervalMs = 5000;
            const maxWaitMs = 10 * 60 * 1000;
            const startTime = Date.now();
            const poll = () => {
                if (existsSync(modelPath)) {
                    logger.info(`vLLM-metal model downloaded: ${modelPath}`);
                    startServer(modelPath);
                    return;
                }
                if (Date.now() - startTime > maxWaitMs) {
                    logger.warn('vLLM-metal model download timed out; start Saga again after download completes.');
                    return;
                }
                setTimeout(poll, pollIntervalMs);
            };
            setTimeout(poll, pollIntervalMs);
            return;
        }

        startServer(modelPath);
    } catch (error) {
        logger.error('vLLM-metal auto-configuration failed', error);
    }
}

initializeVllmMetalAutoConfig();

// ============================================
// END VLLM-METAL AUTO-CONFIGURATION
// ============================================

// Initialize server
logger.info(`${getTimestamp()} About to create FastMCP server...`);

const server = new FastMCP({
    name: "Documentation Server",
    version: "1.0.0",
});

logger.info('FastMCP server initialized');
logger.info(`${getTimestamp()} FastMCP server created successfully`);

// Initialize with default embedding provider
let documentManager: DocumentManager;

async function initializeDocumentManager() {
    logger.info('initializeDocumentManager START');
    const startTime = Date.now();

    if (!documentManager) {
        logger.info('Creating new DocumentManager...');
        // Get embedding model from environment variable (provider handles defaults)
        const embeddingModel = process.env.MCP_EMBEDDING_MODEL;
        logger.info(`Embedding model: ${embeddingModel || 'default'}`);
        const embeddingProvider = createLazyEmbeddingProvider(embeddingModel);
        logger.info('Embedding provider created');

          // Constructor will use default paths automatically
        logger.info('Calling DocumentManager constructor...');
        documentManager = new DocumentManager(embeddingProvider);
        logger.info(`Document manager initialized with: ${embeddingProvider.getModelName()} (lazy loading)`);
        logger.info(`Data directory: ${documentManager.getDataDir()}`);
        logger.info(`Uploads directory: ${documentManager.getUploadsDir()}`);
    } else {
        logger.info('DocumentManager already exists, reusing');
    }

    const endTime = Date.now();
    logger.info(`initializeDocumentManager END - took ${endTime - startTime}ms`);
    return documentManager;
}

function normalizeContentType(contentType?: string | null): string {
    return contentType ? contentType.split(';')[0].trim().toLowerCase() : '';
}

function getMaxSearchResults(requested?: number): number {
    const defaultLimit = parseInt(process.env.MCP_MAX_SEARCH_RESULTS || '10');
    return requested ?? defaultLimit;
}

async function getVectorDatabase(manager: DocumentManager): Promise<any> {
    await manager.ensureVectorDbReady();
    const vectorDatabase = (manager as any).vectorDatabase;
    if (!vectorDatabase) {
        throw new Error('Vector database is not available.');
    }
    return vectorDatabase;
}

async function getDocumentOrThrow(manager: DocumentManager, documentId: string, notFoundMessage: string) {
    const document = await manager.getDocument(documentId);
    if (!document) {
        throw new Error(notFoundMessage);
    }
    return document;
}

async function generateQueryEmbedding(manager: DocumentManager, query: string): Promise<number[]> {
    const embeddingProvider = manager.getEmbeddingProvider();
    return embeddingProvider.generateEmbedding(query);
}

function buildContextWindow(document: Document, chunkIndex: number, before: number, after: number) {
    if (!document.chunks || !Array.isArray(document.chunks)) {
        throw new Error('Document or chunk not found');
    }
    const total = document.chunks.length;
    const start = Math.max(0, chunkIndex - before);
    const end = Math.min(total, chunkIndex + after + 1);
    const windowChunks = document.chunks.slice(start, end).map(chunk => ({
        chunk_index: chunk.chunk_index,
        content: chunk.content,
    }));
    return {
        window: windowChunks,
        center: chunkIndex,
        total_chunks: total,
    };
}

async function searchDocumentChunks(
    manager: DocumentManager,
    documentId: string,
    query: string,
    limit: number
) {
    await getDocumentOrThrow(
        manager,
        documentId,
        `Document with ID '${documentId}' not found. Use 'list_documents' to get available document IDs.`
    );
    const vectorDatabase = await getVectorDatabase(manager);
    const queryEmbedding = await generateQueryEmbedding(manager, query);
    const filter = `document_id = '${documentId}'`;
    const results = await vectorDatabase.search(queryEmbedding, limit, filter);

    return {
        hint_for_llm: "After identifying the relevant chunks, use get_document with chunk_window to retrieve additional context around each chunk of interest.",
        results: results.map((result: any) => ({
            document_id: result.chunk.document_id,
            chunk_index: result.chunk.chunk_index,
            score: result.score,
            content: result.chunk.content,
        })),
    };
}

const addDocumentParams = z.object({
    title: z.string().optional().describe("The title of the document"),
    content: z.string().optional().describe("The content of the document"),
    metadata: z.object({}).passthrough().optional().describe("Optional metadata for the document"),
    source: z.enum(["uploads"]).optional().describe("Set to 'uploads' to read content from an uploads file"),
    path: z.string().optional().describe("Path to a file in the uploads directory (used when source is 'uploads')"),
}).superRefine((value, ctx) => {
    if (value.source === 'uploads') {
        if (!value.path) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "path is required when source is 'uploads'",
                path: ['path'],
            });
        }
    } else if (!value.title || !value.content) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "title and content are required unless source is 'uploads'",
            path: ['title'],
        });
    }
});

// Add document tool
server.addTool({
    name: "add_document",
    description: "Add a new document to the knowledge base. For test data, include metadata like { source: \"test\", test: true, tags: [\"test\"] } to make cleanup easy.",
    parameters: addDocumentParams,
    execute: async (args) => {
        try {
            const manager = await initializeDocumentManager();
            const baseMetadata = args.metadata || {};
            const metadata = { ...baseMetadata } as Record<string, any>;

            if (args.source === 'uploads') {
                if (args.title) {
                    metadata.title = args.title;
                }
                const document = await manager.processUploadFile(args.path as string, metadata);
                if (!document) {
                    throw new Error('Failed to add document from uploads - document is null');
                }
                return `Document added successfully with ID: ${document.id}`;
            }
            const normalizedContentType = normalizeContentType(
                (typeof metadata.contentType === 'string' ? metadata.contentType : undefined)
                || (typeof metadata.content_type === 'string' ? metadata.content_type : undefined)
                || (typeof metadata.mimeType === 'string' ? metadata.mimeType : undefined)
                || (typeof metadata['content-type'] === 'string' ? metadata['content-type'] : undefined)
            );
            const isHtml = normalizedContentType === 'text/html'
                || normalizedContentType === 'application/xhtml+xml'
                || looksLikeHtml(args.content);

            let title = args.title as string;
            let content = args.content as string;
            let codeBlocks: ReturnType<typeof extractHtmlContent>['codeBlocks'] = [];

            if (isHtml) {
                const sourceUrl = typeof metadata.source_url === 'string' ? metadata.source_url : undefined;
                const extracted = extractHtmlContent(args.content, {
                    sourceUrl,
                    fallbackTitle: args.title,
                });
                title = extracted.title || args.title;
                content = extracted.text || args.content;
                codeBlocks = extracted.codeBlocks;

                if (!metadata.contentType && !metadata.content_type) {
                    metadata.contentType = normalizedContentType || 'text/html';
                }
            }

            const document = await manager.addDocument(title, content, metadata);

            if (!document) {
                throw new Error('Failed to add document - document is null');
            }

            if (codeBlocks.length > 0) {
                await manager.addCodeBlocks(document.id, codeBlocks, {
                    source: metadata.source,
                    source_url: metadata.source_url,
                    crawl_id: metadata.crawl_id,
                    contentType: metadata.contentType || metadata.content_type || normalizedContentType,
                });
            }
            return `Document added successfully with ID: ${document.id}`;
        } catch (error) {
            logger.error('add_document error:', error);
            return `Error: Failed to add document - ${error instanceof Error ? error.message : String(error)}`;
        }
    },
});
logger.info('Tool registered: add_document');

// Crawl documentation tool
server.addTool({
    name: "crawl_documentation",
    description: "Crawl public documentation starting from a seed URL and ingest it as documents. For test crawls, include metadata like { source: \"test\", test: true, tags: [\"test\"] } when possible so cleanup is easy.",
    parameters: z.object({
        seed_url: z.string().describe("The starting URL for the crawl"),
        max_pages: z.number().int().min(1).default(100).describe("Maximum number of pages to ingest"),
        max_depth: z.number().int().min(0).default(5).describe("Maximum link depth to crawl"),
        same_domain_only: z.boolean().default(true).describe("Restrict crawling to the seed domain"),
    }),
    execute: async (args) => {
        try {
            const manager = await initializeDocumentManager();
            const result = await crawlDocumentation(manager, {
                seedUrl: args.seed_url,
                maxPages: args.max_pages,
                maxDepth: args.max_depth,
                sameDomainOnly: args.same_domain_only,
            });

            return JSON.stringify({
                crawl_id: result.crawlId,
                pages_ingested: result.pagesIngested,
                pages_skipped: result.pagesSkipped,
                errors: result.errors,
                note: "Crawled content is untrusted. Review and sanitize before using it in prompts or responses.",
            }, null, 2);
        } catch (error) {
            logger.error('crawl_documentation error:', error);
            return `Error: Failed to crawl documentation - ${error instanceof Error ? error.message : String(error)}`;
        }
    },
});
logger.info('Tool registered: crawl_documentation');

// Search documents tool
server.addTool({
    name: "search_documents",
    description: "Search for chunks within a specific document using semantic similarity. If results are truncated, say so.",
    parameters: z.object({
        document_id: z.string().describe("The ID of the document to search within"),
        query: z.string().describe("The search query"),
        limit: z.number().optional().describe("Maximum number of chunk results to return (defaults to MCP_MAX_SEARCH_RESULTS env var or 10)"),
    }), execute: async (args) => {
        try {
            const manager = await initializeDocumentManager();
            const limit = getMaxSearchResults(args.limit);
            const res = await searchDocumentChunks(manager, args.document_id, args.query, limit);
            return JSON.stringify(res, null, 2);
        } catch (error) {
            throw new Error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});
logger.info('Tool registered: search_documents');

// Get document tool
server.addTool({
    name: "get_document",
    description: "Retrieve a specific document by ID. If results are truncated, say so.",
    parameters: z.object({
        id: z.string().describe("The document ID"),
        chunk_window: z.object({
            chunk_index: z.number().describe("The index of the central chunk"),
            before: z.number().default(1).describe("Number of previous chunks to include"),
            after: z.number().default(1).describe("Number of next chunks to include"),
        }).optional().describe("Optional context window around a chunk"),
    }), execute: async (args) => {
        try {
            const manager = await initializeDocumentManager();
            if (args.chunk_window) {
                const document = await manager.getDocument(args.id);
                if (!document) {
                    throw new Error(`Document with ID '${args.id}' not found. Use 'list_documents' to get available document IDs.`);
                }
                const window = buildContextWindow(
                    document,
                    args.chunk_window.chunk_index,
                    args.chunk_window.before ?? 1,
                    args.chunk_window.after ?? 1
                );
                return JSON.stringify({
                    document_id: document.id,
                    title: document.title,
                    ...window,
                }, null, 2);
            }

            const content = await manager.getOnlyContentDocument(args.id);

            if (!content) {
                throw new Error(`Document with ID '${args.id}' not found. Use 'list_documents' to get available document IDs.`);
            }

            return JSON.stringify(content, null, 2);
        } catch (error) {
            throw new Error(`Failed to retrieve document: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});
logger.info('Tool registered: get_document');

// List documents tool
server.addTool({
    name: "list_documents",
    description: "List documents in the knowledge base with pagination and optional metadata/preview.",
    parameters: z.object({
        offset: z.number().int().min(0).default(0).describe("Number of documents to skip for pagination"),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum number of documents to return (default 50, max 200)"),
        include_metadata: z.boolean().default(false).describe("Include full metadata objects (default false)"),
        include_preview: z.boolean().default(false).describe("Include a content preview snippet (default false)"),
        preview_length: z.number().int().min(0).max(1000).default(200).describe("Preview length if include_preview is true (default 200, max 1000)"),
    }), execute: async (args) => {
        try {
            const manager = await initializeDocumentManager();
            const { total, documents } = await manager.listDocumentSummaries({
                offset: args.offset,
                limit: args.limit,
                includeMetadata: args.include_metadata,
                includePreview: args.include_preview,
                previewLength: args.preview_length,
            });

            const returned = documents.length;
            const hasMore = args.offset + returned < total;
            const response = {
                total_documents: total,
                offset: args.offset,
                limit: args.limit,
                returned,
                has_more: hasMore,
                next_offset: hasMore ? args.offset + returned : null,
                documents,
            };

            return JSON.stringify(response, null, 2);
        } catch (error) {
            throw new Error(`Failed to list documents: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});

// Get uploads folder path tool
server.addTool({
    name: "get_uploads_path",
    description: "Get the absolute path to the uploads folder where you can manually place .txt and .md files. For test runs, tag documents with metadata { source: \"test\", test: true, tags: [\"test\"] } when ingesting.",
    parameters: z.object({}),
    execute: async () => {
        try {
            const manager = await initializeDocumentManager();
            const uploadsPath = manager.getUploadsPath();
            return `Uploads folder path: ${uploadsPath}\n\nYou can place .txt and .md files in this folder, then use the 'process_uploads' tool to create embeddings for them. For test runs, tag documents with metadata like { source: "test", test: true, tags: ["test"] } so cleanup is easy.`;
        } catch (error) {
            throw new Error(`Failed to get uploads path: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});

// Process uploads folder tool
server.addTool({
    name: "process_uploads",
    description: "Process all .txt and .md files in the uploads folder and create embeddings for them. For test data, include metadata like { source: \"test\", test: true, tags: [\"test\"] } so cleanup is easy.",
    parameters: z.object({}), execute: async () => {
        try {
            const manager = await initializeDocumentManager();
            const result = await manager.processUploadsFolder();

            let message = `Processing completed!\n`;
            message += `- Files processed: ${result.processed}\n`;

            if (result.errors.length > 0) {
                message += `- Errors encountered: ${result.errors.length}\n`;
                message += `\nErrors:\n${result.errors.map(err => `  • ${err}`).join('\n')}`;
            }

            return message;
        } catch (error) {
            throw new Error(`Failed to process uploads: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});

// List uploads files tool
server.addTool({
    name: "list_uploads_files",
    description: "List all files in the uploads folder with their details.",
    parameters: z.object({}), execute: async () => {
        try {
            const manager = await initializeDocumentManager();
            const files = await manager.listUploadsFiles();

            if (files.length === 0) {
                return "No files found in the uploads folder.";
            }

            const fileList = files.map(file => ({
                name: file.name,
                size_bytes: file.size,
                modified: file.modified,
                supported: file.supported,
                status: file.supported ? "Can be processed" : "Unsupported format"
            }));

            return JSON.stringify(fileList, null, 2);
        } catch (error) {
            throw new Error(`Failed to list uploads files: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});

// Delete document tool
server.addTool({
    name: "delete_document",
    description: "Delete a document from the collection.",
    parameters: z.object({
        id: z.string().describe("Document ID to delete")
    }),
    execute: async ({ id }) => {
        try {
            const manager = await initializeDocumentManager();
            
            // Check if document exists first
            const document = await getDocumentOrThrow(
                manager,
                id,
                `Document with ID '${id}' not found. Use 'list_documents' to get available document IDs.`
            );

            // Delete the document
            const success = await manager.deleteDocument(id);
            
            if (success) {
                return `Document "${document.title}" (${id}) has been deleted successfully.`;
            } else {
                throw new Error(`Document with ID '${id}' not found or already deleted. Use 'list_documents' to get available document IDs.`);
            }
        } catch (error) {
            throw new Error(`Failed to delete document: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});

// Delete crawl session tool
server.addTool({
    name: "delete_crawl_session",
    description: "Delete all documents associated with a crawl session ID.",
    parameters: z.object({
        crawl_id: z.string().describe("Crawl session ID to delete"),
    }),
    execute: async ({ crawl_id }) => {
        try {
            const manager = await initializeDocumentManager();
            const result = await manager.deleteCrawlSession(crawl_id);

            if (result.deleted === 0) {
                return `No documents found for crawl session ${crawl_id}.`;
            }

            const summary = {
                crawl_id,
                deleted: result.deleted,
                errors: result.errors,
            };

            return JSON.stringify(summary, null, 2);
        } catch (error) {
            throw new Error(`Failed to delete crawl session: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});


// MCP tool: get_context_window
server.addTool({
    name: "get_context_window",
    description: "Return a window of chunks around a central chunk (document_id, chunk_index, before, after). If results are truncated, say so.",
    parameters: z.object({
        document_id: z.string().describe("The document ID"),
        chunk_index: z.number().describe("The index of the central chunk"),
        before: z.number().default(1).describe("Number of previous chunks to include"),
        after: z.number().default(1).describe("Number of next chunks to include")
    }),
    async execute({ document_id, chunk_index, before, after }) {
        const manager = await initializeDocumentManager();
        const document = await getDocumentOrThrow(manager, document_id, 'Document or chunk not found');
        const window = buildContextWindow(document, chunk_index, before, after);
        return JSON.stringify(window, null, 2);
    }
});

const aiProviderSelection = resolveAiProviderSelection();
// Add AI search tool (only if provider is configured)
if (aiProviderSelection.enabled) {
    server.addTool({
        name: "search_documents_with_ai",
        description: "Search within a document using the configured AI provider for advanced semantic analysis and content extraction.",
        parameters: z.object({
            document_id: z.string().describe("The ID of the document to search within"),
            query: z.string().describe("The search query for semantic analysis"),
        }),
        execute: async (args) => {
            try {
                const manager = await initializeDocumentManager();
                const selection = resolveAiProviderSelection();
                if (!selection.enabled) {
                    throw new Error(selection.reason || 'AI provider is not configured.');
                }

                // Check if document exists
                const document = await getDocumentOrThrow(
                    manager,
                    args.document_id,
                    `Document with ID '${args.document_id}' not found. Use 'list_documents' to get available document IDs.`
                );
                logger.info(`AI-powered search (${selection.provider}) for document ${args.document_id}`);

                // Perform AI search
                const aiResult = await searchDocumentWithAi(
                    args.document_id,
                    args.query,
                    manager
                );

                return JSON.stringify({
                    document_id: args.document_id,
                    document_title: document.title,
                    search_query: args.query,
                    ai_analysis: aiResult.result,
                    note: `This search was performed using ${aiResult.provider}${aiResult.model ? ` (${aiResult.model})` : ''} for advanced semantic analysis. Always verify the results for accuracy.`
                }, null, 2);

            } catch (error) {
                throw new Error(`AI search failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        },
    });
    logger.info(`AI search tool enabled (${aiProviderSelection.provider})`);
} else {
    logger.info(`AI search tool disabled (${aiProviderSelection.reason || 'provider not configured'})`);
}

// Query documents tool
server.addTool({
    name: "query",
    description: "Return the most relevant document IDs and summaries. Use this for query-first discovery before fetching full content. Set scope to 'document' with document_id to search chunks within a single document.",
    parameters: z.object({
        query: z.string().describe("The search query text"),
        limit: z.number().int().min(1).max(200).default(10).describe("Maximum number of results to return (default 10, max 200)"),
        offset: z.number().int().min(0).default(0).describe("Number of results to skip for pagination"),
        include_metadata: z.boolean().default(true).describe("Include full metadata objects in results (default true)"),
        scope: z.enum(["global", "document"]).optional().describe("Search scope (default: global unless document_id is provided)"),
        document_id: z.string().optional().describe("Limit search to a specific document (requires scope: 'document')"),
        filters: z.object({
            tags: z.array(z.string()).optional().describe("Filter by document tags"),
            source: z.string().optional().describe("Filter by document source (e.g., 'upload', 'crawl', 'api')"),
            crawl_id: z.string().optional().describe("Filter by crawl session ID"),
            author: z.string().optional().describe("Filter by document author"),
            contentType: z.string().optional().describe("Filter by content type"),
            languages: z.array(z.string()).optional().describe("Filter by language codes (ISO 639-1, e.g., 'en', 'es', 'fr'). Defaults to MCP_DEFAULT_QUERY_LANGUAGES or MCP_ACCEPTED_LANGUAGES if not specified."),
        }).optional().describe("Optional metadata filters to apply"),
    }),
    execute: async (args) => {
        try {
            const manager = await initializeDocumentManager();
            const scope = args.scope ?? (args.document_id ? 'document' : 'global');
            if (scope === 'document') {
                if (!args.document_id) {
                    throw new Error("document_id is required when scope is 'document'");
                }
                const limit = getMaxSearchResults(args.limit);
                const res = await searchDocumentChunks(manager, args.document_id, args.query, limit);
                return JSON.stringify(res, null, 2);
            }

            const result = await manager.query(args.query, {
                limit: args.limit,
                offset: args.offset,
                include_metadata: args.include_metadata,
                filters: args.filters ?? {},
            });

            return JSON.stringify(result, null, 2);
        } catch (error) {
            throw new Error(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});

// Search code blocks tool
server.addTool({
    name: "search_code_blocks",
    description: "Search for code blocks across all documents using semantic similarity. Returns all language variants by default. Use the optional language filter to restrict results to a specific programming language. If results are truncated, say so.",
    parameters: z.object({
        query: z.string().describe("The search query for finding relevant code blocks"),
        limit: z.number().optional().describe("Maximum number of code block results to return (defaults to MCP_MAX_SEARCH_RESULTS env var or 10)"),
        language: z.string().optional().describe("Optional language filter to restrict results to a specific programming language (e.g., 'javascript', 'python', 'typescript'). If not specified, returns results from all languages."),
    }),
    execute: async (args) => {
        try {
            const manager = await initializeDocumentManager();
            
            const vectorDatabase = await getVectorDatabase(manager);
            const queryEmbedding = await generateQueryEmbedding(manager, args.query);
            const limit = getMaxSearchResults(args.limit);

            const results = await vectorDatabase.searchCodeBlocks(queryEmbedding, limit, args.language);

            if (results.length === 0) {
                return args.language
                    ? `No code blocks found matching your query in ${args.language}. Try searching without a language filter to see all available code blocks.`
                    : "No code blocks found matching your query.";
            }

            const searchResults = results.map((result: any) => ({
                document_id: result.code_block.document_id,
                block_id: result.code_block.block_id,
                block_index: result.code_block.block_index,
                language: result.code_block.language,
                score: result.score,
                content: result.code_block.content,
                source_url: result.code_block.source_url,
            }));

            const res = {
                query: args.query,
                language_filter: args.language || null,
                hint_for_llm: "Code block search results include all language variants by default. Use the optional language parameter to filter for specific programming languages. Each result is a separate code block variant.",
                results: searchResults,
            };

            return JSON.stringify(res, null, 2);
        } catch (error) {
            throw new Error(`Code block search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});

// Get code blocks for document tool
server.addTool({
    name: "get_code_blocks",
    description: "Get all code blocks for a specific document. Returns all language variants available for each code block. If results are truncated, say so.",
    parameters: z.object({
        document_id: z.string().describe("The ID of the document to get code blocks for"),
    }),
    execute: async (args) => {
        try {
            const manager = await initializeDocumentManager();
            
            const vectorDatabase = await getVectorDatabase(manager);
            const document = await getDocumentOrThrow(
                manager,
                args.document_id,
                `Document with ID '${args.document_id}' not found. Use 'list_documents' to get available document IDs.`
            );

            const codeBlocks = await vectorDatabase.getCodeBlocksByDocument(args.document_id);

            if (codeBlocks.length === 0) {
                return `No code blocks found for document '${args.document_id}'. This document may not have been crawled with code block extraction enabled, or it may not contain any code blocks.`;
            }

            // Group code blocks by block_id to show variants
            const groupedBlocks: Record<string, any[]> = {};
            for (const block of codeBlocks) {
                if (!groupedBlocks[block.block_id]) {
                    groupedBlocks[block.block_id] = [];
                }
                groupedBlocks[block.block_id].push({
                    language: block.language,
                    content: block.content,
                    block_index: block.block_index,
                    source_url: block.source_url,
                });
            }

            const res = {
                document_id: args.document_id,
                document_title: document.title,
                total_code_blocks: codeBlocks.length,
                unique_code_block_groups: Object.keys(groupedBlocks).length,
                hint_for_llm: "Code blocks are grouped by block_id. Each group contains all available language variants for that code block.",
                code_blocks: groupedBlocks,
            };

            return JSON.stringify(res, null, 2);
        } catch (error) {
            throw new Error(`Failed to get code blocks: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
});

// Start the server
logger.info(`${getTimestamp()} About to start server with stdio transport...`);

server.start({
    transportType: "stdio",
});

logger.info(`${getTimestamp()} Server started successfully!`);
