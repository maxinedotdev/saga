import { createHash } from 'crypto';
import fse from 'fs-extra';
import { promises as fsp } from 'fs';
import * as path from 'path';
import type { SourceMetadata } from '../types.js';

/**
 * Document-level search fields for efficient discovery
 */
interface DocumentSearchFields {
    id: string;
    title: string;
    tags: string[];
    tags_generated?: string[];
    source_metadata: SourceMetadata;
    keywords: string[];
}

/**
 * In-memory indexing system for O(1) document and chunk lookups
 * Replaces linear searches with hash-based maps for scalability
 */
export class DocumentIndex {
    private documentMap = new Map<string, string>(); // id -> filePath
    private chunkMap = new Map<string, {docId: string, chunkIndex: number}>(); // chunkId -> document info
    private contentHash = new Map<string, string>(); // contentHash -> docId (deduplication)
    private keywordIndex = new Map<string, Set<string>>(); // keyword -> docIds
    
    // Document-level search fields for query-first discovery
    private titleIndex = new Map<string, Set<string>>(); // word -> docIds (from titles)
    private tagIndex = new Map<string, Set<string>>(); // tag -> docIds
    private sourceIndex = new Map<string, Set<string>>(); // source -> docIds
    private crawlIdIndex = new Map<string, Set<string>>(); // crawl_id -> docIds
    private documentSearchFields = new Map<string, DocumentSearchFields>(); // docId -> search fields
    
    private initialized = false;
    private indexFilePath: string;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private suppressAutoSave = false;

    constructor(dataDir: string) {
        this.indexFilePath = path.join(dataDir, 'document-index.json');
    }

    /**
     * Initialize the index by loading from disk or building from existing documents
     */
    async initialize(dataDir: string): Promise<void> {
        console.error('[DocumentIndex] initialize START');
        const startTime = Date.now();

        if (this.initialized) {
            console.error('[DocumentIndex] Already initialized, returning');
            return;
        }

        try {
            console.error('[DocumentIndex] Attempting to load existing index...');
            // Try to load existing index
            await this.loadIndex();
            console.error('[DocumentIndex] Existing index loaded successfully');
            
            // If index file exists but is empty while documents exist, rebuild
            if (this.documentMap.size === 0) {
                try {
                    const files = await fsp.readdir(dataDir);
                    const hasDocuments = files.some(file => file.endsWith('.json') && file !== 'document-index.json');
                    if (hasDocuments) {
                        console.error('[DocumentIndex] Index file is empty but documents exist, rebuilding index...');
                        await this.rebuildIndex(dataDir);
                    }
                } catch (scanError) {
                    console.warn('[DocumentIndex] Failed to scan data directory for rebuild check:', scanError);
                }
            }
        } catch (error) {
            console.error('[DocumentIndex] Failed to load existing index, rebuilding:', error);
            // Rebuild index from existing documents
            await this.rebuildIndex(dataDir);
        }

        this.initialized = true;
        const endTime = Date.now();
        console.error(`[DocumentIndex] initialize END - took ${endTime - startTime}ms, ${this.documentMap.size} documents`);
    }

    /**
     * Add a document to the index
     */
    addDocument(id: string, filePath: string, content: string, chunks?: any[], title?: string, metadata?: Record<string, any>): void {
        if (this.documentMap.has(id)) {
            this.removeDocument(id);
        }

        // Add to document map
        this.documentMap.set(id, filePath);

        // Add content hash for deduplication
        const contentHashValue = this.hashContent(content);
        this.contentHash.set(contentHashValue, id);

        // Add chunks to chunk map
        if (chunks) {
            chunks.forEach((chunk, index) => {
                this.chunkMap.set(chunk.id, { docId: id, chunkIndex: index });
            });
        }

        // Extract and index keywords
        this.indexKeywords(id, content);

        // Index document-level search fields
        this.indexDocumentSearchFields(id, title, content, metadata);

        this.scheduleSaveIndex();
    }

    /**
     * Remove a document from the index
     */
    removeDocument(id: string): void {
        const filePath = this.documentMap.get(id);
        if (!filePath) return;

        // Remove from document map
        this.documentMap.delete(id);

        // Remove from content hash
        for (const [hash, docId] of this.contentHash.entries()) {
            if (docId === id) {
                this.contentHash.delete(hash);
                break;
            }
        }

        // Remove chunks
        for (const [chunkId, chunkInfo] of this.chunkMap.entries()) {
            if (chunkInfo.docId === id) {
                this.chunkMap.delete(chunkId);
            }
        }

        // Remove from keyword index
        for (const [keyword, docIds] of this.keywordIndex.entries()) {
            docIds.delete(id);
            if (docIds.size === 0) {
                this.keywordIndex.delete(keyword);
            }
        }

        // Remove from document-level search field indices
        this.removeDocumentSearchFields(id);

        this.scheduleSaveIndex();
    }

    /**
     * Find document file path by ID - O(1) lookup
     */
    findDocument(id: string): string | undefined {
        return this.documentMap.get(id);
    }

    /**
     * Find chunk information by chunk ID - O(1) lookup  
     */
    findChunk(chunkId: string): {docId: string, chunkIndex: number} | undefined {
        return this.chunkMap.get(chunkId);
    }

    /**
     * Find duplicate content by hash - O(1) lookup
     */
    findDuplicateContent(content: string): string | undefined {
        const contentHashValue = this.hashContent(content);
        return this.contentHash.get(contentHashValue);
    }

    /**
     * Search documents by keywords - much faster than full text search
     */
    searchByKeywords(keywords: string[]): Set<string> {
        if (keywords.length === 0) return new Set();

        let result = this.keywordIndex.get(keywords[0].toLowerCase()) || new Set();
        
        for (let i = 1; i < keywords.length; i++) {
            const keywordDocs = this.keywordIndex.get(keywords[i].toLowerCase()) || new Set();
            result = new Set([...result].filter(docId => keywordDocs.has(docId)));
        }

        return result;
    }

    /**
     * Get all document IDs - O(1) size, O(n) iteration
     */
    getAllDocumentIds(): string[] {
        return Array.from(this.documentMap.keys());
    }

    /**
     * Get index statistics
     */
    getStats(): {documents: number, chunks: number, keywords: number} {
        return {
            documents: this.documentMap.size,
            chunks: this.chunkMap.size,
            keywords: this.keywordIndex.size
        };
    }

    /**
     * Get document search fields for a document ID
     */
    getDocumentSearchFields(docId: string): DocumentSearchFields | undefined {
        return this.documentSearchFields.get(docId);
    }

    /**
     * Get all document search fields
     */
    getAllDocumentSearchFields(): Map<string, DocumentSearchFields> {
        return new Map(this.documentSearchFields);
    }

    /**
     * Search documents by tags
     */
    searchByTags(tags: string[]): Set<string> {
        if (tags.length === 0) return new Set();

        let result = this.tagIndex.get(tags[0].toLowerCase()) || new Set();
        
        for (let i = 1; i < tags.length; i++) {
            const tagDocs = this.tagIndex.get(tags[i].toLowerCase()) || new Set();
            result = new Set([...result].filter(docId => tagDocs.has(docId)));
        }

        return result;
    }

    /**
     * Search documents by source type
     */
    searchBySource(source: string): Set<string> {
        const sourceLower = source.toLowerCase();
        return this.sourceIndex.get(sourceLower) || new Set();
    }

    /**
     * Search documents by crawl ID
     */
    searchByCrawlId(crawlId: string): Set<string> {
        return this.crawlIdIndex.get(crawlId) || new Set();
    }

    /**
     * Search documents by title keywords
     */
    searchByTitle(title: string): Set<string> {
        const keywords = this.extractKeywords(title);
        return this.searchByKeywords(keywords);
    }

    /**
     * Search documents by combined criteria (title, tags, keywords)
     */
    searchByCombinedCriteria(query: string): Set<string> {
        const keywords = this.extractKeywords(query);
        const keywordResults = this.searchByKeywords(keywords);
        const titleResults = this.searchByTitle(query);
        
        // Combine results with union
        return new Set([...keywordResults, ...titleResults]);
    }

    /**
     * Hash content for deduplication
     */
    private hashContent(content: string): string {
        return createHash('sha256').update(content.trim()).digest('hex').substring(0, 16);
    }

    /**
     * Extract and index keywords from content
     */
    private indexKeywords(docId: string, content: string): void {
        const keywords = this.extractKeywords(content);
        for (const keyword of keywords) {
            const keywordLower = keyword.toLowerCase();
            if (!this.keywordIndex.has(keywordLower)) {
                this.keywordIndex.set(keywordLower, new Set());
            }
            this.keywordIndex.get(keywordLower)!.add(docId);
        }
    }

    /**
     * Extract keywords from text (simple word extraction)
     */
    private extractKeywords(content: string): string[] {
        const words = content
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && word.length < 20)
            .filter(word => !this.isStopWord(word));

        // Return unique words
        return Array.from(new Set(words));
    }

    /**
     * Check if word is a stop word (basic list)
     */
    private isStopWord(word: string): boolean {
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
            'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does',
            'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that',
            'these', 'those', 'from', 'up', 'down', 'out', 'off', 'over', 'under', 'again',
            'further', 'then', 'once'
        ]);
        return stopWords.has(word);
    }

    /**
     * Index document-level search fields (title, tags, source metadata, keywords)
     */
    private indexDocumentSearchFields(docId: string, title?: string, content?: string, metadata?: Record<string, any>): void {
        // Extract or default source metadata
        const sourceMetadata: SourceMetadata = {
            source: metadata?.source || 'api',
            originalFilename: metadata?.originalFilename,
            fileExtension: metadata?.fileExtension,
            crawl_id: metadata?.crawl_id,
            crawl_url: metadata?.crawl_url,
            processedAt: metadata?.processedAt || new Date().toISOString()
        };

        // Extract tags from metadata
        const tags = this.extractTags(metadata?.tags);
        const tagsGenerated = this.extractTags(metadata?.tags_generated);

        // Extract keywords from title and content
        const titleKeywords = title ? this.extractKeywords(title) : [];
        const contentKeywords = content ? this.extractKeywords(content) : [];
        // Combine and deduplicate keywords
        const keywords = Array.from(new Set([...titleKeywords, ...contentKeywords]));

        // Store document search fields
        const searchFields: DocumentSearchFields = {
            id: docId,
            title: title || '',
            tags,
            tags_generated: tagsGenerated,
            source_metadata: sourceMetadata,
            keywords
        };
        this.documentSearchFields.set(docId, searchFields);

        // Index title words
        if (title) {
            this.indexTitleWords(docId, title);
        }

        // Index tags
        for (const tag of tags) {
            const tagLower = tag.toLowerCase();
            if (!this.tagIndex.has(tagLower)) {
                this.tagIndex.set(tagLower, new Set());
            }
            this.tagIndex.get(tagLower)!.add(docId);
        }

        // Index generated tags
        for (const tag of tagsGenerated) {
            const tagLower = tag.toLowerCase();
            if (!this.tagIndex.has(tagLower)) {
                this.tagIndex.set(tagLower, new Set());
            }
            this.tagIndex.get(tagLower)!.add(docId);
        }

        // Index source
        const sourceLower = sourceMetadata.source.toLowerCase();
        if (!this.sourceIndex.has(sourceLower)) {
            this.sourceIndex.set(sourceLower, new Set());
        }
        this.sourceIndex.get(sourceLower)!.add(docId);

        // Index crawl ID
        if (sourceMetadata.crawl_id) {
            if (!this.crawlIdIndex.has(sourceMetadata.crawl_id)) {
                this.crawlIdIndex.set(sourceMetadata.crawl_id, new Set());
            }
            this.crawlIdIndex.get(sourceMetadata.crawl_id)!.add(docId);
        }
    }

    /**
     * Remove document search fields from indices
     */
    private removeDocumentSearchFields(docId: string): void {
        const searchFields = this.documentSearchFields.get(docId);
        if (!searchFields) return;

        // Remove from title index
        const titleWords = this.extractKeywords(searchFields.title);
        for (const word of titleWords) {
            const wordLower = word.toLowerCase();
            const titleDocs = this.titleIndex.get(wordLower);
            if (titleDocs) {
                titleDocs.delete(docId);
                if (titleDocs.size === 0) {
                    this.titleIndex.delete(wordLower);
                }
            }
        }

        // Remove from tag index
        for (const tag of [...searchFields.tags, ...(searchFields.tags_generated || [])]) {
            const tagLower = tag.toLowerCase();
            const tagDocs = this.tagIndex.get(tagLower);
            if (tagDocs) {
                tagDocs.delete(docId);
                if (tagDocs.size === 0) {
                    this.tagIndex.delete(tagLower);
                }
            }
        }

        // Remove from source index
        const sourceLower = searchFields.source_metadata.source.toLowerCase();
        const sourceDocs = this.sourceIndex.get(sourceLower);
        if (sourceDocs) {
            sourceDocs.delete(docId);
            if (sourceDocs.size === 0) {
                this.sourceIndex.delete(sourceLower);
            }
        }

        // Remove from crawl ID index
        if (searchFields.source_metadata.crawl_id) {
            const crawlDocs = this.crawlIdIndex.get(searchFields.source_metadata.crawl_id);
            if (crawlDocs) {
                crawlDocs.delete(docId);
                if (crawlDocs.size === 0) {
                    this.crawlIdIndex.delete(searchFields.source_metadata.crawl_id);
                }
            }
        }

        // Remove from document search fields map
        this.documentSearchFields.delete(docId);
    }

    /**
     * Index title words for search
     */
    private indexTitleWords(docId: string, title: string): void {
        const words = this.extractKeywords(title);
        for (const word of words) {
            const wordLower = word.toLowerCase();
            if (!this.titleIndex.has(wordLower)) {
                this.titleIndex.set(wordLower, new Set());
            }
            this.titleIndex.get(wordLower)!.add(docId);
        }
    }

    /**
     * Extract tags from metadata (can be string, array, or undefined)
     */
    private extractTags(tags?: string | string[]): string[] {
        if (!tags) return [];
        
        if (typeof tags === 'string') {
            // Split by comma and trim whitespace
            return tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
        }
        
        if (Array.isArray(tags)) {
            return tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0).map(tag => tag.trim());
        }
        
        return [];
    }

    /**
     * Save index to disk
     */
    private async saveIndex(): Promise<void> {
        const indexData = {
            version: '2.0',
            documentMap: Object.fromEntries(this.documentMap),
            chunkMap: Object.fromEntries(this.chunkMap),
            contentHash: Object.fromEntries(this.contentHash),
            keywordIndex: Object.fromEntries(
                Array.from(this.keywordIndex.entries()).map(([key, value]) => [key, Array.from(value)])
            ),
            titleIndex: Object.fromEntries(
                Array.from(this.titleIndex.entries()).map(([key, value]) => [key, Array.from(value)])
            ),
            tagIndex: Object.fromEntries(
                Array.from(this.tagIndex.entries()).map(([key, value]) => [key, Array.from(value)])
            ),
            sourceIndex: Object.fromEntries(
                Array.from(this.sourceIndex.entries()).map(([key, value]) => [key, Array.from(value)])
            ),
            crawlIdIndex: Object.fromEntries(
                Array.from(this.crawlIdIndex.entries()).map(([key, value]) => [key, Array.from(value)])
            ),
            documentSearchFields: Object.fromEntries(this.documentSearchFields),
            lastUpdated: new Date().toISOString()
        };

        await fse.ensureDir(path.dirname(this.indexFilePath));
        await fse.writeJSON(this.indexFilePath, indexData, { spaces: 2 });
    }

    private scheduleSaveIndex(): void {
        if (this.suppressAutoSave) {
            return;
        }
        if (this.saveTimer) {
            return;
        }

        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveIndex().catch(error =>
                console.warn('[DocumentIndex] Failed to save index:', error)
            );
        }, 200);
    }

    /**
     * Load index from disk
     */
    private async loadIndex(): Promise<void> {
        if (!await fse.pathExists(this.indexFilePath)) {
            throw new Error('Index file does not exist');
        }

        const indexData = await fse.readJSON(this.indexFilePath);
        
        this.documentMap = new Map(Object.entries(indexData.documentMap || {}));
        this.chunkMap = new Map(Object.entries(indexData.chunkMap || {}));
        this.contentHash = new Map(Object.entries(indexData.contentHash || {}));
        this.keywordIndex = new Map(
            Object.entries(indexData.keywordIndex || {}).map(([key, value]) => [key, new Set(value as string[])])
        );
        
        // Load document-level search field indices if available (version 2.0+)
        if (indexData.titleIndex) {
            this.titleIndex = new Map(
                Object.entries(indexData.titleIndex).map(([key, value]) => [key, new Set(value as string[])])
            );
        }
        if (indexData.tagIndex) {
            this.tagIndex = new Map(
                Object.entries(indexData.tagIndex).map(([key, value]) => [key, new Set(value as string[])])
            );
        }
        if (indexData.sourceIndex) {
            this.sourceIndex = new Map(
                Object.entries(indexData.sourceIndex).map(([key, value]) => [key, new Set(value as string[])])
            );
        }
        if (indexData.crawlIdIndex) {
            this.crawlIdIndex = new Map(
                Object.entries(indexData.crawlIdIndex).map(([key, value]) => [key, new Set(value as string[])])
            );
        }
        if (indexData.documentSearchFields) {
            this.documentSearchFields = new Map(Object.entries(indexData.documentSearchFields || {}));
        }
    }

    /**
     * Rebuild index from existing documents in data directory
     */
    private async rebuildIndex(dataDir: string): Promise<void> {
        console.error('[DocumentIndex] Rebuilding index from existing documents...');
        
        this.suppressAutoSave = true;
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.documentMap.clear();
        this.chunkMap.clear();
        this.contentHash.clear();
        this.keywordIndex.clear();
        this.titleIndex.clear();
        this.tagIndex.clear();
        this.sourceIndex.clear();
        this.crawlIdIndex.clear();
        this.documentSearchFields.clear();

        try {
            const files = await fsp.readdir(dataDir);
            const documentFiles = files.filter(file => file.endsWith('.json') && file !== 'document-index.json');

            for (const file of documentFiles) {
                try {
                    const filePath = path.join(dataDir, file);
                    const document = await fse.readJSON(filePath);
                    
                    if (document.id && document.content) {
                        this.addDocument(
                            document.id,
                            filePath,
                            document.content,
                            document.chunks,
                            document.title,
                            document.metadata
                        );
                    }
                } catch (error) {
                    console.warn(`[DocumentIndex] Failed to index document ${file}:`, error);
                }
            }

            await this.saveIndex();
            console.error(`[DocumentIndex] Rebuilt index with ${this.documentMap.size} documents`);
        } catch (error) {
            console.error('[DocumentIndex] Failed to rebuild index:', error);
        } finally {
            this.suppressAutoSave = false;
        }
    }
}
