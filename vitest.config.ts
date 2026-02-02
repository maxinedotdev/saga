import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    setupFiles: ['./src/__tests__/vitest-setup.ts'],
    maxWorkers: 1,
    // Set a longer timeout for tests (120 seconds)
    // Tests involving embedding operations with multiple documents can take longer
    testTimeout: 120000,
    // Suppress console output during tests to reduce verbosity
    // This prevents large amounts of debug logging from cluttering test results
    reporters: process.env.CI ? ['junit', 'verbose'] : ['default'],
    outputFile: process.env.CI ? './test-results/junit.xml' : undefined,
    // Suppress console.log and console.info during tests
    // Set MCP_VERBOSE_TESTS=true to enable verbose output if needed for debugging
    onConsoleLog: (log, type) => {
      // Suppress all console output unless verbose tests are enabled
      // This includes logs from DocumentManager, VectorDB, LanceDB, etc.
      return !!process.env.MCP_VERBOSE_TESTS;
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/__tests__/**',
        '**/*.config.ts',
        '**/*.config.js',
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
  plugins: [tsconfigPaths()],
});
