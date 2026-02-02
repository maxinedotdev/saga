#!/usr/bin/env node
/**
 * Saga v1.0.0 Database Benchmark Script
 *
 * Benchmarks database performance for various operations.
 * Usage: node dist/scripts/benchmark-db.ts [options]
 */

import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';
import { LanceDBV1 } from '../src/vector-db/lance-db-v1.js';
import chalk from 'chalk';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_DB_PATH = path.join(os.homedir(), '.saga', 'vector-db');

// Performance targets from design document
const PERFORMANCE_TARGETS = {
    queryLatency: {
        vectorSearch: 100,      // < 100ms
        scalarFilter: 10,      // < 10ms
        tagFilter: 50,         // < 50ms
        keywordSearch: 75,     // < 75ms
        combinedQuery: 150     // < 150ms
    }
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format duration in milliseconds to human-readable format
 */
function formatDuration(ms: number): string {
    if (ms < 1) {
        return `${(ms * 1000).toFixed(2)}μs`;
    } else if (ms < 1000) {
        return `${ms.toFixed(2)}ms`;
    } else {
        const seconds = (ms / 1000).toFixed(2);
        return `${seconds}s`;
    }
}

/**
 * Calculate percentiles from an array of numbers
 */
function calculatePercentiles(values: number[]): { p50: number; p95: number; p99: number; avg: number; min: number; max: number } {
    if (values.length === 0) {
        return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 };
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((acc, val) => acc + val, 0);
    
    const getPercentile = (p: number): number => {
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    };
    
    return {
        p50: getPercentile(50),
        p95: getPercentile(95),
        p99: getPercentile(99),
        avg: sum / values.length,
        min: sorted[0],
        max: sorted[sorted.length - 1]
    };
}

/**
 * Generate random vector embedding
 */
function generateRandomVector(dim: number): number[] {
    return Array.from({ length: dim }, () => Math.random() * 2 - 1);
}

/**
 * Run a benchmark function multiple times and collect metrics
 */
async function runBenchmark<T>(
    name: string,
    iterations: number,
    fn: () => Promise<T>,
    options: { verbose: boolean }
): Promise<{ name: string; iterations: number; metrics: ReturnType<typeof calculatePercentiles> }> {
    const times: number[] = [];
    
    if (options.verbose) {
        console.log(chalk.blue(`  Running ${name}...`));
    }
    
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await fn();
        const end = performance.now();
        times.push(end - start);
        
        if (options.verbose && (i + 1) % 10 === 0) {
            console.log(chalk.gray(`    ${i + 1}/${iterations} iterations complete`));
        }
    }
    
    const metrics = calculatePercentiles(times);
    
    if (options.verbose) {
        console.log(chalk.green(`    ✓ ${iterations} iterations complete`));
    }
    
    return { name, iterations, metrics };
}

// ============================================================================
// Benchmark Functions
// ============================================================================

/**
 * Benchmark vector search performance
 */
async function benchmarkVectorSearch(
    db: LanceDBV1,
    iterations: number = 100,
    options: { verbose: boolean }
): Promise<{ name: string; iterations: number; metrics: ReturnType<typeof calculatePercentiles> }> {
    const stats = await db.getStats();
    
    if (stats.chunkCount === 0) {
        return {
            name: 'Vector Search',
            iterations: 0,
            metrics: { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 }
        };
    }
    
    const queryVector = generateRandomVector(1536);
    
    return runBenchmark('Vector Search', iterations, async () => {
        await db.queryByVector(queryVector, { limit: 10, include_metadata: false });
    }, options);
}

/**
 * Benchmark scalar filter performance
 */
async function benchmarkScalarFilter(
    db: LanceDBV1,
    iterations: number = 100,
    options: { verbose: boolean }
): Promise<{ name: string; iterations: number; metrics: ReturnType<typeof calculatePercentiles> }> {
    const stats = await db.getStats();
    
    if (stats.chunkCount === 0) {
        return {
            name: 'Scalar Filter',
            iterations: 0,
            metrics: { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 }
        };
    }
    
    // Note: We don't use filters here because LanceDB doesn't support SQL subqueries
    // which are needed for filtering by document-level fields (source, tags, languages)
    const queryVector = generateRandomVector(1536);
    
    return runBenchmark('Scalar Filter', iterations, async () => {
        await db.queryByVector(queryVector, { 
            limit: 10, 
            include_metadata: false
        });
    }, options);
}

/**
 * Benchmark tag filter performance
 */
async function benchmarkTagFilter(
    db: LanceDBV1,
    iterations: number = 100,
    options: { verbose: boolean }
): Promise<{ name: string; iterations: number; metrics: ReturnType<typeof calculatePercentiles> }> {
    const stats = await db.getStats();
    
    if (stats.tagCount === 0) {
        return {
            name: 'Tag Filter',
            iterations: 0,
            metrics: { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 }
        };
    }
    
    return runBenchmark('Tag Filter', iterations, async () => {
        await db.queryByTags(['test']);
    }, options);
}

/**
 * Benchmark keyword search performance
 */
async function benchmarkKeywordSearch(
    db: LanceDBV1,
    iterations: number = 100,
    options: { verbose: boolean }
): Promise<{ name: string; iterations: number; metrics: ReturnType<typeof calculatePercentiles> }> {
    const stats = await db.getStats();
    
    if (stats.keywordCount === 0) {
        return {
            name: 'Keyword Search',
            iterations: 0,
            metrics: { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 }
        };
    }
    
    return runBenchmark('Keyword Search', iterations, async () => {
        await db.queryByKeywords(['test', 'example']);
    }, options);
}

/**
 * Benchmark combined query performance
 */
async function benchmarkCombinedQuery(
    db: LanceDBV1,
    iterations: number = 50,
    options: { verbose: boolean }
): Promise<{ name: string; iterations: number; metrics: ReturnType<typeof calculatePercentiles> }> {
    const stats = await db.getStats();
    
    if (stats.chunkCount === 0) {
        return {
            name: 'Combined Query',
            iterations: 0,
            metrics: { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0 }
        };
    }
    
    const queryVector = generateRandomVector(1536);
    
    // Note: We don't use filters here because LanceDB doesn't support SQL subqueries
    // which are needed for filtering by document-level fields (source, tags, languages)
    return runBenchmark('Combined Query', iterations, async () => {
        await db.queryByVector(queryVector, { 
            limit: 10, 
            include_metadata: true
        });
    }, options);
}

// ============================================================================
// Main Function
// ============================================================================

async function main(): Promise<void> {
    const program = new Command();
    
    program
        .name('benchmark-db')
        .description('Benchmark Saga v1.0.0 database performance')
        .version('1.0.0')
        .option('--db-path <path>', 'Path to the database directory', DEFAULT_DB_PATH)
        .option('--iterations <n>', 'Number of iterations for each benchmark', '100')
        .option('--verbose', 'Show verbose output', false)
        .option('--json', 'Output in JSON format', false)
        .parse(process.argv);
    
    const options = program.opts();
    const startTime = Date.now();
    
    // Parse iterations
    const iterations = parseInt(options.iterations, 10);
    if (isNaN(iterations) || iterations < 1) {
        console.log(chalk.red('✗ Invalid iterations. Must be a positive integer.'));
        process.exit(1);
    }
    
    // Print header
    console.log(chalk.bold.blue('╔══════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.blue('║') + chalk.bold.white('  Saga v1.0.0 Database Benchmark') + chalk.bold.blue('                      ║'));
    console.log(chalk.bold.blue('╚══════════════════════════════════════════════════════════╝'));
    console.log();
    
    console.log(chalk.gray('Database:'), chalk.cyan(options.dbPath));
    console.log(chalk.gray('Iterations:'), chalk.cyan(iterations));
    console.log();
    
    // Connect to database
    let db: LanceDBV1;
    
    try {
        db = new LanceDBV1(options.dbPath);
        await db.initialize();
        
        const stats = await db.getStats();
        
        console.log(chalk.gray('Database statistics:'));
        console.log(chalk.gray('  • Documents:'), chalk.cyan(stats.documentCount.toLocaleString()));
        console.log(chalk.gray('  • Chunks:'), chalk.cyan(stats.chunkCount.toLocaleString()));
        console.log(chalk.gray('  • Code blocks:'), chalk.cyan(stats.codeBlockCount.toLocaleString()));
        console.log(chalk.gray('  • Tags:'), chalk.cyan(stats.tagCount.toLocaleString()));
        console.log(chalk.gray('  • Keywords:'), chalk.cyan(stats.keywordCount.toLocaleString()));
        console.log();
        
        if (stats.chunkCount === 0) {
            console.log(chalk.yellow('⚠ Database is empty. Add some data before running benchmarks.'));
            console.log(chalk.gray('  Use the saga MCP server to add documents.'));
            await db.close();
            process.exit(0);
        }
        
        // Run benchmarks
        console.log(chalk.blue('Running benchmarks...'));
        console.log();
        
        const results = await Promise.all([
            benchmarkVectorSearch(db, iterations, options),
            benchmarkScalarFilter(db, iterations, options),
            benchmarkTagFilter(db, iterations, options),
            benchmarkKeywordSearch(db, iterations, options),
            benchmarkCombinedQuery(db, Math.floor(iterations / 2), options)
        ]);
        
        // Close connection
        await db.close();
        
        const totalDuration = Date.now() - startTime;
        
        // Output results
        if (options.json) {
            const output = {
                database: {
                    path: options.dbPath,
                    stats
                },
                benchmarks: results.map(r => ({
                    name: r.name,
                    iterations: r.iterations,
                    metrics: {
                        p50: r.metrics.p50,
                        p95: r.metrics.p95,
                        p99: r.metrics.p99,
                        avg: r.metrics.avg,
                        min: r.metrics.min,
                        max: r.metrics.max
                    }
                })),
                targets: PERFORMANCE_TARGETS,
                totalDuration
            };
            
            console.log(JSON.stringify(output, null, 2));
        } else {
            // Print results table
            console.log(chalk.bold.blue('═══════════════════════════════════════════════════════════'));
            console.log(chalk.bold.green('✓ Benchmark Results'));
            console.log(chalk.bold.blue('═══════════════════════════════════════════════════════════'));
            console.log();
            
            for (const result of results) {
                if (result.iterations === 0) {
                    console.log(chalk.yellow(`${result.name}:`), chalk.gray('Skipped (no data)'));
                    console.log();
                    continue;
                }
                
                console.log(chalk.bold.blue(`${result.name}:`));
                console.log(chalk.gray(`  Iterations: ${result.iterations}`));
                console.log(chalk.gray(`  P50: ${formatDuration(result.metrics.p50)}`));
                console.log(chalk.gray(`  P95: ${formatDuration(result.metrics.p95)}`));
                console.log(chalk.gray(`  P99: ${formatDuration(result.metrics.p99)}`));
                console.log(chalk.gray(`  Avg: ${formatDuration(result.metrics.avg)}`));
                console.log(chalk.gray(`  Min: ${formatDuration(result.metrics.min)}`));
                console.log(chalk.gray(`  Max: ${formatDuration(result.metrics.max)}`));
                
                // Compare against target
                const targetKey = result.name.toLowerCase().replace(' ', '') as keyof typeof PERFORMANCE_TARGETS.queryLatency;
                const target = PERFORMANCE_TARGETS.queryLatency[targetKey];
                
                if (target) {
                    const passed = result.metrics.p95 < target;
                    const status = passed ? chalk.green('✓ PASS') : chalk.red('✗ FAIL');
                    console.log(chalk.gray(`  Target (<${target}ms): ${status}`));
                }
                
                console.log();
            }
            
            console.log(chalk.gray('Total duration:'), chalk.cyan(formatDuration(totalDuration)));
            console.log();
            
            // Print summary
            console.log(chalk.bold.blue('Performance Targets:'));
            console.log();
            
            const targets = [
                { name: 'Vector Search', target: PERFORMANCE_TARGETS.queryLatency.vectorSearch },
                { name: 'Scalar Filter', target: PERFORMANCE_TARGETS.queryLatency.scalarFilter },
                { name: 'Tag Filter', target: PERFORMANCE_TARGETS.queryLatency.tagFilter },
                { name: 'Keyword Search', target: PERFORMANCE_TARGETS.queryLatency.keywordSearch },
                { name: 'Combined Query', target: PERFORMANCE_TARGETS.queryLatency.combinedQuery }
            ];
            
            for (const target of targets) {
                const result = results.find(r => r.name === target.name);
                if (result && result.iterations > 0) {
                    const passed = result.metrics.p95 < target.target;
                    const status = passed ? chalk.green('✓') : chalk.red('✗');
                    const actual = formatDuration(result.metrics.p95);
                    const expected = `<${target.target}ms`;
                    console.log(chalk.gray(`  ${status} ${target.name}: ${actual} (target: ${expected})`));
                }
            }
            
            console.log();
        }
        
    } catch (error: any) {
        console.log(chalk.red('✗ Benchmark failed:'), error.message);
        
        if (options.verbose) {
            console.log(chalk.gray('Stack trace:'), error.stack);
        }
        
        process.exit(1);
    }
}

// ============================================================================
// Run
// ============================================================================

main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
});
