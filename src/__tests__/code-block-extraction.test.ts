/**
 * Unit tests for code block extraction from documentation crawler
 * Tests for multi-language code block detection and extraction
 */

import assert from 'assert';
import { extractCodeBlocks, normalizeLanguageTag } from '../documentation-crawler.js';

/**
 * Test: Language tag normalization
 */
async function testLanguageTagNormalization() {
    console.log('\n=== Test: Language Tag Normalization ===');

    // Test standard language tags
    assert.strictEqual(normalizeLanguageTag('javascript'), 'javascript', 'Should normalize javascript');
    assert.strictEqual(normalizeLanguageTag('JavaScript'), 'javascript', 'Should normalize JavaScript');
    assert.strictEqual(normalizeLanguageTag('js'), 'javascript', 'Should normalize js to javascript');

    assert.strictEqual(normalizeLanguageTag('typescript'), 'typescript', 'Should normalize typescript');
    assert.strictEqual(normalizeLanguageTag('TypeScript'), 'typescript', 'Should normalize TypeScript');
    assert.strictEqual(normalizeLanguageTag('ts'), 'typescript', 'Should normalize ts to typescript');

    assert.strictEqual(normalizeLanguageTag('python'), 'python', 'Should normalize python');
    assert.strictEqual(normalizeLanguageTag('py'), 'python', 'Should normalize py to python');

    assert.strictEqual(normalizeLanguageTag('c#'), 'csharp', 'Should normalize c# to csharp');
    assert.strictEqual(normalizeLanguageTag('csharp'), 'csharp', 'Should normalize csharp');

    assert.strictEqual(normalizeLanguageTag('c++'), 'cpp', 'Should normalize c++ to cpp');
    assert.strictEqual(normalizeLanguageTag('cpp'), 'cpp', 'Should normalize cpp');

    assert.strictEqual(normalizeLanguageTag('shell'), 'shell', 'Should normalize shell');
    assert.strictEqual(normalizeLanguageTag('bash'), 'shell', 'Should normalize bash to shell');
    assert.strictEqual(normalizeLanguageTag('sh'), 'shell', 'Should normalize sh to shell');

    // Test edge cases
    assert.strictEqual(normalizeLanguageTag(''), 'unknown', 'Should handle empty string');
    assert.strictEqual(normalizeLanguageTag('  '), 'unknown', 'Should handle whitespace');
    assert.strictEqual(normalizeLanguageTag('UNKNOWN-LANG'), 'unknown-lang', 'Should lowercase unknown languages');

    console.log('✓ Language tag normalization tests passed');
}

/**
 * Test: Standard code block extraction
 */
async function testStandardCodeBlockExtraction() {
    console.log('\n=== Test: Standard Code Block Extraction ===');

    const html = `
        <html>
        <body>
        <pre><code class="language-javascript">const x = 1;
console.log(x);</code></pre>
        <pre><code class="python">x = 1
print(x)</code></pre>
        <pre><code class="language-typescript">const x: number = 1;</code></pre>
        </body>
        </html>
    `;

    const codeBlocks = extractCodeBlocks(html, 'https://example.com');

    assert.strictEqual(codeBlocks.length, 3, 'Should extract 3 code blocks');

    // Verify first code block (javascript)
    assert.strictEqual(codeBlocks[0].language, 'javascript', 'First block should be javascript');
    assert.strictEqual(codeBlocks[0].content, 'const x = 1;\nconsole.log(x);', 'Content should match');

    // Verify second code block (python)
    assert.strictEqual(codeBlocks[1].language, 'python', 'Second block should be python');
    assert.strictEqual(codeBlocks[1].content, 'x = 1\nprint(x)', 'Content should match');

    // Verify third code block (typescript)
    assert.strictEqual(codeBlocks[2].language, 'typescript', 'Third block should be typescript');

    // Verify metadata
    codeBlocks.forEach(cb => {
        assert.strictEqual(cb.source_url, 'https://example.com', 'Source URL should be set');
        assert.strictEqual(cb.metadata?.extraction_method, 'standard', 'Extraction method should be standard');
        assert(cb.metadata?.test === true, 'Metadata should be preserved');
    });

    console.log('✓ Standard code block extraction tests passed');
}

/**
 * Test: Plain code block extraction (without language class)
 */
async function testPlainCodeBlockExtraction() {
    console.log('\n=== Test: Plain Code Block Extraction ===');

    const html = `
        <html>
        <body>
        <pre><code>def hello():
    print("Hello")</code></pre>
        <pre><code>function hello() {
    console.log("Hello");
}</code></pre>
        </body>
        </html>
    `;

    const codeBlocks = extractCodeBlocks(html, 'https://example.com');

    assert.strictEqual(codeBlocks.length, 2, 'Should extract 2 code blocks');

    // Both should have 'unknown' language
    assert.strictEqual(codeBlocks[0].language, 'unknown', 'First block should have unknown language');
    assert.strictEqual(codeBlocks[1].language, 'unknown', 'Second block should have unknown language');

    // Verify extraction method
    assert.strictEqual(codeBlocks[0].metadata?.extraction_method, 'plain', 'Extraction method should be plain');

    console.log('✓ Plain code block extraction tests passed');
}

/**
 * Test: Tabbed code block extraction
 */
async function testTabbedCodeBlockExtraction() {
    console.log('\n=== Test: Tabbed Code Block Extraction ===');

    const html = `
        <html>
        <body>
        <div class="tabs">
            <div class="tab" data-lang="javascript">
                <pre><code>const x = 1;</code></pre>
            </div>
            <div class="tab" data-lang="python">
                <pre><code>x = 1</code></pre>
            </div>
            <div class="tab" data-lang="typescript">
                <pre><code>const x: number = 1;</code></pre>
            </div>
        </div>
        </body>
        </html>
    `;

    const codeBlocks = extractCodeBlocks(html, 'https://example.com');

    assert.strictEqual(codeBlocks.length, 3, 'Should extract 3 code block variants');

    // Verify all three languages are present
    const languages = codeBlocks.map(cb => cb.language);
    assert(languages.includes('javascript'), 'Should include javascript variant');
    assert(languages.includes('python'), 'Should include python variant');
    assert(languages.includes('typescript'), 'Should include typescript variant');

    // Verify all have the same block_id (indicating they're variants)
    const blockIds = [...new Set(codeBlocks.map(cb => cb.block_id))];
    assert.strictEqual(blockIds.length, 1, 'All variants should have the same block_id');

    // Verify metadata indicates tabbed extraction
    assert.strictEqual(codeBlocks[0].metadata?.extraction_method, 'tabbed', 'Extraction method should be tabbed');
    assert.strictEqual(codeBlocks[0].metadata?.is_variant, true, 'Should be marked as variant');
    assert.strictEqual(codeBlocks[0].metadata?.variant_count, 3, 'Should indicate 3 variants');

    console.log('✓ Tabbed code block extraction tests passed');
}

/**
 * Test: Code block extraction with data-language attribute
 */
async function testDataLanguageAttributeExtraction() {
    console.log('\n=== Test: Data-Language Attribute Extraction ===');

    const html = `
        <html>
        <body>
        <pre data-language="rust"><code>fn main() {
    println!("Hello");
}</code></pre>
        <pre data-lang="go"><code>func main() {
    fmt.Println("Hello")
}</code></pre>
        </body>
        </html>
    `;

    const codeBlocks = extractCodeBlocks(html, 'https://example.com');

    assert.strictEqual(codeBlocks.length, 2, 'Should extract 2 code blocks');

    assert.strictEqual(codeBlocks[0].language, 'rust', 'First block should be rust');
    assert.strictEqual(codeBlocks[0].metadata?.extraction_method, 'data-lang', 'Extraction method should be data-lang');

    assert.strictEqual(codeBlocks[1].language, 'go', 'Second block should be go');
    assert.strictEqual(codeBlocks[1].metadata?.extraction_method, 'data-lang-short', 'Extraction method should be data-lang-short');

    console.log('✓ Data-language attribute extraction tests passed');
}

/**
 * Test: Code block extraction with HTML entity decoding
 */
async function testHtmlEntityDecoding() {
    console.log('\n=== Test: HTML Entity Decoding ===');

    const html = `
        <html>
        <body>
        <pre><code class="language-javascript">const x = "hello";
console.log('world');</code></pre>
        </body>
        </html>
    `;

    const codeBlocks = extractCodeBlocks(html, 'https://example.com');

    assert.strictEqual(codeBlocks.length, 1, 'Should extract 1 code block');
    assert.strictEqual(codeBlocks[0].content, 'const x = "hello";\nconsole.log(\'world\');', 'Should decode HTML entities');

    console.log('✓ HTML entity decoding tests passed');
}

/**
 * Test: Empty and invalid code blocks are skipped
 */
async function testEmptyCodeBlockSkipping() {
    console.log('\n=== Test: Empty Code Block Skipping ===');

    const html = `
        <html>
        <body>
        <pre><code class="language-javascript"></code></pre>
        <pre><code class="language-python">   </code></pre>
        <pre><code class="language-typescript">const x = 1;</code></pre>
        <pre><code></code></pre>
        </body>
        </html>
    `;

    const codeBlocks = extractCodeBlocks(html, 'https://example.com');

    // Only the non-empty code block should be extracted
    assert.strictEqual(codeBlocks.length, 1, 'Should skip empty code blocks');
    assert.strictEqual(codeBlocks[0].language, 'typescript', 'Should extract only the non-empty block');

    console.log('✓ Empty code block skipping tests passed');
}

/**
 * Test: Mixed code block formats in single document
 */
async function testMixedCodeBlockFormats() {
    console.log('\n=== Test: Mixed Code Block Formats ===');

    const html = `
        <html>
        <body>
        <pre><code class="language-javascript">const x = 1;</code></pre>
        <div class="tabs">
            <div class="tab" data-lang="python">
                <pre><code>x = 1</code></pre>
            </div>
            <div class="tab" data-lang="ruby">
                <pre><code>x = 1</code></pre>
            </div>
        </div>
        <pre data-language="go"><code>func main() {}</code></pre>
        <pre><code>plain code</code></pre>
        </body>
        </html>
    `;

    const codeBlocks = extractCodeBlocks(html, 'https://example.com');

    assert.strictEqual(codeBlocks.length === 5, 'Should extract code blocks from all formats');

    // Verify we have different extraction methods
    const extractionMethods = [...new Set(codeBlocks.map(cb => cb.metadata?.extraction_method))];
    assert(extractionMethods.includes('standard'), 'Should have standard extraction');
    assert(extractionMethods.includes('tabbed'), 'Should have tabbed extraction');
    assert(extractionMethods.includes('data-lang'), 'Should have data-lang extraction');
    assert(extractionMethods.includes('plain'), 'Should have plain extraction');

    console.log('✓ Mixed code block format tests passed');
}

/**
 * Run all code block extraction tests
 */
async function runCodeBlockTests() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Code Block Extraction Unit Tests                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    try {
        await testLanguageTagNormalization();
        await testStandardCodeBlockExtraction();
        await testPlainCodeBlockExtraction();
        await testTabbedCodeBlockExtraction();
        await testDataLanguageAttributeExtraction();
        await testHtmlEntityDecoding();
        await testEmptyCodeBlockSkipping();
        await testMixedCodeBlockFormats();

        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║  ✓ All code block extraction tests passed!               ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
    } catch (error) {
        console.error('\n✗ Test failed:', error);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runCodeBlockTests();
}

export { runCodeBlockTests };
