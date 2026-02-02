/**
 * Tests for model downloader utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getDefaultModelPath,
} from '../model-downloader.js';

describe('Model Downloader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('getDefaultModelPath', () => {
        it('should return the default model path', () => {
            const path = getDefaultModelPath();
            expect(path).toContain('.saga');
            expect(path).toContain('models');
            expect(path).toContain('jina-reranker-v3-mlx');
        });
    });
});

