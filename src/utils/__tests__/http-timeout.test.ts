/**
 * Unit tests for HTTP timeout utility
 * Tests for fetchWithTimeout, RequestTimeoutError, getRequestTimeout, and parseTimeoutValue
 */

import { describe, it, expect, vi } from 'vitest';
import {
    fetchWithTimeout,
    RequestTimeoutError,
    getRequestTimeout,
    parseTimeoutValue,
    DEFAULT_TIMEOUT_MS,
    ENV_TIMEOUT_GLOBAL,
    ENV_TIMEOUT_AI_SEARCH,
    ENV_TIMEOUT_EMBEDDING,
} from '../http-timeout.js';
import { withEnv } from '../../__tests__/test-utils.js';

describe('RequestTimeoutError', () => {
    describe('Properties', () => {
        it('should have isTimeout property set to true', () => {
            const timeoutMs = 5000;
            const url = 'https://api.example.com/test';
            const error = new RequestTimeoutError(timeoutMs, url);

            expect(error.isTimeout).toBe(true);
        });

        it('should have correct error name', () => {
            const error = new RequestTimeoutError(1000, 'https://example.com');
            expect(error.name).toBe('RequestTimeoutError');
        });

        it('should include timeout duration in message', () => {
            const timeoutMs = 5000;
            const url = 'https://api.example.com/test';
            const error = new RequestTimeoutError(timeoutMs, url);

            expect(error.message).toContain(String(timeoutMs));
        });

        it('should include URL in message', () => {
            const timeoutMs = 5000;
            const url = 'https://api.example.com/test';
            const error = new RequestTimeoutError(timeoutMs, url);

            expect(error.message).toContain(url);
        });

        it('should have timeoutMs property', () => {
            const timeoutMs = 5000;
            const url = 'https://api.example.com/test';
            const error = new RequestTimeoutError(timeoutMs, url);

            expect(error.timeoutMs).toBe(timeoutMs);
        });

        it('should have url property', () => {
            const timeoutMs = 5000;
            const url = 'https://api.example.com/test';
            const error = new RequestTimeoutError(timeoutMs, url);

            expect(error.url).toBe(url);
        });

        it('should be instance of Error', () => {
            const error = new RequestTimeoutError(1000, 'https://example.com');
            expect(error instanceof Error).toBe(true);
        });

        it('should be instance of RequestTimeoutError', () => {
            const error = new RequestTimeoutError(1000, 'https://example.com');
            expect(error instanceof RequestTimeoutError).toBe(true);
        });
    });

    describe('Stack Trace', () => {
        it('should have stack trace defined', () => {
            const error = new RequestTimeoutError(1000, 'https://example.com');
            expect(error.stack).toBeDefined();
        });

        it('should mention RequestTimeoutError in stack trace', () => {
            const error = new RequestTimeoutError(1000, 'https://example.com');
            expect(error.stack).toContain('RequestTimeoutError');
        });
    });
});

describe('parseTimeoutValue', () => {
    describe('Valid Numbers', () => {
        it('should parse valid numeric string', () => {
            expect(parseTimeoutValue('5000', 30000, 'TEST_VAR')).toBe(5000);
        });

        it('should parse 1000', () => {
            expect(parseTimeoutValue('1000', 30000, 'TEST_VAR')).toBe(1000);
        });

        it('should parse 60000', () => {
            expect(parseTimeoutValue('60000', 30000, 'TEST_VAR')).toBe(60000);
        });

        it('should parse 1', () => {
            expect(parseTimeoutValue('1', 30000, 'TEST_VAR')).toBe(1);
        });

        it('should trim whitespace', () => {
            expect(parseTimeoutValue('  5000  ', 30000, 'TEST_VAR')).toBe(5000);
        });

        it('should trim tabs and newlines', () => {
            expect(parseTimeoutValue('\t1000\n', 30000, 'TEST_VAR')).toBe(1000);
        });
    });

    describe('Invalid Values', () => {
        it('should return default for "invalid"', () => {
            expect(parseTimeoutValue('invalid', 30000, 'TEST_VAR')).toBe(30000);
        });

        it('should return default for "abc123"', () => {
            expect(parseTimeoutValue('abc123', 30000, 'TEST_VAR')).toBe(30000);
        });

        it('should return default for decimal', () => {
            expect(parseTimeoutValue('12.34', 30000, 'TEST_VAR')).toBe(30000);
        });

        it('should return default for empty string', () => {
            expect(parseTimeoutValue('', 30000, 'TEST_VAR')).toBe(30000);
        });

        it('should return default for undefined', () => {
            expect(parseTimeoutValue(undefined, 30000, 'TEST_VAR')).toBe(30000);
        });
    });

    describe('Zero and Negative Values', () => {
        it('should return default for zero', () => {
            expect(parseTimeoutValue('0', 30000, 'TEST_VAR')).toBe(30000);
        });

        it('should return default for -1', () => {
            expect(parseTimeoutValue('-1', 30000, 'TEST_VAR')).toBe(30000);
        });

        it('should return default for -5000', () => {
            expect(parseTimeoutValue('-5000', 30000, 'TEST_VAR')).toBe(30000);
        });
    });
});

describe('getRequestTimeout', () => {
    describe('Operation Types', () => {
        it('should return ai-search specific timeout', async () => {
            await withEnv({
                [ENV_TIMEOUT_GLOBAL]: '45000',
                [ENV_TIMEOUT_AI_SEARCH]: '60000',
                [ENV_TIMEOUT_EMBEDDING]: '30000',
            }, async () => {
                const aiSearchTimeout = getRequestTimeout('ai-search');
                expect(aiSearchTimeout).toBe(60000);
            });
        });

        it('should return embedding specific timeout', async () => {
            await withEnv({
                [ENV_TIMEOUT_GLOBAL]: '45000',
                [ENV_TIMEOUT_AI_SEARCH]: '60000',
                [ENV_TIMEOUT_EMBEDDING]: '30000',
            }, async () => {
                const embeddingTimeout = getRequestTimeout('embedding');
                expect(embeddingTimeout).toBe(30000);
            });
        });

        it('should return global timeout', async () => {
            await withEnv({
                [ENV_TIMEOUT_GLOBAL]: '45000',
                [ENV_TIMEOUT_AI_SEARCH]: '60000',
                [ENV_TIMEOUT_EMBEDDING]: '30000',
            }, async () => {
                const globalTimeout = getRequestTimeout('global');
                expect(globalTimeout).toBe(45000);
            });
        });
    });

    describe('Fallback Chain', () => {
        it('should fall back to global when ai-search not set', async () => {
            await withEnv({
                [ENV_TIMEOUT_GLOBAL]: '45000',
                [ENV_TIMEOUT_AI_SEARCH]: undefined,
                [ENV_TIMEOUT_EMBEDDING]: '25000',
            }, async () => {
                const aiSearchTimeout = getRequestTimeout('ai-search');
                expect(aiSearchTimeout).toBe(45000);
            });
        });

        it('should use embedding specific timeout', async () => {
            await withEnv({
                [ENV_TIMEOUT_GLOBAL]: '45000',
                [ENV_TIMEOUT_AI_SEARCH]: undefined,
                [ENV_TIMEOUT_EMBEDDING]: '25000',
            }, async () => {
                const embeddingTimeout = getRequestTimeout('embedding');
                expect(embeddingTimeout).toBe(25000);
            });
        });

        it('should use global timeout', async () => {
            await withEnv({
                [ENV_TIMEOUT_GLOBAL]: '45000',
                [ENV_TIMEOUT_AI_SEARCH]: undefined,
                [ENV_TIMEOUT_EMBEDDING]: '25000',
            }, async () => {
                const globalTimeout = getRequestTimeout('global');
                expect(globalTimeout).toBe(45000);
            });
        });

        it('should fall back to default when global not set', async () => {
            await withEnv({
                [ENV_TIMEOUT_GLOBAL]: undefined,
                [ENV_TIMEOUT_AI_SEARCH]: undefined,
                [ENV_TIMEOUT_EMBEDDING]: undefined,
            }, async () => {
                const aiSearchTimeout = getRequestTimeout('ai-search');
                expect(aiSearchTimeout).toBe(DEFAULT_TIMEOUT_MS);

                const embeddingTimeout = getRequestTimeout('embedding');
                expect(embeddingTimeout).toBe(DEFAULT_TIMEOUT_MS);

                const globalTimeout = getRequestTimeout('global');
                expect(globalTimeout).toBe(DEFAULT_TIMEOUT_MS);
            });
        });
    });

    describe('Invalid Values', () => {
        it('should fall back to default for invalid global', async () => {
            await withEnv({
                [ENV_TIMEOUT_GLOBAL]: 'invalid',
                [ENV_TIMEOUT_AI_SEARCH]: '60000',
            }, async () => {
                const globalTimeout = getRequestTimeout('global');
                expect(globalTimeout).toBe(DEFAULT_TIMEOUT_MS);
            });
        });

        it('should use valid specific value', async () => {
            await withEnv({
                [ENV_TIMEOUT_GLOBAL]: 'invalid',
                [ENV_TIMEOUT_AI_SEARCH]: '60000',
            }, async () => {
                const aiSearchTimeout = getRequestTimeout('ai-search');
                expect(aiSearchTimeout).toBe(60000);
            });
        });

        it('should fall back to global for invalid specific', async () => {
            await withEnv({
                [ENV_TIMEOUT_GLOBAL]: '45000',
                [ENV_TIMEOUT_AI_SEARCH]: 'not-a-number',
            }, async () => {
                const aiSearchTimeout = getRequestTimeout('ai-search');
                expect(aiSearchTimeout).toBe(45000);
            });
        });
    });
});

describe('fetchWithTimeout', () => {
    describe('Success', () => {
        it('should return successful response', async () => {
            const mockResponse = new Response('{"success": true}', {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });

            const originalFetch = global.fetch;

            try {
                global.fetch = vi.fn().mockResolvedValue(mockResponse) as any;

                const response = await fetchWithTimeout('https://api.example.com/data', {
                    method: 'GET',
                    headers: { 'Authorization': 'Bearer token' },
                });

                expect(response.status).toBe(200);
                expect(response.ok).toBe(true);
            } finally {
                global.fetch = originalFetch;
            }
        });
    });

    describe('Custom Timeout', () => {
        it('should pass AbortSignal to fetch', async () => {
            const originalFetch = global.fetch;
            let receivedSignal: AbortSignal | undefined;

            try {
                global.fetch = vi.fn().mockImplementation((url: string | URL, options?: RequestInit) => {
                    receivedSignal = options?.signal as AbortSignal | undefined;
                    return new Promise((resolve) => {
                        setTimeout(() => {
                            resolve(new Response('{}', { status: 200 }));
                        }, 100);
                    });
                }) as any;

                const fetchPromise = fetchWithTimeout('https://api.example.com/data', {
                    timeoutMs: 50,
                });

                await new Promise(resolve => setTimeout(resolve, 10));

                expect(receivedSignal).toBeDefined();

                try {
                    await fetchPromise;
                } catch (error) {
                    expect(error instanceof RequestTimeoutError).toBe(true);
                }
            } finally {
                global.fetch = originalFetch;
            }
        });
    });

    describe('AbortError Conversion', () => {
        it('should convert AbortError to RequestTimeoutError', async () => {
            const originalFetch = global.fetch;

            try {
                const abortError = new Error('The operation was aborted');
                abortError.name = 'AbortError';

                global.fetch = vi.fn().mockRejectedValue(abortError) as any;

                try {
                    await fetchWithTimeout('https://api.example.com/data', { timeoutMs: 1000 });
                    expect.fail('Should have thrown an error');
                } catch (error) {
                    expect(error instanceof RequestTimeoutError).toBe(true);
                    expect((error as RequestTimeoutError).isTimeout).toBe(true);
                    expect((error as RequestTimeoutError).url).toBe('https://api.example.com/data');
                }
            } finally {
                global.fetch = originalFetch;
            }
        });
    });

    describe('Other Errors', () => {
        it('should not convert non-AbortError to RequestTimeoutError', async () => {
            const originalFetch = global.fetch;

            try {
                const networkError = new Error('Network error: Connection refused');
                global.fetch = vi.fn().mockRejectedValue(networkError) as any;

                try {
                    await fetchWithTimeout('https://api.example.com/data');
                    expect.fail('Should have thrown an error');
                } catch (error) {
                    expect(!(error instanceof RequestTimeoutError)).toBe(true);
                    expect(error instanceof Error).toBe(true);
                    expect((error as Error).message).toContain('Network error');
                }
            } finally {
                global.fetch = originalFetch;
            }
        });

        it('should return HTTP error response', async () => {
            const originalFetch = global.fetch;

            try {
                global.fetch = vi.fn().mockResolvedValue(
                    new Response('Not Found', { status: 404, statusText: 'Not Found' })
                ) as any;

                const response = await fetchWithTimeout('https://api.example.com/data');
                expect(response.status).toBe(404);
                expect(response.ok).toBe(false);
            } finally {
                global.fetch = originalFetch;
            }
        });
    });

    describe('Invalid Timeout', () => {
        it('should warn about invalid timeout', async () => {
            const originalFetch = global.fetch;
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            try {
                global.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })) as any;

                await fetchWithTimeout('https://api.example.com/data', { timeoutMs: 0 });

                expect(consoleErrorSpy).toHaveBeenCalled();
            } finally {
                consoleErrorSpy.mockRestore();
                global.fetch = originalFetch;
            }
        });

        it('should warn about negative timeout', async () => {
            const originalFetch = global.fetch;
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            try {
                global.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 })) as any;

                await fetchWithTimeout('https://api.example.com/data', { timeoutMs: -100 });

                expect(consoleErrorSpy).toHaveBeenCalled();
            } finally {
                consoleErrorSpy.mockRestore();
                global.fetch = originalFetch;
            }
        });
    });

    describe('Default Timeout', () => {
        it('should use DEFAULT_TIMEOUT_MS', async () => {
            const originalFetch = global.fetch;
            let receivedSignal: AbortSignal | undefined;

            try {
                global.fetch = vi.fn().mockImplementation((url: string | URL, options?: RequestInit) => {
                    receivedSignal = options?.signal as AbortSignal | undefined;
                    return new Response('{}', { status: 200 });
                }) as any;

                await fetchWithTimeout('https://api.example.com/data');

                expect(receivedSignal).toBeDefined();
            } finally {
                global.fetch = originalFetch;
            }
        });
    });
});

describe('Environment Variable Parsing', () => {
    it('should read all timeout-related env vars', async () => {
        await withEnv({
            [ENV_TIMEOUT_GLOBAL]: '60000',
            [ENV_TIMEOUT_AI_SEARCH]: '120000',
            [ENV_TIMEOUT_EMBEDDING]: '90000',
        }, async () => {
            expect(process.env[ENV_TIMEOUT_GLOBAL]).toBe('60000');
            expect(process.env[ENV_TIMEOUT_AI_SEARCH]).toBe('120000');
            expect(process.env[ENV_TIMEOUT_EMBEDDING]).toBe('90000');

            const globalTimeout = getRequestTimeout('global');
            const aiSearchTimeout = getRequestTimeout('ai-search');
            const embeddingTimeout = getRequestTimeout('embedding');

            expect(globalTimeout).toBe(60000);
            expect(aiSearchTimeout).toBe(120000);
            expect(embeddingTimeout).toBe(90000);
        });
    });
});
