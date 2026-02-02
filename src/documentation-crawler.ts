import { DocumentManager } from './document-manager.js';
import { normalizeText } from './utils.js';
import { randomUUID } from 'crypto';
import { decodeHtmlEntities, extractHtmlContent } from './html-extraction.js';
import type { CodeBlock } from './types.js';
import { detectLanguages, getAcceptedLanguages, getLanguageConfidenceThreshold, isLanguageAllowed, parseLanguageList } from './language-detection.js';
import { fetchWithTimeout } from './utils/http-timeout.js';

const DEFAULT_USER_AGENT = 'MCP-Documentation-Server/1.0';
const MAX_SITEMAP_FETCHES = 10;
const DEFAULT_CRAWL_TIMEOUT_MS = 15000;
const DEFAULT_CRAWL_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_CRAWL_REQUEST_DELAY_MS = 0;

type RobotsRules = {
    allows: string[];
    disallows: string[];
    sitemaps: string[];
};

type CrawlQueueItem = {
    url: string;
    depth: number;
};

export type CrawlOptions = {
    seedUrl: string;
    maxPages: number;
    maxDepth: number;
    sameDomainOnly: boolean;
    accepted_languages?: string[]; // Override for MCP_ACCEPTED_LANGUAGES
};

export type CrawlResult = {
    crawlId: string;
    pagesIngested: number;
    pagesSkipped: number;
    errors: Array<{ url: string; error: string }>;
};

/**
 * Extracted content from a page including text, title, links, and code blocks
 */
type ExtractedContent = {
    text: string;
    title: string;
    links: string[];
    codeBlocks?: CodeBlock[];
};

export async function crawlDocumentation(
    manager: DocumentManager,
    options: CrawlOptions
): Promise<CrawlResult> {
    const seed = toUrl(options.seedUrl);
    const seedOrigin = seed.origin;
    const crawlId = randomUUID();

    const robotsCache = new Map<string, RobotsRules>();
    const seedRobots = await getRobotsForOrigin(seedOrigin, robotsCache);
    const sitemapUrls = await collectSitemapUrls(seedRobots.sitemaps, seedOrigin);
    const requestTimeoutMs = parsePositiveInt(process.env.MCP_CRAWL_TIMEOUT_MS, DEFAULT_CRAWL_TIMEOUT_MS);
    const maxResponseBytes = parsePositiveInt(process.env.MCP_CRAWL_MAX_RESPONSE_BYTES, DEFAULT_CRAWL_MAX_RESPONSE_BYTES);
    const requestDelayMs = parsePositiveInt(process.env.MCP_CRAWL_REQUEST_DELAY_MS, DEFAULT_CRAWL_REQUEST_DELAY_MS);

    // Determine accepted languages for this crawl
    // Use per-crawl override if provided, otherwise fall back to environment variable
    const acceptedLanguages = options.accepted_languages ?? getAcceptedLanguages();
    const confidenceThreshold = getLanguageConfidenceThreshold();

    const queue: CrawlQueueItem[] = [{ url: seed.toString(), depth: 0 }];
    const queued = new Set<string>([normalizeUrlForSet(seed)]);
    const visited = new Set<string>();
    const errors: Array<{ url: string; error: string }> = [];

    for (const sitemapUrl of sitemapUrls) {
        const normalized = tryNormalizeUrl(sitemapUrl);
        if (!normalized) {
            continue;
        }
        const url = new URL(normalized);
        if (options.sameDomainOnly && !isSameHost(seed, url)) {
            continue;
        }
        const key = normalizeUrlForSet(url);
        if (!queued.has(key)) {
            queue.push({ url: normalized, depth: 1 });
            queued.add(key);
        }
    }

    let pagesIngested = 0;
    let pagesSkipped = 0;
    let queueIndex = 0;

    while (queueIndex < queue.length && pagesIngested < options.maxPages) {
        const { url, depth } = queue[queueIndex++];
        const normalized = tryNormalizeUrl(url);
        if (!normalized) {
            pagesSkipped += 1;
            continue;
        }

        if (visited.has(normalized)) {
            continue;
        }
        visited.add(normalized);

        const parsedUrl = new URL(normalized);
        if (options.sameDomainOnly && !isSameHost(seed, parsedUrl)) {
            pagesSkipped += 1;
            continue;
        }
        if (depth > options.maxDepth) {
            pagesSkipped += 1;
            continue;
        }

        const robots = await getRobotsForOrigin(parsedUrl.origin, robotsCache);
        if (!isPathAllowed(parsedUrl.pathname, robots)) {
            pagesSkipped += 1;
            continue;
        }

        if (requestDelayMs > 0 && queueIndex > 1) {
            await sleep(requestDelayMs);
        }

        try {
            const response = await fetchWithTimeout(parsedUrl.toString(), {
                headers: {
                    'User-Agent': DEFAULT_USER_AGENT,
                    'Accept': 'text/html, text/plain, text/markdown, application/json, application/xml;q=0.9, */*;q=0.1',
                },
                timeoutMs: requestTimeoutMs,
            });

            if (!response.ok) {
                pagesSkipped += 1;
                errors.push({ url: parsedUrl.toString(), error: `HTTP ${response.status}` });
                continue;
            }

            const contentType = normalizeContentType(response.headers.get('content-type'));
            if (!isTextContentType(contentType)) {
                pagesSkipped += 1;
                continue;
            }

            let body: string;
            try {
                body = await readResponseTextWithLimit(response, maxResponseBytes);
            } catch (error) {
                pagesSkipped += 1;
                errors.push({
                    url: parsedUrl.toString(),
                    error: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
            const { text, title, links, codeBlocks } = extractContent(body, contentType, parsedUrl);
            const normalizedText = normalizeText(text);

            if (!normalizedText) {
                pagesSkipped += 1;
                continue;
            }

            // Detect language and check allowlist before ingestion
            const detectedLanguages = await detectLanguages(normalizedText, confidenceThreshold);
            if (!isLanguageAllowed(detectedLanguages, acceptedLanguages)) {
                console.warn(`[Crawler] Page rejected: language '${detectedLanguages.join(', ')}' not in accepted languages list (${parsedUrl.toString()})`);
                pagesSkipped += 1;
                continue;
            }

            const document = await manager.addDocument(title, normalizedText, {
                source: 'crawl',
                crawl_id: crawlId,
                source_url: parsedUrl.toString(),
                crawl_depth: depth,
                fetched_at: new Date().toISOString(),
                contentType: contentType || 'text/plain',
                untrusted: true,
                languages: detectedLanguages,
            });

            // Skip if document was rejected by addDocument (e.g., language check)
            if (!document) {
                pagesSkipped += 1;
                continue;
            }

            // Add code blocks if any were extracted
            if (codeBlocks && codeBlocks.length > 0) {
                await manager.addCodeBlocks(document.id, codeBlocks, {
                    crawl_id: crawlId,
                    source_url: parsedUrl.toString(),
                });
            }

            pagesIngested += 1;

            if (depth < options.maxDepth && links.length > 0) {
                for (const link of links) {
                    if (pagesIngested >= options.maxPages) {
                        break;
                    }
                    const normalizedLink = tryNormalizeUrl(link);
                    if (!normalizedLink) {
                        continue;
                    }
                    const linkUrl = new URL(normalizedLink);
                    if (options.sameDomainOnly && !isSameHost(seed, linkUrl)) {
                        continue;
                    }
                    const key = normalizeUrlForSet(linkUrl);
                    if (!queued.has(key) && !visited.has(normalizedLink)) {
                        queue.push({ url: normalizedLink, depth: depth + 1 });
                        queued.add(key);
                    }
                }
            }
        } catch (error) {
            pagesSkipped += 1;
            errors.push({
                url: parsedUrl.toString(),
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        crawlId,
        pagesIngested,
        pagesSkipped,
        errors,
    };
}

function toUrl(value: string): URL {
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Seed URL must be http or https.');
        }
        return parsed;
    } catch (error) {
        throw new Error(`Invalid seed URL: ${value}`);
    }
}

function tryNormalizeUrl(value: string): string | null {
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return null;
        }
        parsed.pathname = parsed.pathname.replace(/\/+/g, '/');
        return normalizeUrlForSet(parsed);
    } catch {
        return null;
    }
}

function normalizeUrlForSet(url: URL): string {
    const normalized = new URL(url.toString());
    normalized.hash = '';
    normalized.pathname = normalized.pathname.replace(/\/+/g, '/');
    if (normalized.pathname.endsWith('/') && normalized.pathname !== '/') {
        normalized.pathname = normalized.pathname.replace(/\/+$/, '');
    }
    return normalized.toString();
}

function isSameHost(base: URL, target: URL): boolean {
    return normalizeHostname(base.hostname) === normalizeHostname(target.hostname);
}

function normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, '');
}

function normalizeContentType(contentType: string | null): string {
    return contentType ? contentType.split(';')[0].trim().toLowerCase() : '';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
    if (maxBytes > 0) {
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            const size = Number.parseInt(contentLength, 10);
            if (Number.isFinite(size) && size > maxBytes) {
                throw new Error(`Response exceeded max size (${size} bytes > ${maxBytes} bytes)`);
            }
        }
    }

    if (!response.body || maxBytes <= 0) {
        return response.text();
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (maxBytes > 0 && total > maxBytes) {
            await reader.cancel();
            throw new Error(`Response exceeded max size (${maxBytes} bytes)`);
        }
        chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return new TextDecoder('utf-8').decode(merged);
}

function isTextContentType(contentType: string): boolean {
    if (!contentType) {
        return true;
    }
    if (contentType.startsWith('text/')) {
        return true;
    }
    return [
        'application/json',
        'application/xml',
        'application/xhtml+xml',
        'application/rss+xml',
        'application/atom+xml',
    ].includes(contentType);
}

async function getRobotsForOrigin(origin: string, cache: Map<string, RobotsRules>): Promise<RobotsRules> {
    const cached = cache.get(origin);
    if (cached) {
        return cached;
    }

    const fallback: RobotsRules = { allows: [], disallows: [], sitemaps: [] };
    const robotsUrl = new URL('/robots.txt', origin).toString();

    try {
        const response = await fetch(robotsUrl, {
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                'Accept': 'text/plain',
            },
        });

        if (!response.ok) {
            cache.set(origin, fallback);
            return fallback;
        }

        const text = await response.text();
        const rules = parseRobotsTxt(text, origin);
        cache.set(origin, rules);
        return rules;
    } catch {
        cache.set(origin, fallback);
        return fallback;
    }
}

function parseRobotsTxt(text: string, origin: string): RobotsRules {
    const allows: string[] = [];
    const disallows: string[] = [];
    const sitemaps: string[] = [];
    const lines = text.split(/\r?\n/);
    let groupApplies = false;
    let sawRule = false;

    for (const line of lines) {
        const cleaned = line.split('#')[0].trim();
        if (!cleaned) {
            continue;
        }

        const [rawKey, ...rest] = cleaned.split(':');
        if (!rawKey || rest.length === 0) {
            continue;
        }

        const key = rawKey.trim().toLowerCase();
        const value = rest.join(':').trim();
        if (!value && key !== 'disallow') {
            continue;
        }

        if (key === 'user-agent') {
            if (sawRule) {
                groupApplies = false;
                sawRule = false;
            }
            if (value.toLowerCase() === '*') {
                groupApplies = true;
            }
            continue;
        }

        if (key === 'sitemap') {
            const resolved = resolveUrl(value, origin);
            if (resolved) {
                sitemaps.push(resolved);
            }
            continue;
        }

        if (key === 'allow' || key === 'disallow') {
            sawRule = true;
            if (!groupApplies) {
                continue;
            }
            if (key === 'allow' && value) {
                allows.push(value);
            }
            if (key === 'disallow' && value) {
                disallows.push(value);
            }
        }
    }

    return { allows, disallows, sitemaps };
}

function isPathAllowed(pathname: string, rules: RobotsRules): boolean {
    if (rules.allows.length === 0 && rules.disallows.length === 0) {
        return true;
    }

    let bestMatch: { type: 'allow' | 'disallow'; length: number } | null = null;

    for (const rule of rules.allows) {
        const matchLength = matchesRobotsRule(pathname, rule);
        if (matchLength > 0 && (!bestMatch || matchLength > bestMatch.length)) {
            bestMatch = { type: 'allow', length: matchLength };
        }
    }

    for (const rule of rules.disallows) {
        const matchLength = matchesRobotsRule(pathname, rule);
        if (matchLength > 0 && (!bestMatch || matchLength > bestMatch.length)) {
            bestMatch = { type: 'disallow', length: matchLength };
        }
    }

    if (!bestMatch) {
        return true;
    }
    if (bestMatch.type === 'allow') {
        return true;
    }

    return false;
}

function matchesRobotsRule(pathname: string, rule: string): number {
    const cleaned = rule.split('*')[0].trim();
    if (!cleaned) {
        return 0;
    }
    return pathname.startsWith(cleaned) ? cleaned.length : 0;
}

async function collectSitemapUrls(sitemapUrls: string[], origin: string): Promise<string[]> {
    const results: string[] = [];
    const queue = sitemapUrls.slice();
    const seen = new Set<string>();

    while (queue.length > 0 && seen.size < MAX_SITEMAP_FETCHES) {
        const sitemapUrl = queue.shift();
        if (!sitemapUrl) {
            continue;
        }
        const resolved = resolveUrl(sitemapUrl, origin);
        if (!resolved || seen.has(resolved)) {
            continue;
        }

        seen.add(resolved);
        try {
            const response = await fetch(resolved, {
                headers: {
                    'User-Agent': DEFAULT_USER_AGENT,
                    'Accept': 'application/xml,text/xml',
                },
            });
            if (!response.ok) {
                continue;
            }

            const text = await response.text();
            const locs = extractSitemapLocs(text);

            for (const loc of locs) {
                const normalized = resolveUrl(loc, origin);
                if (!normalized) {
                    continue;
                }
                if (looksLikeSitemap(normalized)) {
                    if (!seen.has(normalized)) {
                        queue.push(normalized);
                    }
                } else {
                    results.push(normalized);
                }
            }
        } catch {
            continue;
        }
    }

    return results;
}

function looksLikeSitemap(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.endsWith('.xml') || lower.includes('sitemap');
}

function extractSitemapLocs(xml: string): string[] {
    const results: string[] = [];
    const regex = /<loc>([^<]+)<\/loc>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
        const value = decodeHtmlEntities(match[1].trim());
        if (value) {
            results.push(value);
        }
    }
    return results;
}

function resolveUrl(value: string, origin: string): string | null {
    try {
        const resolved = new URL(value, origin);
        if (!['http:', 'https:'].includes(resolved.protocol)) {
            return null;
        }
        resolved.pathname = resolved.pathname.replace(/\/+/g, '/');
        return resolved.toString();
    } catch {
        return null;
    }
}

function extractContent(body: string, contentType: string, baseUrl: URL): ExtractedContent {
    if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
        const extracted = extractHtmlContent(body, {
            sourceUrl: baseUrl.toString(),
            fallbackTitle: deriveTitleFromUrl(baseUrl),
        });
        return {
            text: extracted.text,
            title: extracted.title || deriveTitleFromUrl(baseUrl),
            links: extracted.links,
            codeBlocks: extracted.codeBlocks,
        };
    }

    return {
        text: body,
        title: deriveTitleFromUrl(baseUrl),
        links: [],
    };
}

function deriveTitleFromUrl(url: URL): string {
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) {
        return decodeURIComponent(pathParts[pathParts.length - 1]);
    }
    return url.hostname;
}

// Export functions for testing
export { extractHtmlCodeBlocks as extractCodeBlocks } from './html-extraction.js';
export { normalizeLanguageTag } from './code-block-utils.js';
