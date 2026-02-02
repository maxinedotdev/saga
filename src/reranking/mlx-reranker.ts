/**
 * MLX-based reranker implementation
 * 
 * This reranker uses Apple's MLX framework to run Jina Reranker V3 MLX locally
 * on Apple Silicon (M1/M2/M3) chips. It provides fast, local reranking without
 * API calls by spawning a Python subprocess to run the MLX model.
 * 
 * Requirements:
 * - Apple Silicon (M1/M2/M3) Mac
 * - Python 3.8+ with MLX installed: pip install mlx mlx-lm
 * - Jina Reranker V3 MLX model downloaded locally
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { Reranker, RerankerConfig, RerankOptions, RerankResult } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Configuration for MLX reranker
 */
interface MlxRerankerConfig extends RerankerConfig {
    /** Path to the MLX model directory */
    modelPath: string;
    /** Path to Python executable (default: 'python3') */
    pythonPath?: string;
}

/**
 * Response from the Python MLX reranker script
 */
interface MlxRerankerResponse {
    results?: Array<{
        index: number;
        score: number;
    }>;
    error?: string;
}

/**
 * MLX-based reranker implementation
 * 
 * This class implements the Reranker interface using a Python subprocess
 * to run MLX models locally on Apple Silicon.
 */
export class MlxReranker implements Reranker {
    private config: MlxRerankerConfig;
    private ready: boolean = false;
    private pythonScriptPath: string;

    constructor(config: Partial<MlxRerankerConfig>) {
        // Apply defaults
        this.config = {
            provider: 'mlx', // This is a local provider
            model: config.model || 'jina-reranker-v3-mlx',
            modelPath: config.modelPath || '',
            pythonPath: config.pythonPath || 'python3',
            maxCandidates: config.maxCandidates || 50,
            topK: config.topK || 10,
            timeout: config.timeout || 60000, // Longer timeout for local inference
        };

        // Path to the Python script
        this.pythonScriptPath = join(__dirname, 'mlx_reranker.py');
    }

    /**
     * Initialize the MLX reranker
     * Checks if Python and MLX are available
     */
    async initialize(): Promise<void> {
        try {
            // Check if Python is available
            await this.runPythonScript(['--version']);
            
            // Check if MLX is installed
            await this.runPythonScript(['-c', 'import mlx; print(mlx.__version__)']);
            
            // Check if model path exists
            if (!this.config.modelPath) {
                throw new Error('MLX model path is required. Set modelPath in config.');
            }

            this.ready = true;
        } catch (error) {
            console.error('Failed to initialize MLX reranker:', error);
            this.ready = false;
            throw error;
        }
    }

    /**
     * Rerank documents using the MLX model
     * @param query - The search query
     * @param documents - Array of document contents to rerank
     * @param options - Optional reranking configuration
     * @returns Promise resolving to sorted reranking results
     */
    async rerank(
        query: string,
        documents: string[],
        options?: RerankOptions
    ): Promise<RerankResult[]> {
        if (!this.ready) {
            throw new Error('MLX reranker is not ready. Call initialize() first.');
        }

        if (documents.length === 0) {
            return [];
        }

        const topK = options?.topK ?? this.config.topK;
        const maxCandidates = Math.min(
            documents.length,
            options?.maxCandidates ?? this.config.maxCandidates
        );

        // Limit documents to maxCandidates
        const documentsToRerank = documents.slice(0, maxCandidates);

        try {
            const response = await this.runRerankingScript(
                query,
                documentsToRerank,
                topK
            );

            return response.results || [];
        } catch (error) {
            console.error('MLX reranking failed:', error);
            throw error;
        }
    }

    /**
     * Check if the reranker is ready to use
     * @returns True if the reranker is initialized and ready
     */
    isReady(): boolean {
        return this.ready;
    }

    /**
     * Get information about the reranker model
     * @returns Object containing model name and type
     */
    getModelInfo(): { name: string; type: 'api' | 'local' } {
        return {
            name: this.config.model,
            type: 'local',
        };
    }

    /**
     * Run the Python MLX reranker script
     * @param query - Search query
     * @param documents - Documents to rerank
     * @param topK - Number of top results to return
     * @returns Promise resolving to reranking results
     */
    private async runRerankingScript(
        query: string,
        documents: string[],
        topK: number
    ): Promise<MlxRerankerResponse> {
        return new Promise((resolve, reject) => {
            const args = [
                this.pythonScriptPath,
                '--query', query,
                '--model', this.config.modelPath,
                '--top-k', topK.toString(),
                '--documents', JSON.stringify(documents),
            ];

            const python = spawn(this.config.pythonPath!, args);

            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            python.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`MLX reranker script exited with code ${code}: ${stderr}`));
                    return;
                }

                try {
                    const response: MlxRerankerResponse = JSON.parse(stdout);
                    
                    if (response.error) {
                        reject(new Error(response.error));
                        return;
                    }

                    resolve(response);
                } catch (parseError) {
                    reject(new Error(`Failed to parse MLX reranker response: ${parseError}\nOutput: ${stdout}`));
                }
            });

            python.on('error', (error) => {
                reject(new Error(`Failed to spawn Python process: ${error.message}`));
            });

            // Set timeout
            const timeout = setTimeout(() => {
                python.kill();
                reject(new Error(`MLX reranker timed out after ${this.config.timeout}ms`));
            }, this.config.timeout);

            python.on('close', () => {
                clearTimeout(timeout);
            });
        });
    }

    /**
     * Run a Python command and return the output
     * @param args - Arguments to pass to Python
     * @returns Promise resolving to the command output
     */
    private runPythonScript(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const python = spawn(this.config.pythonPath!, args);

            let stdout = '';
            let stderr = '';

            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            python.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Python command failed with code ${code}: ${stderr}`));
                    return;
                }
                resolve(stdout);
            });

            python.on('error', (error) => {
                reject(new Error(`Failed to spawn Python process: ${error.message}`));
            });
        });
    }
}
