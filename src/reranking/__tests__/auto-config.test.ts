/**
 * Tests for MLX auto-configuration logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('MLX Auto-Configuration', () => {
    let originalPlatform: NodeJS.Platform;
    let originalArch: string;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        // Store original values
        originalPlatform = process.platform;
        originalArch = process.arch;
        originalEnv = { ...process.env };
        
        // Clear module cache to reload config
        vi.clearAllMocks();
    });

    afterEach(() => {
        // Restore original values
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        Object.defineProperty(process, 'arch', { value: originalArch });
        process.env = originalEnv;
        
        // Clear module cache
        vi.resetModules();
    });

    describe('Auto-configuration on Apple Silicon', () => {
        it('should auto-configure MLX provider on Apple Silicon', async () => {
            // Simulate Apple Silicon
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            // Clear environment variables that might override
            delete process.env.MCP_RERANKING_PROVIDER;
            delete process.env.MCP_RERANKING_MLX_MODEL_PATH;
            delete process.env.MCP_RERANKING_AUTO_CONFIGURE_MLX;
            
            // Clear module cache and reload config
            vi.resetModules();
            const { RERANKING_CONFIG } = await import('../config.js');
            
            expect(RERANKING_CONFIG.provider).toBe('mlx');
            expect(RERANKING_CONFIG.mlxModelPath).toContain('.saga');
            expect(RERANKING_CONFIG.mlxModelPath).toContain('jina-reranker-v3-mlx');
        });

        it('should respect explicit provider override on Apple Silicon', async () => {
            // Simulate Apple Silicon
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            // Set explicit provider
            process.env.MCP_RERANKING_PROVIDER = 'cohere';
            
            // Clear module cache and reload config
            vi.resetModules();
            const { RERANKING_CONFIG } = await import('../config.js');
            
            expect(RERANKING_CONFIG.provider).toBe('cohere');
        });

        it('should respect explicit model path override on Apple Silicon', async () => {
            // Simulate Apple Silicon
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            // Set explicit model path
            process.env.MCP_RERANKING_MLX_MODEL_PATH = '/custom/path/to/model';
            
            // Clear module cache and reload config
            vi.resetModules();
            const { RERANKING_CONFIG } = await import('../config.js');
            
            expect(RERANKING_CONFIG.mlxModelPath).toBe('/custom/path/to/model');
        });

        it('should disable auto-configuration when MCP_RERANKING_AUTO_CONFIGURE_MLX=false', async () => {
            // Simulate Apple Silicon
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            // Disable auto-configuration and set provider to cohere
            process.env.MCP_RERANKING_AUTO_CONFIGURE_MLX = 'false';
            process.env.MCP_RERANKING_PROVIDER = 'cohere';
            
            // Clear module cache and reload config
            vi.resetModules();
            const { RERANKING_CONFIG } = await import('../config.js');
            
            expect(RERANKING_CONFIG.provider).toBe('cohere'); // Default provider
        });
    });

    describe('No auto-configuration on non-Apple Silicon', () => {
        it('should not auto-configure MLX on Linux', async () => {
            // Simulate Linux
            Object.defineProperty(process, 'platform', { value: 'linux' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            
            // Clear environment variables and set provider to cohere
            delete process.env.MCP_RERANKING_PROVIDER;
            delete process.env.MCP_RERANKING_MLX_MODEL_PATH;
            process.env.MCP_RERANKING_PROVIDER = 'cohere';
            
            // Clear module cache and reload config
            vi.resetModules();
            const { RERANKING_CONFIG } = await import('../config.js');
            
            expect(RERANKING_CONFIG.provider).toBe('cohere'); // Default provider
            expect(RERANKING_CONFIG.mlxModelPath).toBe('');
        });

        it('should not auto-configure MLX on Windows', async () => {
            // Simulate Windows
            Object.defineProperty(process, 'platform', { value: 'win32' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            
            // Clear environment variables and set provider to cohere
            delete process.env.MCP_RERANKING_PROVIDER;
            delete process.env.MCP_RERANKING_MLX_MODEL_PATH;
            process.env.MCP_RERANKING_PROVIDER = 'cohere';
            
            // Clear module cache and reload config
            vi.resetModules();
            const { RERANKING_CONFIG } = await import('../config.js');
            
            expect(RERANKING_CONFIG.provider).toBe('cohere'); // Default provider
            expect(RERANKING_CONFIG.mlxModelPath).toBe('');
        });

        it('should not auto-configure MLX on macOS with x64', async () => {
            // Simulate Intel Mac
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            
            // Clear environment variables and set provider to cohere
            delete process.env.MCP_RERANKING_PROVIDER;
            delete process.env.MCP_RERANKING_MLX_MODEL_PATH;
            process.env.MCP_RERANKING_PROVIDER = 'cohere';
            
            // Clear module cache and reload config
            vi.resetModules();
            const { RERANKING_CONFIG } = await import('../config.js');
            
            expect(RERANKING_CONFIG.provider).toBe('cohere'); // Default provider
            expect(RERANKING_CONFIG.mlxModelPath).toBe('');
        });
    });

    describe('isRerankingEnabled with MLX', () => {
        it('should return true when MLX provider is configured with model path', async () => {
            // Simulate Apple Silicon
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            // Clear module cache and reload config
            vi.resetModules();
            const { isRerankingEnabled } = await import('../config.js');
            
            expect(isRerankingEnabled()).toBe(true);
        });

        it('should return false when MLX provider has no model path', async () => {
            // Simulate Apple Silicon
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            // Set provider to MLX but no model path
            process.env.MCP_RERANKING_PROVIDER = 'mlx';
            process.env.MCP_RERANKING_MLX_MODEL_PATH = '';
            
            // Clear module cache and reload config
            vi.resetModules();
            const { isRerankingEnabled } = await import('../config.js');
            
            expect(isRerankingEnabled()).toBe(false);
        });
    });
});
