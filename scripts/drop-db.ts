#!/usr/bin/env node
/**
 * Saga v1.0.0 Database Drop Script
 *
 * Removes the database directory (for testing purposes).
 * Usage: node dist/scripts/drop-db.ts [options]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';
import chalk from 'chalk';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_DB_PATH = path.join(os.homedir(), '.saga', 'vector-db');

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
        .name('drop-db')
        .description('Drop/clear the Saga v1.0.0 database (for testing)')
        .version('1.0.0')
        .option('--db-path <path>', 'Path to the database directory', DEFAULT_DB_PATH)
        .option('--confirm', 'Confirm deletion (required)', false)
        .option('--backup', 'Create backup before deletion', false)
        .option('--verbose', 'Show verbose output', false)
        .parse(process.argv);
    
    const options = program.opts();
    
    // Print header
    console.log(chalk.bold.red('╔══════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.red('║') + chalk.bold.white('  Saga v1.0.0 Database Drop') + chalk.bold.red('                            ║'));
    console.log(chalk.bold.red('╚══════════════════════════════════════════════════════════╝'));
    console.log();
    
    // Check if database exists
    if (!isDirectoryNotEmpty(options.dbPath)) {
        console.log(chalk.yellow('⚠ Database directory not found or empty:'), chalk.cyan(options.dbPath));
        console.log(chalk.gray('  Nothing to delete.'));
        process.exit(0);
    }
    
    // Show database info
    const dirSize = getDirectorySize(options.dbPath);
    console.log(chalk.gray('Database:'), chalk.cyan(options.dbPath));
    console.log(chalk.gray('Size:'), chalk.cyan(formatBytes(dirSize)));
    console.log();
    
    // Check for confirmation flag
    if (!options.confirm) {
        console.log(chalk.red('⚠ DANGER: This will permanently delete all database data!'));
        console.log();
        console.log(chalk.gray('To confirm deletion, use the --confirm flag:'));
        console.log(chalk.cyan('  node dist/scripts/drop-db.ts --confirm'));
        console.log();
        console.log(chalk.gray('To create a backup before deletion, use --backup:'));
        console.log(chalk.cyan('  node dist/scripts/drop-db.ts --confirm --backup'));
        console.log();
        console.log(chalk.gray('For more options, use --help'));
        process.exit(1);
    }
    
    // Create backup if requested
    let backupPath: string | null = null;
    if (options.backup) {
        try {
            backupPath = await createBackup(options.dbPath, options);
            console.log(chalk.green('✓ Backup created:'), chalk.cyan(backupPath));
            console.log();
        } catch (error) {
            console.log(chalk.red('✗ Deletion aborted due to backup failure.'));
            process.exit(1);
        }
    }
    
    // Show warning
    console.log(chalk.bold.red('⚠ WARNING: This action cannot be undone!'));
    console.log(chalk.red('  All data in the database will be permanently deleted.'));
    console.log();
    
    // Delete database
    console.log(chalk.blue('Deleting database...'));
    
    try {
        // Remove database directory
        fs.rmSync(options.dbPath, { recursive: true, force: true });
        console.log(chalk.green('✓ Database deleted successfully'));
        console.log();
        
        // Print summary
        console.log(chalk.bold.red('═══════════════════════════════════════════════════════════'));
        console.log(chalk.bold.green('✓ Database drop complete!'));
        console.log(chalk.bold.red('═══════════════════════════════════════════════════════════'));
        console.log();
        console.log(chalk.gray('Deleted:'), chalk.cyan(options.dbPath));
        console.log(chalk.gray('Size freed:'), chalk.cyan(formatBytes(dirSize)));
        console.log();
        
        if (backupPath) {
            console.log(chalk.gray('Backup location:'), chalk.cyan(backupPath));
            console.log(chalk.gray('  You can restore from backup if needed:'));
            console.log(chalk.gray(`  mv ${backupPath} ${options.dbPath}`));
            console.log(chalk.gray('  Or remove the backup:'));
            console.log(chalk.gray(`  rm -rf ${backupPath}`));
            console.log();
        }
        
        console.log(chalk.gray('To initialize a new database, run:'));
        console.log(chalk.cyan('  npm run init-db-v1'));
        console.log();
        
    } catch (error: any) {
        console.log(chalk.red('✗ Failed to delete database:'), error.message);
        
        if (options.verbose) {
            console.log(chalk.gray('Stack trace:'), error.stack);
        }
        
        if (backupPath) {
            console.log();
            console.log(chalk.yellow('Backup available at:'), chalk.cyan(backupPath));
            console.log(chalk.gray('  The database was not deleted, but a backup was created.'));
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
