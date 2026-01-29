/**
 * Unit tests for Cheerio-based HTML extraction
 */

import assert from 'assert';
import { extractHtmlContent, looksLikeHtml } from '../html-extraction.js';

async function testHtmlDetection() {
    console.log('\n=== Test: HTML Detection ===');

    assert.strictEqual(looksLikeHtml('<html><body></body></html>'), true, 'Should detect HTML tags');
    assert.strictEqual(looksLikeHtml('plain text content'), false, 'Should reject plain text');

    console.log('✓ HTML detection tests passed');
}

async function testTitleAndTextExtraction() {
    console.log('\n=== Test: Title and Text Extraction ===');

    const html = `
        <!doctype html>
        <html>
        <head><title>Doc &amp; Title</title></head>
        <body>
            <nav>SHOULD-NOT-INCLUDE</nav>
            <main>
                <h1>Heading</h1>
                <p>Paragraph text.</p>
                <script>malicious()</script>
                <style>.hidden{display:none;}</style>
            </main>
        </body>
        </html>
    `;

    const result = extractHtmlContent(html, { sourceUrl: 'https://example.com/docs/intro' });

    assert.strictEqual(result.title, 'Doc & Title', 'Should extract and decode title');
    assert(result.text.includes('Heading'), 'Should include visible text');
    assert(result.text.includes('Paragraph text.'), 'Should include paragraph text');
    assert(!result.text.includes('malicious()'), 'Should remove script contents');
    assert(!result.text.includes('SHOULD-NOT-INCLUDE'), 'Should remove nav content');

    console.log('✓ Title and text extraction tests passed');
}

async function testLinkAndCodeExtraction() {
    console.log('\n=== Test: Link and Code Extraction ===');

    const html = `
        <html>
        <head></head>
        <body>
            <a href="/docs/start">Docs</a>
            <a href="https://example.com/abs">Absolute</a>
            <a href="mailto:test@example.com">Mail</a>
            <a href="javascript:alert('x')">Script</a>
            <a href="#section">Anchor</a>
            <pre><code class="language-js">const x = 1;</code></pre>
        </body>
        </html>
    `;

    const result = extractHtmlContent(html, { sourceUrl: 'https://example.com/base/' });

    const expectedLinks = new Set([
        'https://example.com/docs/start',
        'https://example.com/abs',
    ]);

    assert.strictEqual(result.links.length, expectedLinks.size, 'Should extract expected links');
    result.links.forEach(link => assert(expectedLinks.has(link), 'Unexpected link extracted'));

    assert.strictEqual(result.codeBlocks.length, 1, 'Should extract one code block');
    assert.strictEqual(result.codeBlocks[0].language, 'javascript', 'Should normalize language');
    assert.strictEqual(result.codeBlocks[0].content, 'const x = 1;', 'Should extract code block content');

    console.log('✓ Link and code extraction tests passed');
}

async function testTitleFallbackFromUrl() {
    console.log('\n=== Test: Title Fallback from URL ===');

    const html = `
        <html>
        <body>
            <p>Content</p>
        </body>
        </html>
    `;

    const result = extractHtmlContent(html, { sourceUrl: 'https://example.com/path/to/page' });
    assert.strictEqual(result.title, 'page', 'Should derive title from URL when missing');

    console.log('✓ Title fallback tests passed');
}

async function runHtmlExtractionTests() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  HTML Extraction Unit Tests                               ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    try {
        await testHtmlDetection();
        await testTitleAndTextExtraction();
        await testLinkAndCodeExtraction();
        await testTitleFallbackFromUrl();

        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║  ✓ All HTML extraction tests passed!                      ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
    } catch (error) {
        console.error('\n✗ Test failed:', error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runHtmlExtractionTests();
}

export { runHtmlExtractionTests };
