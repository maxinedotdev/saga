![GitHub Release](https://img.shields.io/github/v/release/cvntress/saga)
![npm version](https://img.shields.io/npm/v/saga-mcp)

# Saga MCP Server

[![npm publish](https://github.com/maxinedotdev/saga/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/maxinedotdev/saga/actions/workflows/npm-publish.yml)

Saga is a TypeScript-based [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for local-first document management and semantic search using embeddings. It ships with LanceDB vector storage, web crawling, and optional LLM integration.

## Installation

### Local Development

You can install from npm or clone and link locally:

```bash
# Install from npm
npm install -g @maxinedotdev/saga

# Or clone and build
git clone https://github.com/maxinedotdev/saga.git
cd saga
npm install
npm run build

# Link globally so it's available in other MCP consumers
npm link
```

After linking, the `saga` command will be available globally across all VSCode windows.

### Direct Path Method (Alternative)

If you prefer not to use `npm link`, you can reference the server directly in your MCP configuration:

```json
{
  "mcpServers": {
    "saga": {
      "command": "node",
      "args": ["/full/path/to/saga/dist/server.js"],
      "env": {
        "MCP_BASE_DIR": "~/.saga",
        "MCP_EMBEDDING_PROVIDER": "openai",
        "MCP_EMBEDDING_BASE_URL": "http://localhost:1234",
        "MCP_EMBEDDING_MODEL": "llama-nemotron-embed-1b-v2"
      }
    }
  }
}
```

### Via npm

```bash
npm install -g @maxinedotdev/saga
```

## Quick Start

### Configure an MCP Client

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "documentation": {
      "command": "saga",
      "env": {
        "MCP_BASE_DIR": "~/.saga",
        "MCP_EMBEDDING_PROVIDER": "openai",
        "MCP_EMBEDDING_BASE_URL": "http://localhost:1234",
        "MCP_EMBEDDING_MODEL": "llama-nemotron-embed-1b-v2"
      }
    }
  }
}
```

> **Note:** If you didn't run `npm link` during installation, use the direct path method shown in the Installation section above.

### Basic Usage

1. **Add documents**: Use `add_document` tool or place `.txt`/`.md` files in the uploads folder and call `process_uploads`
2. **Search**: Use `query` for semantic document discovery
3. **Analyze**: Use `search_documents_with_ai` for LLM-powered analysis (requires LLM configuration)

## Features

- **Semantic Search**: Vector-based search with LanceDB and HNSW indexing
- **Two-Stage Retrieval**: Optional cross-encoder reranking for improved result quality
- **Query-First Discovery**: Find relevant documents quickly with hybrid ranking (vector + keyword fallback)
- **Web Crawling**: Crawl public documentation with `crawl_documentation`
- **LLM Integration**: Optional AI-powered analysis via OpenAI-compatible providers (LM Studio, synthetic.new)
- **Performance**: LRU caching, parallel processing, streaming file reads
- **Local-First**: All data stored in `~/.saga/` - no external services required

### Reranking

Saga supports optional two-stage retrieval that improves search result quality by combining vector search with cross-encoder reranking:

1. **Stage 1 - Vector Search**: Retrieve a larger pool of candidate results (5x the requested limit)
2. **Stage 2 - Reranking**: Use a cross-encoder model to re-rank candidates based on semantic similarity to the query

This approach provides more accurate results, especially for:
- Multilingual queries (Norwegian, English, and mixed-language content)
- Code snippet searches
- Complex technical queries

**Note**: Reranking is enabled by default but can be disabled via configuration or per-query. The feature gracefully degrades to vector-only search if the reranking service is unavailable.

## Database v1.0.0

Saga now uses a redesigned v1.0.0 database schema with significant improvements in performance, scalability, and data integrity.

### Key Improvements

| Area | Improvement | Benefit |
|------|-------------|---------|
| **Schema** | Flattened metadata, normalized tables | Type safety, better queries |
| **Indexes** | Dynamic IVF_PQ, scalar indexes | Fast queries, scalable |
| **Storage** | Single source of truth (LanceDB only) | No duplication, consistency |
| **Memory** | Optional LRU caches | Scalable, configurable |
| **Migration** | Migrationless (manual reset) | Clear state, no legacy coupling |
| **Performance** | <100ms query latency | Better UX |

### Quick Start

#### New Installation

For new installations, the v1.0.0 schema is initialized automatically:

```bash
# The database will be initialized on first run
saga
```

#### Legacy Data (No Migration)

Saga v1 is **migrationless**. If you have legacy data, discard it and re-ingest.
There is no backward compatibility, and the server will prompt you to manually
delete the database when it detects a schema mismatch.

```bash
rm -rf ~/.saga/lancedb
```


### Performance Targets

| Metric | Target |
|--------|--------|
| Vector search (top-10) | < 100ms |
| Scalar filter (document_id) | < 10ms |
| Tag filter query | < 50ms |
| Keyword search | < 75ms |
| Combined query | < 150ms |

### Storage Layout

```
~/.saga/lancedb/
├── documents.lance/         # Document metadata
├── document_tags.lance/     # Tag relationships
├── document_languages.lance/# Language relationships
├── chunks.lance/            # Text chunks with embeddings
├── code_blocks.lance/       # Code blocks with embeddings
├── keywords.lance/          # Keyword inverted index
└── schema_version.lance/    # Schema tracking
```

### Documentation

- **[Schema Reference](docs/database-v1-schema-reference.md)** - Complete schema documentation
- **[API Reference](docs/database-v1-api-reference.md)** - LanceDBV1 API documentation
- **[Design Document](plans/database-schema-v1-design.md)** - Detailed design rationale

### Database Management

#### Check Database Status

```bash
# View database statistics
node dist/scripts/db-status.ts
```

#### Initialize Fresh Database

```bash
# Initialize a new v1.0.0 database
node dist/scripts/init-db-v1.ts --verbose
```

#### Drop Database

```bash
# Remove all database data
node dist/scripts/drop-db.ts
```

### Troubleshooting

#### Schema/Initialization Issues

**Symptom**: Startup error mentions schema mismatch or missing tables.

**Solutions**:
1. Stop the server
2. Delete the database directory:
   ```bash
   rm -rf ~/.saga/lancedb
   ```
3. Restart the server and re-ingest documents

#### Performance Issues

**Symptom**: Slow queries

**Solutions**:
1. Check database stats: `node dist/scripts/db-status.ts`
2. Reduce result limit for faster queries
3. Monitor with `node dist/scripts/benchmark-db.ts`

**Symptom**: High memory usage

**Solutions**:
1. Use pagination for large result sets
2. Reduce batch size for inserts
3. Close database connections when done

## Available Tools

### Document Management
- `add_document` - Add a document with title, content, and metadata
- `list_documents` - List documents with pagination
- `get_document` - Retrieve full document by ID
- `delete_document` - Remove a document and its chunks
- `query` - Query-first document discovery with semantic ranking

### File Processing
- `process_uploads` - Convert files in uploads folder to documents
- `get_uploads_path` - Get the absolute uploads folder path
- `list_uploads_files` - List files in uploads folder

### Search & Analysis
- `search_documents_with_ai` - LLM-powered analysis (requires provider config)
- `get_context_window` - Get neighboring chunks for context
- `crawl_documentation` - Crawl public docs from a seed URL
- `delete_crawl_session` - Remove all documents from a crawl session

## Configuration

Configure via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_BASE_DIR` | Data storage directory | `~/.saga` |
| `MCP_EMBEDDING_PROVIDER` | `openai` (OpenAI-compatible API only) | `openai` |
| `MCP_EMBEDDING_MODEL` | Embedding model name | `llama-nemotron-embed-1b-v2` |
| `MCP_EMBEDDING_BASE_URL` | OpenAI-compatible base URL (required) | - |
| `MCP_AI_BASE_URL` | LLM provider URL (LM Studio/synthetic.new) | - |
| `MCP_AI_MODEL` | LLM model name | Provider default |
| `MCP_AI_API_KEY` | API key for remote providers | - |
| `MCP_TAG_GENERATION_ENABLED` | Auto-generate tags with AI | `false` |
| `MCP_SIMILARITY_THRESHOLD` | Min similarity score (0.0-1.0) | `0.0` |

### Reranking Configuration

Reranking improves search result quality by using cross-encoder models to re-rank vector search results.

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_RERANKING_ENABLED` | Enable/disable reranking feature | `true` |
| `MCP_RERANKING_PROVIDER` | Reranking provider: `cohere`, `jina`, `openai`, `custom` | `cohere` |
| `MCP_RERANKING_BASE_URL` | Base URL for custom provider | (provider default) |
| `MCP_RERANKING_API_KEY` | API key for reranking provider | - |
| `MCP_RERANKING_MODEL` | Reranking model name | (provider default) |
| `MCP_RERANKING_CANDIDATES` | Max candidates to retrieve for reranking | `50` |
| `MCP_RERANKING_TOP_K` | Number of results to return after reranking | `10` |
| `MCP_RERANKING_TIMEOUT` | Reranking API timeout (ms) | `30000` |

**Provider-Specific Defaults:**

- **Cohere**: `https://api.cohere.ai/v1`, model: `rerank-multilingual-v3.0`
- **Jina AI**: `https://api.jina.ai/v1`, model: `jina-reranker-v1-base-en`
- **OpenAI**: `https://api.openai.com/v1`, model: `gpt-4o-mini`

**Example Configurations:**

```env
# Cohere (recommended for multilingual)
MCP_RERANKING_ENABLED=true
MCP_RERANKING_PROVIDER=cohere
MCP_RERANKING_API_KEY=your-cohere-api-key

# Jina AI
MCP_RERANKING_ENABLED=true
MCP_RERANKING_PROVIDER=jina
MCP_RERANKING_API_KEY=your-jina-api-key

# Custom endpoint
MCP_RERANKING_ENABLED=true
MCP_RERANKING_PROVIDER=custom
MCP_RERANKING_BASE_URL=https://your-reranker.example.com/v1
MCP_RERANKING_API_KEY=your-api-key
MCP_RERANKING_MODEL=your-model-name
```

### Request Timeouts

The server supports configurable HTTP request timeouts to handle slow or unresponsive providers. All timeout values are in milliseconds.

**Timeout Hierarchy** (from highest to lowest priority):
1. **Operation-specific timeout** (e.g., `MCP_AI_SEARCH_TIMEOUT_MS`)
2. **Global timeout** (`MCP_REQUEST_TIMEOUT_MS`)
3. **Default** (30000ms = 30 seconds)

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_REQUEST_TIMEOUT_MS` | Global timeout for all HTTP requests | `30000` |
| `MCP_AI_SEARCH_TIMEOUT_MS` | Timeout for AI search requests (`search_documents_with_ai`) | Global timeout |
| `MCP_EMBEDDING_TIMEOUT_MS` | Timeout for embedding generation requests | Global timeout |

**Timeout Error Behavior:**

When a request exceeds its timeout, a `RequestTimeoutError` is thrown with details:
- Error message includes the timeout duration and URL
- The `isTimeout` property is set to `true` for programmatic detection
- Provider health tracking marks the failure and may trigger fallback to other providers (in multi-provider mode)

**Example Configurations:**

```env
# Fast local setup (15 second global timeout)
MCP_REQUEST_TIMEOUT_MS=15000

# Slow remote APIs (60 second global timeout)
MCP_REQUEST_TIMEOUT_MS=60000

# Different timeouts per operation
MCP_REQUEST_TIMEOUT_MS=30000        # 30s default
MCP_AI_SEARCH_TIMEOUT_MS=120000     # 2 min for AI search (slow LLMs)
MCP_EMBEDDING_TIMEOUT_MS=45000      # 45s for embeddings
```

**Validation:**
- Values must be positive integers (e.g., `30000`, not `30s`)
- Non-numeric, zero, or negative values are rejected with a warning
- Invalid values fall back to the next level in the hierarchy

### LLM Provider Examples

**LM Studio (local)**:
```env
MCP_AI_BASE_URL=http://localhost:1234
MCP_AI_MODEL=ministral-3-8b-instruct-2512
```

**synthetic.new (remote)**:
```env
MCP_AI_BASE_URL=https://api.synthetic.new/openai/v1
MCP_AI_API_KEY=your-api-key
```

## Troubleshooting

### MCP Server Keeps Restarting

**Symptom**: VS Code shows MCP server continuously restarting

**Common causes**:
- LanceDB data corruption in `~/.saga/lancedb/`
- Embedding provider not running (e.g., LM Studio on port 1234)
- Missing or incorrect environment variables

**Solutions**:
1. **Clear LanceDB data**: `rm -rf ~/.saga/lancedb/`
2. **Verify embedding endpoint**:
   ```bash
   curl http://localhost:1234/v1/embeddings \
     -H "Content-Type: application/json" \
     -d '{"input": ["test"], "model": "llama-nemotron-embed-1b-v2"}'
   ```
3. **Check VS Code MCP logs**: Open Output panel → Select "MCP Documentation Server"
4. **Restart VS Code** after applying fixes

### LM Studio "Unexpected endpoint or method" Errors

**Symptom**: LM Studio logs show repeated errors like:
```
Unexpected endpoint or method. (HEAD /). Returning 200 anyway
```

**Cause**: LM Studio is configured to use HTTP transport for the Saga MCP server, but Saga uses stdio transport by default. LM Studio attempts to ping an HTTP endpoint that doesn't exist.

**Solutions**:
1. **Configure LM Studio to use stdio transport**: Ensure your LM Studio MCP configuration uses `command` and `args` instead of HTTP URL
2. **Example correct configuration**:
   ```json
   {
     "mcpServers": {
       "saga": {
         "command": "node",
         "args": ["/path/to/saga/dist/server.js"],
         "env": {
           "MCP_BASE_DIR": "~/.saga",
           "MCP_EMBEDDING_PROVIDER": "openai",
           "MCP_EMBEDDING_BASE_URL": "http://localhost:1234",
           "MCP_EMBEDDING_MODEL": "llama-nemotron-embed-1b-v2"
         }
       }
     }
   }
   ```
3. **Note**: These errors are harmless and don't affect server functionality, but fixing the configuration will clean up the logs

### Vector Index Creation Errors

**Symptom**: Logs show warnings about vector index creation:
```
Failed to create vector index on chunks: Not enough rows to train PQ. Requires 256 rows but only 33 available
```

**Cause**: LanceDB's IVF_PQ indexing requires at least 256 vectors for Product Quantization training. Small datasets don't have enough data.

**Solutions**:
1. **No action needed**: The server gracefully handles this by skipping index creation for small datasets
2. **Use HNSW indexing**: Set `MCP_USE_HNSW=true` (default) - HNSW works with any dataset size
3. **Add more documents**: When your dataset grows beyond 256 vectors, indexes will be created automatically
4. **Note**: Brute force search is efficient for small datasets (< 1000 vectors), so missing indexes won't impact performance

### Graceful Degradation

If the vector database fails to initialize, the server will continue running without vector search capabilities. Document management tools (add, list, delete) remain functional, but semantic search will be unavailable. Check the MCP logs to identify and resolve the underlying issue.

### Reranking Issues

**Symptom**: Search results don't use reranking despite being enabled

**Common causes**:
- Missing or invalid `MCP_RERANKING_API_KEY`
- Reranking API endpoint unreachable
- Timeout value too low for the provider

**Solutions**:
1. **Verify API key**: Ensure the API key is valid for your reranking provider
2. **Check endpoint connectivity**:
   ```bash
   curl https://api.cohere.ai/v1/rerank \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"query": "test", "documents": ["test"], "model": "rerank-multilingual-v3.0"}'
   ```
3. **Increase timeout**: Set `MCP_RERANKING_TIMEOUT` to a higher value (e.g., `60000` for 60 seconds)
4. **Check MCP logs**: Look for reranking-related errors in the MCP server logs

**Symptom**: Reranking causes search to be slow

**Solutions**:
1. **Reduce candidate pool**: Lower `MCP_RERANKING_CANDIDATES` (default: 50)
2. **Disable for quick searches**: Set `MCP_RERANKING_ENABLED=false` for faster results
3. **Use per-query override**: Pass `useReranking: false` in query options for specific queries

**Note**: Reranking gracefully degrades to vector-only search if the reranking service is unavailable or times out.

### LM Studio Embedding Model Loading Error

**Symptom**: LM Studio shows an error when Saga tries to use embeddings:

```
Invalid model identifier 'text-embedding-llama-nemotron-embed-1b-v2@q4_k_s'. No matching loaded model found, and just-in-time (JIT) model loading is disabled. Ensure you have this model loaded first. JIT loading can be enabled in LM Studio Server Settings.
```

**Cause**: LM Studio has Just-In-Time (JIT) model loading disabled, which requires models to be pre-loaded before use. Saga requests the embedding model by name, but LM Studio cannot automatically load it because JIT loading is turned off.

**Solutions**:

#### Option 1: Enable JIT Model Loading (Recommended)

Enable JIT loading in LM Studio Server Settings to allow automatic model loading:

1. **Open LM Studio**
2. **Go to Server Settings**:
   - Click the "Server" tab in the left sidebar
   - Click "Server Settings" (gear icon)
3. **Enable JIT Loading**:
   - Find the "JIT Model Loading" or "Just-In-Time Loading" option
   - Toggle it to **Enabled**
4. **Restart the LM Studio Server**:
   - Stop the server (if running)
   - Start it again
5. **Verify the fix**:
   - Try using Saga again
   - The model should now load automatically when requested

#### Option 2: Pre-load the Embedding Model

If you prefer to keep JIT loading disabled, manually load the model first:

1. **Open LM Studio**
2. **Download the embedding model**:
   - Search for "text-embedding-llama-nemotron-embed-1b-v2@q4_k_s" in the model marketplace
   - Download and install the model
3. **Load the model**:
   - Go to the "Local Models" tab
   - Find "text-embedding-llama-nemotron-embed-1b-v2@q4_k_s"
   - Click "Load" or "Start" to load the model into memory
4. **Keep the model loaded**:
   - Ensure the model remains loaded while using Saga
   - If LM Studio unloads the model, you'll need to reload it
5. **Verify the fix**:
   - Try using Saga again
   - The model should now be available

#### Recommended LM Studio Configuration for Saga

For the best experience with Saga, configure LM Studio with these settings:

```env
# LM Studio Server Settings
- Port: 1234 (or your preferred port)
- JIT Model Loading: Enabled (recommended)
- Host: 127.0.0.1 (localhost)
- CORS: Enabled (if accessing from other applications)
```

**Why Enable JIT Loading?**
- **Flexibility**: Automatically loads models as needed
- **Convenience**: No need to manually pre-load models
- **Resource Management**: Only loads models when they're actually used
- **Better Experience**: Seamless integration with Saga and other MCP servers

**Troubleshooting Tips**:

1. **Check if the model is installed**:
   - In LM Studio, go to "Local Models"
   - Search for "text-embedding-llama-nemotron-embed-1b-v2@q4_k_s"
   - If not found, download it from the marketplace

2. **Verify LM Studio server is running**:
   ```bash
   curl http://localhost:1234/v1/models
   ```
   You should see a list of available models including the embedding model.

3. **Test the embedding endpoint directly**:
   ```bash
   curl http://localhost:1234/v1/embeddings \
     -H "Content-Type: application/json" \
     -d '{"input": ["test"], "model": "llama-nemotron-embed-1b-v2"}'
   ```

4. **Check LM Studio logs**:
   - Open LM Studio's log panel
   - Look for errors related to model loading or JIT settings
   - Verify the server is listening on the correct port

5. **Restart LM Studio**:
   - Sometimes a simple restart resolves configuration issues
   - Stop the server, make changes, then start it again

## Storage Layout

```
~/.saga/
├── data/        # Document JSON files
├── lancedb/     # Vector storage
└── uploads/     # Drop files here to import
```

## Development

```bash
npm run dev      # Development mode
npm run build    # Build TypeScript
```

### Testing

The project uses Vitest for testing. Available test commands:

```bash
npm run test:unit        # Run unit tests only
npm run test:integration # Run integration tests only
npm run test:benchmark   # Run performance benchmarks
npm run test:all         # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
```

**Coverage Reporting:**
- Coverage reports are generated in the `coverage/` directory
- HTML reports can be opened at `coverage/index.html`
- Coverage thresholds are enforced: 80% for statements, branches, functions, and lines

**CI/CD Integration:**
- JUnit XML reports are generated for CI environments
- Reports are saved to `test-results/junit.xml` when running in CI

**Test Output Control:**
- By default, console output from tests is suppressed to keep results clean and readable
- To enable verbose output for debugging, set the `MCP_VERBOSE_TESTS` environment variable:
  ```bash
  MCP_VERBOSE_TESTS=true npm run test:all
  ```
- This is useful when debugging test failures or investigating specific test behavior

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/name`
3. Follow [Conventional Commits](https://conventionalcommits.org/)
4. Open a pull request

## License

MIT - see [LICENSE](LICENSE) file

---

**Built with [FastMCP](https://github.com/punkpeye/fastmcp) and TypeScript**
