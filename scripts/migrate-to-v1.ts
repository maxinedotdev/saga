#!/usr/bin/env node
/**
 * Saga v1.0.0 Database Migration Script
 *
 * Migrates from the old database schema to the new v1.0.0 schema.
 * Usage: node dist/scripts/migrate-to-v1.ts [options]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';
import { migrateToV1 } from '../src/vector-db/migrate-v1.js';
import chalk from 'chalk';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_DB_PATH = path.join(os.homedir(), '.saga', 'vector-db');
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

/**
 * Create backup of database
 */
async function createBackup(dbPath: string, options: { verbose: boolean }): Promise<string> {
    const backupPath = `${dbPath}.backup.${Date.now()}`;
    
    if (options.verbose) {
        console.log(chalk.blue('Creating backup...'));
    }
    
    try {
        // Copy database directory
        await fs.promises.cp(dbPath, backupPath, { recursive: true });
        
        if (options.verbose) {
            console.log(chalk.green(`  ✓ Backup created: ${backupPath}`));
        }
        
        return backupPath;
    } catch (error: any) {
        console.log(chalk.red('✗ Failed to create backup:'), error.message);
        throw error;
    }
}

// ============================================================================
// Main Function
// ============================================================================

async function main(): Promise<void> {
    const program = new Command();
    
    program
        .name('migrate-to-v1')
        .description('Migrate from old database schema to Saga v1.0.0')
        .version('1.0.0')
        .option('--db-path <path>', 'Path to the database directory', DEFAULT_DB_PATH)
        .option('--backup', 'Create backup before migration', false)
        .option('--batch-size <size>', 'Batch size for processing (default: 1000)', '1000')
        .option('--skip-validation', 'Skip post-migration validation', false)
        .option('--skip-indexes', 'Skip index creation', false)
        .option('--dry-run', 'Dry run without making changes', false)
        .option('--verbose', 'Show verbose output', false)
        .option('--log <file>', 'Log output to file')
        .parse(process.argv);
    
    const options = program.opts();
    const startTime = Date.now();
    
    // Parse batch size
    const batchSize = parseInt(options.batchSize, 10);
    if (isNaN(batchSize) || batchSize < 1) {
        console.log(chalk.red('✗ Invalid batch size. Must be a positive integer.'));
        process.exit(1);
    }
    
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
    console.log(chalk.bold.blue('║') + chalk.bold.white('  Saga v1.0.0 Database Migration') + chalk.bold.blue('                    ║'));
    console.log(chalk.bold.blue('╚══════════════════════════════════════════════════════════╝'));
    console.log();
    
    // Check if database exists
    if (!isDirectoryNotEmpty(options.dbPath)) {
        console.log(chalk.red('✗ Database directory not found or empty:'), chalk.cyan(options.dbPath));
        console.log(chalk.gray('  Please ensure the database exists before migrating.'));
        process.exit(1);
    }
    
    // Show database info
    const dirSize = getDirectorySize(options.dbPath);
    console.log(chalk.gray('Database:'), chalk.cyan(options.dbPath));
    console.log(chalk.gray('Size:'), chalk.cyan(formatBytes(dirSize)));
    console.log();
    
    // Create backup if requested
    let backupPath: string | null = null;
    if (options.backup && !options.dryRun) {
        try {
            backupPath = await createBackup(options.dbPath, options);
            console.log(chalk.green('✓ Backup created:'), chalk.cyan(backupPath));
            console.log();
        } catch (error) {
            console.log(chalk.red('✗ Migration aborted due to backup failure.'));
            process.exit(1);
        }
    }
    
    // Show migration options
    console.log(chalk.blue('Migration options:'));
    console.log(chalk.gray('  • Batch size:'), chalk.cyan(batchSize));
    console.log(chalk.gray('  • Validation:'), options.skipValidation ? chalk.yellow('skipped') : chalk.green('enabled'));
    console.log(chalk.gray('  • Index creation:'), options.skipIndexes ? chalk.yellow('skipped') : chalk.green('enabled'));
    console.log(chalk.gray('  • Dry run:'), options.dryRun ? chalk.yellow('yes') : chalk.green('no'));
    console.log();
    
    // Perform migration
    console.log(chalk.blue('Starting migration...'));
    console.log();
    
    try {
        const result = await migrateToV1(options.dbPath, {
            batchSize,
            progressTracking: true,
            rollbackOnFailure: false,
            dryRun: options.dryRun,
            createIndexes: !options.skipIndexes,
            validateAfterMigration: !options.skipValidation
        });
        
        console.log();
        
        // Print results
        if (result.success) {
            console.log(chalk.bold.blue('═══════════════════════════════════════════════════════════'));
            console.log(chalk.bold.green('✓ Migration completed successfully!'));
            console.log(chalk.bold.blue('═══════════════════════════════════════════════════════════'));
            console.log();
            
            const duration = Date.now() - startTime;
            console.log(chalk.gray('Duration:'), chalk.cyan(formatDuration(duration)));
            console.log();
            
            console.log(chalk.gray('Migration statistics:'));
            console.log(chalk.gray('  • Documents migrated:'), chalk.cyan(result.documentsMigrated.toLocaleString()));
            console.log(chalk.gray('  • Chunks migrated:'), chalk.cyan(result.chunksMigrated.toLocaleString()));
            console.log(chalk.gray('  • Code blocks migrated:'), chalk.cyan(result.codeBlocksMigrated.toLocaleString()));
            console.log(chalk.gray('  • Tags migrated:'), chalk.cyan(result.tagsMigrated.toLocaleString()));
            console.log(chalk.gray('  • Languages migrated:'), chalk.cyan(result.languagesMigrated.toLocaleString()));
            console.log(chalk.gray('  • Keywords created:'), chalk.cyan(result.keywordsCreated.toLocaleString()));
            console.log();
            
            if (backupPath) {
                console.log(chalk.gray('Backup location:'), chalk.cyan(backupPath));
                console.log(chalk.gray('  You can remove this backup after verifying the migration:'));
                console.log(chalk.gray(`  rm -rf ${backupPath}`));
                console.log();
            }
            
            console.log(chalk.gray('Schema version:'), chalk.cyan(SCHEMA_VERSION));
            console.log();
            
            if (result.errors.length > 0) {
                console.log(chalk.yellow('Warnings encountered:'));
                for (const error of result.errors) {
                    console.log(chalk.yellow(`  • ${error}`));
                }
                console.log();
            }
        } else {
            console.log(chalk.bold.red('✗ Migration failed!'));
            console.log();
            
            console.log(chalk.red('Errors:'));
            for (const error of result.errors) {
                console.log(chalk.red(`  • ${error}`));
            }
            console.log();
            
            if (backupPath) {
                console.log(chalk.yellow('Backup available at:'), chalk.cyan(backupPath));
                console.log(chalk.gray('  You can restore from backup if needed.'));
                console.log();
            }
            
            process.exit(1);
        }
        
    } catch (error: any) {
        console.log();
        console.log(chalk.red('✗ Migration failed with error:'), error.message);
        
        if (options.verbose) {
            console.log(chalk.gray('Stack trace:'), error.stack);
        }
        
        if (backupPath) {
            console.log();
            console.log(chalk.yellow('Backup available at:'), chalk.cyan(backupPath));
            console.log(chalk.gray('  You can restore from backup if needed.'));
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
