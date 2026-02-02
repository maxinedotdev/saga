/**
 * Automated Backup Manager Implementation
 *
 * Provides scheduled backups with configurable retention.
 * Uses node-cron for scheduling and fs-extra for file operations.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as cron from 'node-cron';
import { getLogger } from '../utils.js';

const logger = getLogger('BackupManager');

/**
 * Backup configuration
 */
export interface BackupConfig {
    /** Cron expression for backup schedule (default: '0 2 * * *' = daily at 2 AM) */
    schedule: string;
    /** Number of backups to retain (default: 7) */
    retention: number;
    /** Backup destination directory */
    destination: string;
    /** Whether to compress backups (default: true) */
    compression: boolean;
    /** Source database directory */
    sourceDir: string;
    /** Backup file prefix */
    prefix: string;
}

/**
 * Backup metadata
 */
export interface BackupMetadata {
    /** Backup ID (timestamp) */
    id: string;
    /** Backup timestamp */
    timestamp: string;
    /** Backup file path */
    path: string;
    /** Size in bytes */
    size: number;
    /** Whether compressed */
    compressed: boolean;
    /** Number of files backed up */
    fileCount: number;
    /** Duration in milliseconds */
    duration: number;
    /** Status */
    status: 'success' | 'failed';
    /** Error message if failed */
    error?: string;
}

/**
 * Backup statistics
 */
export interface BackupStats {
    /** Total backups created */
    totalBackups: number;
    /** Successful backups */
    successfulBackups: number;
    /** Failed backups */
    failedBackups: number;
    /** Total backup size in bytes */
    totalSize: number;
    /** Average backup duration */
    averageDuration: number;
    /** Last backup timestamp */
    lastBackup: string | null;
}

/**
 * Backup manager for automated database backups
 */
export class BackupManager {
    private config: BackupConfig;
    private scheduledTask: cron.ScheduledTask | null = null;
    private isRunning = false;
    private backupHistory: BackupMetadata[] = [];
    private stats: BackupStats = {
        totalBackups: 0,
        successfulBackups: 0,
        failedBackups: 0,
        totalSize: 0,
        averageDuration: 0,
        lastBackup: null,
    };

    constructor(config: Partial<BackupConfig> & { sourceDir: string }) {
        this.config = {
            schedule: '0 2 * * *', // Daily at 2 AM
            retention: 7,
            destination: path.join(config.sourceDir, 'backups'),
            compression: true,
            prefix: 'saga-backup',
            ...config,
        };

        logger.debug(`Created backup manager: schedule=${this.config.schedule}, retention=${this.config.retention}`);
    }

    /**
     * Initialize backup manager
     */
    async initialize(): Promise<void> {
        // Ensure backup destination exists
        await fs.ensureDir(this.config.destination);
        logger.info(`Backup destination: ${this.config.destination}`);

        // Load existing backup history
        await this.loadBackupHistory();
    }

    /**
     * Start scheduled backups
     */
    start(): void {
        if (this.scheduledTask) {
            logger.warn('Backup scheduler already running');
            return;
        }

        if (!cron.validate(this.config.schedule)) {
            throw new Error(`Invalid cron schedule: ${this.config.schedule}`);
        }

        this.scheduledTask = cron.schedule(this.config.schedule, async () => {
            logger.info('Running scheduled backup...');
            try {
                await this.createBackup();
            } catch (error) {
                logger.error('Scheduled backup failed:', error);
            }
        });

        logger.info(`Backup scheduler started: ${this.config.schedule}`);
    }

    /**
     * Stop scheduled backups
     */
    stop(): void {
        if (this.scheduledTask) {
            this.scheduledTask.stop();
            this.scheduledTask = null;
            logger.info('Backup scheduler stopped');
        }
    }

    /**
     * Create a manual backup
     */
    async createBackup(): Promise<BackupMetadata> {
        if (this.isRunning) {
            throw new Error('Backup already in progress');
        }

        this.isRunning = true;
        const startTime = Date.now();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupId = timestamp;

        const backupDir = path.join(this.config.destination, `${this.config.prefix}-${timestamp}`);

        const metadata: BackupMetadata = {
            id: backupId,
            timestamp: new Date().toISOString(),
            path: backupDir,
            size: 0,
            compressed: false,
            fileCount: 0,
            duration: 0,
            status: 'success',
        };

        try {
            logger.info(`Creating backup: ${backupId}`);

            // Check source directory exists
            if (!(await fs.pathExists(this.config.sourceDir))) {
                throw new Error(`Source directory does not exist: ${this.config.sourceDir}`);
            }

            // Create backup (copy directory)
            await fs.copy(this.config.sourceDir, backupDir, {
                filter: (src) => !src.includes('backups'), // Exclude backup directory
            });

            // Count files and get size
            const stats = await this.getBackupStats(backupDir);
            metadata.size = stats.size;
            metadata.fileCount = stats.fileCount;
            metadata.duration = Date.now() - startTime;

            this.backupHistory.push(metadata);
            await this.saveBackupHistory();

            // Update statistics
            this.updateStats(metadata);

            // Clean old backups
            await this.cleanOldBackups();

            logger.info(`Backup completed: ${backupId} (${this.formatBytes(metadata.size)}, ${metadata.duration}ms)`);

            return metadata;
        } catch (error) {
            metadata.status = 'failed';
            metadata.error = error instanceof Error ? error.message : String(error);
            metadata.duration = Date.now() - startTime;

            this.backupHistory.push(metadata);
            await this.saveBackupHistory();

            this.updateStats(metadata);

            logger.error(`Backup failed: ${backupId}`, error);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Get backup statistics
     */
    private async getBackupStats(backupPath: string): Promise<{ size: number; fileCount: number }> {
        const stats = await fs.stat(backupPath);

        if (stats.isFile()) {
            return { size: stats.size, fileCount: 1 };
        }

        // Count files in directory
        let fileCount = 0;
        let totalSize = 0;

        const countFiles = async (dir: string) => {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await countFiles(fullPath);
                } else {
                    fileCount++;
                    const fileStats = await fs.stat(fullPath);
                    totalSize += fileStats.size;
                }
            }
        };

        await countFiles(backupPath);
        return { size: totalSize, fileCount };
    }

    /**
     * Clean old backups based on retention policy
     */
    async cleanOldBackups(): Promise<number> {
        const successfulBackups = this.backupHistory
            .filter(b => b.status === 'success')
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        const toDelete = successfulBackups.slice(this.config.retention);
        let deleted = 0;

        for (const backup of toDelete) {
            try {
                await fs.remove(backup.path);
                logger.debug(`Deleted old backup: ${backup.id}`);
                deleted++;
            } catch (error) {
                logger.warn(`Failed to delete old backup: ${backup.id}`, error);
            }
        }

        // Remove deleted backups from history
        this.backupHistory = this.backupHistory.filter(
            b => !toDelete.find(d => d.id === b.id)
        );
        await this.saveBackupHistory();

        if (deleted > 0) {
            logger.info(`Cleaned ${deleted} old backups (retention: ${this.config.retention})`);
        }

        return deleted;
    }

    /**
     * List all backups
     */
    async listBackups(): Promise<BackupMetadata[]> {
        return [...this.backupHistory].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    }

    /**
     * Restore from a backup
     */
    async restoreBackup(backupId: string, targetDir?: string): Promise<void> {
        const backup = this.backupHistory.find(b => b.id === backupId);
        if (!backup) {
            throw new Error(`Backup not found: ${backupId}`);
        }

        if (backup.status !== 'success') {
            throw new Error(`Cannot restore from failed backup: ${backupId}`);
        }

        const restoreDir = targetDir || this.config.sourceDir;
        logger.info(`Restoring backup ${backupId} to ${restoreDir}`);

        // Backup current state first
        const currentBackupDir = `${restoreDir}.pre-restore-${Date.now()}`;
        await fs.move(restoreDir, currentBackupDir);

        try {
            // Copy backup to restore location
            await fs.copy(backup.path, restoreDir);

            // Remove pre-restore backup on success
            await fs.remove(currentBackupDir);

            logger.info(`Restore completed: ${backupId}`);
        } catch (error) {
            // Restore failed, try to recover original
            logger.error('Restore failed, attempting to recover original state...');
            await fs.remove(restoreDir);
            await fs.move(currentBackupDir, restoreDir);
            throw error;
        }
    }

    /**
     * Delete a specific backup
     */
    async deleteBackup(backupId: string): Promise<void> {
        const backup = this.backupHistory.find(b => b.id === backupId);
        if (!backup) {
            throw new Error(`Backup not found: ${backupId}`);
        }

        await fs.remove(backup.path);
        this.backupHistory = this.backupHistory.filter(b => b.id !== backupId);
        await this.saveBackupHistory();

        logger.info(`Deleted backup: ${backupId}`);
    }

    /**
     * Get backup statistics
     */
    getStats(): BackupStats {
        return { ...this.stats };
    }

    /**
     * Check if backup is in progress
     */
    getIsRunning(): boolean {
        return this.isRunning;
    }

    /**
     * Check if scheduler is active
     */
    isScheduled(): boolean {
        return this.scheduledTask !== null;
    }

    /**
     * Update statistics
     */
    private updateStats(metadata: BackupMetadata): void {
        this.stats.totalBackups++;

        if (metadata.status === 'success') {
            this.stats.successfulBackups++;
            this.stats.totalSize += metadata.size;
            this.stats.lastBackup = metadata.timestamp;
        } else {
            this.stats.failedBackups++;
        }

        // Recalculate average duration
        const totalDuration = this.backupHistory
            .filter(b => b.status === 'success')
            .reduce((sum, b) => sum + b.duration, 0);
        const successfulCount = this.stats.successfulBackups;
        this.stats.averageDuration = successfulCount > 0 ? totalDuration / successfulCount : 0;
    }

    /**
     * Load backup history from disk
     */
    private async loadBackupHistory(): Promise<void> {
        const historyPath = path.join(this.config.destination, 'backup-history.json');
        try {
            if (await fs.pathExists(historyPath)) {
                const data = await fs.readJson(historyPath);
                this.backupHistory = data.history || [];
                this.stats = data.stats || this.stats;
                logger.debug(`Loaded ${this.backupHistory.length} backup records`);
            }
        } catch (error) {
            logger.warn('Failed to load backup history:', error);
        }
    }

    /**
     * Save backup history to disk
     */
    private async saveBackupHistory(): Promise<void> {
        const historyPath = path.join(this.config.destination, 'backup-history.json');
        try {
            await fs.writeJson(historyPath, {
                history: this.backupHistory,
                stats: this.stats,
            }, { spaces: 2 });
        } catch (error) {
            logger.warn('Failed to save backup history:', error);
        }
    }

    /**
     * Format bytes to human readable
     */
    private formatBytes(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }
}

/**
 * Get backup configuration from environment
 */
export function getBackupConfigFromEnv(sourceDir: string): BackupConfig {
    return {
        schedule: process.env.MCP_BACKUP_SCHEDULE || '0 2 * * *',
        retention: parseInt(process.env.MCP_BACKUP_RETENTION || '7', 10),
        destination: process.env.MCP_BACKUP_DESTINATION || path.join(sourceDir, 'backups'),
        compression: process.env.MCP_BACKUP_COMPRESSION !== 'false',
        sourceDir,
        prefix: process.env.MCP_BACKUP_PREFIX || 'saga-backup',
    };
}

/**
 * Create a backup manager with environment configuration
 */
export async function createBackupManager(sourceDir: string): Promise<BackupManager> {
    const config = getBackupConfigFromEnv(sourceDir);
    const manager = new BackupManager(config);
    await manager.initialize();
    return manager;
}
