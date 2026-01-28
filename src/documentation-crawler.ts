import { DocumentManager } from './document-manager.js';
import { normalizeText } from './utils.js';
import { createHash, randomUUID } from 'crypto';
import { convert } from 'html-to-text';
import type { CodeBlock } from './types.js';

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
            }, requestTimeoutMs);

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

            const document = await manager.addDocument(title, normalizedText, {
                source: 'crawl',
                crawl_id: crawlId,
                source_url: parsedUrl.toString(),
                crawl_depth: depth,
                fetched_at: new Date().toISOString(),
                contentType: contentType || 'text/plain',
                untrusted: true,
            });

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

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    if (!timeoutMs || timeoutMs <= 0) {
        return fetch(url, options);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
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
        const title = extractHtmlTitle(body) || deriveTitleFromUrl(baseUrl);
        return {
            text: stripHtml(body),
            title,
            links: extractHtmlLinks(body, baseUrl),
            codeBlocks: extractCodeBlocks(body, baseUrl.toString()),
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
    // Use html-to-text library for proper HTML to text conversion
    return convert(html, {
        wordwrap: false, // Don't wrap lines at a specific width
        preserveNewlines: true, // Preserve paragraph structure
        selectors: [
            // Skip navigation, headers, footers, and other non-content elements
            { selector: 'nav', format: 'skip' },
            { selector: 'header', format: 'skip' },
            { selector: 'footer', format: 'skip' },
            { selector: 'aside', format: 'skip' },
            { selector: '[role="navigation"]', format: 'skip' },
            { selector: '[role="banner"]', format: 'skip' },
            { selector: '[role="contentinfo"]', format: 'skip' },
            { selector: '[role="complementary"]', format: 'skip' },
            { selector: 'script', format: 'skip' },
            { selector: 'style', format: 'skip' },
            { selector: 'noscript', format: 'skip' },
            { selector: '.navigation', format: 'skip' },
            { selector: '.nav', format: 'skip' },
            { selector: '.sidebar', format: 'skip' },
            { selector: '.menu', format: 'skip' },
            { selector: '.breadcrumb', format: 'skip' },
            { selector: '.pagination', format: 'skip' },
            { selector: '.footer', format: 'skip' },
            { selector: '.header', format: 'skip' },
        ],
    });
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

function hashCodeBlockContent(content: string): string {
    return createHash('sha256')
        .update(content)
        .digest('hex')
        .substring(0, 16);
}

// Export functions for testing
export { extractCodeBlocks, normalizeLanguageTag };

/**
 * Normalize language tag to a consistent format
 * Handles variations like "javascript", "js", "JavaScript" → "javascript"
 */
function normalizeLanguageTag(language: string): string {
    if (!language) return 'unknown';
    
    const normalized = language.toLowerCase().trim();
    
    // Return 'unknown' for empty strings after trimming
    if (!normalized) return 'unknown';
    
    // Common language aliases
    const aliases: Record<string, string> = {
        'javascript': 'javascript',
        'js': 'javascript',
        'typescript': 'typescript',
        'ts': 'typescript',
        'python': 'python',
        'py': 'python',
        'java': 'java',
        'c#': 'csharp',
        'csharp': 'csharp',
        'c++': 'cpp',
        'cpp': 'cpp',
        'c': 'c',
        'go': 'go',
        'golang': 'go',
        'rust': 'rust',
        'rs': 'rust',
        'ruby': 'ruby',
        'rb': 'ruby',
        'php': 'php',
        'swift': 'swift',
        'kotlin': 'kotlin',
        'kt': 'kotlin',
        'scala': 'scala',
        'shell': 'shell',
        'bash': 'shell',
        'sh': 'shell',
        'powershell': 'powershell',
        'ps1': 'powershell',
        'sql': 'sql',
        'json': 'json',
        'xml': 'xml',
        'html': 'html',
        'css': 'css',
        'scss': 'scss',
        'yaml': 'yaml',
        'yml': 'yaml',
        'markdown': 'markdown',
        'md': 'markdown',
        'dockerfile': 'dockerfile',
        'docker': 'dockerfile',
    };
    
    return aliases[normalized] || normalized;
}

/**
 * Extract all code blocks from HTML, including all language variants from tabbed interfaces
 * Returns an array of CodeBlock objects with normalized language tags
 */
function extractCodeBlocks(html: string, sourceUrl: string): CodeBlock[] {
    const codeBlocks: CodeBlock[] = [];
    let blockCounter = 0;
    const seenContent = new Map<string, number>();
    const seenContentLang = new Set<string>();

    const pushBlock = (block: CodeBlock) => {
        const contentHash = hashCodeBlockContent(block.content);
        const langKey = `${contentHash}:${block.language}`;

        if (block.language === 'unknown') {
            if (seenContent.has(contentHash)) {
                return;
            }
            codeBlocks.push(block);
            seenContent.set(contentHash, codeBlocks.length - 1);
            seenContentLang.add(langKey);
            return;
        }

        if (seenContentLang.has(langKey)) {
            return;
        }

        const existingIndex = seenContent.get(contentHash);
        if (existingIndex !== undefined) {
            const existing = codeBlocks[existingIndex];
            if (existing && existing.language === 'unknown') {
                codeBlocks[existingIndex] = block;
                seenContentLang.add(langKey);
                return;
            }
        }

        codeBlocks.push(block);
        seenContentLang.add(langKey);
        if (!seenContent.has(contentHash)) {
            seenContent.set(contentHash, codeBlocks.length - 1);
        }
    };
    
    // Pattern 1: Standard code blocks with language class
    // Matches: <pre><code class="language-javascript">...</code></pre>
    // Matches: <pre><code class="javascript">...</code></pre>
    const standardCodePattern = /<pre[^>]*>\s*<code[^>]*class=["'](?:language-)?([^"']+)["'][^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi;
    
    let match: RegExpExecArray | null;
    while ((match = standardCodePattern.exec(html)) !== null) {
        const language = normalizeLanguageTag(match[1]);
        const content = decodeHtmlEntities(match[2].trim());
        
        // Skip empty code blocks
        if (!content) continue;
        
        pushBlock({
            id: `${blockCounter}`,
            document_id: '', // Will be set by DocumentManager
            block_id: `block-${blockCounter}`,
            block_index: blockCounter,
            language,
            content,
            metadata: {
                source_url: sourceUrl,
                extraction_method: 'standard',
            },
            source_url: sourceUrl,
        });
        blockCounter++;
    }
    
    // Pattern 2: Code blocks without explicit language class
    const plainCodePattern = /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi;
    
    while ((match = plainCodePattern.exec(html)) !== null) {
        const content = decodeHtmlEntities(match[1].trim());
        
        // Skip empty code blocks
        if (!content) continue;
        
        pushBlock({
            id: `${blockCounter}`,
            document_id: '', // Will be set by DocumentManager
            block_id: `block-${blockCounter}`,
            block_index: blockCounter,
            language: 'unknown',
            content,
            metadata: {
                source_url: sourceUrl,
                extraction_method: 'plain',
            },
            source_url: sourceUrl,
        });
        blockCounter++;
    }
    
    // Pattern 3: Tabbed code blocks (common in documentation sites)
    // Look for patterns like:
    // <div class="tabs"><div class="tab" data-lang="javascript">...</div><div class="tab" data-lang="python">...</div></div>
    const tabbedCodePattern = /<div[^>]*class[^>]*tab[^>]*>[\s\S]*?(?=<div[^>]*class[^>]*tab[^>]*>|<\/div>[\s\S]*?<\/div>)/gi;
    
    const tabContainerPattern = /<div[^>]*class[^>]*tabs?[^>]*>([\s\S]*?)<\/div>/gi;
    let tabContainerMatch: RegExpExecArray | null;
    
    while ((tabContainerMatch = tabContainerPattern.exec(html)) !== null) {
        const tabContainer = tabContainerMatch[1];
        const tabs: Array<{ language: string; content: string }> = [];
        
        // Extract individual tabs with their content
        // Pattern for tabs with data-lang attribute
        const tabPattern = /<div[^>]*data-lang=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi;
        let tabMatch: RegExpExecArray | null;
        
        while ((tabMatch = tabPattern.exec(tabContainer)) !== null) {
            const language = normalizeLanguageTag(tabMatch[1]);
            const tabContent = tabMatch[2];
            
            // Extract code from tab content
            const innerCodeMatch = /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/i.exec(tabContent);
            if (innerCodeMatch) {
                const content = decodeHtmlEntities(innerCodeMatch[1].trim());
                if (content) {
                    tabs.push({ language, content });
                }
            }
        }
        
        // Create code blocks for each tab variant
        for (const tab of tabs) {
            pushBlock({
                id: `${blockCounter}`,
                document_id: '', // Will be set by DocumentManager
                block_id: `tabbed-block-${blockCounter}`,
                block_index: blockCounter,
                language: tab.language,
                content: tab.content,
                metadata: {
                    source_url: sourceUrl,
                    extraction_method: 'tabbed',
                    is_variant: true,
                    variant_count: tabs.length,
                },
                source_url: sourceUrl,
            });
            blockCounter++;
        }
    }
    
    // Pattern 4: Code blocks with data-language attribute
    const dataLangPattern = /<pre[^>]*data-language=["']([^"']+)["'][^>]*>([\s\S]*?)<\/pre>/gi;
    
    while ((match = dataLangPattern.exec(html)) !== null) {
        const language = normalizeLanguageTag(match[1]);
        const content = decodeHtmlEntities(match[2].trim());
        
        // Skip empty code blocks
        if (!content) continue;
        
        pushBlock({
            id: `${blockCounter}`,
            document_id: '', // Will be set by DocumentManager
            block_id: `block-${blockCounter}`,
            block_index: blockCounter,
            language,
            content,
            metadata: {
                source_url: sourceUrl,
                extraction_method: 'data-lang',
            },
            source_url: sourceUrl,
        });
        blockCounter++;
    }
    
    // Pattern 5: Code blocks with data-lang attribute
    const dataLangShortPattern = /<pre[^>]*data-lang=["']([^"']+)["'][^>]*>([\s\S]*?)<\/pre>/gi;
    
    while ((match = dataLangShortPattern.exec(html)) !== null) {
        const language = normalizeLanguageTag(match[1]);
        const content = decodeHtmlEntities(match[2].trim());
        
        // Skip empty code blocks
        if (!content) continue;
        
        pushBlock({
            id: `${blockCounter}`,
            document_id: '', // Will be set by DocumentManager
            block_id: `block-${blockCounter}`,
            block_index: blockCounter,
            language,
            content,
            metadata: {
                source_url: sourceUrl,
                extraction_method: 'data-lang-short',
            },
            source_url: sourceUrl,
        });
        blockCounter++;
    }
    
    return codeBlocks;
}
