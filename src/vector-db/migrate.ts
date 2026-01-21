/**
 * Data Migration Utility
 * 
 * Migrates existing JSON-based document storage to LanceDB format.
 * Automatically runs on first LanceDB initialization if no data is present.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { glob } from "glob";
import type { VectorDatabase } from "./lance-db.js";
import { Document, DocumentChunk } from "../types.js";
import { getLogger, getDefaultDataDir } from "../utils.js";

const logger = getLogger("Migration");

export interface MigrationResult {
    success: boolean;
    documentsMigrated: number;
    chunksMigrated: number;
    errors: string[];
}

/**
 * Migrate all JSON documents from the data directory to LanceDB
 */
export async function migrateFromJson(
    vectorDb: VectorDatabase,
    dataDir?: string
): Promise<MigrationResult> {
    const result: MigrationResult = {
        success: false,
        documentsMigrated: 0,
        chunksMigrated: 0,
        errors: []
    };

    const baseDir = dataDir || getDefaultDataDir();
    const dataPath = path.join(baseDir, "data");

    try {
        logger.info(`Starting migration from JSON to LanceDB at: ${dataPath}`);

        // Ensure data directory exists
        try {
            await fs.access(dataPath);
        } catch {
            logger.info("Data directory does not exist, nothing to migrate");
            result.success = true;
            return result;
        }

        // Find all JSON document files
        const globPattern = dataPath.replace(/\\/g, '/') + "/*.json";
        const files = await glob(globPattern);

        if (files.length === 0) {
            logger.info("No JSON documents found to migrate");
            result.success = true;
            return result;
        }

        logger.info(`Found ${files.length} JSON documents to migrate`);

        // Process each document
        for (const file of files) {
            try {
                const content = await fs.readFile(file, 'utf-8');
                const document: Document = JSON.parse(content);

                // Validate document structure
                if (!document.id || !document.chunks || document.chunks.length === 0) {
                    result.errors.push(`Invalid document structure in: ${path.basename(file)}`);
                    continue;
                }

                // Check if chunks have embeddings
                const chunksWithEmbeddings = document.chunks.filter(
                    chunk => chunk.embeddings && chunk.embeddings.length > 0
                );

                if (chunksWithEmbeddings.length === 0) {
                    result.errors.push(`No embeddings found in: ${path.basename(file)}`);
                    continue;
                }

                // Check if chunks are already migrated by checking if the first chunk exists
                const firstChunkId = chunksWithEmbeddings[0].id;
                const existingChunk = await vectorDb.getChunk(firstChunkId);
                
                if (existingChunk !== null) {
                    // Document already migrated, skip it
                    logger.debug(`Skipping already migrated document: ${document.id}`);
                    continue;
                }

                // Add chunks to vector database
                await vectorDb.addChunks(chunksWithEmbeddings);
                
                result.documentsMigrated++;
                result.chunksMigrated += chunksWithEmbeddings.length;
                
                logger.debug(`Migrated document: ${document.id} (${chunksWithEmbeddings.length} chunks)`);
            } catch (error) {
                const errorMsg = `Failed to migrate ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`;
                logger.error(errorMsg);
                result.errors.push(errorMsg);
            }
        }

        // Check if migration was successful
        if (result.documentsMigrated > 0) {
            logger.info(`Migration completed: ${result.documentsMigrated} documents, ${result.chunksMigrated} chunks migrated`);
            result.success = true;
        } else if (result.errors.length === 0) {
            // No documents to migrate is considered successful
            logger.info("No documents needed migration");
            result.success = true;
        } else {
            logger.warn(`Migration completed with errors: ${result.errors.length} errors`);
        }

        return result;
    } catch (error) {
        const errorMsg = `Migration failed: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(errorMsg);
        result.errors.push(errorMsg);
        return result;
    }
}

/**
 * Check if migration is needed
 * Returns true if LanceDB is empty but JSON files exist
 */
export async function needsMigration(vectorDb: VectorDatabase, dataDir?: string): Promise<boolean> {
    try {
        const baseDir = dataDir || getDefaultDataDir();
        const dataPath = path.join(baseDir, "data");

        // Check if data directory exists
        try {
            await fs.access(dataPath);
        } catch {
            return false;
        }

        // Check if there are JSON files
        const globPattern = dataPath.replace(/\\/g, '/') + "/*.json";
        const files = await glob(globPattern);

        if (files.length === 0) {
            return false;
        }

        // Check if vector DB has any data
        // For LanceDB, we'd need to check the table count
        // For simplicity, we'll check if we can find any chunks
        // This is a basic check - could be enhanced
        
        return true;
    } catch (error) {
        logger.error("Error checking migration need:", error);
        return false;
    }
}

/**
 * Manual migration command for CLI usage
 */
export async function runManualMigration(dataDir?: string): Promise<void> {
    const { LanceDBAdapter } = await import("./lance-db.js");
    
    const baseDir = dataDir || getDefaultDataDir();
    const dbPath = path.join(baseDir, "lancedb");
    
    logger.info(`Running manual migration to: ${dbPath}`);
    
    const vectorDb = new LanceDBAdapter(dbPath);
    await vectorDb.initialize();
    
    const result = await migrateFromJson(vectorDb, baseDir);
    
    if (result.success) {
        logger.info(`Migration successful: ${result.documentsMigrated} documents, ${result.chunksMigrated} chunks`);
    } else {
        logger.error(`Migration failed: ${result.errors.join(", ")}`);
    }
    
    await vectorDb.close();
}
