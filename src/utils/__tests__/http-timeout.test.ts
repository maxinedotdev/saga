/**
 * Unit tests for HTTP timeout utility
 * Tests for fetchWithTimeout, RequestTimeoutError, getRequestTimeout, and parseTimeoutValue
 */

import './../../__tests__/setup.js';
import assert from 'assert';
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

// ============================================================================
// RequestTimeoutError Tests
// ============================================================================

async function testRequestTimeoutErrorProperties() {
    console.log('\n=== Test: RequestTimeoutError Properties ===');

    const timeoutMs = 5000;
    const url = 'https://api.example.com/test';
    const error = new RequestTimeoutError(timeoutMs, url);

    // Test isTimeout property
    assert.strictEqual(error.isTimeout, true, 'isTimeout should be true');

    // Test error name
    assert.strictEqual(error.name, 'RequestTimeoutError', 'Error name should be "RequestTimeoutError"');

    // Test error message includes timeout duration and URL
    assert(error.message.includes(String(timeoutMs)), 'Error message should include timeout duration');
    assert(error.message.includes(url), 'Error message should include URL');

    // Test timeoutMs property
    assert.strictEqual(error.timeoutMs, timeoutMs, 'timeoutMs property should match');

    // Test url property
    assert.strictEqual(error.url, url, 'url property should match');

    // Test that it's an instance of Error
    assert(error instanceof Error, 'Should be instance of Error');

    // Test that it's an instance of RequestTimeoutError
    assert(error instanceof RequestTimeoutError, 'Should be instance of RequestTimeoutError');

    console.log('✓ RequestTimeoutError properties test passed');
}

async function testRequestTimeoutErrorStackTrace() {
    console.log('\n=== Test: RequestTimeoutError Stack Trace ===');

    const error = new RequestTimeoutError(1000, 'https://example.com');

    // Test that stack trace is present
    assert(error.stack !== undefined, 'Stack trace should be defined');
    assert(error.stack.includes('RequestTimeoutError'), 'Stack trace should mention RequestTimeoutError');

    console.log('✓ RequestTimeoutError stack trace test passed');
}

// ============================================================================
// parseTimeoutValue Tests
// ============================================================================

async function testParseTimeoutValueValidNumbers() {
    console.log('\n=== Test: parseTimeoutValue Valid Numbers ===');

    // Test valid numeric string
    assert.strictEqual(parseTimeoutValue('5000', 30000, 'TEST_VAR'), 5000, 'Should parse valid numeric string');
    assert.strictEqual(parseTimeoutValue('1000', 30000, 'TEST_VAR'), 1000, 'Should parse 1000');
    assert.strictEqual(parseTimeoutValue('60000', 30000, 'TEST_VAR'), 60000, 'Should parse 60000');
    assert.strictEqual(parseTimeoutValue('1', 30000, 'TEST_VAR'), 1, 'Should parse 1');

    // Test with whitespace
    assert.strictEqual(parseTimeoutValue('  5000  ', 30000, 'TEST_VAR'), 5000, 'Should trim whitespace');
    assert.strictEqual(parseTimeoutValue('\t1000\n', 30000, 'TEST_VAR'), 1000, 'Should trim tabs and newlines');

    console.log('✓ parseTimeoutValue valid numbers test passed');
}

async function testParseTimeoutValueInvalidValues() {
    console.log('\n=== Test: parseTimeoutValue Invalid Values ===');

    const originalError = console.error;
    const errors: string[] = [];
    console.error = (...args: any[]) => {
        errors.push(args.join(' '));
    };

    try {
        // Test non-numeric values return default with warning
        assert.strictEqual(parseTimeoutValue('invalid', 30000, 'TEST_VAR'), 30000, 'Should return default for "invalid"');
        assert(errors.some(e => e.includes('TEST_VAR') && e.includes('invalid')), 'Should warn about invalid value');

        errors.length = 0;
        assert.strictEqual(parseTimeoutValue('abc123', 30000, 'TEST_VAR'), 30000, 'Should return default for "abc123"');
        assert(errors.some(e => e.includes('TEST_VAR')), 'Should warn about non-numeric value');

        errors.length = 0;
        assert.strictEqual(parseTimeoutValue('12.34', 30000, 'TEST_VAR'), 30000, 'Should return default for decimal');
        assert(errors.some(e => e.includes('TEST_VAR')), 'Should warn about decimal value');

        errors.length = 0;
        assert.strictEqual(parseTimeoutValue('', 30000, 'TEST_VAR'), 30000, 'Should return default for empty string');
        // Empty string doesn't warn, just returns default

        errors.length = 0;
        assert.strictEqual(parseTimeoutValue(undefined, 30000, 'TEST_VAR'), 30000, 'Should return default for undefined');
        // Undefined doesn't warn, just returns default

        console.log('✓ parseTimeoutValue invalid values test passed');
    } finally {
        console.error = originalError;
    }
}

async function testParseTimeoutValueZeroAndNegative() {
    console.log('\n=== Test: parseTimeoutValue Zero and Negative Values ===');

    const originalError = console.error;
    const errors: string[] = [];
    console.error = (...args: any[]) => {
        errors.push(args.join(' '));
    };

    try {
        // Test zero returns default with warning
        errors.length = 0;
        assert.strictEqual(parseTimeoutValue('0', 30000, 'TEST_VAR'), 30000, 'Should return default for zero');
        assert(errors.some(e => e.includes('TEST_VAR') && e.includes('positive integer')), 'Should warn about zero');

        // Test negative values return default with warning
        errors.length = 0;
        assert.strictEqual(parseTimeoutValue('-1', 30000, 'TEST_VAR'), 30000, 'Should return default for -1');
        assert(errors.some(e => e.includes('TEST_VAR') && e.includes('positive integer')), 'Should warn about negative');

        errors.length = 0;
        assert.strictEqual(parseTimeoutValue('-5000', 30000, 'TEST_VAR'), 30000, 'Should return default for -5000');
        assert(errors.some(e => e.includes('TEST_VAR')), 'Should warn about large negative');

        console.log('✓ parseTimeoutValue zero and negative values test passed');
    } finally {
        console.error = originalError;
    }
}

// ============================================================================
// getRequestTimeout Tests
// ============================================================================

async function testGetRequestTimeoutOperationTypes() {
    console.log('\n=== Test: getRequestTimeout Operation Types ===');

    await withEnv({
        [ENV_TIMEOUT_GLOBAL]: '45000',
        [ENV_TIMEOUT_AI_SEARCH]: '60000',
        [ENV_TIMEOUT_EMBEDDING]: '30000',
    }, async () => {
        // Test AI search timeout
        const aiSearchTimeout = getRequestTimeout('ai-search');
        assert.strictEqual(aiSearchTimeout, 60000, 'Should return ai-search specific timeout');

        // Test embedding timeout
        const embeddingTimeout = getRequestTimeout('embedding');
        assert.strictEqual(embeddingTimeout, 30000, 'Should return embedding specific timeout');

        // Test global timeout
        const globalTimeout = getRequestTimeout('global');
        assert.strictEqual(globalTimeout, 45000, 'Should return global timeout');
    });

    console.log('✓ getRequestTimeout operation types test passed');
}

async function testGetRequestTimeoutFallbackChain() {
    console.log('\n=== Test: getRequestTimeout Fallback Chain ===');

    // Test specific → global → default fallback
    await withEnv({
        [ENV_TIMEOUT_GLOBAL]: '45000',
        [ENV_TIMEOUT_AI_SEARCH]: undefined, // Not set, should fall back to global
        [ENV_TIMEOUT_EMBEDDING]: '25000',
    }, async () => {
        // AI search should fall back to global
        const aiSearchTimeout = getRequestTimeout('ai-search');
        assert.strictEqual(aiSearchTimeout, 45000, 'Should fall back to global when ai-search not set');

        // Embedding should use its specific value
        const embeddingTimeout = getRequestTimeout('embedding');
        assert.strictEqual(embeddingTimeout, 25000, 'Should use embedding specific timeout');

        // Global should use its value
        const globalTimeout = getRequestTimeout('global');
        assert.strictEqual(globalTimeout, 45000, 'Should use global timeout');
    });

    // Test global → default fallback
    await withEnv({
        [ENV_TIMEOUT_GLOBAL]: undefined, // Not set
        [ENV_TIMEOUT_AI_SEARCH]: undefined,
        [ENV_TIMEOUT_EMBEDDING]: undefined,
    }, async () => {
        // All should fall back to default
        const aiSearchTimeout = getRequestTimeout('ai-search');
        assert.strictEqual(aiSearchTimeout, DEFAULT_TIMEOUT_MS, 'Should fall back to default when global not set');

        const embeddingTimeout = getRequestTimeout('embedding');
        assert.strictEqual(embeddingTimeout, DEFAULT_TIMEOUT_MS, 'Should fall back to default');

        const globalTimeout = getRequestTimeout('global');
        assert.strictEqual(globalTimeout, DEFAULT_TIMEOUT_MS, 'Should use default timeout');
    });

    console.log('✓ getRequestTimeout fallback chain test passed');
}

async function testGetRequestTimeoutInvalidValues() {
    console.log('\n=== Test: getRequestTimeout Invalid Values ===');

    const originalError = console.error;
    const errors: string[] = [];
    console.error = (...args: any[]) => {
        errors.push(args.join(' '));
    };

    try {
        // Test invalid global falls back to default
        await withEnv({
            [ENV_TIMEOUT_GLOBAL]: 'invalid',
            [ENV_TIMEOUT_AI_SEARCH]: '60000',
        }, async () => {
            errors.length = 0;
            const globalTimeout = getRequestTimeout('global');
            assert.strictEqual(globalTimeout, DEFAULT_TIMEOUT_MS, 'Invalid global should fall back to default');
            assert(errors.some(e => e.includes(ENV_TIMEOUT_GLOBAL)), 'Should warn about invalid global');

            // AI search should still use its specific value
            const aiSearchTimeout = getRequestTimeout('ai-search');
            assert.strictEqual(aiSearchTimeout, 60000, 'AI search should use its valid specific value');
        });

        // Test invalid specific falls back to valid global
        await withEnv({
            [ENV_TIMEOUT_GLOBAL]: '45000',
            [ENV_TIMEOUT_AI_SEARCH]: 'not-a-number',
        }, async () => {
            errors.length = 0;
            const aiSearchTimeout = getRequestTimeout('ai-search');
            assert.strictEqual(aiSearchTimeout, 45000, 'Invalid ai-search should fall back to global');
            assert(errors.some(e => e.includes(ENV_TIMEOUT_AI_SEARCH)), 'Should warn about invalid ai-search');
        });

        console.log('✓ getRequestTimeout invalid values test passed');
    } finally {
        console.error = originalError;
    }
}

// ============================================================================
// fetchWithTimeout Tests
// ============================================================================

// Mock fetch for testing
let mockFetchCalls: Array<{ url: string; options: RequestInit }> = [];
let mockFetchResponse: Response | Error | null = null;

async function testFetchWithTimeoutSuccess() {
    console.log('\n=== Test: fetchWithTimeout Success ===');

    // Create a successful mock response
    const mockResponse = new Response('{"success": true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });

    // Store original fetch
    const originalFetch = global.fetch;

    try {
        // Mock fetch
        global.fetch = Object.assign(
            async (url: string | URL, options?: RequestInit): Promise<Response> => {
                mockFetchCalls.push({ url: url.toString(), options: options || {} });
                return mockResponse;
            },
            { preconnect: undefined }
        ) as unknown as typeof fetch;

        mockFetchCalls = [];

        // Test successful request
        const response = await fetchWithTimeout('https://api.example.com/data', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer token' },
        });

        assert.strictEqual(response.status, 200, 'Should return 200 status');
        assert.strictEqual(response.ok, true, 'Response should be ok');
        assert.strictEqual(mockFetchCalls.length, 1, 'Should call fetch once');
        assert.strictEqual(mockFetchCalls[0].url, 'https://api.example.com/data', 'Should call correct URL');
        assert.strictEqual(mockFetchCalls[0].options.method, 'GET', 'Should use GET method');

        console.log('✓ fetchWithTimeout success test passed');
    } finally {
        global.fetch = originalFetch;
    }
}

async function testFetchWithTimeoutCustomTimeout() {
    console.log('\n=== Test: fetchWithTimeout Custom Timeout ===');

    const originalFetch = global.fetch;

    try {
        let receivedSignal: AbortSignal | undefined;

        global.fetch = Object.assign(
            async (url: string | URL, options?: RequestInit): Promise<Response> => {
                receivedSignal = options?.signal ?? undefined;
                // Return a promise that never resolves to test timeout setup
                return new Promise((resolve) => {
                    // Don't resolve - we just want to check the signal was passed
                    setTimeout(() => {
                        resolve(new Response('{}', { status: 200 }));
                    }, 100);
                });
            },
            { preconnect: undefined }
        ) as unknown as typeof fetch;

        // Start the request with a 50ms timeout
        const fetchPromise = fetchWithTimeout('https://api.example.com/data', {
            timeoutMs: 50,
        });

        // Wait a bit for fetch to be called
        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify signal was passed
        assert(receivedSignal !== undefined, 'AbortSignal should be passed to fetch');

        // Wait for timeout or response
        try {
            await fetchPromise;
        } catch (error) {
            // Timeout is expected
            assert(error instanceof RequestTimeoutError, 'Should throw RequestTimeoutError');
            assert.strictEqual((error as RequestTimeoutError).timeoutMs, 50, 'Timeout should be 50ms');
        }

        console.log('✓ fetchWithTimeout custom timeout test passed');
    } finally {
        global.fetch = originalFetch;
    }
}

async function testFetchWithTimeoutAbortErrorConversion() {
    console.log('\n=== Test: fetchWithTimeout AbortError Conversion ===');

    const originalFetch = global.fetch;

    try {
        global.fetch = Object.assign(
            async (): Promise<Response> => {
                const error = new Error('The operation was aborted');
                error.name = 'AbortError';
                throw error;
            },
            { preconnect: undefined }
        ) as unknown as typeof fetch;

        try {
            await fetchWithTimeout('https://api.example.com/data', { timeoutMs: 1000 });
            assert.fail('Should have thrown an error');
        } catch (error) {
            assert(error instanceof RequestTimeoutError, 'Should convert AbortError to RequestTimeoutError');
            assert.strictEqual((error as RequestTimeoutError).isTimeout, true, 'Error should have isTimeout=true');
            assert.strictEqual((error as RequestTimeoutError).url, 'https://api.example.com/data', 'Error should have correct URL');
        }

        console.log('✓ fetchWithTimeout AbortError conversion test passed');
    } finally {
        global.fetch = originalFetch;
    }
}

async function testFetchWithTimeoutOtherErrors() {
    console.log('\n=== Test: fetchWithTimeout Other Errors ===');

    const originalFetch = global.fetch;

    try {
        // Test network error
        global.fetch = Object.assign(
            async (): Promise<Response> => {
                throw new Error('Network error: Connection refused');
            },
            { preconnect: undefined }
        ) as unknown as typeof fetch;

        try {
            await fetchWithTimeout('https://api.example.com/data');
            assert.fail('Should have thrown an error');
        } catch (error) {
            assert(!(error instanceof RequestTimeoutError), 'Should not convert non-AbortError to RequestTimeoutError');
            assert(error instanceof Error, 'Should be an Error');
            assert((error as Error).message.includes('Network error'), 'Should preserve original error message');
        }

        // Test HTTP error response
        global.fetch = Object.assign(
            async (): Promise<Response> => {
                return new Response('Not Found', { status: 404, statusText: 'Not Found' });
            },
            { preconnect: undefined }
        ) as unknown as typeof fetch;

        const response = await fetchWithTimeout('https://api.example.com/data');
        assert.strictEqual(response.status, 404, 'Should return 404 status');
        assert.strictEqual(response.ok, false, 'Response should not be ok');

        console.log('✓ fetchWithTimeout other errors test passed');
    } finally {
        global.fetch = originalFetch;
    }
}

async function testFetchWithTimeoutInvalidTimeout() {
    console.log('\n=== Test: fetchWithTimeout Invalid Timeout ===');

    const originalFetch = global.fetch;
    const originalError = console.error;
    const errors: string[] = [];

    try {
        console.error = (...args: any[]) => {
            errors.push(args.join(' '));
        };

        global.fetch = Object.assign(
            async (url: string | URL, options?: RequestInit): Promise<Response> => {
                // Verify no signal was passed (since timeout is invalid)
                assert.strictEqual(options?.signal, undefined, 'No signal should be passed for invalid timeout');
                return new Response('{}', { status: 200 });
            },
            { preconnect: undefined }
        ) as unknown as typeof fetch;

        // Test zero timeout
        errors.length = 0;
        await fetchWithTimeout('https://api.example.com/data', { timeoutMs: 0 });
        assert(errors.some(e => e.includes('Invalid timeout')), 'Should warn about invalid timeout');

        // Test negative timeout
        errors.length = 0;
        await fetchWithTimeout('https://api.example.com/data', { timeoutMs: -100 });
        assert(errors.some(e => e.includes('Invalid timeout')), 'Should warn about negative timeout');

        console.log('✓ fetchWithTimeout invalid timeout test passed');
    } finally {
        global.fetch = originalFetch;
        console.error = originalError;
    }
}

async function testFetchWithTimeoutDefaultTimeout() {
    console.log('\n=== Test: fetchWithTimeout Default Timeout ===');

    const originalFetch = global.fetch;

    try {
        let receivedSignal: AbortSignal | undefined;

        global.fetch = Object.assign(
            async (url: string | URL, options?: RequestInit): Promise<Response> => {
                receivedSignal = options?.signal ?? undefined;
                return new Response('{}', { status: 200 });
            },
            { preconnect: undefined }
        ) as unknown as typeof fetch;

        // Test without specifying timeout (should use DEFAULT_TIMEOUT_MS)
        await fetchWithTimeout('https://api.example.com/data');

        // Verify signal was passed
        assert(receivedSignal !== undefined, 'AbortSignal should be passed with default timeout');

        console.log('✓ fetchWithTimeout default timeout test passed');
    } finally {
        global.fetch = originalFetch;
    }
}

// ============================================================================
// Environment Variable Configuration Tests
// ============================================================================

async function testEnvironmentVariableParsing() {
    console.log('\n=== Test: Environment Variable Parsing ===');

    // Test all timeout-related env vars are read correctly
    await withEnv({
        [ENV_TIMEOUT_GLOBAL]: '60000',
        [ENV_TIMEOUT_AI_SEARCH]: '120000',
        [ENV_TIMEOUT_EMBEDDING]: '90000',
    }, async () => {
        // Verify env vars are set
        assert.strictEqual(process.env[ENV_TIMEOUT_GLOBAL], '60000', 'Global timeout env var should be set');
        assert.strictEqual(process.env[ENV_TIMEOUT_AI_SEARCH], '120000', 'AI search timeout env var should be set');
        assert.strictEqual(process.env[ENV_TIMEOUT_EMBEDDING], '90000', 'Embedding timeout env var should be set');

        // Verify parsing works correctly
        const globalTimeout = getRequestTimeout('global');
        const aiSearchTimeout = getRequestTimeout('ai-search');
        const embeddingTimeout = getRequestTimeout('embedding');

        assert.strictEqual(globalTimeout, 60000, 'Global timeout should be parsed correctly');
        assert.strictEqual(aiSearchTimeout, 120000, 'AI search timeout should be parsed correctly');
        assert.strictEqual(embeddingTimeout, 90000, 'Embedding timeout should be parsed correctly');
    });

    console.log('✓ Environment variable parsing test passed');
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runHttpTimeoutTests() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  HTTP Timeout Unit Tests                                   ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');

    try {
        // RequestTimeoutError tests
        await testRequestTimeoutErrorProperties();
        await testRequestTimeoutErrorStackTrace();

        // parseTimeoutValue tests
        await testParseTimeoutValueValidNumbers();
        await testParseTimeoutValueInvalidValues();
        await testParseTimeoutValueZeroAndNegative();

        // getRequestTimeout tests
        await testGetRequestTimeoutOperationTypes();
        await testGetRequestTimeoutFallbackChain();
        await testGetRequestTimeoutInvalidValues();

        // fetchWithTimeout tests
        await testFetchWithTimeoutSuccess();
        await testFetchWithTimeoutCustomTimeout();
        await testFetchWithTimeoutAbortErrorConversion();
        await testFetchWithTimeoutOtherErrors();
        await testFetchWithTimeoutInvalidTimeout();
        await testFetchWithTimeoutDefaultTimeout();

        // Environment variable tests
        await testEnvironmentVariableParsing();

        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║  ✓ All HTTP timeout unit tests passed!                     ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
    } catch (error) {
        console.error('\n✗ Test failed:', error);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runHttpTimeoutTests();
}

export { runHttpTimeoutTests };
