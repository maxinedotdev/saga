import { DocumentManager } from './document-manager.js';
import { normalizeText } from './utils.js';
import { randomUUID } from 'crypto';

const DEFAULT_USER_AGENT = 'MCP-Documentation-Server/1.0';
const MAX_SITEMAP_FETCHES = 10;

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
};

export type CrawlResult = {
    crawlId: string;
    pagesIngested: number;
    pagesSkipped: number;
    errors: Array<{ url: string; error: string }>;
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

        try {
            const response = await fetch(parsedUrl.toString(), {
                headers: {
                    'User-Agent': DEFAULT_USER_AGENT,
                    'Accept': 'text/html, text/plain, text/markdown, application/json, application/xml;q=0.9, */*;q=0.1',
                },
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

            const body = await response.text();
            const { text, title, links } = extractContent(body, contentType, parsedUrl);
            const normalizedText = normalizeText(text);

            if (!normalizedText) {
                pagesSkipped += 1;
                continue;
            }

            await manager.addDocument(title, normalizedText, {
                source: 'crawl',
                crawl_id: crawlId,
                source_url: parsedUrl.toString(),
                crawl_depth: depth,
                fetched_at: new Date().toISOString(),
                content_type: contentType || 'text/plain',
                untrusted: true,
            });

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
        return normalizeUrlForSet(parsed);
    } catch {
        return null;
    }
}

function normalizeUrlForSet(url: URL): string {
    const normalized = new URL(url.toString());
    normalized.hash = '';
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
        return resolved.toString();
    } catch {
        return null;
    }
}

function extractContent(body: string, contentType: string, baseUrl: URL): { text: string; title: string; links: string[] } {
    if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
        const title = extractHtmlTitle(body) || deriveTitleFromUrl(baseUrl);
        return {
            text: stripHtml(body),
            title,
            links: extractHtmlLinks(body, baseUrl),
        };
    }

    return {
        text: body,
        title: deriveTitleFromUrl(baseUrl),
        links: [],
    };
}

function extractHtmlTitle(html: string): string {
    const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    if (!match) {
        return '';
    }
    return decodeHtmlEntities(match[1]).trim();
}

function deriveTitleFromUrl(url: URL): string {
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) {
        return decodeURIComponent(pathParts[pathParts.length - 1]);
    }
    return url.hostname;
}

function extractHtmlLinks(html: string, baseUrl: URL): string[] {
    const links: string[] = [];
    const regex = /href\s*=\s*["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
        const raw = match[1].trim();
        if (!raw || raw.startsWith('#')) {
            continue;
        }
        if (raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:') || raw.startsWith('data:')) {
            continue;
        }
        const resolved = resolveUrl(raw, baseUrl.toString());
        if (resolved) {
            links.push(resolved);
        }
    }
    return links;
}

function stripHtml(html: string): string {
    let text = html;
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    text = text.replace(/<([a-z0-9]+)[^>]*style=['"][^'"]*(display\s*:\s*none|visibility\s*:\s*hidden)[^'"]*['"][^>]*>[\s\S]*?<\/\1>/gi, ' ');
    text = text.replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/table|\/section|\/article|\/ul|\/ol|\/pre|\/code|\/blockquote)[^>]*>/gi, '\n');
    text = text.replace(/<[^>]+>/g, ' ');
    text = decodeHtmlEntities(text);
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}
