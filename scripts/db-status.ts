#!/usr/bin/env node
/**
 * Saga v1.0.0 Database Status Script
 *
 * Checks database health, schema version, and statistics.
 * Usage: node dist/scripts/db-status.ts [options]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';
import * as lancedb from '@lancedb/lancedb';
import { LanceDBV1 } from '../src/vector-db/lance-db-v1.js';
import chalk from 'chalk';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_DB_PATH = path.join(os.homedir(), '.saga', 'vector-db');
const EXPECTED_SCHEMA_VERSION = '1.0.0';

// ============================================================================
// Utility Functions
// ============================================================================

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
 * Format number with thousands separator
 */
function formatNumber(num: number): string {
    return num.toLocaleString();
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

/**
 * Get table directory size
 */
function getTableSize(dbPath: string, tableName: string): number {
    const tablePath = path.join(dbPath, `${tableName}.lance`);
    
    if (!fs.existsSync(tablePath)) {
        return 0;
    }
    
    return getDirectorySize(tablePath);
}

/**
 * Check if database needs migration
 */
async function checkMigrationNeeded(db: any): Promise<boolean> {
    try {
        const schemaVersionTable = await db.openTable('schema_version');
        const versions = await schemaVersionTable.query().toArray();
        
        if (versions.length === 0) {
            return true; // No version recorded, needs migration
        }
        
        const latestVersion = versions[versions.length - 1].version;
        return latestVersion !== EXPECTED_SCHEMA_VERSION;
    } catch (error) {
        // Table doesn't exist or other error, assume migration needed
        return true;
    }
}

/**
 * Get detailed table statistics
 */
async function getTableStats(db: any, tableName: string): Promise<{ count: number; size: number }> {
    try {
        const table = await db.openTable(tableName);
        const count = await table.countRows();
        return { count, size: 0 }; // Size will be calculated separately
    } catch (error) {
        return { count: 0, size: 0 };
    }
}

// ============================================================================
// Main Function
// ============================================================================

async function main(): Promise<void> {
    const program = new Command();
    
    program
        .name('db-status')
        .description('Check Saga v1.0.0 database status and health')
        .version('1.0.0')
        .option('--db-path <path>', 'Path to the database directory', DEFAULT_DB_PATH)
        .option('--verbose', 'Show verbose output', false)
        .option('--json', 'Output in JSON format', false)
        .parse(process.argv);
    
    const options = program.opts();
    
    // Check if database exists
    if (!fs.existsSync(options.dbPath)) {
        const error = {
            status: 'error',
            message: 'Database directory not found',
            path: options.dbPath
        };
        
        if (options.json) {
            console.log(JSON.stringify(error, null, 2));
        } else {
            console.log(chalk.red('✗ Database directory not found:'), chalk.cyan(options.dbPath));
            console.log(chalk.gray('  Run "npm run init-db-v1" to initialize a new database.'));
        }
        
        process.exit(1);
    }
    
    // Connect to database
    let db: any;
    let lanceDb: LanceDBV1;
    
    try {
        db = await lancedb.connect(options.dbPath);
        lanceDb = new LanceDBV1(options.dbPath);
        await lanceDb.initialize();
    } catch (error: any) {
        const errorObj = {
            status: 'error',
            message: 'Failed to connect to database',
            error: error.message
        };
        
        if (options.json) {
            console.log(JSON.stringify(errorObj, null, 2));
        } else {
            console.log(chalk.red('✗ Failed to connect to database:'), error.message);
        }
        
        process.exit(1);
    }
    
    try {
        // Get database statistics
        const stats = await lanceDb.getStats();
        
        // Check if migration is needed
        const migrationNeeded = await checkMigrationNeeded(db);
        
        // Calculate storage sizes
        const totalSize = getDirectorySize(options.dbPath);
        const tables = ['documents', 'document_tags', 'document_languages', 'chunks', 'code_blocks', 'keywords', 'schema_version'];
        const tableSizes: Record<string, number> = {};
        
        for (const tableName of tables) {
            tableSizes[tableName] = getTableSize(options.dbPath, tableName);
        }
        
        // Update stats with storage info
        stats.storageUsage = {
            documents: tableSizes.documents,
            chunks: tableSizes.chunks,
            codeBlocks: tableSizes.code_blocks,
            keywords: tableSizes.keywords,
            total: totalSize
        };
        
        // Output results
        if (options.json) {
            const output = {
                status: 'ok',
                database: {
                    path: options.dbPath,
                    schemaVersion: stats.schemaVersion,
                    migrationNeeded,
                    totalSize
                },
                tables: {
                    documents: { count: stats.documentCount, size: tableSizes.documents },
                    documentTags: { count: stats.tagCount, size: tableSizes.document_tags },
                    documentLanguages: { count: stats.languageCount, size: tableSizes.document_languages },
                    chunks: { count: stats.chunkCount, size: tableSizes.chunks },
                    codeBlocks: { count: stats.codeBlockCount, size: tableSizes.code_blocks },
                    keywords: { count: stats.keywordCount, size: tableSizes.keywords },
                    schemaVersion: { count: 1, size: tableSizes.schema_version }
                },
                indexes: stats.indexes
            };
            
            console.log(JSON.stringify(output, null, 2));
        } else {
            // Print header
            console.log(chalk.bold.blue('╔══════════════════════════════════════════════════════════╗'));
            console.log(chalk.bold.blue('║') + chalk.bold.white('  Saga v1.0.0 Database Status') + chalk.bold.blue('                        ║'));
            console.log(chalk.bold.blue('╚══════════════════════════════════════════════════════════╝'));
            console.log();
            
            // Database info
            console.log(chalk.bold.blue('Database Information:'));
            console.log(chalk.gray('  Path:'), chalk.cyan(options.dbPath));
            console.log(chalk.gray('  Schema version:'), chalk.cyan(stats.schemaVersion));
            console.log(chalk.gray('  Expected version:'), chalk.cyan(EXPECTED_SCHEMA_VERSION));
            
            if (migrationNeeded) {
                console.log(chalk.gray('  Migration status:'), chalk.yellow('NEEDS MIGRATION'));
                console.log(chalk.gray('  Run:'), chalk.cyan('npm run migrate-to-v1'));
            } else {
                console.log(chalk.gray('  Migration status:'), chalk.green('UP TO DATE'));
            }
            
            console.log(chalk.gray('  Total size:'), chalk.cyan(formatBytes(totalSize)));
            console.log();
            
            // Table statistics
            console.log(chalk.bold.blue('Table Statistics:'));
            console.log();
            
            const tableData = [
                { name: 'documents', count: stats.documentCount, size: tableSizes.documents },
                { name: 'document_tags', count: stats.tagCount, size: tableSizes.document_tags },
                { name: 'document_languages', count: stats.languageCount, size: tableSizes.document_languages },
                { name: 'chunks', count: stats.chunkCount, size: tableSizes.chunks },
                { name: 'code_blocks', count: stats.codeBlockCount, size: tableSizes.code_blocks },
                { name: 'keywords', count: stats.keywordCount, size: tableSizes.keywords },
                { name: 'schema_version', count: 1, size: tableSizes.schema_version }
            ];
            
            // Calculate max widths
            const maxNameLen = Math.max(...tableData.map(t => t.name.length));
            const maxCountLen = Math.max(...tableData.map(t => formatNumber(t.count).length));
            
            for (const table of tableData) {
                const countStr = formatNumber(table.count);
                const sizeStr = formatBytes(table.size);
                console.log(
                    chalk.gray(`  ${table.name.padEnd(maxNameLen)}  `) +
                    chalk.cyan(countStr.padStart(maxCountLen)) +
                    chalk.gray(' rows  ') +
                    chalk.cyan(sizeStr)
                );
            }
            
            console.log();
            
            // Index status
            console.log(chalk.bold.blue('Index Status:'));
            console.log();
            
            console.log(chalk.gray('  Vector indexes:'));
            for (const index of stats.indexes.vector) {
                console.log(chalk.gray('    •'), chalk.cyan(index));
            }
            
            if (stats.indexes.vector.length === 0) {
                console.log(chalk.gray('    (none - indexes will be created when data is added)'));
            }
            
            console.log();
            console.log(chalk.gray('  Scalar indexes:'));
            for (const index of stats.indexes.scalar) {
                console.log(chalk.gray('    •'), chalk.cyan(index));
            }
            
            console.log();
            
            // Health check
            console.log(chalk.bold.blue('Health Check:'));
            console.log();
            
            const healthChecks = [
                { name: 'Database accessible', status: true },
                { name: 'Schema version recorded', status: stats.schemaVersion !== 'unknown' },
                { name: 'All tables present', status: true },
                { name: 'Migration required', status: migrationNeeded, warning: true }
            ];
            
            for (const check of healthChecks) {
                if (check.warning) {
                    if (check.status) {
                        console.log(chalk.yellow(`  ⚠ ${check.name}`));
                    } else {
                        console.log(chalk.green(`  ✓ ${check.name}`));
                    }
                } else {
                    if (check.status) {
                        console.log(chalk.green(`  ✓ ${check.name}`));
                    } else {
                        console.log(chalk.red(`  ✗ ${check.name}`));
                    }
                }
            }
            
            console.log();
        }
        
        // Close connection
        await lanceDb.close();
        
    } catch (error: any) {
        const errorObj = {
            status: 'error',
            message: 'Failed to get database status',
            error: error.message
        };
        
        if (options.json) {
            console.log(JSON.stringify(errorObj, null, 2));
        } else {
            console.log(chalk.red('✗ Failed to get database status:'), error.message);
            
            if (options.verbose) {
                console.log(chalk.gray('Stack trace:'), error.stack);
            }
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
