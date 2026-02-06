import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const ISO_TIMESTAMP_PREFIX = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/;
let consoleTimestampPatchApplied = false;

function patchConsoleTimestamps(): void {
    if (consoleTimestampPatchApplied) {
        return;
    }
    consoleTimestampPatchApplied = true;

    const patchMethod = (method: 'error' | 'warn' | 'info' | 'log' | 'debug') => {
        const original = console[method].bind(console);
        console[method] = ((...args: unknown[]) => {
            if (
                args.length > 0 &&
                typeof args[0] === 'string' &&
                ISO_TIMESTAMP_PREFIX.test(args[0])
            ) {
                original(...args);
                return;
            }
            original(`[${new Date().toISOString()}]`, ...args);
        }) as typeof console[typeof method];
    };

    patchMethod('error');
    patchMethod('warn');
    patchMethod('info');
    patchMethod('log');
    patchMethod('debug');
}

patchConsoleTimestamps();

/**
 * Get the default data directory for the server
 */
export function getDefaultDataDir(): string {
    // Check for MCP_BASE_DIR environment variable first
    const baseDir = process.env.MCP_BASE_DIR?.trim();
    if (baseDir) {
        return expandHomeDir(baseDir);
    }
    
    // Fall back to home directory
    const homeDir = os.homedir();
    return path.join(homeDir, '.saga');
}

/**
 * Format date as YYYYMMDD-HHMMSS for logfile naming
 */
function formatDateForLogfile(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Get the logfile path with datetime stamp
 * Creates logs directory if it doesn't exist
 */
function getLogfilePath(): string | null {
    const logToFile = process.env.MCP_LOG_TO_FILE === 'true';
    if (!logToFile) {
        return null;
    }

    const baseDir = getDefaultDataDir();
    const logsDir = path.join(baseDir, 'logs');

    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
        try {
            fs.mkdirSync(logsDir, { recursive: true });
        } catch (error) {
            console.error(`[Logger] Failed to create logs directory: ${error}`);
            return null;
        }
    }

    const timestamp = formatDateForLogfile(new Date());
    return path.join(logsDir, `saga-mcp-${timestamp}.log`);
}

/**
 * Global logfile handle
 */
let globalLogfileHandle: number | null = null;
let globalLogfilePath: string | null = null;

/**
 * Initialize logfile if logging to file is enabled
 */
function initializeLogfile(): void {
    if (globalLogfileHandle !== null) {
        return; // Already initialized
    }

    const logfilePath = getLogfilePath();
    if (!logfilePath) {
        return;
    }

    try {
        globalLogfileHandle = fs.openSync(logfilePath, 'a', 0o644);
        globalLogfilePath = logfilePath;
        // Write initial log entry
        const timestamp = new Date().toISOString();
        fs.writeSync(globalLogfileHandle, `[${timestamp}] [Logger] Logfile initialized: ${logfilePath}\n`);
    } catch (error) {
        console.error(`[Logger] Failed to open logfile: ${error}`);
        globalLogfileHandle = null;
        globalLogfilePath = null;
    }
}

/**
 * Write to logfile
 */
function writeToLogfile(message: string): void {
    if (globalLogfileHandle === null) {
        initializeLogfile();
    }

    if (globalLogfileHandle !== null) {
        try {
            fs.writeSync(globalLogfileHandle, message + '\n');
        } catch (error) {
            // If writing fails, reset handle and try to reinitialize once
            try {
                if (globalLogfileHandle !== null) {
                    fs.closeSync(globalLogfileHandle);
                }
            } catch {
                // Ignore close errors
            }
            globalLogfileHandle = null;
            globalLogfilePath = null;
        }
    }
}

/**
 * Close logfile handle (should be called on process exit)
 */
export function closeLogfile(): void {
    if (globalLogfileHandle !== null) {
        try {
            const timestamp = new Date().toISOString();
            fs.writeSync(globalLogfileHandle, `[${timestamp}] [Logger] Logfile closing\n`);
            fs.closeSync(globalLogfileHandle);
        } catch {
            // Ignore errors during close
        }
        globalLogfileHandle = null;
        globalLogfilePath = null;
    }
}

// Register cleanup on exit
process.on('exit', closeLogfile);
process.on('SIGTERM', closeLogfile);
process.on('SIGINT', closeLogfile);

export function expandHomeDir(value: string): string {
    if (value === '~') {
        return os.homedir();
    }
    if (value.startsWith('~/') || value.startsWith('~\\')) {
        return path.join(os.homedir(), value.slice(2));
    }
    return value;
}

/**
 * Clean and normalize text for processing
 */
export function normalizeText(text: string): string {
    return text
        .replace(/\r\n/g, '\n')  // Normalize line endings
        .replace(/\t/g, '  ')    // Replace tabs with spaces
        .trim();
}

/**
 * Default embedding batch size
 */
const DEFAULT_EMBEDDING_BATCH_SIZE = 100;

/**
 * Maximum embedding batch size (supports up to 4096 for models like text-embedding-llama-embed-nemotron-8b)
 */
const MAX_EMBEDDING_BATCH_SIZE = 4096;

/**
 * Minimum embedding batch size
 */
const MIN_EMBEDDING_BATCH_SIZE = 1;

/**
 * Get the configured embedding batch size
 * Reads from MCP_EMBEDDING_BATCH_SIZE environment variable
 * Validates and returns a value between MIN and MAX
 * @returns Validated batch size (default: 100)
 */
export function getEmbeddingBatchSize(): number {
    const envValue = process.env.MCP_EMBEDDING_BATCH_SIZE;
    
    if (!envValue) {
        return DEFAULT_EMBEDDING_BATCH_SIZE;
    }
    
    const parsed = parseInt(envValue, 10);
    
    if (isNaN(parsed)) {
        console.warn(`[Config] Invalid MCP_EMBEDDING_BATCH_SIZE value "${envValue}", using default: ${DEFAULT_EMBEDDING_BATCH_SIZE}`);
        return DEFAULT_EMBEDDING_BATCH_SIZE;
    }
    
    if (parsed < MIN_EMBEDDING_BATCH_SIZE) {
        console.warn(`[Config] MCP_EMBEDDING_BATCH_SIZE (${parsed}) is below minimum (${MIN_EMBEDDING_BATCH_SIZE}), using minimum`);
        return MIN_EMBEDDING_BATCH_SIZE;
    }
    
    if (parsed > MAX_EMBEDDING_BATCH_SIZE) {
        console.warn(`[Config] MCP_EMBEDDING_BATCH_SIZE (${parsed}) exceeds maximum (${MAX_EMBEDDING_BATCH_SIZE}), using maximum`);
        return MAX_EMBEDDING_BATCH_SIZE;
    }
    
    return parsed;
}

/**
 * Default embedding dimension
 * Current model (llama-nemotron-embed-1b-v2) produces 2048 dimensions
 */
const DEFAULT_EMBEDDING_DIMENSION = 2048;

/**
 * Minimum embedding dimension
 */
const MIN_EMBEDDING_DIMENSION = 64;

/**
 * Maximum embedding dimension
 */
const MAX_EMBEDDING_DIMENSION = 8192;

/**
 * Get the configured embedding dimension
 * Reads from MCP_EMBEDDING_DIMENSION environment variable
 * Validates and returns a value between MIN and MAX
 * @returns Validated embedding dimension (default: 2048)
 */
export function getEmbeddingDimension(): number {
    const envValue = process.env.MCP_EMBEDDING_DIMENSION;

    if (!envValue) {
        return DEFAULT_EMBEDDING_DIMENSION;
    }

    const parsed = parseInt(envValue, 10);

    if (isNaN(parsed)) {
        console.warn(`[Config] Invalid MCP_EMBEDDING_DIMENSION value "${envValue}", using default: ${DEFAULT_EMBEDDING_DIMENSION}`);
        return DEFAULT_EMBEDDING_DIMENSION;
    }

    if (parsed < MIN_EMBEDDING_DIMENSION) {
        console.warn(`[Config] MCP_EMBEDDING_DIMENSION (${parsed}) is below minimum (${MIN_EMBEDDING_DIMENSION}), using minimum`);
        return MIN_EMBEDDING_DIMENSION;
    }

    if (parsed > MAX_EMBEDDING_DIMENSION) {
        console.warn(`[Config] MCP_EMBEDDING_DIMENSION (${parsed}) exceeds maximum (${MAX_EMBEDDING_DIMENSION}), using maximum`);
        return MAX_EMBEDDING_DIMENSION;
    }

    return parsed;
}

/**
 * Get a logger for the specified prefix
 * Uses console.error for logging (MCP standard)
 * Also writes to logfile if MCP_LOG_TO_FILE is enabled
 */
export function getLogger(prefix: string): {
    debug: (...args: any[]) => void;
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
} {
    const log = (level: string, ...args: any[]) => {
        const timestamp = new Date().toISOString();
        const message = `[${timestamp}] [${prefix}] [${level.toUpperCase()}] ${args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ')}`;

        // Always log to stderr (MCP standard)
        console.error(`[${timestamp}] [${prefix}] [${level.toUpperCase()}]`, ...args);

        // Also write to logfile if enabled
        writeToLogfile(message);
    };

    return {
        debug: (...args: any[]) => log('debug', ...args),
        info: (...args: any[]) => log('info', ...args),
        warn: (...args: any[]) => log('warn', ...args),
        error: (...args: any[]) => log('error', ...args)
    };
}
