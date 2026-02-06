#!/usr/bin/env node
/**
 * Saga v1.0.0 Database Initialization Script
 *
 * Initializes a new v1.0.0 database with all required tables and indexes.
 * Usage: node dist/scripts/init-db-v1.ts [options]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';
import * as lancedb from '@lancedb/lancedb';
import { Index } from '@lancedb/lancedb';
import chalk from 'chalk';
import { getEmbeddingDimension } from '../src/utils.js';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_DB_PATH = path.join(os.homedir(), '.saga', 'lancedb');
const SCHEMA_VERSION = '1.0.0';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get current ISO 8601 timestamp
 */
function getCurrentTimestamp(): string {
    return new Date().toISOString();
}

/**
 * Generate a sample embedding vector for schema inference
 * Uses the configured embedding dimension (default: 4096)
 * This allows LanceDB to properly infer the embedding field type
 */
function generateSampleEmbedding(dim: number = getEmbeddingDimension()): number[] {
    return new Array(dim).fill(0);
}

/**
 * Format duration in milliseconds to human-readable format
 */
function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    } else if (ms < 60000) {
        return `${(ms / 1000).toFixed(2)}s`;
    } else {
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(2);
        return `${minutes}m ${seconds}s`;
    }
}

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Check if directory exists and is not empty
 */
function isDirectoryNotEmpty(dirPath: string): boolean {
    if (!fs.existsSync(dirPath)) {
        return false;
    }
    const files = fs.readdirSync(dirPath);
    return files.length > 0;
}

/**
 * Get directory size recursively
 */
function getDirectorySize(dirPath: string): number {
    let totalSize = 0;
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        
        if (stats.isDirectory()) {
            totalSize += getDirectorySize(filePath);
        } else {
            totalSize += stats.size;
        }
    }
    
    return totalSize;
}

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * Create all v1 tables with proper schema
 */
async function createV1Schema(db: any, options: { verbose: boolean }): Promise<void> {
    const tables = [
        'documents',
        'document_tags',
        'document_languages',
        'chunks',
        'code_blocks',
        'keywords',
        'schema_version'
    ];
    
    for (const tableName of tables) {
        try {
            let sampleData: any[] = [];
            
            // Create sample data for schema inference
            switch (tableName) {
                case 'documents':
                    sampleData = [{
                        id: crypto.randomUUID(),
                        title: '',
                        content: '',
                        content_hash: '',
                        content_length: 0,
                        source: 'upload',
                        original_filename: '',
                        file_extension: '',
                        crawl_id: '',
                        crawl_url: '',
                        author: '',
                        description: '',
                        content_type: '',
                        created_at: getCurrentTimestamp(),
                        updated_at: getCurrentTimestamp(),
                        processed_at: getCurrentTimestamp(),
                        chunks_count: 0,
                        code_blocks_count: 0,
                        status: 'active'
                    }];
                    break;
                case 'document_tags':
                    sampleData = [{
                        id: crypto.randomUUID(),
                        document_id: '',
                        tag: '',
                        is_generated: false,
                        created_at: getCurrentTimestamp()
                    }];
                    break;
                case 'document_languages':
                    sampleData = [{
                        id: crypto.randomUUID(),
                        document_id: '',
                        language_code: '',
                        created_at: getCurrentTimestamp()
                    }];
                    break;
                case 'chunks':
                    sampleData = [{
                        id: crypto.randomUUID(),
                        document_id: '',
                        chunk_index: 0,
                        start_position: 0,
                        end_position: 0,
                        content: '',
                        content_length: 0,
                        embedding: generateSampleEmbedding(),
                        surrounding_context: '',
                        semantic_topic: '',
                        created_at: getCurrentTimestamp()
                    }];
                    break;
                case 'code_blocks':
                    sampleData = [{
                        id: crypto.randomUUID(),
                        document_id: '',
                        block_id: '',
                        block_index: 0,
                        language: '',
                        content: '',
                        content_length: 0,
                        embedding: generateSampleEmbedding(),
                        source_url: '',
                        created_at: getCurrentTimestamp()
                    }];
                    break;
                case 'keywords':
                    sampleData = [{
                        id: crypto.randomUUID(),
                        keyword: '',
                        document_id: '',
                        source: 'title',
                        frequency: 0,
                        created_at: getCurrentTimestamp()
                    }];
                    break;
                case 'schema_version':
                    sampleData = [{
                        id: 0,
                        version: '',
                        applied_at: getCurrentTimestamp(),
                        description: ''
                    }];
                    break;
            }
            
            await db.createTable(tableName, sampleData);
            if (options.verbose) {
                console.log(chalk.green(`  ✓ Created table: ${tableName}`));
            }
        } catch (error: any) {
            if (error.message.includes('already exists')) {
                if (options.verbose) {
                    console.log(chalk.yellow(`  ⊙ Table already exists: ${tableName}`));
                }
            } else {
                throw error;
            }
        }
    }
}

/**
 * Create scalar indexes for all tables
 */
async function createScalarIndexes(db: any, options: { verbose: boolean }): Promise<void> {
    const indexes = [
        // Documents table
        { table: 'documents', columns: ['id', 'content_hash', 'source', 'crawl_id', 'status', 'created_at'] },
        // Chunks table
        { table: 'chunks', columns: ['document_id', 'chunk_index', 'created_at'] },
        // Code blocks table
        { table: 'code_blocks', columns: ['document_id', 'block_index', 'language', 'created_at'] },
        // Document tags table
        { table: 'document_tags', columns: ['document_id', 'tag'] },
        // Document languages table
        { table: 'document_languages', columns: ['document_id', 'language_code'] },
        // Keywords table
        { table: 'keywords', columns: ['keyword', 'document_id'] }
    ];
    
    for (const { table, columns } of indexes) {
        const tableRef = await db.openTable(table);
        
        for (const column of columns) {
            try {
                await tableRef.createIndex(column, { config: Index.btree() });
                if (options.verbose) {
                    console.log(chalk.green(`  ✓ Created scalar index: ${table}.${column}`));
                }
            } catch (error: any) {
                if (error.message.includes('already exists')) {
                    if (options.verbose) {
                        console.log(chalk.yellow(`  ⊙ Scalar index already exists: ${table}.${column}`));
                    }
                } else {
                    console.log(chalk.red(`  ✗ Failed to create scalar index: ${table}.${column}`));
                    if (options.verbose) {
                        console.log(chalk.gray(`    Error: ${error.message}`));
                    }
                }
            }
        }
    }
}

/**
 * Record schema version in schema_version table
 */
async function recordSchemaVersion(db: any, version: string, description: string): Promise<void> {
    const schemaVersionTable = await db.openTable('schema_version');
    
    const schemaVersion = {
        id: Date.now(),
        version,
        applied_at: getCurrentTimestamp(),
        description
    };
    
    await schemaVersionTable.add([schemaVersion]);
}

// ============================================================================
// Main Function
// ============================================================================

async function main(): Promise<void> {
    const program = new Command();
    
    program
        .name('init-db-v1')
        .description('Initialize a new Saga v1.0.0 database')
        .version('1.0.0')
        .option('--db-path <path>', 'Path to the database directory', DEFAULT_DB_PATH)
        .option('--force', 'Force overwrite existing database', false)
        .option('--verbose', 'Show verbose output', false)
        .option('--log <file>', 'Log output to file')
        .parse(process.argv);
    
    const options = program.opts();
    const startTime = Date.now();
    
    // Setup logging if requested
    if (options.log) {
        const logStream = fs.createWriteStream(options.log, { flags: 'a' });
        const originalConsoleLog = console.log;
        console.log = (...args: any[]) => {
            originalConsoleLog(...args);
            logStream.write(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ') + '\n');
        };
    }
    
    // Print header
    console.log(chalk.bold.blue('╔══════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.blue('║') + chalk.bold.white('  Saga v1.0.0 Database Initialization') + chalk.bold.blue('              ║'));
    console.log(chalk.bold.blue('╚══════════════════════════════════════════════════════════╝'));
    console.log();
    
    // Check if database already exists
    if (isDirectoryNotEmpty(options.dbPath)) {
        const dirSize = getDirectorySize(options.dbPath);
        console.log(chalk.yellow('⚠ Database directory already exists:'), chalk.cyan(options.dbPath));
        console.log(chalk.yellow('  Size:'), chalk.cyan(formatBytes(dirSize)));
        console.log();
        
        if (!options.force) {
            console.log(chalk.red('✗ Initialization aborted. Use --force to overwrite.'));
            console.log(chalk.gray('  Warning: This will delete all existing data!'));
            process.exit(1);
        }
        
        console.log(chalk.yellow('⚠ Force mode enabled. Removing existing database...'));
        console.log();
        
        try {
            fs.rmSync(options.dbPath, { recursive: true, force: true });
            console.log(chalk.green('✓ Existing database removed'));
        } catch (error: any) {
            console.log(chalk.red('✗ Failed to remove existing database:'), error.message);
            process.exit(1);
        }
    }
    
    // Create database directory
    try {
        fs.mkdirSync(options.dbPath, { recursive: true });
        console.log(chalk.green('✓ Database directory created:'), chalk.cyan(options.dbPath));
    } catch (error: any) {
        console.log(chalk.red('✗ Failed to create database directory:'), error.message);
        process.exit(1);
    }
    
    console.log();
    
    // Connect to database
    console.log(chalk.blue('Connecting to database...'));
    try {
        const db = await lancedb.connect(options.dbPath);
        console.log(chalk.green('✓ Connected to database'));
        console.log();
        
        // Create schema
        console.log(chalk.blue('Creating schema...'));
        await createV1Schema(db, options);
        console.log(chalk.green('✓ Schema created'));
        console.log();
        
        // Create scalar indexes
        console.log(chalk.blue('Creating scalar indexes...'));
        await createScalarIndexes(db, options);
        console.log(chalk.green('✓ Scalar indexes created'));
        console.log();
        
        // Record schema version
        console.log(chalk.blue('Recording schema version...'));
        await recordSchemaVersion(db, SCHEMA_VERSION, 'Initial v1.0.0 schema with flattened metadata and normalized tables');
        console.log(chalk.green(`✓ Schema version ${SCHEMA_VERSION} recorded`));
        console.log();
        
        // Close connection
        await db.close();
        console.log(chalk.green('✓ Database connection closed'));
        console.log();
        
        // Print summary
        const duration = Date.now() - startTime;
        console.log(chalk.bold.blue('═══════════════════════════════════════════════════════════'));
        console.log(chalk.bold.green('✓ Database initialization complete!'));
        console.log(chalk.bold.blue('═══════════════════════════════════════════════════════════'));
        console.log();
        console.log(chalk.gray('Database:'), chalk.cyan(options.dbPath));
        console.log(chalk.gray('Schema version:'), chalk.cyan(SCHEMA_VERSION));
        console.log(chalk.gray('Duration:'), chalk.cyan(formatDuration(duration)));
        console.log();
        console.log(chalk.gray('Tables created:'));
        console.log(chalk.gray('  • documents'));
        console.log(chalk.gray('  • document_tags'));
        console.log(chalk.gray('  • document_languages'));
        console.log(chalk.gray('  • chunks'));
        console.log(chalk.gray('  • code_blocks'));
        console.log(chalk.gray('  • keywords'));
        console.log(chalk.gray('  • schema_version'));
        console.log();
        console.log(chalk.gray('Note: Vector indexes will be created automatically when data is added.'));
        console.log();
        
    } catch (error: any) {
        console.log(chalk.red('✗ Database initialization failed:'), error.message);
        if (options.verbose) {
            console.log(chalk.gray('Stack trace:'), error.stack);
        }
        process.exit(1);
    }
}

// ============================================================================
// Run
// ============================================================================

main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
});
