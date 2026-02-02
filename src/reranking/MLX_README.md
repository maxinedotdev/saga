# MLX Reranker Implementation

This document describes the MLX-based reranker implementation for the Saga MCP server.

## Overview

The MLX reranker provides fast, local document reranking using Apple's MLX framework and the Jina Reranker V3 MLX model. This implementation runs entirely on Apple Silicon (M1/M2/M3) chips without requiring API calls, making it ideal for testing and development environments.

## Requirements

### Hardware
- Apple Silicon Mac (M1, M2, or M3 chip)

### Software
- Python 3.8 or higher
- MLX framework: `pip install mlx mlx-lm`
- Jina Reranker V3 MLX model (downloaded locally)

## Installation

### 1. Install MLX Dependencies

```bash
pip install mlx mlx-lm
```

### 2. Download Jina Reranker V3 MLX Model

```bash
# Using Hugging Face CLI
pip install huggingface_hub
huggingface-cli download jinaai/jina-reranker-v3-mlx --local-dir /path/to/model
```

Or download directly from: https://huggingface.co/jinaai/jina-reranker-v3-mlx

### 3. Configure Environment Variables

Set the following environment variables to use the MLX reranker:

```bash
# Enable reranking
export MCP_RERANKING_ENABLED=true

# Use MLX provider
export MCP_RERANKING_PROVIDER=mlx

# Path to the downloaded MLX model
export MCP_RERANKING_MLX_MODEL_PATH=/path/to/jina-reranker-v3-mlx

# Python executable (optional, defaults to 'python3')
export MCP_RERANKING_MLX_PYTHON_PATH=python3

# Reranking parameters (optional)
export MCP_RERANKING_CANDIDATES=50
export MCP_RERANKING_TOP_K=10
export MCP_RERANKING_TIMEOUT=60000
```

## Usage

### Basic Usage

```typescript
import { MlxReranker } from './reranking/mlx-reranker.js';

// Create the reranker
const reranker = new MlxReranker({
    model: 'jina-reranker-v3-mlx',
    modelPath: '/path/to/jina-reranker-v3-mlx',
    pythonPath: 'python3',
    maxCandidates: 50,
    topK: 10,
    timeout: 60000,
});

// Initialize (checks Python and MLX availability)
await reranker.initialize();

// Rerank documents
const query = 'machine learning frameworks';
const documents = [
    'TensorFlow is an open-source machine learning framework',
    'PyTorch provides a flexible deep learning platform',
    'MLX is Apple\'s machine learning framework for Silicon',
];

const results = await reranker.rerank(query, documents);

// Results are sorted by relevance score (highest first)
console.log(results);
// Output:
// [
//   { index: 2, score: 0.95 },  // MLX document
//   { index: 0, score: 0.82 },  // TensorFlow
//   { index: 1, score: 0.75 },  // PyTorch
// ]
```

### Using with Configuration

The reranker can also be configured via environment variables and used with the configuration system:

```typescript
import { getRerankingConfig } from './reranking/config.js';
import { MlxReranker } from './reranking/mlx-reranker.js';

const config = getRerankingConfig();

if (config.provider === 'mlx') {
    const reranker = new MlxReranker({
        model: config.model,
        modelPath: process.env.MCP_RERANKING_MLX_MODEL_PATH!,
        pythonPath: process.env.MCP_RERANKING_MLX_PYTHON_PATH || 'python3',
        maxCandidates: config.maxCandidates,
        topK: config.topK,
        timeout: config.timeout,
    });
    
    await reranker.initialize();
    // Use reranker...
}
```

## Architecture

### Components

1. **TypeScript Wrapper** (`mlx-reranker.ts`)
   - Implements the `Reranker` interface
   - Spawns Python subprocess to run MLX model
   - Handles communication via JSON over stdin/stdout
   - Manages timeouts and error handling

2. **Python Script** (`mlx_reranker.py`)
   - Loads and runs the MLX model
   - Accepts query and documents as JSON input
   - Returns reranking results as JSON output
   - Handles model loading and inference

### Data Flow

```
TypeScript Application
    ↓ (spawn)
Python Subprocess
    ↓ (load)
MLX Model (Jina Reranker V3)
    ↓ (inference)
Reranking Scores
    ↓ (JSON)
TypeScript Application
```

## Performance

### Expected Performance

- **Initialization**: 1-3 seconds (model loading)
- **Reranking**: 100-500ms for 10-50 documents (varies by document length)
- **Memory**: 2-4 GB (model loaded in memory)

### Comparison with API-based Rerankers

| Metric | MLX Reranker | API Reranker |
|--------|--------------|--------------|
| Latency | 100-500ms | 500-2000ms |
| Cost | Free (local) | Per-request pricing |
| Privacy | 100% local | Data sent to API |
| Setup | Requires MLX installation | Just API key |
| Hardware | Apple Silicon only | Any device |

## Limitations

1. **Apple Silicon Only**: MLX only runs on Apple Silicon (M1/M2/M3) chips
2. **Python Dependency**: Requires Python and MLX to be installed
3. **Model Download**: Must download the model manually from Hugging Face
4. **Memory Usage**: Model requires 2-4 GB of RAM
5. **First Request Slow**: First reranking request is slower due to model loading

## Troubleshooting

### "MLX dependencies not installed"

Install MLX and MLX-LM:
```bash
pip install mlx mlx-lm
```

### "Failed to load model from path"

Ensure the model path is correct and the model files exist:
```bash
ls -la /path/to/jina-reranker-v3-mlx
```

### "Python not found"

Check Python installation and update the path:
```bash
which python3
export MCP_RERANKING_MLX_PYTHON_PATH=/path/to/python3
```

### "MLX reranker timed out"

Increase the timeout value:
```bash
export MCP_RERANKING_TIMEOUT=120000  # 120 seconds
```

## Testing

The MLX reranker includes comprehensive tests in `src/reranking/__tests__/mlx-reranker.test.ts`.

To run the tests:
```bash
npm test -- src/reranking/__tests__/mlx-reranker.test.ts
```

Note: The tests mock the Python subprocess, so they don't require MLX to be installed.

## Switching Between API and MLX Rerankers

You can easily switch between API-based and MLX rerankers by changing the provider:

```bash
# Use API-based reranker (Cohere, Jina, OpenAI)
export MCP_RERANKING_PROVIDER=cohere
export MCP_RERANKING_API_KEY=your-api-key

# Use MLX reranker
export MCP_RERANKING_PROVIDER=mlx
export MCP_RERANKING_MLX_MODEL_PATH=/path/to/model
```

## Future Improvements

1. **Model Caching**: Cache loaded model in memory for faster subsequent requests
2. **Batch Processing**: Support for batching multiple reranking requests
3. **GPU Acceleration**: Leverage GPU cores on Apple Silicon for faster inference
4. **Model Quantization**: Use quantized models for reduced memory usage
5. **Automatic Model Download**: Implement automatic model download from Hugging Face

## References

- [MLX Framework](https://ml-explore.github.io/mlx/)
- [Jina Reranker V3 MLX](https://huggingface.co/jinaai/jina-reranker-v3-mlx)
- [Apple ML Research](https://machinelearning.apple.com/)
- [Jina AI Documentation](https://jina.ai/)
