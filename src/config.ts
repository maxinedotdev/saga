import fs from 'fs';
import path from 'path';
import { expandHomeDir, getDefaultDataDir, getLogger } from './utils.js';

type TomlPrimitive = string | number | boolean;
type TomlValue = TomlPrimitive | TomlValue[] | TomlTable;
type TomlTable = { [key: string]: TomlValue };

const logger = getLogger('Config');

function isRecord(value: unknown): value is TomlTable {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripComments(line: string): string {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (char === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if ((char === '#' || char === ';') && !inSingle && !inDouble) {
            return line.slice(0, i);
        }
    }
    return line;
}

function splitKeyValue(line: string, lineNumber: number): [string, string] {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (char === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (char === '=' && !inSingle && !inDouble) {
            return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
        }
    }
    throw new Error(`TOML parse error at line ${lineNumber}: Missing '='`);
}

function parseString(raw: string): string {
    const quote = raw[0];
    if (quote === '"') {
        // Reuse the JS string parser to avoid introducing unsafe unescape rules.
        return JSON.parse(raw) as string;
    }
    return raw.slice(1, -1);
}

function parseArray(raw: string, lineNumber: number): TomlValue[] {
    const inner = raw.slice(1, -1).trim();
    if (!inner) {
        return [];
    }
    const items: TomlValue[] = [];
    let current = '';
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < inner.length; i += 1) {
        const char = inner[i];
        if (char === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (char === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (!inSingle && !inDouble) {
            if (char === '[') {
                depth += 1;
            } else if (char === ']') {
                depth -= 1;
            } else if (char === ',' && depth === 0) {
                const trimmed = current.trim();
                if (trimmed) {
                    items.push(parseValue(trimmed, lineNumber));
                }
                current = '';
                continue;
            }
        }
        current += char;
    }
    const trimmed = current.trim();
    if (trimmed) {
        items.push(parseValue(trimmed, lineNumber));
    }
    return items;
}

function parseValue(raw: string, lineNumber: number): TomlValue {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error(`TOML parse error at line ${lineNumber}: Empty value`);
    }
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return parseString(trimmed);
    }
    if (trimmed === 'true') {
        return true;
    }
    if (trimmed === 'false') {
        return false;
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return parseArray(trimmed, lineNumber);
    }
    if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
        const value = Number(trimmed);
        if (!Number.isNaN(value)) {
            return value;
        }
    }
    return trimmed;
}

function getOrCreateTable(root: TomlTable, pathParts: string[]): TomlTable {
    let current = root;
    for (const part of pathParts) {
        const key = part.trim();
        if (!key) {
            continue;
        }
        const existing = current[key];
        if (isRecord(existing)) {
            current = existing;
            continue;
        }
        const next: TomlTable = {};
        current[key] = next;
        current = next;
    }
    return current;
}

function parseToml(content: string): TomlTable {
    const root: TomlTable = {};
    let currentTable = root;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        const lineNumber = i + 1;
        const rawLine = stripComments(lines[i]).trim();
        if (!rawLine) {
            continue;
        }
        if (rawLine.startsWith('[') && rawLine.endsWith(']')) {
            const header = rawLine.slice(1, -1).trim();
            if (!header) {
                throw new Error(`TOML parse error at line ${lineNumber}: Empty table header`);
            }
            const pathParts = header.split('.');
            currentTable = getOrCreateTable(root, pathParts);
            continue;
        }
        const [keyRaw, valueRaw] = splitKeyValue(rawLine, lineNumber);
        if (!keyRaw) {
            throw new Error(`TOML parse error at line ${lineNumber}: Empty key`);
        }
        const keyParts = keyRaw.split('.').map((part) => part.trim()).filter(Boolean);
        const targetTable = keyParts.length > 1 ? getOrCreateTable(currentTable, keyParts.slice(0, -1)) : currentTable;
        const key = keyParts[keyParts.length - 1] ?? keyRaw.trim();
        targetTable[key] = parseValue(valueRaw, lineNumber);
    }
    return root;
}

function getConfigPathFromArgs(): string | undefined {
    const index = process.argv.findIndex((arg) => arg === '--config');
    if (index !== -1 && index + 1 < process.argv.length) {
        return process.argv[index + 1];
    }
    return undefined;
}

function resolveConfigPath(): { path: string; explicit: boolean } {
    const argPath = getConfigPathFromArgs()?.trim();
    const envPath = (process.env.MCP_CONFIG_TOML || process.env.SAGA_CONFIG_TOML || '').trim();
    const explicit = Boolean(argPath || envPath);
    const baseDir = getDefaultDataDir();
    const configPath = argPath || envPath || path.join(baseDir, 'saga.toml');
    return { path: expandHomeDir(configPath), explicit };
}

function normalizeEnvValue(value: TomlValue): string {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return JSON.stringify(value);
}

function readString(value: TomlValue | undefined): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return undefined;
}

function readNumber(value: TomlValue | undefined): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

function readBoolean(value: TomlValue | undefined): boolean | undefined {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') {
            return true;
        }
        if (value.toLowerCase() === 'false') {
            return false;
        }
    }
    return undefined;
}

function applyServerConfig(config: TomlTable, setEnvValue: (key: string, value: string) => void): void {
    const server = isRecord(config.server) ? config.server : undefined;
    const transport = readString(server?.transport ?? config.transport);
    const baseDir = readString(server?.base_dir ?? config.base_dir);
    if (transport) {
        setEnvValue('MCP_TRANSPORT', transport);
    }
    if (baseDir) {
        setEnvValue('MCP_BASE_DIR', baseDir);
    }

    const httpTable = isRecord(server?.http) ? server?.http : isRecord(config.http) ? config.http : undefined;
    const host = readString(httpTable?.host ?? server?.http_host ?? config.http_host);
    const port = readNumber(httpTable?.port ?? server?.http_port ?? config.http_port);
    const endpoint = readString(httpTable?.endpoint ?? server?.http_endpoint ?? config.http_endpoint);
    const publicFlag = readBoolean(httpTable?.public ?? server?.http_public ?? config.http_public);
    const stateless = readBoolean(httpTable?.stateless ?? server?.http_stateless ?? config.http_stateless);

    if (host) {
        setEnvValue('MCP_HTTP_HOST', host);
    }
    if (typeof port === 'number') {
        setEnvValue('MCP_HTTP_PORT', String(port));
    }
    if (endpoint) {
        setEnvValue('MCP_HTTP_ENDPOINT', endpoint);
    }
    if (typeof publicFlag === 'boolean') {
        setEnvValue('MCP_HTTP_PUBLIC', publicFlag ? 'true' : 'false');
    }
    if (typeof stateless === 'boolean') {
        setEnvValue('MCP_HTTP_STATELESS', stateless ? 'true' : 'false');
    }
}

function applyEnvTable(config: TomlTable, setEnvValue: (key: string, value: string) => void): void {
    const envTable = isRecord(config.env) ? config.env : undefined;
    if (!envTable) {
        return;
    }
    for (const [key, value] of Object.entries(envTable)) {
        setEnvValue(key, normalizeEnvValue(value));
    }
}

export function applyTomlConfig(): void {
    const { path: configPath, explicit } = resolveConfigPath();
    if (!configPath) {
        return;
    }
    if (!fs.existsSync(configPath)) {
        if (explicit) {
            logger.warn(`TOML config not found at ${configPath}`);
        }
        return;
    }
    const content = fs.readFileSync(configPath, 'utf8');
    const baseline = new Set(Object.keys(process.env));
    const applied: Record<string, string> = {};
    const setEnvValue = (key: string, value: string) => {
        if (baseline.has(key)) {
            return;
        }
        process.env[key] = value;
        applied[key] = value;
    };

    try {
        const config = parseToml(content);
        applyServerConfig(config, setEnvValue);
        applyEnvTable(config, setEnvValue);
        logger.info(`Loaded TOML config: ${configPath}`);
        const appliedKeys = Object.keys(applied);
        if (appliedKeys.length > 0) {
            logger.info(`Applied ${appliedKeys.length} values from TOML config`);
        }
    } catch (error) {
        logger.error(`Failed to parse TOML config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
