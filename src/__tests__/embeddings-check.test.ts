import { describe, expect, test } from 'vitest';
import dotenv from 'dotenv';

dotenv.config();

const rawBaseUrl = (process.env.MCP_EMBEDDING_BASE_URL || '').replace(/\/$/, '');
const baseUrl = rawBaseUrl.endsWith('/v1') ? rawBaseUrl : `${rawBaseUrl}/v1`;
const model = process.env.MCP_EMBEDDING_MODEL || '';
const isConfigured = Boolean(baseUrl && model);

const embeddingTest = isConfigured ? test : test.skip;

describe('Embeddings check', () => {
    embeddingTest('returns embeddings for the configured model', async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(`${baseUrl}/embeddings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, input: 'quick embedding test' }),
                signal: controller.signal,
            });

            const text = await response.text();
            expect(response.ok).toBe(true);

            const payload = JSON.parse(text) as {
                data?: Array<{ embedding?: number[] }>;
            };
            const embedding = payload.data?.[0]?.embedding;
            if (!Array.isArray(embedding)) {
                throw new Error(`Unexpected embeddings payload: ${text}`);
            }
            expect(embedding && embedding.length > 0).toBe(true);
        } finally {
            clearTimeout(timeout);
        }
    });
});
