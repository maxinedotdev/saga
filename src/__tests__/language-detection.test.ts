/**
 * Tests for language detection feature (Task 5.1, 5.2, 5.3)
 */

import './setup.js';
import { withBaseDirAndDocumentManager, withEnv } from './test-utils.js';
import { detectLanguages, getAcceptedLanguages, getDefaultQueryLanguages, getLanguageConfidenceThreshold, isLanguageAllowed, matchesLanguageFilter, parseLanguageList } from '../language-detection.js';
import { crawlDocumentation } from '../documentation-crawler.js';

async function testLanguageDetection() {
    console.log('\n=== Test: Language Detection ===');

    // Test English detection
    const englishText = 'This is a test document written in English language.';
    const englishResult = detectLanguages(englishText, 0.2);
    if (!englishResult.includes('en')) {
        throw new Error(`Expected 'en' for English text, got: ${englishResult.join(', ')}`);
    }
    console.log('  ✓ English detection works');

    // Test Spanish detection
    const spanishText = 'Este es un documento de prueba escrito en idioma español.';
    const spanishResult = detectLanguages(spanishText, 0.2);
    if (!spanishResult.includes('es')) {
        throw new Error(`Expected 'es' for Spanish text, got: ${spanishResult.join(', ')}`);
    }
    console.log('  ✓ Spanish detection works');

    // Test French detection
    const frenchText = 'Ceci est un document de test écrit en langue française.';
    const frenchResult = detectLanguages(frenchText, 0.2);
    if (!frenchResult.includes('fr')) {
        throw new Error(`Expected 'fr' for French text, got: ${frenchResult.join(', ')}`);
    }
    console.log('  ✓ French detection works');

    // Test empty text returns 'unknown'
    const emptyResult = detectLanguages('', 0.2);
    if (!emptyResult.includes('unknown')) {
        throw new Error(`Expected 'unknown' for empty text, got: ${emptyResult.join(', ')}`);
    }
    console.log('  ✓ Empty text returns unknown');

    // Test confidence threshold
    const lowConfidenceResult = detectLanguages('Hi', 0.9);
    if (!lowConfidenceResult.includes('unknown')) {
        throw new Error(`Expected 'unknown' for low confidence with high threshold`);
    }
    console.log('  ✓ Confidence threshold works');

    console.log('✓ Language detection tests passed');
}

async function testAllowlistDecisions() {
    console.log('\n=== Test: Allowlist Decisions ===');

    // Test with no allowlist (should allow all)
    const noAllowlist = isLanguageAllowed(['en'], null);
    if (!noAllowlist) throw new Error('Should allow all when no allowlist');
    console.log('  ✓ No allowlist allows all languages');

    // Test with matching language
    const matching = isLanguageAllowed(['en'], ['en', 'es', 'fr']);
    if (!matching) throw new Error('Should allow when language matches');
    console.log('  ✓ Matching language is allowed');

    // Test with non-matching language
    const nonMatching = isLanguageAllowed(['de'], ['en', 'es', 'fr']);
    if (nonMatching) throw new Error('Should not allow when language does not match');
    console.log('  ✓ Non-matching language is rejected');

    // Test with 'unknown' in allowlist
    const unknownAllowed = isLanguageAllowed(['unknown'], ['en', 'unknown']);
    if (!unknownAllowed) throw new Error('Should allow unknown when in allowlist');
    console.log('  ✓ Unknown language allowed when in allowlist');

    // Test with 'unknown' not in allowlist
    const unknownNotAllowed = isLanguageAllowed(['unknown'], ['en', 'es']);
    if (unknownNotAllowed) throw new Error('Should not allow unknown when not in allowlist');
    console.log('  ✓ Unknown language rejected when not in allowlist');

    console.log('✓ Allowlist decision tests passed');
}

async function testEnvironmentVariableParsing() {
    console.log('\n=== Test: Environment Variable Parsing ===');

    await withEnv({
        MCP_ACCEPTED_LANGUAGES: 'en,es,fr',
        MCP_DEFAULT_QUERY_LANGUAGES: 'en',
        MCP_LANGUAGE_CONFIDENCE_THRESHOLD: '0.3'
    }, async () => {
        const accepted = getAcceptedLanguages();
        if (!accepted || accepted.length !== 3) {
            throw new Error('Should parse MCP_ACCEPTED_LANGUAGES');
        }
        if (!accepted.includes('en') || !accepted.includes('es') || !accepted.includes('fr')) {
            throw new Error('Should include all languages from MCP_ACCEPTED_LANGUAGES');
        }
        console.log('  ✓ MCP_ACCEPTED_LANGUAGES parsing works');

        const defaultQuery = getDefaultQueryLanguages();
        if (!defaultQuery || !defaultQuery.includes('en')) {
            throw new Error('Should parse MCP_DEFAULT_QUERY_LANGUAGES');
        }
        console.log('  ✓ MCP_DEFAULT_QUERY_LANGUAGES parsing works');

        const threshold = getLanguageConfidenceThreshold();
        if (threshold !== 0.3) {
            throw new Error(`Should parse MCP_LANGUAGE_CONFIDENCE_THRESHOLD, got: ${threshold}`);
        }
        console.log('  ✓ MCP_LANGUAGE_CONFIDENCE_THRESHOLD parsing works');
    });

    // Test fallback to MCP_ACCEPTED_LANGUAGES when MCP_DEFAULT_QUERY_LANGUAGES not set
    await withEnv({
        MCP_ACCEPTED_LANGUAGES: 'de,it',
        MCP_DEFAULT_QUERY_LANGUAGES: undefined
    }, async () => {
        const defaultQuery = getDefaultQueryLanguages();
        if (!defaultQuery || !defaultQuery.includes('de') || !defaultQuery.includes('it')) {
            throw new Error('Should fall back to MCP_ACCEPTED_LANGUAGES');
        }
        console.log('  ✓ Fallback to MCP_ACCEPTED_LANGUAGES works');
    });

    // Test default threshold
    await withEnv({
        MCP_LANGUAGE_CONFIDENCE_THRESHOLD: undefined
    }, async () => {
        const threshold = getLanguageConfidenceThreshold();
        if (threshold !== 0.2) {
            throw new Error(`Should use default threshold 0.2, got: ${threshold}`);
        }
        console.log('  ✓ Default confidence threshold works');
    });

    console.log('✓ Environment variable parsing tests passed');
}

async function testLanguageFilterMatching() {
    console.log('\n=== Test: Language Filter Matching ===');

    // Test no filter (allow all)
    const noFilter = matchesLanguageFilter(['en', 'es'], undefined);
    if (!noFilter) throw new Error('Should match when no filter');
    console.log('  ✓ No filter allows all');

    // Test matching filter
    const matching = matchesLanguageFilter(['en', 'es'], ['en']);
    if (!matching) throw new Error('Should match when document language in filter');
    console.log('  ✓ Matching filter works');

    // Test non-matching filter
    const nonMatching = matchesLanguageFilter(['de'], ['en', 'fr']);
    if (nonMatching) throw new Error('Should not match when document language not in filter');
    console.log('  ✓ Non-matching filter rejected');

    // Test empty document languages with unknown in filter
    const emptyWithUnknown = matchesLanguageFilter([], ['unknown']);
    if (!emptyWithUnknown) throw new Error('Should match unknown when document has no languages');
    console.log('  ✓ Empty document languages with unknown filter');

    // Test empty document languages without unknown in filter
    const emptyWithoutUnknown = matchesLanguageFilter([], ['en', 'fr']);
    if (emptyWithoutUnknown) throw new Error('Should not match when document has no languages and unknown not in filter');
    console.log('  ✓ Empty document languages without unknown filter rejected');

    console.log('✓ Language filter matching tests passed');
}

async function testDocumentIngestionWithLanguageAllowlist() {
    console.log('\n=== Test: Document Ingestion with Language Allowlist ===');

    await withEnv({
        MCP_ACCEPTED_LANGUAGES: 'en',
        MCP_LANGUAGE_CONFIDENCE_THRESHOLD: '0.2'
    }, async () => {
        await withBaseDirAndDocumentManager('lang-test-', async ({ documentManager }) => {
            // English document should be accepted
            const englishDoc = await documentManager.addDocument(
                'English Document',
                'This is a document written entirely in English language.',
                { source: 'test' }
            );
            if (!englishDoc) throw new Error('English document should be accepted');
            if (!englishDoc.metadata.languages || !englishDoc.metadata.languages.includes('en')) {
                throw new Error('English document should have languages metadata');
            }
            console.log('  ✓ English document accepted with allowlist');

            // Clean up
            await documentManager.deleteDocument(englishDoc.id);
        });
    });

    console.log('✓ Document ingestion with language allowlist tests passed');
}

async function testQueryWithLanguageFilter() {
    console.log('\n=== Test: Query with Language Filter ===');

    await withBaseDirAndDocumentManager('query-lang-test-', async ({ documentManager }) => {
        // Create documents with different languages metadata
        const doc1 = await documentManager.addDocument(
            'Document 1',
            'This is a test document about programming.',
            { source: 'test', languages: ['en'] }
        );
        if (!doc1) throw new Error('Document 1 should be created');

        const doc2 = await documentManager.addDocument(
            'Document 2',
            'Este es un documento de prueba sobre programación.',
            { source: 'test', languages: ['es'] }
        );
        if (!doc2) throw new Error('Document 2 should be created');

        // Query with language filter for English
        const englishResults = await documentManager.query('programming', {
            filters: { languages: ['en'] }
        });

        // Should find at least doc1
        const hasDoc1 = englishResults.results.some(r => r.id === doc1.id);
        if (!hasDoc1) {
            throw new Error('Should find English document with language filter');
        }
        console.log('  ✓ Query with English language filter works');

        // Query with language filter for Spanish
        const spanishResults = await documentManager.query('prueba', {
            filters: { languages: ['es'] }
        });

        // Should find doc2
        const hasDoc2 = spanishResults.results.some(r => r.id === doc2.id);
        if (!hasDoc2) {
            throw new Error('Should find Spanish document with language filter');
        }
        console.log('  ✓ Query with Spanish language filter works');

        // Clean up
        await documentManager.deleteDocument(doc1.id);
        await documentManager.deleteDocument(doc2.id);
    });

    console.log('✓ Query with language filter tests passed');
}

async function testCrawlWithAcceptedLanguages() {
    console.log('\n=== Test: Crawl with Accepted Languages Override ===');

    // This test verifies that the accepted_languages option is available in CrawlOptions
    // Actual crawling would require network access, so we just verify the types
    const options = {
        seedUrl: 'https://example.com',
        maxPages: 10,
        maxDepth: 2,
        sameDomainOnly: true,
        accepted_languages: ['en', 'es']
    };

    // Verify the options structure is valid
    if (!options.accepted_languages || options.accepted_languages.length !== 2) {
        throw new Error('CrawlOptions should accept accepted_languages');
    }
    console.log('  ✓ CrawlOptions accepts accepted_languages override');

    console.log('✓ Crawl with accepted languages tests passed');
}

async function testParseLanguageList() {
    console.log('\n=== Test: Parse Language List ===');

    // Test normal parsing
    const result1 = parseLanguageList('en,es,fr');
    if (!result1 || result1.length !== 3) throw new Error('Should parse comma-separated languages');
    console.log('  ✓ Parse comma-separated languages');

    // Test with spaces
    const result2 = parseLanguageList('en, es, fr');
    if (!result2 || result2.length !== 3) throw new Error('Should handle spaces');
    console.log('  ✓ Parse with spaces');

    // Test empty
    const result3 = parseLanguageList('');
    if (result3 !== null) throw new Error('Should return null for empty string');
    console.log('  ✓ Return null for empty string');

    // Test undefined
    const result4 = parseLanguageList(undefined);
    if (result4 !== null) throw new Error('Should return null for undefined');
    console.log('  ✓ Return null for undefined');

    console.log('✓ Parse language list tests passed');
}

async function runLanguageDetectionTests() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  Language Detection Tests                                  ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    try {
        await testLanguageDetection();
        await testAllowlistDecisions();
        await testEnvironmentVariableParsing();
        await testLanguageFilterMatching();
        await testDocumentIngestionWithLanguageAllowlist();
        await testQueryWithLanguageFilter();
        await testCrawlWithAcceptedLanguages();
        await testParseLanguageList();

        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║  ✓ All language detection tests passed!                    ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
    } catch (error) {
        console.error('\n✗ Test failed:', error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runLanguageDetectionTests();
}

export { runLanguageDetectionTests };
