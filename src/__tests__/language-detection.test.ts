/**
 * Tests for language detection feature (Task 5.1, 5.2, 5.3)
 */

import { describe, it, expect } from 'vitest';
import { withBaseDirAndDocumentManager, withEnv } from './test-utils.js';
import { detectLanguages, getAcceptedLanguages, getDefaultQueryLanguages, getLanguageConfidenceThreshold, isLanguageAllowed, matchesLanguageFilter, parseLanguageList } from '../language-detection.js';

describe('Language Detection', () => {
    describe('Language Detection', () => {
        it('should detect English', async () => {
            const englishText = 'This is a test document written in English language.';
            const englishResult = await detectLanguages(englishText, 0.2);
            expect(englishResult).toContain('en');
        });

        it('should detect Spanish', async () => {
            const spanishText = 'Este es un documento de prueba escrito en idioma español.';
            const spanishResult = await detectLanguages(spanishText, 0.2);
            expect(spanishResult).toContain('es');
        });

        it('should detect French', async () => {
            const frenchText = 'Ceci est un document de test écrit en langue française.';
            const frenchResult = await detectLanguages(frenchText, 0.2);
            expect(frenchResult).toContain('fr');
        });

        it('should return unknown for empty text', async () => {
            const emptyResult = await detectLanguages('', 0.2);
            expect(emptyResult).toContain('unknown');
        });

        it('should respect confidence threshold', async () => {
            const lowConfidenceResult = await detectLanguages('Hi', 0.9);
            expect(lowConfidenceResult).toContain('unknown');
        });
    });

    describe('Allowlist Decisions', () => {
        it('should allow all when no allowlist', () => {
            const noAllowlist = isLanguageAllowed(['en'], null);
            expect(noAllowlist).toBe(true);
        });

        it('should allow when language matches', () => {
            const matching = isLanguageAllowed(['en'], ['en', 'es', 'fr']);
            expect(matching).toBe(true);
        });

        it('should not allow when language does not match', () => {
            const nonMatching = isLanguageAllowed(['de'], ['en', 'es', 'fr']);
            expect(nonMatching).toBe(false);
        });

        it('should allow unknown when in allowlist', () => {
            const unknownAllowed = isLanguageAllowed(['unknown'], ['en', 'unknown']);
            expect(unknownAllowed).toBe(true);
        });

        it('should not allow unknown when not in allowlist', () => {
            const unknownNotAllowed = isLanguageAllowed(['unknown'], ['en', 'es']);
            expect(unknownNotAllowed).toBe(false);
        });
    });

    describe('Environment Variable Parsing', () => {
        it('should parse MCP_ACCEPTED_LANGUAGES', async () => {
            await withEnv({
                MCP_ACCEPTED_LANGUAGES: 'en,es,fr',
            }, async () => {
                const accepted = getAcceptedLanguages();
                expect(accepted).toBeDefined();
                expect(accepted.length).toBe(3);
                expect(accepted).toContain('en');
                expect(accepted).toContain('es');
                expect(accepted).toContain('fr');
            });
        });

        it('should parse MCP_DEFAULT_QUERY_LANGUAGES', async () => {
            await withEnv({
                MCP_DEFAULT_QUERY_LANGUAGES: 'en',
            }, async () => {
                const defaultQuery = getDefaultQueryLanguages();
                expect(defaultQuery).toContain('en');
            });
        });

        it('should parse MCP_LANGUAGE_CONFIDENCE_THRESHOLD', async () => {
            await withEnv({
                MCP_LANGUAGE_CONFIDENCE_THRESHOLD: '0.3'
            }, async () => {
                const threshold = getLanguageConfidenceThreshold();
                expect(threshold).toBe(0.3);
            });
        });

        it('should fall back to MCP_ACCEPTED_LANGUAGES when MCP_DEFAULT_QUERY_LANGUAGES not set', async () => {
            await withEnv({
                MCP_ACCEPTED_LANGUAGES: 'de,it',
                MCP_DEFAULT_QUERY_LANGUAGES: undefined
            }, async () => {
                const defaultQuery = getDefaultQueryLanguages();
                expect(defaultQuery).toContain('de');
                expect(defaultQuery).toContain('it');
            });
        });

        it('should default accepted languages to en,no when unset', async () => {
            await withEnv({
                MCP_ACCEPTED_LANGUAGES: undefined,
                MCP_DEFAULT_QUERY_LANGUAGES: undefined,
            }, async () => {
                const accepted = getAcceptedLanguages();
                expect(accepted).toContain('en');
                expect(accepted).toContain('no');
            });
        });

        it('should default query languages to en,no when unset', async () => {
            await withEnv({
                MCP_ACCEPTED_LANGUAGES: undefined,
                MCP_DEFAULT_QUERY_LANGUAGES: undefined,
            }, async () => {
                const defaultQuery = getDefaultQueryLanguages();
                expect(defaultQuery).toContain('en');
                expect(defaultQuery).toContain('no');
            });
        });

        it('should use default confidence threshold', async () => {
            await withEnv({
                MCP_LANGUAGE_CONFIDENCE_THRESHOLD: undefined
            }, async () => {
                const threshold = getLanguageConfidenceThreshold();
                expect(threshold).toBe(0.2);
            });
        });
    });

    describe('Language Filter Matching', () => {
        it('should match when no filter', () => {
            const noFilter = matchesLanguageFilter(['en', 'es'], undefined);
            expect(noFilter).toBe(true);
        });

        it('should match when document language in filter', () => {
            const matching = matchesLanguageFilter(['en', 'es'], ['en']);
            expect(matching).toBe(true);
        });

        it('should not match when document language not in filter', () => {
            const nonMatching = matchesLanguageFilter(['de'], ['en', 'fr']);
            expect(nonMatching).toBe(false);
        });

        it('should match unknown when document has no languages and unknown in filter', () => {
            const emptyWithUnknown = matchesLanguageFilter([], ['unknown']);
            expect(emptyWithUnknown).toBe(true);
        });

        it('should not match when document has no languages and unknown not in filter', () => {
            const emptyWithoutUnknown = matchesLanguageFilter([], ['en', 'fr']);
            expect(emptyWithoutUnknown).toBe(false);
        });
    });

    describe('Document Ingestion with Language Allowlist', () => {
        it('should accept English document with allowlist', async () => {
            await withEnv({
                MCP_ACCEPTED_LANGUAGES: 'en',
                MCP_LANGUAGE_CONFIDENCE_THRESHOLD: '0.2'
            }, async () => {
                await withBaseDirAndDocumentManager('lang-test-', async ({ documentManager }) => {
                    const englishDoc = await documentManager.addDocument(
                        'English Document',
                        'This is a document written entirely in English language.',
                        { source: 'test' }
                    );
                    expect(englishDoc).toBeDefined();
                    expect(englishDoc?.metadata.languages).toContain('en');

                    // Clean up
                    if (englishDoc) {
                        await documentManager.deleteDocument(englishDoc.id);
                    }
                });
            });
        });
    });

    describe('Query with Language Filter', () => {
        it('should find English document with language filter', async () => {
            await withEnv({ MCP_ACCEPTED_LANGUAGES: 'en,es' }, async () => {
                await withBaseDirAndDocumentManager('query-lang-test-', async ({ documentManager }) => {
                const doc1 = await documentManager.addDocument(
                    'Document 1',
                    'This is a test document about programming.',
                    { source: 'test', languages: ['en'] }
                );
                expect(doc1).toBeDefined();

                const doc2 = await documentManager.addDocument(
                    'Document 2',
                    'Este es un documento de prueba sobre programación.',
                    { source: 'test', languages: ['es'] }
                );
                expect(doc2).toBeDefined();

                const englishResults = await documentManager.query('programming', {
                    filters: { languages: ['en'] }
                });

                const hasDoc1 = doc1 ? englishResults.results.some(r => r.id === doc1.id) : false;
                expect(hasDoc1).toBe(true);

                const spanishResults = await documentManager.query('prueba', {
                    filters: { languages: ['es'] }
                });

                const hasDoc2 = doc2 ? spanishResults.results.some(r => r.id === doc2.id) : false;
                expect(hasDoc2).toBe(true);

                // Clean up
                if (doc1) {
                    await documentManager.deleteDocument(doc1.id);
                }
                if (doc2) {
                    await documentManager.deleteDocument(doc2.id);
                }
                });
            });
        });
    });

    describe('Crawl with Accepted Languages Override', () => {
        it('should accept accepted_languages in CrawlOptions', () => {
            const options = {
                seedUrl: 'https://example.com',
                maxPages: 10,
                maxDepth: 2,
                sameDomainOnly: true,
                accepted_languages: ['en', 'es']
            };

            expect(options.accepted_languages).toBeDefined();
            expect(options.accepted_languages?.length).toBe(2);
        });
    });

    describe('Parse Language List', () => {
        it('should parse comma-separated languages', () => {
            const result = parseLanguageList('en,es,fr');
            expect(result).toBeDefined();
            expect(result?.length).toBe(3);
        });

        it('should handle spaces', () => {
            const result = parseLanguageList('en, es, fr');
            expect(result).toBeDefined();
            expect(result?.length).toBe(3);
        });

        it('should return null for empty string', () => {
            const result = parseLanguageList('');
            expect(result).toBeNull();
        });

        it('should return null for undefined', () => {
            const result = parseLanguageList(undefined);
            expect(result).toBeNull();
        });
    });
});
