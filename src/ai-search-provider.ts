import { DocumentManager } from './document-manager.js';
import { GeminiSearchService } from './gemini-search-service.js';
import { SearchResult } from './types.js';

const LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234';
const SYNTHETIC_BASE_URL = 'https://api.synthetic.new/openai/v1';
const DEFAULT_LOCAL_MODEL = 'ministral-3-8b-instruct-2512';
const DEFAULT_REMOTE_MODEL = 'glm-4.7';
const DEFAULT_MAX_CONTEXT_CHUNKS = 6;

export type AiProviderType = 'gemini' | 'openai';

export type AiSearchSection = {
    section_title: string;
    content: string;
    relevance_score: number;
    page_number?: number | null;
};

export type AiSearchResult = {
    search_results: string;
    relevant_sections: AiSearchSection[];
};

export type AiProviderConfig = {
    provider: AiProviderType;
    baseUrl?: string;
    model?: string;
    apiKey?: string;
    maxChunks: number;
};

export type AiProviderSelection = {
    enabled: boolean;
    provider?: AiProviderType;
    reason?: string;
    config?: AiProviderConfig;
};

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

function ensureOpenAiBaseUrl(url: string): string {
    const normalized = normalizeBaseUrl(url);
    return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveDefaultModel(baseUrl: string): string | null {
    const normalized = normalizeBaseUrl(baseUrl);
    if (normalized === LM_STUDIO_BASE_URL) {
        return DEFAULT_LOCAL_MODEL;
    }
    if (normalized === SYNTHETIC_BASE_URL) {
        return DEFAULT_REMOTE_MODEL;
    }
    return null;
}

function isSyntheticBaseUrl(baseUrl: string): boolean {
    return normalizeBaseUrl(baseUrl) === SYNTHETIC_BASE_URL;
}

export function resolveAiProviderSelection(): AiProviderSelection {
    const providerEnv = process.env.MCP_AI_PROVIDER?.toLowerCase();
    let provider: AiProviderType | null = null;

    if (providerEnv === 'gemini' || providerEnv === 'openai') {
        provider = providerEnv;
    } else if (providerEnv) {
        return {
            enabled: false,
            reason: `Unknown MCP_AI_PROVIDER value: ${providerEnv}`,
        };
    } else if (process.env.GEMINI_API_KEY) {
        provider = 'gemini';
    } else if (process.env.MCP_AI_BASE_URL) {
        provider = 'openai';
    }

    if (!provider) {
        return {
            enabled: false,
            reason: 'No AI provider configured (set MCP_AI_PROVIDER or provider-specific env vars).',
        };
    }

    if (provider === 'gemini') {
        if (!process.env.GEMINI_API_KEY) {
            return {
                enabled: false,
                provider,
                reason: 'GEMINI_API_KEY is required for Gemini AI search.',
            };
        }
        return {
            enabled: true,
            provider,
            config: {
                provider,
                apiKey: process.env.GEMINI_API_KEY,
                maxChunks: DEFAULT_MAX_CONTEXT_CHUNKS,
            },
        };
    }

    const baseUrl = process.env.MCP_AI_BASE_URL;
    if (!baseUrl) {
        return {
            enabled: false,
            provider,
            reason: 'MCP_AI_BASE_URL is required for OpenAI-compatible AI search.',
        };
    }

    const maxChunks = parsePositiveInt(process.env.MCP_AI_MAX_CONTEXT_CHUNKS, DEFAULT_MAX_CONTEXT_CHUNKS);
    const defaultModel = resolveDefaultModel(baseUrl);
    const model = process.env.MCP_AI_MODEL?.trim() || defaultModel;

    if (!model) {
        return {
            enabled: false,
            provider,
            reason: 'MCP_AI_MODEL is required when MCP_AI_BASE_URL is not a known default.',
        };
    }

    if (isSyntheticBaseUrl(baseUrl) && !process.env.MCP_AI_API_KEY) {
        return {
            enabled: false,
            provider,
            reason: 'MCP_AI_API_KEY is required for synthetic.new.',
        };
    }

    return {
        enabled: true,
        provider,
        config: {
            provider,
            baseUrl: normalizeBaseUrl(baseUrl),
            model,
            apiKey: process.env.MCP_AI_API_KEY,
            maxChunks,
        },
    };
}

export async function searchDocumentWithAi(
    documentId: string,
    query: string,
    manager: DocumentManager
): Promise<{ provider: AiProviderType; model?: string; result: AiSearchResult }> {
    const selection = resolveAiProviderSelection();
    if (!selection.enabled || !selection.provider || !selection.config) {
        throw new Error(selection.reason || 'AI provider not configured.');
    }

    if (selection.provider === 'gemini') {
        const result = await searchWithGemini(documentId, query, manager, selection.config.apiKey);
        return {
            provider: 'gemini',
            result,
        };
    }

    const result = await searchWithOpenAi(documentId, query, manager, selection.config);
    return {
        provider: 'openai',
        model: selection.config.model,
        result,
    };
}

async function searchWithGemini(
    documentId: string,
    query: string,
    manager: DocumentManager,
    apiKey?: string
): Promise<AiSearchResult> {
    const dataDir = manager.getDataDir();
    const response = await GeminiSearchService.searchDocumentWithGemini(
        documentId,
        query,
        dataDir,
        apiKey
    );
    return parseAiSearchResult(response);
}

async function searchWithOpenAi(
    documentId: string,
    query: string,
    manager: DocumentManager,
    config: AiProviderConfig
): Promise<AiSearchResult> {
    const document = await manager.getDocument(documentId);
    if (!document) {
        throw new Error(`Document with ID '${documentId}' not found. Use 'list_documents' to get available document IDs.`);
    }

    const searchResults = await manager.searchDocuments(documentId, query, config.maxChunks);
    if (searchResults.length === 0) {
        return {
            search_results: 'No relevant content found in the document for the given query.',
            relevant_sections: [],
        };
    }

    const prompt = buildOpenAiPrompt(document.title, query, searchResults);
    const responseText = await fetchOpenAiResponse(prompt, config);
    return parseAiSearchResult(responseText);
}

function buildOpenAiPrompt(
    documentTitle: string,
    query: string,
    searchResults: SearchResult[]
): { system: string; user: string } {
    const contextBlocks = searchResults
        .map((result, index) => {
            const chunk = result.chunk;
            return [
                `Chunk ${index + 1}`,
                `chunk_index: ${chunk.chunk_index}`,
                `score: ${result.score.toFixed(4)}`,
                `content:\n${chunk.content}`,
            ].join('\n');
        })
        .join('\n\n');

    const system = [
        'You are an expert document analyst specializing in semantic search and content extraction.',
        'Return only valid JSON with these keys:',
        '- search_results (string)',
        '- relevant_sections (array of objects with section_title, content, relevance_score, page_number)',
        'Do not include markdown or extra text.',
    ].join(' ');

    const user = [
        `Document title: ${documentTitle}`,
        `Query: ${query}`,
        '',
        'Relevant chunks (ranked):',
        contextBlocks,
        '',
        'Respond with JSON only.',
    ].join('\n');

    return { system, user };
}

async function fetchOpenAiResponse(
    prompt: { system: string; user: string },
    config: AiProviderConfig
): Promise<string> {
    if (!config.baseUrl || !config.model) {
        throw new Error('OpenAI-compatible provider is missing baseUrl or model.');
    }

    const baseUrl = ensureOpenAiBaseUrl(config.baseUrl);
    const body = {
        model: config.model,
        temperature: 0.2,
        messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
        ],
    };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (config.apiKey) {
        headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });

    const payloadText = await response.text();
    if (!response.ok) {
        throw new Error(`OpenAI-compatible request failed (${response.status}): ${payloadText}`);
    }

    let payload: any;
    try {
        payload = JSON.parse(payloadText);
    } catch (error) {
        throw new Error(`OpenAI-compatible response was not JSON: ${payloadText}`);
    }

    if (payload?.error) {
        const message = typeof payload.error === 'string' ? payload.error : payload.error?.message;
        throw new Error(`OpenAI-compatible response error: ${message ?? payloadText}`);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        const fallback = payload?.choices?.[0]?.text;
        if (typeof fallback === 'string' && fallback.trim()) {
            return fallback.trim();
        }
        throw new Error('OpenAI-compatible response missing message content.');
    }

    return content.trim();
}

function parseAiSearchResult(content: string): AiSearchResult {
    const parsed = tryParseJson(content);
    if (!parsed) {
        return {
            search_results: content.trim(),
            relevant_sections: [],
        };
    }

    const search_results = typeof parsed.search_results === 'string' ? parsed.search_results : '';
    const relevant_sections = Array.isArray(parsed.relevant_sections)
        ? parsed.relevant_sections
              .map((section: any) => ({
                  section_title: typeof section?.section_title === 'string' ? section.section_title : 'Untitled',
                  content: typeof section?.content === 'string' ? section.content : '',
                  relevance_score: typeof section?.relevance_score === 'number' ? section.relevance_score : 0,
                  page_number:
                      typeof section?.page_number === 'number' ? section.page_number : null,
              }))
              .filter((section: AiSearchSection) => section.content)
        : [];

    return { search_results, relevant_sections };
}

function tryParseJson(content: string): any | null {
    try {
        return JSON.parse(content);
    } catch {
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start === -1 || end === -1 || start >= end) {
            return null;
        }
        try {
            return JSON.parse(content.slice(start, end + 1));
        } catch {
            return null;
        }
    }
}
