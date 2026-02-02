import { afterAll, beforeAll } from 'vitest';
import 'dotenv/config';
import eld from 'eld';
import http from 'node:http';
import https from 'node:https';

const embeddingBaseUrl = process.env.MCP_EMBEDDING_BASE_URL;
const aiBaseUrl = process.env.MCP_AI_BASE_URL;
const normalizedEmbeddingOrigin = normalizeOrigin(embeddingBaseUrl);
const normalizedAiOrigin = normalizeOrigin(aiBaseUrl);
const EMBEDDING_DIMENSIONS = 8;

let originalFetch: any;
let stubEnabled = false;

function normalizeOrigin(value?: string): string | null {
    if (!value) {
        return null;
    }
    try {
        const parsed = new URL(value.replace(/\/+$/, ''));
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return null;
    }
}

function createEmbeddingArray(input?: string | string[]): number[] {
    const text = Array.isArray(input) ? input.join(' ') : input ?? '';
    const base = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index + 1) * 0.001);
    const seed = Array.from(text, (char) => char.charCodeAt(0) || 0);
    return base.map((value, index) => {
        const extra = seed[index % seed.length] ?? 0;
        return parseFloat((value + extra / 1000).toFixed(6));
    });
}

function parseInputFromBody(body?: BodyInit | null): string | string[] | undefined {
    if (!body) {
        return undefined;
    }
    if (typeof body === 'string') {
        try {
            const parsed = JSON.parse(body);
            return parsed?.input;
        } catch {
            return body;
        }
    }
    if (body instanceof URLSearchParams) {
        return body.get('input') ?? undefined;
    }
    return undefined;
}

function createEmbeddingResponse(input?: string | string[]): string {
    const embedding = createEmbeddingArray(input);
    return JSON.stringify({
        object: 'list',
        model: 'text-embedding-stub',
        data: [
            {
                object: 'embedding',
                embedding,
                index: 0,
            },
        ],
    });
}

function createAiResponse(): string {
    return JSON.stringify({
        choices: [
            {
                message: {
                    content: JSON.stringify(['test', 'integration', 'document']),
                },
            },
        ],
    });
}

function matchesOrigin(url: URL, origin: string | null): boolean {
    if (!origin) {
        return false;
    }
    return `${url.protocol}//${url.host}` === origin;
}

function stubFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const rawUrl = typeof input === 'string' ? input : input.url;
    const parsed = new URL(rawUrl);

    if (matchesOrigin(parsed, normalizedEmbeddingOrigin) && parsed.pathname.endsWith('/v1/embeddings')) {
        const responseBody = createEmbeddingResponse(parseInputFromBody(init?.body));
        console.error('[vitest-setup] Embedding stub response generated');
        return Promise.resolve(
            new Response(responseBody, {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
    }

    if (matchesOrigin(parsed, normalizedAiOrigin) && parsed.pathname.endsWith('/v1/chat/completions')) {
        console.error('[vitest-setup] AI stub response generated');
        return Promise.resolve(
            new Response(createAiResponse(), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
    }

    if (originalFetch) {
        return originalFetch(input, init);
    }

    return Promise.reject(new Error('No fetch implementation available'));
}

async function startFetchStub(): Promise<void> {
    const baseUrl = process.env.MCP_EMBEDDING_BASE_URL;
    
    // Force stub fetch if explicitly requested (for testing)
    const forceStub = process.env.MCP_FORCE_STUB_FETCH === 'true';
    
    if (forceStub) {
        console.error('[vitest-setup] MCP_FORCE_STUB_FETCH=true, forcing fetch stub regardless of reachability');
        originalFetch = globalThis.fetch;
        globalThis.fetch = stubFetch as any;
        stubEnabled = true;
        console.error('[vitest-setup] Fetch stub enabled (forced)');
        return;
    }
    
    if (baseUrl && (await isUrlReachable(baseUrl))) {
        console.error('[vitest-setup] Embedding base URL reachable; not stubbing fetch:', baseUrl);
        return;
    }

    originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch as any;
    stubEnabled = true;
    console.error('[vitest-setup] Fetch stub enabled');
}

async function stopFetchStub(): Promise<void> {
    if (stubEnabled && originalFetch) {
        globalThis.fetch = originalFetch;
        console.error('[vitest-setup] Fetch stub restored');
    }
}

async function isUrlReachable(target: string): Promise<boolean> {
    try {
        const parsed = new URL(target);
        const module = parsed.protocol === 'https:' ? https : http;
        return await new Promise<boolean>((resolve) => {
            const req = module.request(
                {
                    method: 'HEAD',
                    hostname: parsed.hostname,
                    port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
                    path: parsed.pathname || '/',
                    timeout: 1200,
                },
                (res) => {
                    res.resume();
                    resolve(true);
                }
            );
            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            req.end();
        });
    } catch {
        return false;
    }
}

// Initialize eld language detector model before all tests run
// This loads the ngrams database required for language detection
beforeAll(async () => {
    await startFetchStub();
    console.error('[vitest-setup] Setup complete');
});

afterAll(async () => {
    await stopFetchStub();
});
