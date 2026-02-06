import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTomlConfig } from '../config.js';

function snapshotEnv(): NodeJS.ProcessEnv {
    return { ...process.env };
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
    for (const key of Object.keys(process.env)) {
        if (!(key in snapshot)) {
            delete process.env[key];
        }
    }
    for (const [key, value] of Object.entries(snapshot)) {
        if (typeof value === 'undefined') {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}

let envSnapshot = snapshotEnv();

afterEach(() => {
    restoreEnv(envSnapshot);
    envSnapshot = snapshotEnv();
});

describe('TOML config parsing', () => {
    it('parses escaped strings without unsafe double unescape behavior', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-config-'));
        const configPath = path.join(tmpDir, 'saga.toml');
        const toml = [
            '[env]',
            'TEST_WIN_PATH = "C:\\\\Users\\\\cvntress\\\\.saga"',
            'TEST_ESCAPED_QUOTE = "value with \\"quote\\""',
            ''
        ].join('\n');

        fs.writeFileSync(configPath, toml, 'utf8');
        process.env.SAGA_CONFIG_TOML = configPath;
        delete process.env.MCP_CONFIG_TOML;
        delete process.env.TEST_WIN_PATH;
        delete process.env.TEST_ESCAPED_QUOTE;

        applyTomlConfig();

        expect(process.env.TEST_WIN_PATH).toBe('C:\\Users\\cvntress\\.saga');
        expect(process.env.TEST_ESCAPED_QUOTE).toBe('value with "quote"');

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});
