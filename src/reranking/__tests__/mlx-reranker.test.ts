import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MlxReranker } from '../mlx-reranker.js';
import { getRerankingConfig, isRerankingEnabled } from '../config.js';

// Mock spawn function
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
    spawn: (...args: any[]) => mockSpawn(...args),
}));

describe('MlxReranker', () => {
    let reranker: MlxReranker;

    beforeEach(() => {
        vi.clearAllMocks();
        reranker = new MlxReranker({
            model: 'jina-reranker-v3-mlx',
            modelPath: '/path/to/mlx/model',
            uvPath: 'uv',
            maxCandidates: 50,
            topK: 10,
            timeout: 60000,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should create reranker with default config', () => {
            const defaultReranker = new MlxReranker({
                modelPath: '/path/to/model',
            });

            const modelInfo = defaultReranker.getModelInfo();
            expect(modelInfo.type).toBe('local');
            expect(modelInfo.name).toBe('jina-reranker-v3-mlx');
        });

        it('should create reranker with custom config', () => {
            const customReranker = new MlxReranker({
                model: 'custom-mlx-model',
                modelPath: '/custom/path',
                uvPath: '/usr/local/bin/uv',
                maxCandidates: 100,
                topK: 20,
                timeout: 120000,
            });

            expect(customReranker.getModelInfo()).toMatchObject({
                name: 'custom-mlx-model',
                type: 'local',
            });
        });

        it('should return model info', () => {
            const modelInfo = reranker.getModelInfo();

            expect(modelInfo).toEqual({
                name: 'jina-reranker-v3-mlx',
                type: 'local',
            });
        });
    });

    describe('initialize', () => {
        it('should initialize successfully when UV and MLX are available', async () => {
            // Mock successful UV version check
            mockSpawn.mockReturnValueOnce({
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, callback: Function) => {
                    if (event === 'close') callback(0);
                }),
            });

            // Mock successful MLX check
            mockSpawn.mockReturnValueOnce({
                stdout: { on: vi.fn((event: string, callback: Function) => {
                    if (event === 'data') callback('0.1.0\n');
                }) },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, callback: Function) => {
                    if (event === 'close') callback(0);
                }),
            });

            await reranker.initialize();
            expect(reranker.isReady()).toBe(true);
        });

        it('should fail when UV is not available', async () => {
            mockSpawn.mockReturnValueOnce({
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, callback: Function) => {
                    if (event === 'error') callback(new Error('UV not found'));
                }),
            });

            await expect(reranker.initialize()).rejects.toThrow();
            expect(reranker.isReady()).toBe(false);
        });

        it('should fail when MLX is not installed', async () => {
            // Mock successful UV version check
            mockSpawn.mockReturnValueOnce({
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, callback: Function) => {
                    if (event === 'close') callback(0);
                }),
            });

            // Mock failed MLX check
            mockSpawn.mockReturnValueOnce({
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn((event: string, callback: Function) => {
                    if (event === 'data') callback('ModuleNotFoundError: No module named \'mlx\'\n');
                }) },
                on: vi.fn((event: string, callback: Function) => {
                    if (event === 'close') callback(1);
                }),
            });

            await expect(reranker.initialize()).rejects.toThrow();
            expect(reranker.isReady()).toBe(false);
        });

        it('should fail when model path is not set', async () => {
            const invalidReranker = new MlxReranker({
                modelPath: '',
            });

            // The error is thrown during initialization when checking model path
            await expect(invalidReranker.initialize()).rejects.toThrow();
        });
    });

    describe('rerank method', () => {
        beforeEach(async () => {
            // Mock successful initialization
            mockSpawn.mockReturnValue({
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, callback: Function) => {
                    if (event === 'close') callback(0);
                }),
            });
            await reranker.initialize();
        });

        it('should rerank documents successfully', async () => {
            const documents = ['doc1', 'doc2', 'doc3'];
            const mockResponse = {
                results: [
                    { index: 2, score: 0.95 },
                    { index: 0, score: 0.82 },
                    { index: 1, score: 0.75 },
                ],
            };

            let stdoutData = '';
            mockSpawn.mockImplementationOnce(() => ({
                stdout: {
                    on: vi.fn((event: string, callback: Function) => {
                        if (event === 'data') callback(JSON.stringify(mockResponse));
                    }),
                },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, callback: Function) => {
                    if (event === 'close') callback(0);
                }),
            }));

            const results = await reranker.rerank('test query', documents);

            expect(results).toHaveLength(3);
            expect(results[0].index).toBe(2);
            expect(results[0].score).toBe(0.95);
            expect(results[1].index).toBe(0);
            expect(results[1].score).toBe(0.82);
            expect(results[2].index).toBe(1);
            expect(results[2].score).toBe(0.75);
        });

        it('should handle empty documents array', async () => {
            const results = await reranker.rerank('test query', []);

            expect(results).toEqual([]);
        });

        it('should respect topK option', async () => {
            const documents = ['doc1', 'doc2', 'doc3', 'doc4', 'doc5'];
            const mockResponse = {
                results: [
                    { index: 2, score: 0.95 },
                    { index: 0, score: 0.82 },
                    { index: 1, score: 0.75 },
                    { index: 3, score: 0.70 },
                    { index: 4, score: 0.65 },
                ],
            };

            mockSpawn.mockImplementationOnce(() => {
                let stdoutData = '';
                return {
                    stdout: {
                        on: vi.fn((event: string, callback: Function) => {
                            if (event === 'data') {
                                // Return only topK results
                                stdoutData = JSON.stringify({
                                    results: mockResponse.results.slice(0, 2)
                                });
                                callback(stdoutData);
                            }
                        }),
                    },
                    stderr: { on: vi.fn() },
                    on: vi.fn((event: string, callback: Function) => {
                        if (event === 'close') callback(0);
                    }),
                };
            });

            const results = await reranker.rerank('test query', documents, { topK: 2 });

            expect(results).toHaveLength(2);
            expect(results[0].index).toBe(2);
            expect(results[1].index).toBe(0);
        });

        it('should handle Python script errors gracefully', async () => {
            mockSpawn.mockImplementationOnce(() => ({
                stdout: {
                    on: vi.fn((event: string, callback: Function) => {
                        if (event === 'data') callback('{"error": "Model loading failed"}');
                    }),
                },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, callback: Function) => {
                    if (event === 'close') callback(0);
                }),
            }));

            await expect(reranker.rerank('test query', ['doc1'])).rejects.toThrow('Model loading failed');
        });

        it('should handle subprocess errors', async () => {
            mockSpawn.mockImplementationOnce(() => ({
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, callback: Function) => {
                    if (event === 'error') callback(new Error('Failed to spawn UV'));
                }),
            }));

            await expect(reranker.rerank('test query', ['doc1'])).rejects.toThrow('Failed to spawn UV');
        });

        it('should throw when not ready', async () => {
            const notReadyReranker = new MlxReranker({
                modelPath: '/path/to/model',
            });

            await expect(notReadyReranker.rerank('test query', ['doc1'])).rejects.toThrow('not ready');
        });
    });

    describe('isReady', () => {
        it('should return false before initialization', () => {
            const newReranker = new MlxReranker({
                modelPath: '/path/to/model',
            });
            expect(newReranker.isReady()).toBe(false);
        });

        it('should return true after successful initialization', async () => {
            mockSpawn.mockReturnValue({
                stdout: { on: vi.fn() },
                stderr: { on: vi.fn() },
                on: vi.fn((event: string, callback: Function) => {
                    if (event === 'close') callback(0);
                }),
            });

            await reranker.initialize();
            expect(reranker.isReady()).toBe(true);
        });
    });
});

describe('Configuration with MLX', () => {
    describe('getRerankingConfig', () => {
        it('should load MLX config from environment variables', () => {
            process.env.MCP_RERANKING_ENABLED = 'true';
            process.env.MCP_RERANKING_PROVIDER = 'mlx';
            process.env.MCP_RERANKING_MODEL = 'jina-reranker-v3-mlx';
            process.env.MCP_RERANKING_MLX_MODEL_PATH = '/path/to/model';
            process.env.MCP_RERANKING_MLX_UV_PATH = '/usr/local/bin/uv';
            process.env.MCP_RERANKING_CANDIDATES = '50';
            process.env.MCP_RERANKING_TOP_K = '10';
            process.env.MCP_RERANKING_TIMEOUT = '60000';
            process.env.MCP_RERANKING_API_KEY = 'test-api-key';

            const config = getRerankingConfig();

            expect(config.provider).toBe('mlx');
            expect(config.model).toBe('jina-reranker-v3-mlx');
            expect(config.maxCandidates).toBe(50);
            expect(config.topK).toBe(10);
            expect(config.timeout).toBe(60000);

            // Cleanup
            delete process.env.MCP_RERANKING_ENABLED;
            delete process.env.MCP_RERANKING_PROVIDER;
            delete process.env.MCP_RERANKING_MODEL;
            delete process.env.MCP_RERANKING_MLX_MODEL_PATH;
            delete process.env.MCP_RERANKING_MLX_UV_PATH;
            delete process.env.MCP_RERANKING_CANDIDATES;
            delete process.env.MCP_RERANKING_TOP_K;
            delete process.env.MCP_RERANKING_TIMEOUT;
            delete process.env.MCP_RERANKING_API_KEY;
        });
    });

    describe('isRerankingEnabled', () => {
        it('should return true when MLX provider is configured', () => {
            process.env.MCP_RERANKING_ENABLED = 'true';
            process.env.MCP_RERANKING_PROVIDER = 'mlx';
            process.env.MCP_RERANKING_MLX_MODEL_PATH = '/path/to/model';
            expect(isRerankingEnabled()).toBe(true);

            delete process.env.MCP_RERANKING_ENABLED;
            delete process.env.MCP_RERANKING_PROVIDER;
            delete process.env.MCP_RERANKING_MLX_MODEL_PATH;
        });

        it('should return false when MLX model path is missing', () => {
            process.env.MCP_RERANKING_ENABLED = 'true';
            process.env.MCP_RERANKING_PROVIDER = 'mlx';
            process.env.MCP_RERANKING_MLX_MODEL_PATH = '';  // Explicitly set to empty string
            expect(isRerankingEnabled()).toBe(false);

            delete process.env.MCP_RERANKING_ENABLED;
            delete process.env.MCP_RERANKING_PROVIDER;
            delete process.env.MCP_RERANKING_MLX_MODEL_PATH;
        });
    });
});
