/**
 * Data Integrity Validator Implementation
 *
 * Provides data integrity validation with checksums and consistency checks.
 * Validates documents, chunks, code blocks, and their relationships.
 */

import * as crypto from 'crypto';
import { getLogger } from '../utils.js';
import type {
    DocumentV1,
    ChunkV1,
    CodeBlockV1,
} from '../types/database-v1.js';

const logger = getLogger('IntegrityValidator');

/**
 * Validation error severity
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

/**
 * Validation issue
 */
export interface ValidationIssue {
    /** Issue severity */
    severity: ValidationSeverity;
    /** Issue category */
    category: string;
    /** Issue message */
    message: string;
    /** Entity ID if applicable */
    entityId?: string;
    /** Entity type if applicable */
    entityType?: string;
    /** Suggested fix */
    suggestion?: string;
}

/**
 * Validation report
 */
export interface ValidationReport {
    /** Whether validation passed */
    valid: boolean;
    /** Validation timestamp */
    timestamp: string;
    /** Validation issues */
    issues: ValidationIssue[];
    /** Issue counts by severity */
    summary: {
        errors: number;
        warnings: number;
        info: number;
        total: number;
    };
    /** Statistics */
    stats: {
        documentsChecked: number;
        chunksChecked: number;
        codeBlocksChecked: number;
        tagsChecked: number;
        languagesChecked: number;
    };
}

/**
 * Validator configuration
 */
export interface ValidatorConfig {
    /** Validate UUID format */
    validateUUIDs: boolean;
    /** Validate content hashes */
    validateHashes: boolean;
    /** Validate relationships */
    validateRelationships: boolean;
    /** Validate timestamps */
    validateTimestamps: boolean;
    /** Check for orphaned records */
    checkOrphaned: boolean;
    /** Maximum issues to report */
    maxIssues: number;
}

/**
 * Database interface for validation
 */
export interface ValidationDatabase {
    getAllDocuments(): Promise<DocumentV1[]>;
    getAllChunks(): Promise<ChunkV1[]>;
    getAllCodeBlocks(): Promise<CodeBlockV1[]>;
    getChunksByDocument(documentId: string): Promise<ChunkV1[]>;
    getCodeBlocksByDocument(documentId: string): Promise<CodeBlockV1[]>;
    getDocumentTags(documentId: string): Promise<string[]>;
    getDocumentLanguages(documentId: string): Promise<string[]>;
}

/**
 * Data integrity validator
 */
export class IntegrityValidator {
    private config: ValidatorConfig;

    constructor(config?: Partial<ValidatorConfig>) {
        this.config = {
            validateUUIDs: true,
            validateHashes: true,
            validateRelationships: true,
            validateTimestamps: true,
            checkOrphaned: true,
            maxIssues: 1000,
            ...config,
        };
    }

    /**
     * Validate entire database
     */
    async validate(db: ValidationDatabase): Promise<ValidationReport> {
        const issues: ValidationIssue[] = [];
        const stats = {
            documentsChecked: 0,
            chunksChecked: 0,
            codeBlocksChecked: 0,
            tagsChecked: 0,
            languagesChecked: 0,
        };

        logger.info('Starting database integrity validation...');

        // Get all data
        const documents = await db.getAllDocuments();
        const chunks = await db.getAllChunks();
        const codeBlocks = await db.getAllCodeBlocks();

        // Create lookup maps
        const documentMap = new Map(documents.map(d => [d.id, d]));
        const chunksByDocument = new Map<string, ChunkV1[]>();
        const codeBlocksByDocument = new Map<string, CodeBlockV1[]>();

        for (const chunk of chunks) {
            const docChunks = chunksByDocument.get(chunk.document_id) || [];
            docChunks.push(chunk);
            chunksByDocument.set(chunk.document_id, docChunks);
        }

        for (const block of codeBlocks) {
            const docBlocks = codeBlocksByDocument.get(block.document_id) || [];
            docBlocks.push(block);
            codeBlocksByDocument.set(block.document_id, docBlocks);
        }

        // Validate documents
        logger.debug(`Validating ${documents.length} documents...`);
        for (const doc of documents) {
            const docIssues = await this.validateDocument(doc);
            issues.push(...docIssues);
            stats.documentsChecked++;

            if (this.config.validateRelationships) {
                const relIssues = await this.validateDocumentRelationships(
                    doc,
                    documentMap,
                    chunksByDocument.get(doc.id) || [],
                    codeBlocksByDocument.get(doc.id) || []
                );
                issues.push(...relIssues);
            }

            if (issues.length >= this.config.maxIssues) {
                logger.warn(`Max issues (${this.config.maxIssues}) reached, stopping validation`);
                break;
            }
        }

        // Validate chunks
        logger.debug(`Validating ${chunks.length} chunks...`);
        for (const chunk of chunks) {
            const chunkIssues = await this.validateChunk(chunk, documentMap);
            issues.push(...chunkIssues);
            stats.chunksChecked++;

            if (issues.length >= this.config.maxIssues) break;
        }

        // Validate code blocks
        logger.debug(`Validating ${codeBlocks.length} code blocks...`);
        for (const block of codeBlocks) {
            const blockIssues = await this.validateCodeBlock(block, documentMap);
            issues.push(...blockIssues);
            stats.codeBlocksChecked++;

            if (issues.length >= this.config.maxIssues) break;
        }

        // Check for orphaned records
        if (this.config.checkOrphaned) {
            logger.debug('Checking for orphaned records...');
            const orphanedIssues = this.findOrphanedRecords(
                chunks,
                codeBlocks,
                documentMap
            );
            issues.push(...orphanedIssues);
        }

        // Calculate summary
        const summary = {
            errors: issues.filter(i => i.severity === 'error').length,
            warnings: issues.filter(i => i.severity === 'warning').length,
            info: issues.filter(i => i.severity === 'info').length,
            total: issues.length,
        };

        logger.info(`Validation complete: ${summary.errors} errors, ${summary.warnings} warnings, ${summary.info} info`);

        return {
            valid: summary.errors === 0,
            timestamp: new Date().toISOString(),
            issues: issues.slice(0, this.config.maxIssues),
            summary,
            stats,
        };
    }

    /**
     * Validate a single document
     */
    private async validateDocument(doc: DocumentV1): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        // Validate UUID
        if (this.config.validateUUIDs && !this.isValidUUID(doc.id)) {
            issues.push({
                severity: 'error',
                category: 'document',
                message: `Invalid document ID format: ${doc.id}`,
                entityId: doc.id,
                entityType: 'document',
                suggestion: 'Regenerate document with valid UUID',
            });
        }

        // Validate content hash
        if (this.config.validateHashes && doc.content_hash) {
            if (!this.isValidHash(doc.content_hash)) {
                issues.push({
                    severity: 'warning',
                    category: 'document',
                    message: `Invalid content hash format: ${doc.content_hash}`,
                    entityId: doc.id,
                    entityType: 'document',
                });
            }
        }

        // Validate timestamps
        if (this.config.validateTimestamps) {
            const createdAt = new Date(doc.created_at);
            const updatedAt = new Date(doc.updated_at);

            if (isNaN(createdAt.getTime())) {
                issues.push({
                    severity: 'error',
                    category: 'document',
                    message: `Invalid created_at timestamp: ${doc.created_at}`,
                    entityId: doc.id,
                    entityType: 'document',
                });
            }

            if (isNaN(updatedAt.getTime())) {
                issues.push({
                    severity: 'error',
                    category: 'document',
                    message: `Invalid updated_at timestamp: ${doc.updated_at}`,
                    entityId: doc.id,
                    entityType: 'document',
                });
            }

            if (!isNaN(createdAt.getTime()) && !isNaN(updatedAt.getTime()) && updatedAt < createdAt) {
                issues.push({
                    severity: 'warning',
                    category: 'document',
                    message: `Updated_at is before created_at`,
                    entityId: doc.id,
                    entityType: 'document',
                });
            }
        }

        // Validate counts
        if (doc.chunks_count < 0) {
            issues.push({
                severity: 'error',
                category: 'document',
                message: `Negative chunks_count: ${doc.chunks_count}`,
                entityId: doc.id,
                entityType: 'document',
            });
        }

        if (doc.code_blocks_count < 0) {
            issues.push({
                severity: 'error',
                category: 'document',
                message: `Negative code_blocks_count: ${doc.code_blocks_count}`,
                entityId: doc.id,
                entityType: 'document',
            });
        }

        // Validate source
        const validSources = ['upload', 'crawl', 'api'];
        if (!validSources.includes(doc.source)) {
            issues.push({
                severity: 'warning',
                category: 'document',
                message: `Unknown source type: ${doc.source}`,
                entityId: doc.id,
                entityType: 'document',
            });
        }

        // Validate status
        const validStatuses = ['active', 'archived', 'deleted'];
        if (!validStatuses.includes(doc.status)) {
            issues.push({
                severity: 'warning',
                category: 'document',
                message: `Unknown status: ${doc.status}`,
                entityId: doc.id,
                entityType: 'document',
            });
        }

        return issues;
    }

    /**
     * Validate document relationships
     */
    private async validateDocumentRelationships(
        doc: DocumentV1,
        documentMap: Map<string, DocumentV1>,
        docChunks: ChunkV1[],
        docCodeBlocks: CodeBlockV1[]
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        // Validate chunks count matches
        if (docChunks.length !== doc.chunks_count) {
            issues.push({
                severity: 'warning',
                category: 'relationship',
                message: `Chunks count mismatch: document says ${doc.chunks_count}, found ${docChunks.length}`,
                entityId: doc.id,
                entityType: 'document',
            });
        }

        // Validate code blocks count matches
        if (docCodeBlocks.length !== doc.code_blocks_count) {
            issues.push({
                severity: 'warning',
                category: 'relationship',
                message: `Code blocks count mismatch: document says ${doc.code_blocks_count}, found ${docCodeBlocks.length}`,
                entityId: doc.id,
                entityType: 'document',
            });
        }

        return issues;
    }

    /**
     * Validate a chunk
     */
    private async validateChunk(
        chunk: ChunkV1,
        documentMap: Map<string, DocumentV1>
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        // Validate UUID
        if (this.config.validateUUIDs && !this.isValidUUID(chunk.id)) {
            issues.push({
                severity: 'error',
                category: 'chunk',
                message: `Invalid chunk ID format: ${chunk.id}`,
                entityId: chunk.id,
                entityType: 'chunk',
            });
        }

        // Validate document reference
        if (this.config.validateRelationships && !documentMap.has(chunk.document_id)) {
            issues.push({
                severity: 'error',
                category: 'chunk',
                message: `Orphaned chunk: document ${chunk.document_id} not found`,
                entityId: chunk.id,
                entityType: 'chunk',
            });
        }

        // Validate embedding
        if (!chunk.embedding || chunk.embedding.length === 0) {
            issues.push({
                severity: 'warning',
                category: 'chunk',
                message: `Missing embedding`,
                entityId: chunk.id,
                entityType: 'chunk',
            });
        }

        // Validate positions
        if (chunk.start_position < 0 || chunk.end_position < 0) {
            issues.push({
                severity: 'error',
                category: 'chunk',
                message: `Invalid position: start=${chunk.start_position}, end=${chunk.end_position}`,
                entityId: chunk.id,
                entityType: 'chunk',
            });
        }

        if (chunk.start_position >= chunk.end_position) {
            issues.push({
                severity: 'error',
                category: 'chunk',
                message: `Start position >= end position`,
                entityId: chunk.id,
                entityType: 'chunk',
            });
        }

        // Validate content length
        if (chunk.content_length !== chunk.content.length) {
            issues.push({
                severity: 'warning',
                category: 'chunk',
                message: `Content length mismatch: field=${chunk.content_length}, actual=${chunk.content.length}`,
                entityId: chunk.id,
                entityType: 'chunk',
            });
        }

        return issues;
    }

    /**
     * Validate a code block
     */
    private async validateCodeBlock(
        block: CodeBlockV1,
        documentMap: Map<string, DocumentV1>
    ): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        // Validate UUID
        if (this.config.validateUUIDs && !this.isValidUUID(block.id)) {
            issues.push({
                severity: 'error',
                category: 'codeblock',
                message: `Invalid code block ID format: ${block.id}`,
                entityId: block.id,
                entityType: 'code_block',
            });
        }

        // Validate document reference
        if (this.config.validateRelationships && !documentMap.has(block.document_id)) {
            issues.push({
                severity: 'error',
                category: 'codeblock',
                message: `Orphaned code block: document ${block.document_id} not found`,
                entityId: block.id,
                entityType: 'code_block',
            });
        }

        // Validate embedding
        if (!block.embedding || block.embedding.length === 0) {
            issues.push({
                severity: 'warning',
                category: 'codeblock',
                message: `Missing embedding`,
                entityId: block.id,
                entityType: 'code_block',
            });
        }

        // Validate language
        if (!block.language) {
            issues.push({
                severity: 'warning',
                category: 'codeblock',
                message: `Missing language tag`,
                entityId: block.id,
                entityType: 'code_block',
            });
        }

        // Validate content length
        if (block.content_length !== block.content.length) {
            issues.push({
                severity: 'warning',
                category: 'codeblock',
                message: `Content length mismatch: field=${block.content_length}, actual=${block.content.length}`,
                entityId: block.id,
                entityType: 'code_block',
            });
        }

        return issues;
    }

    /**
     * Find orphaned records
     */
    private findOrphanedRecords(
        chunks: ChunkV1[],
        codeBlocks: CodeBlockV1[],
        documentMap: Map<string, DocumentV1>
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Find orphaned chunks
        for (const chunk of chunks) {
            if (!documentMap.has(chunk.document_id)) {
                issues.push({
                    severity: 'error',
                    category: 'orphan',
                    message: `Orphaned chunk references non-existent document`,
                    entityId: chunk.id,
                    entityType: 'chunk',
                    suggestion: `Delete chunk or restore document ${chunk.document_id}`,
                });
            }
        }

        // Find orphaned code blocks
        for (const block of codeBlocks) {
            if (!documentMap.has(block.document_id)) {
                issues.push({
                    severity: 'error',
                    category: 'orphan',
                    message: `Orphaned code block references non-existent document`,
                    entityId: block.id,
                    entityType: 'code_block',
                    suggestion: `Delete code block or restore document ${block.document_id}`,
                });
            }
        }

        return issues;
    }

    /**
     * Validate UUID format
     */
    private isValidUUID(uuid: string): boolean {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(uuid);
    }

    /**
     * Validate content hash format (SHA-256, first 16 chars)
     */
    private isValidHash(hash: string): boolean {
        return /^[a-f0-9]{16}$/i.test(hash);
    }

    /**
     * Calculate content hash
     */
    calculateContentHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    }

    /**
     * Validate a specific document by ID
     */
    async validateDocumentById(
        docId: string,
        db: ValidationDatabase
    ): Promise<ValidationReport> {
        const docs = await db.getAllDocuments();
        const doc = docs.find(d => d.id === docId);

        if (!doc) {
            return {
                valid: false,
                timestamp: new Date().toISOString(),
                issues: [{
                    severity: 'error',
                    category: 'document',
                    message: `Document not found: ${docId}`,
                    entityId: docId,
                    entityType: 'document',
                }],
                summary: { errors: 1, warnings: 0, info: 0, total: 1 },
                stats: {
                    documentsChecked: 0,
                    chunksChecked: 0,
                    codeBlocksChecked: 0,
                    tagsChecked: 0,
                    languagesChecked: 0,
                },
            };
        }

        const issues = await this.validateDocument(doc);

        return {
            valid: issues.length === 0,
            timestamp: new Date().toISOString(),
            issues,
            summary: {
                errors: issues.filter(i => i.severity === 'error').length,
                warnings: issues.filter(i => i.severity === 'warning').length,
                info: issues.filter(i => i.severity === 'info').length,
                total: issues.length,
            },
            stats: {
                documentsChecked: 1,
                chunksChecked: 0,
                codeBlocksChecked: 0,
                tagsChecked: 0,
                languagesChecked: 0,
            },
        };
    }
}

/**
 * Get validator configuration from environment
 */
export function getValidatorConfigFromEnv(): Partial<ValidatorConfig> {
    return {
        validateUUIDs: process.env.MCP_VALIDATE_UUIDS !== 'false',
        validateHashes: process.env.MCP_VALIDATE_HASHES !== 'false',
        validateRelationships: process.env.MCP_VALIDATE_RELATIONSHIPS !== 'false',
        validateTimestamps: process.env.MCP_VALIDATE_TIMESTAMPS !== 'false',
        checkOrphaned: process.env.MCP_CHECK_ORPHANED !== 'false',
        maxIssues: parseInt(process.env.MCP_MAX_VALIDATION_ISSUES || '1000', 10),
    };
}

/**
 * Create an integrity validator with environment configuration
 */
export function createIntegrityValidator(): IntegrityValidator {
    const config = getValidatorConfigFromEnv();
    return new IntegrityValidator(config);
}
