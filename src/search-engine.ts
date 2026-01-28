import { DocumentManager } from './document-manager.js';
import type { EmbeddingProvider, SearchResult, CodeBlockSearchResult } from './types.js';

/**
 * Search engine that provides semantic search capabilities across all documents
 */
export class SearchEngine {
    private documentManager: DocumentManager;
    private embeddingProvider: EmbeddingProvider;

    constructor(documentManager: DocumentManager, embeddingProvider: EmbeddingProvider) {
        this.documentManager = documentManager;
        this.embeddingProvider = embeddingProvider;
    }

    /**
     * Perform semantic search across all documents
     */
    // async searchAllDocuments(query: string, limit = 10): Promise<SearchResult[]> {
    //     try {
    //         const allDocuments = await this.documentManager.getAllDocuments();
    //         const allResults: SearchResult[] = [];

    //         for (const document of allDocuments) {
    //             const results = await this.documentManager.searchDocuments(document.id, query, limit);
    //             allResults.push(...results);
    //         }

    //         // Sort all results by score and limit
    //         allResults.sort((a, b) => b.score - a.score);
    //         return allResults.slice(0, limit);
    //     } catch (error) {
    //         console.error('Search failed:', error);
    //         throw new Error(`Search failed: ${error}`);
    //     }
    // }

    /**
     * Search within a specific document
     */
    async searchDocument(documentId: string, query: string, limit = 10): Promise<SearchResult[]> {
        return this.documentManager.searchDocuments(documentId, query, limit);
    }

    /**
     * Add a document with automatic embedding generation
     */
    async addDocument(
        title: string,
        content: string,
        metadata: Record<string, any> = {}
    ) {
        try {
            // Use the DocumentManager's addDocument method which handles chunking and embeddings
            return await this.documentManager.addDocument(title, content, metadata);
        } catch (error) {
            console.error('Failed to add document:', error);
            throw new Error(`Failed to add document: ${error}`);
        }
    }

    /**
     * Get document by ID
     */
    async getDocument(id: string) {
        return this.documentManager.getDocument(id);
    }

    /**
     * List all documents
     */
    async listDocuments() {
        return this.documentManager.getAllDocuments();
    }

    /**
     * Delete a document
     */
    async deleteDocument(id: string) {
        return this.documentManager.deleteDocument(id);
    }

    /**
     * Check if the search engine is ready
     */
    isReady(): boolean {
        return this.embeddingProvider.isAvailable();
    }

    /**
     * Search code blocks using semantic similarity
     * Returns all language variants by default, or filtered by language when specified
     * @param query - The search query
     * @param limit - Maximum number of results to return (default 10)
     * @param language - Optional language filter (e.g., 'javascript', 'python')
     * @returns Array of code block search results
     */
    async searchCodeBlocks(query: string, limit = 10, language?: string): Promise<CodeBlockSearchResult[]> {
        try {
            // Generate embedding for the query
            const queryEmbedding = await this.embeddingProvider.generateEmbedding(query);

            // Get the vector database from the document manager
            const vectorDatabase = (this.documentManager as any).vectorDatabase;
            if (!vectorDatabase) {
                console.warn('[SearchEngine] Vector database not available for code block search');
                return [];
            }
            const vectorDbReady = await this.documentManager.ensureVectorDbReady();
            if (!vectorDbReady) {
                console.warn('[SearchEngine] Vector database not ready for code block search');
                return [];
            }

            // Check if the vector database supports code block search
            const searchCodeBlocksMethod = vectorDatabase.searchCodeBlocks;
            if (typeof searchCodeBlocksMethod !== 'function') {
                console.warn('[SearchEngine] Vector database does not support code block search');
                return [];
            }

            // Perform the search with optional language filter
            const results = await searchCodeBlocksMethod.call(vectorDatabase, queryEmbedding, limit, language);

            return results;
        } catch (error) {
            console.error('[SearchEngine] Code block search failed:', error);
            throw new Error(`Code block search failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get all code blocks for a specific document
     * @param documentId - The document ID to get code blocks for
     * @returns Array of code blocks
     */
    async getCodeBlocks(documentId: string) {
        try {
            const vectorDatabase = (this.documentManager as any).vectorDatabase;
            if (!vectorDatabase) {
                console.warn('[SearchEngine] Vector database not available for getting code blocks');
                return [];
            }
            const vectorDbReady = await this.documentManager.ensureVectorDbReady();
            if (!vectorDbReady) {
                console.warn('[SearchEngine] Vector database not ready for getting code blocks');
                return [];
            }

            const getCodeBlocksMethod = vectorDatabase.getCodeBlocksByDocument;
            if (typeof getCodeBlocksMethod !== 'function') {
                console.warn('[SearchEngine] Vector database does not support getting code blocks');
                return [];
            }

            return await getCodeBlocksMethod.call(vectorDatabase, documentId);
        } catch (error) {
            console.error('[SearchEngine] Failed to get code blocks:', error);
            throw new Error(`Failed to get code blocks: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
