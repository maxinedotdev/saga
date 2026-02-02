/**
 * Query Plan Optimizer Implementation
 *
 * Optimizes query execution plans by:
 * - Moving scalar filters before vector search
 * - Parallelizing independent steps when possible
 * - Providing query cost estimation
 */

import { getLogger } from '../utils.js';

const logger = getLogger('QueryOptimizer');

/**
 * Query plan step types
 */
export type QueryStepType =
    | 'scalar_filter'
    | 'vector_search'
    | 'tag_filter'
    | 'keyword_search'
    | 'sort'
    | 'limit'
    | 'aggregate';

/**
 * Query plan step
 */
export interface QueryStep {
    /** Step type */
    type: QueryStepType;
    /** Step description */
    description: string;
    /** Step cost estimate (1-100) */
    estimatedCost: number;
    /** Whether this step can be parallelized */
    parallelizable: boolean;
    /** Step-specific configuration */
    config?: Record<string, any>;
}

/**
 * Query plan
 */
export interface QueryPlan {
    /** Plan steps in execution order */
    steps: QueryStep[];
    /** Estimated total cost */
    estimatedCost: number;
    /** Whether plan has been optimized */
    optimized: boolean;
    /** Original plan cost (before optimization) */
    originalCost?: number;
    /** Optimization notes */
    optimizationNotes?: string[];
}

/**
 * Query optimization result
 */
export interface OptimizationResult {
    /** Success status */
    success: boolean;
    /** Optimized plan */
    plan: QueryPlan;
    /** Optimization details */
    details: {
        optimizationsApplied: string[];
        costReduction: number;
        costReductionPercent: number;
    };
}

/**
 * Performance metrics for query execution
 */
export interface QueryPerformanceMetrics {
    /** Query ID */
    queryId: string;
    /** Total execution time in milliseconds */
    totalTime: number;
    /** Time spent on each step */
    stepTimings: Array<{
        step: QueryStepType;
        time: number;
    }>;
    /** Rows processed */
    rowsProcessed: number;
    /** Results returned */
    resultsReturned: number;
    /** Cache hits */
    cacheHits: number;
    /** Cache misses */
    cacheMisses: number;
}

/**
 * Query optimizer configuration
 */
export interface QueryOptimizerConfig {
    /** Enable scalar filter pushdown */
    enableFilterPushdown: boolean;
    /** Enable parallelization */
    enableParallelization: boolean;
    /** Cost threshold for parallelization */
    parallelizationThreshold: number;
    /** Maximum cost reduction target */
    maxCostReductionTarget: number;
}

/**
 * Query plan optimizer
 *
 * Implements query optimization strategies:
 * 1. Filter pushdown - Move scalar filters before expensive vector operations
 * 2. Step reordering - Reorder steps to reduce data volume early
 * 3. Cost estimation - Estimate query cost for monitoring
 */
export class QueryOptimizer {
    private config: QueryOptimizerConfig;

    constructor(config?: Partial<QueryOptimizerConfig>) {
        this.config = {
            enableFilterPushdown: true,
            enableParallelization: true,
            parallelizationThreshold: 20,
            maxCostReductionTarget: 0.5,
            ...config,
        };
    }

    /**
     * Create a query plan from query parameters
     *
     * @param params - Query parameters
     * @returns Query plan
     */
    createPlan(params: {
        hasVectorSearch?: boolean;
        hasScalarFilter?: boolean;
        hasTagFilter?: boolean;
        hasKeywordSearch?: boolean;
        hasLimit?: boolean;
        limit?: number;
    }): QueryPlan {
        const steps: QueryStep[] = [];
        let estimatedCost = 0;

        // Add scalar filter step if present
        if (params.hasScalarFilter) {
            steps.push({
                type: 'scalar_filter',
                description: 'Apply scalar filters (source, status, date)',
                estimatedCost: 10,
                parallelizable: false,
            });
            estimatedCost += 10;
        }

        // Add tag filter step if present
        if (params.hasTagFilter) {
            steps.push({
                type: 'tag_filter',
                description: 'Filter by document tags',
                estimatedCost: 15,
                parallelizable: false,
            });
            estimatedCost += 15;
        }

        // Add keyword search if present
        if (params.hasKeywordSearch) {
            steps.push({
                type: 'keyword_search',
                description: 'Search by keywords in inverted index',
                estimatedCost: 20,
                parallelizable: true,
            });
            estimatedCost += 20;
        }

        // Add vector search step if present
        if (params.hasVectorSearch) {
            steps.push({
                type: 'vector_search',
                description: 'Perform vector similarity search',
                estimatedCost: 50,
                parallelizable: false,
            });
            estimatedCost += 50;
        }

        // Add limit step if present
        if (params.hasLimit && params.limit) {
            steps.push({
                type: 'limit',
                description: `Limit results to ${params.limit}`,
                estimatedCost: 5,
                parallelizable: false,
                config: { limit: params.limit },
            });
            estimatedCost += 5;
        }

        return {
            steps,
            estimatedCost,
            optimized: false,
        };
    }

    /**
     * Optimize a query plan
     *
     * @param plan - Original query plan
     * @returns Optimized plan
     */
    optimizePlan(plan: QueryPlan): OptimizationResult {
        const optimizationNotes: string[] = [];
        const optimizationsApplied: string[] = [];
        const originalCost = plan.estimatedCost;

        let optimizedSteps = [...plan.steps];

        // Optimization 1: Move scalar filters before vector search
        if (this.config.enableFilterPushdown) {
            const result = this.applyFilterPushdown(optimizedSteps);
            optimizedSteps = result.steps;
            if (result.applied) {
                optimizationNotes.push('Moved scalar filters before vector search');
                optimizationsApplied.push('filter_pushdown');
            }
        }

        // Optimization 2: Move limit operations earlier when possible
        const limitResult = this.pushdownLimit(optimizedSteps);
        optimizedSteps = limitResult.steps;
        if (limitResult.applied) {
            optimizationNotes.push('Pushed limit operation earlier in plan');
            optimizationsApplied.push('limit_pushdown');
        }

        // Optimization 3: Identify parallelizable steps
        if (this.config.enableParallelization) {
            const parallelResult = this.identifyParallelSteps(optimizedSteps);
            optimizedSteps = parallelResult.steps;
            if (parallelResult.parallelGroups.length > 0) {
                optimizationNotes.push(`Identified ${parallelResult.parallelGroups.length} parallelizable step groups`);
                optimizationsApplied.push('parallelization');
            }
        }

        // Recalculate estimated cost
        const optimizedCost = optimizedSteps.reduce((sum, step) => sum + step.estimatedCost, 0);
        const costReduction = originalCost - optimizedCost;
        const costReductionPercent = originalCost > 0 ? costReduction / originalCost : 0;

        const optimizedPlan: QueryPlan = {
            steps: optimizedSteps,
            estimatedCost: optimizedCost,
            optimized: true,
            originalCost,
            optimizationNotes,
        };

        return {
            success: true,
            plan: optimizedPlan,
            details: {
                optimizationsApplied,
                costReduction,
                costReductionPercent: Math.round(costReductionPercent * 1000) / 1000,
            },
        };
    }

    /**
     * Apply filter pushdown optimization
     * Move scalar filters before expensive vector operations
     */
    private applyFilterPushdown(steps: QueryStep[]): { steps: QueryStep[]; applied: boolean } {
        const vectorSearchIndex = steps.findIndex(s => s.type === 'vector_search');
        const scalarFilterIndex = steps.findIndex(s => s.type === 'scalar_filter');

        if (vectorSearchIndex === -1 || scalarFilterIndex === -1) {
            return { steps, applied: false };
        }

        if (scalarFilterIndex < vectorSearchIndex) {
            // Already in correct order
            return { steps, applied: false };
        }

        // Reorder: move scalar filter before vector search
        const newSteps = [...steps];
        const [scalarFilter] = newSteps.splice(scalarFilterIndex, 1);
        newSteps.splice(vectorSearchIndex, 0, scalarFilter);

        return { steps: newSteps, applied: true };
    }

    /**
     * Push down limit operations when possible
     */
    private pushdownLimit(steps: QueryStep[]): { steps: QueryStep[]; applied: boolean } {
        const limitIndex = steps.findIndex(s => s.type === 'limit');

        if (limitIndex <= 0) {
            return { steps, applied: false };
        }

        // Can only push limit past parallelizable steps
        const stepsBeforeLimit = steps.slice(0, limitIndex);
        const allParallelizable = stepsBeforeLimit.every(s => s.parallelizable);

        if (!allParallelizable) {
            return { steps, applied: false };
        }

        // Move limit earlier
        const newSteps = [...steps];
        const [limitStep] = newSteps.splice(limitIndex, 1);
        newSteps.unshift(limitStep);

        return { steps: newSteps, applied: true };
    }

    /**
     * Identify parallelizable step groups
     */
    private identifyParallelSteps(steps: QueryStep[]): {
        steps: QueryStep[];
        parallelGroups: Array<QueryStep[]>;
    } {
        const parallelGroups: Array<QueryStep[]> = [];
        let currentGroup: QueryStep[] = [];

        const newSteps = steps.map(step => {
            if (step.parallelizable && step.estimatedCost >= this.config.parallelizationThreshold) {
                currentGroup.push(step);
                return {
                    ...step,
                    config: { ...step.config, parallelGroup: parallelGroups.length },
                };
            } else {
                if (currentGroup.length > 1) {
                    parallelGroups.push([...currentGroup]);
                }
                currentGroup = [];
                return step;
            }
        });

        if (currentGroup.length > 1) {
            parallelGroups.push(currentGroup);
        }

        return { steps: newSteps, parallelGroups };
    }

    /**
     * Estimate query cost based on data statistics
     *
     * @param params - Query parameters
     * @param stats - Data statistics
     * @returns Estimated cost
     */
    estimateCost(params: {
        vectorCount: number;
        documentCount: number;
        filters?: number;
    }): {
        total: number;
        breakdown: Record<string, number>;
    } {
        const breakdown: Record<string, number> = {
            base: 10,
            vectorSearch: 0,
            filter: 0,
            overhead: 0,
        };

        // Vector search cost scales with log of vector count (with HNSW)
        if (params.vectorCount > 0) {
            breakdown.vectorSearch = Math.ceil(Math.log2(params.vectorCount) * 5);
        }

        // Filter cost scales with number of filters
        if (params.filters && params.filters > 0) {
            breakdown.filter = params.filters * 5;
        }

        // Overhead for coordination
        breakdown.overhead = 5;

        const total = Object.values(breakdown).reduce((sum, cost) => sum + cost, 0);

        return { total, breakdown };
    }

    /**
     * Get optimizer configuration
     */
    getConfig(): QueryOptimizerConfig {
        return { ...this.config };
    }

    /**
     * Update optimizer configuration
     */
    updateConfig(config: Partial<QueryOptimizerConfig>): void {
        this.config = { ...this.config, ...config };
    }
}

/**
 * Performance metrics collector
 */
export class QueryMetricsCollector {
    private metrics: QueryPerformanceMetrics[] = [];
    private maxMetrics: number;

    constructor(maxMetrics: number = 1000) {
        this.maxMetrics = maxMetrics;
    }

    /**
     * Record query metrics
     */
    record(metrics: QueryPerformanceMetrics): void {
        this.metrics.push(metrics);

        // Keep only recent metrics
        if (this.metrics.length > this.maxMetrics) {
            this.metrics.shift();
        }
    }

    /**
     * Get average query time
     */
    getAverageQueryTime(): number {
        if (this.metrics.length === 0) return 0;
        const sum = this.metrics.reduce((acc, m) => acc + m.totalTime, 0);
        return sum / this.metrics.length;
    }

    /**
     * Get percentile query time
     */
    getPercentileQueryTime(percentile: number): number {
        if (this.metrics.length === 0) return 0;
        const sorted = [...this.metrics].sort((a, b) => a.totalTime - b.totalTime);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)].totalTime;
    }

    /**
     * Get query type distribution
     */
    getStepTypeDistribution(): Record<string, number> {
        const distribution: Record<string, number> = {};

        for (const metric of this.metrics) {
            for (const timing of metric.stepTimings) {
                distribution[timing.step] = (distribution[timing.step] || 0) + timing.time;
            }
        }

        return distribution;
    }

    /**
     * Get all metrics
     */
    getMetrics(): QueryPerformanceMetrics[] {
        return [...this.metrics];
    }

    /**
     * Clear all metrics
     */
    clear(): void {
        this.metrics = [];
    }
}

/**
 * Create a query optimizer with environment configuration
 */
export function createQueryOptimizer(): QueryOptimizer {
    return new QueryOptimizer({
        enableFilterPushdown: process.env.MCP_QUERY_FILTER_PUSHDOWN !== 'false',
        enableParallelization: process.env.MCP_QUERY_PARALLELIZATION !== 'false',
        parallelizationThreshold: parseInt(process.env.MCP_QUERY_PARALLEL_THRESHOLD || '20', 10),
        maxCostReductionTarget: parseFloat(process.env.MCP_QUERY_COST_REDUCTION_TARGET || '0.5'),
    });
}

// Global metrics collector
const globalMetricsCollector = new QueryMetricsCollector();

/**
 * Get the global metrics collector
 */
export function getGlobalMetricsCollector(): QueryMetricsCollector {
    return globalMetricsCollector;
}
