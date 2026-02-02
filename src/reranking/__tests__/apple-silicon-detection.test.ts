/**
 * Tests for Apple Silicon detection utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAppleSilicon, getPlatformInfo, logPlatformInfo } from '../apple-silicon-detection.js';

describe('Apple Silicon Detection', () => {
    let originalPlatform: NodeJS.Platform;
    let originalArch: string;

    beforeEach(() => {
        // Store original values
        originalPlatform = process.platform;
        originalArch = process.arch;
    });

    afterEach(() => {
        // Restore original values
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        Object.defineProperty(process, 'arch', { value: originalArch });
    });

    describe('isAppleSilicon', () => {
        it('should return true for macOS with ARM64 architecture', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            expect(isAppleSilicon()).toBe(true);
        });

        it('should return false for macOS with x64 architecture', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            
            expect(isAppleSilicon()).toBe(false);
        });

        it('should return false for Linux with ARM64 architecture', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            expect(isAppleSilicon()).toBe(false);
        });

        it('should return false for Windows', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            
            expect(isAppleSilicon()).toBe(false);
        });
    });

    describe('getPlatformInfo', () => {
        it('should return correct info for Apple Silicon', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            const info = getPlatformInfo();
            
            expect(info.isAppleSilicon).toBe(true);
            expect(info.platform).toBe('darwin');
            expect(info.arch).toBe('arm64');
            expect(info.supportsMLX).toBe(true);
            expect(info.reason).toBeUndefined();
        });

        it('should return correct info for non-Apple Silicon macOS', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            
            const info = getPlatformInfo();
            
            expect(info.isAppleSilicon).toBe(false);
            expect(info.platform).toBe('darwin');
            expect(info.arch).toBe('x64');
            expect(info.supportsMLX).toBe(false);
            expect(info.reason).toContain('ARM64 architecture');
        });

        it('should return correct info for Linux', () => {
            Object.defineProperty(process, 'platform', { value: 'linux' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            const info = getPlatformInfo();
            
            expect(info.isAppleSilicon).toBe(false);
            expect(info.platform).toBe('linux');
            expect(info.arch).toBe('arm64');
            expect(info.supportsMLX).toBe(false);
            expect(info.reason).toContain('macOS');
        });

        it('should return correct info for Windows', () => {
            Object.defineProperty(process, 'platform', { value: 'win32' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            
            const info = getPlatformInfo();
            
            expect(info.isAppleSilicon).toBe(false);
            expect(info.platform).toBe('win32');
            expect(info.arch).toBe('x64');
            expect(info.supportsMLX).toBe(false);
            expect(info.reason).toContain('macOS');
        });
    });

    describe('logPlatformInfo', () => {
        it('should log platform information to console.error', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            
            Object.defineProperty(process, 'platform', { value: 'darwin' });
            Object.defineProperty(process, 'arch', { value: 'arm64' });
            
            logPlatformInfo();
            
            expect(consoleSpy).toHaveBeenCalledWith('[MLX Auto-Config] Platform Information:');
            expect(consoleSpy).toHaveBeenCalledWith('[MLX Auto-Config]   Platform: darwin');
            expect(consoleSpy).toHaveBeenCalledWith('[MLX Auto-Config]   Architecture: arm64');
            expect(consoleSpy).toHaveBeenCalledWith('[MLX Auto-Config]   Apple Silicon: true');
            expect(consoleSpy).toHaveBeenCalledWith('[MLX Auto-Config]   MLX Support: true');
            
            consoleSpy.mockRestore();
        });

        it('should log reason when MLX is not supported', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            
            Object.defineProperty(process, 'platform', { value: 'linux' });
            Object.defineProperty(process, 'arch', { value: 'x64' });
            
            logPlatformInfo();
            
            expect(consoleSpy).toHaveBeenCalledWith('[MLX Auto-Config] Platform Information:');
            expect(consoleSpy).toHaveBeenCalledWith('[MLX Auto-Config]   Platform: linux');
            expect(consoleSpy).toHaveBeenCalledWith('[MLX Auto-Config]   Architecture: x64');
            expect(consoleSpy).toHaveBeenCalledWith('[MLX Auto-Config]   Apple Silicon: false');
            expect(consoleSpy).toHaveBeenCalledWith('[MLX Auto-Config]   MLX Support: false');
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Reason:'));
            
            consoleSpy.mockRestore();
        });
    });
});
