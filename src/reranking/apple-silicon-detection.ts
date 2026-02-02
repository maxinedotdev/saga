/**
 * Apple Silicon detection utility
 * 
 * This module provides functions to detect if the current environment
 * supports Apple Silicon (M1/M2/M3) for MLX-based reranking.
 */

import { join } from 'path';
import { homedir } from 'os';

/**
 * Get the default model path for MLX reranker
 * @returns Default path to the MLX model
 */
export function getDefaultModelPath(): string {
    return join(homedir(), '.saga', 'models', 'jina-reranker-v3-mlx');
}

/**
 * Check if the current platform is Apple Silicon (M1/M2/M3)
 * @returns True if running on Apple Silicon, false otherwise
 */
export function isAppleSilicon(): boolean {
    // Check for ARM64 architecture (Apple Silicon uses ARM)
    const isArm64 = process.arch === 'arm64';
    
    // Check for macOS platform
    const isMacOS = process.platform === 'darwin';
    
    return isArm64 && isMacOS;
}

/**
 * Get detailed platform information for MLX support
 * @returns Object containing platform details
 */
export function getPlatformInfo(): {
    isAppleSilicon: boolean;
    platform: string;
    arch: string;
    supportsMLX: boolean;
    reason?: string;
} {
    const platform = process.platform;
    const arch = process.arch;
    const isAppleSilicon = arch === 'arm64' && platform === 'darwin';
    const supportsMLX = isAppleSilicon;
    
    let reason: string | undefined;
    if (!supportsMLX) {
        if (platform !== 'darwin') {
            reason = `MLX requires macOS (detected: ${platform})`;
        } else if (arch !== 'arm64') {
            reason = `MLX requires ARM64 architecture (detected: ${arch})`;
        }
    }
    
    return {
        isAppleSilicon,
        platform,
        arch,
        supportsMLX,
        reason,
    };
}

/**
 * Log platform information for debugging
 */
export function logPlatformInfo(): void {
    const info = getPlatformInfo();
    
    console.error('[MLX Auto-Config] Platform Information:');
    console.error(`[MLX Auto-Config]   Platform: ${info.platform}`);
    console.error(`[MLX Auto-Config]   Architecture: ${info.arch}`);
    console.error(`[MLX Auto-Config]   Apple Silicon: ${info.isAppleSilicon}`);
    console.error(`[MLX Auto-Config]   MLX Support: ${info.supportsMLX}`);
    
    if (info.reason) {
        console.error(`[MLX Auto-Config]   Reason: ${info.reason}`);
    }
}
