import { load, type Cheerio, type CheerioAPI, type Element } from 'cheerio';
import { createHash } from 'crypto';
import type { CodeBlock } from './types.js';
import { normalizeLanguageTag } from './code-block-utils.js';

type HtmlExtractionOptions = {
    sourceUrl?: string;
    fallbackTitle?: string;
};

export type HtmlExtractionResult = {
    text: string;
    title: string;
    links: string[];
    codeBlocks: CodeBlock[];
};

const NON_CONTENT_SELECTORS = [
    'nav',
    'header',
    'footer',
    'aside',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[role="complementary"]',
    'script',
    'style',
    'noscript',
    '.navigation',
    '.nav',
    '.sidebar',
    '.menu',
    '.breadcrumb',
    '.pagination',
    '.footer',
    '.header',
].join(',');

const BLOCK_BREAK_SELECTORS = [
    'p',
    'li',
    'pre',
    'code',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'section',
    'article',
    'div',
    'tr',
].join(',');

export function looksLikeHtml(content: string): boolean {
    if (!content) return false;
    const sample = content.slice(0, 1500).toLowerCase();
    if (sample.includes('<!doctype html') || sample.includes('<html') || sample.includes('<body') || sample.includes('<head')) {
        return true;
    }
    return /<\w+[^>]*>/.test(sample) && /<\/\w+>/.test(sample);
}

export function decodeHtmlEntities(value: string): string {
    const $ = load(value, { decodeEntities: true });
    return $.root().text();
}

export function extractHtmlContent(html: string, options: HtmlExtractionOptions = {}): HtmlExtractionResult {
    const sourceUrl = options.sourceUrl;
    const $ = load(html, { decodeEntities: true });

    const links = extractLinks($, sourceUrl);
    const codeBlocks = extractHtmlCodeBlocksFromDom($, sourceUrl);

    const rawTitle = $('title').first().text().trim();
    const derivedTitle = sourceUrl ? deriveTitleFromUrl(sourceUrl) : '';
    const title = rawTitle || derivedTitle || options.fallbackTitle || '';

    // Remove non-content elements before extracting text.
    if (NON_CONTENT_SELECTORS) {
        $(NON_CONTENT_SELECTORS).remove();
    }

    const text = extractText($);

    return {
        text,
        title,
        links,
        codeBlocks,
    };
}

export function extractHtmlCodeBlocks(html: string, sourceUrl?: string): CodeBlock[] {
    const $ = load(html, { decodeEntities: true });
    return extractHtmlCodeBlocksFromDom($, sourceUrl);
}

function extractHtmlCodeBlocksFromDom($: CheerioAPI, sourceUrl?: string): CodeBlock[] {
    const codeBlocks: CodeBlock[] = [];
    let blockCounter = 0;
    let tabGroupCounter = 0;
    const seenContent = new Map<string, number>();
    const seenContentLang = new Set<string>();
    const usedElements = new Set<Element>();

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

    // Extract tabbed code variants grouped by shared parent with multiple variants.
    const tabParents = new Map<Element, Element[]>();
    $('[data-lang], [data-language]').each((_, el) => {
        const container = findTabContainer($, $(el));
        if (!container) {
            return;
        }
        const list = tabParents.get(container) || [];
        list.push(el);
        tabParents.set(container, list);
    });

    for (const [parent, tabs] of tabParents.entries()) {
        if (tabs.length < 2) {
            continue;
        }

        const variants: Array<{ language: string; content: string; element?: Element }> = [];
        for (const tab of tabs) {
            const $tab = $(tab);
            const language = normalizeLanguageTag($tab.attr('data-lang') || $tab.attr('data-language') || '');
            const { content, element } = findCodeContent($tab);
            if (!content) {
                continue;
            }
            variants.push({ language, content, element });
            if (element) {
                usedElements.add(element);
            }
        }

        if (variants.length === 0) {
            continue;
        }

        const groupId = `tabbed-block-${tabGroupCounter++}`;
        for (const variant of variants) {
            pushBlock({
                id: `${blockCounter}`,
                document_id: '',
                block_id: groupId,
                block_index: blockCounter,
                language: variant.language,
                content: variant.content,
                metadata: {
                    source_url: sourceUrl,
                    extraction_method: 'tabbed',
                    is_variant: true,
                    variant_count: variants.length,
                },
                source_url: sourceUrl,
            });
            blockCounter += 1;
        }
    }

    $('pre').each((_, preEl) => {
        if (usedElements.has(preEl)) {
            return;
        }

        const $pre = $(preEl);
        const codeEl = $pre.children('code').first();
        if (codeEl.length > 0 && usedElements.has(codeEl.get(0))) {
            return;
        }

        const { content, element } = findCodeContent($pre);
        if (!content) {
            return;
        }

        const { language, method } = detectLanguage($pre, codeEl);

        if (element) {
            usedElements.add(element);
        }

        pushBlock({
            id: `${blockCounter}`,
            document_id: '',
            block_id: `block-${blockCounter}`,
            block_index: blockCounter,
            language,
            content,
            metadata: {
                source_url: sourceUrl,
                extraction_method: method,
            },
            source_url: sourceUrl,
        });
        blockCounter += 1;
    });

    return codeBlocks;
}

function findTabContainer($: CheerioAPI, node: Cheerio<Element>): Element | null {
    const candidates = node.parents().addBack();
    for (const el of candidates.toArray()) {
        const $el = $(el);
        const role = $el.attr('role');
        if (role === 'tablist') {
            return el;
        }
        if ($el.attr('data-tabs') !== undefined || $el.attr('data-tablist') !== undefined) {
            return el;
        }
        const classAttr = $el.attr('class');
        if (!classAttr) {
            continue;
        }
        const tokens = classAttr.split(/\s+/).filter(Boolean);
        if (tokens.some(token => token === 'tab' || token === 'tabs' || token.startsWith('tab-') || token.startsWith('tabs-'))) {
            return el;
        }
    }

    return null;
}

function findCodeContent(scope: Cheerio<Element>): { content: string; element?: Element } {
    if (scope.is('code')) {
        const content = scope.text().trim();
        return { content, element: scope.get(0) || undefined };
    }

    if (scope.is('pre')) {
        const directCode = scope.children('code').first();
        if (directCode.length > 0) {
            const content = directCode.text().trim();
            return { content, element: directCode.get(0) || undefined };
        }
        const nestedCode = scope.find('code').first();
        if (nestedCode.length > 0) {
            const content = nestedCode.text().trim();
            return { content, element: nestedCode.get(0) || undefined };
        }
        const content = scope.text().trim();
        return { content, element: scope.get(0) || undefined };
    }

    const codeEl = scope.find('pre > code').first();
    if (codeEl.length > 0) {
        const content = codeEl.text().trim();
        return { content, element: codeEl.get(0) || undefined };
    }

    const preEl = scope.find('pre').first();
    if (preEl.length > 0) {
        const content = preEl.text().trim();
        return { content, element: preEl.get(0) || undefined };
    }

    const standaloneCode = scope.find('code').first();
    if (standaloneCode.length > 0) {
        const content = standaloneCode.text().trim();
        return { content, element: standaloneCode.get(0) || undefined };
    }

    return { content: '' };
}

function detectLanguage(preEl: Cheerio<Element>, codeEl: Cheerio<Element>): { language: string; method: string } {
    const dataLang = codeEl.attr('data-lang') || preEl.attr('data-lang');
    if (dataLang) {
        return { language: normalizeLanguageTag(dataLang), method: 'data-lang-short' };
    }

    const dataLanguage = codeEl.attr('data-language') || preEl.attr('data-language');
    if (dataLanguage) {
        return { language: normalizeLanguageTag(dataLanguage), method: 'data-lang' };
    }

    const classLang = extractLanguageFromClasses(codeEl.attr('class'))
        || extractLanguageFromClasses(preEl.attr('class'));
    if (classLang) {
        return { language: classLang, method: 'standard' };
    }

    return { language: 'unknown', method: 'plain' };
}

function extractLanguageFromClasses(classAttr?: string | null): string | null {
    if (!classAttr) {
        return null;
    }
    const tokens = classAttr.split(/\s+/).filter(Boolean);
    const prioritized = [
        ...tokens.filter(token => token.startsWith('language-') || token.startsWith('lang-')),
        ...tokens,
    ];

    for (const token of prioritized) {
        const normalized = normalizeLanguageTag(token);
        if (normalized && normalized !== 'unknown') {
            return normalized;
        }
    }

    return null;
}

function extractLinks($: CheerioAPI, sourceUrl?: string): string[] {
    const links = new Set<string>();

    $('a[href]').each((_, el) => {
        const raw = $(el).attr('href');
        if (!raw) {
            return;
        }
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return;
        }
        if (trimmed.startsWith('mailto:') || trimmed.startsWith('tel:') || trimmed.startsWith('javascript:') || trimmed.startsWith('data:')) {
            return;
        }
        const resolved = resolveUrl(trimmed, sourceUrl);
        if (resolved) {
            links.add(resolved);
        }
    });

    return Array.from(links);
}

function resolveUrl(value: string, base?: string): string | null {
    try {
        const resolved = base ? new URL(value, base) : new URL(value);
        if (!['http:', 'https:'].includes(resolved.protocol)) {
            return null;
        }
        resolved.pathname = resolved.pathname.replace(/\/+/g, '/');
        return resolved.toString();
    } catch {
        return null;
    }
}

function extractText($: CheerioAPI): string {
    const root = $('body').length > 0 ? $('body') : $.root();

    root.find('br').replaceWith('\n');
    root.find(BLOCK_BREAK_SELECTORS).each((_, el) => {
        const $el = $(el);
        $el.append('\n');
    });

    const text = root.text();
    return normalizeExtractedText(text);
}

function normalizeExtractedText(value: string): string {
    return value
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function deriveTitleFromUrl(sourceUrl: string): string {
    try {
        const url = new URL(sourceUrl);
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0) {
            return decodeURIComponent(pathParts[pathParts.length - 1]);
        }
        return url.hostname;
    } catch {
        return '';
    }
}

function hashCodeBlockContent(content: string): string {
    return createHash('sha256')
        .update(content)
        .digest('hex')
        .substring(0, 16);
}
