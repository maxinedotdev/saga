# MCP Documentation Server

A TypeScript-based [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides local-first document management and semantic search using embeddings. The server exposes a collection of MCP tools and uses on-disk persistence, an in-memory index, caching, and LanceDB vector storage by default with an in-memory fallback.

## LLM-assisted analysis (optional)

Optional integration with LLM providers for document analysis and summarization. Supports Gemini (cloud) or OpenAI-compatible endpoints such as LM Studio (local) or synthetic.new (remote).

### Capabilities
- LLM search via `search_documents_with_ai`
- Natural-language queries and summaries over document content
- Context window retrieval for surrounding chunks
- File mapping cache to avoid re-uploading the same files to Gemini


## Core capabilities

### Search and analysis
- LLM search using the configured provider (optional)
- Semantic search using embeddings plus in-memory keyword index
- Context window retrieval for surrounding chunks

### Performance and optimization
- O(1) document lookup and keyword index through `DocumentIndex`
- LanceDB vector storage (default): disk-based vector search with HNSW indexing for larger datasets
- LRU `EmbeddingCache` to avoid recomputing embeddings and speed up repeated queries
- Parallel chunking and batch processing to accelerate ingestion of large documents
- Streaming file reader to process large files without high memory usage
- Automatic migration of existing JSON documents to LanceDB on first use

### File management
- Copy-based storage with backup preservation
- Complete deletion removes JSON files and associated originals
- Local-only storage; all data resides in `~/.mcp-documentation-server/`

## Quick Start

### Configure an MCP client

Example configuration for an MCP client (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "documentation": {
      "command": "npx",
      "args": [
        "-y",
        "@maxinedotdev/mcp-documentation-server"
      ],
      "env": {
            "MCP_BASE_DIR": "/path/to/workspace",  // Optional, custom data directory (default: ~/.mcp-documentation-server)
            "MCP_VECTOR_DB": "lance",  // Optional, "lance" (default) or "memory" (legacy in-memory)
            "MCP_LANCE_DB_PATH": "~/.data/lancedb",  // Optional, custom LanceDB path (default: {dataDir}/lancedb)
            "MCP_EMBEDDING_PROVIDER": "transformers",  // Optional, "transformers" or "openai"
            "MCP_EMBEDDING_MODEL": "Xenova/all-MiniLM-L6-v2",
            "MCP_EMBEDDING_BASE_URL": "http://127.0.0.1:1234",  // Optional, OpenAI-compatible embeddings base URL
            "MCP_EMBEDDING_API_KEY": "your-api-key-here",  // Optional, required for remote embeddings
            "MCP_AI_PROVIDER": "gemini",  // Optional, "gemini" or "openai"
            "GEMINI_API_KEY": "your-api-key-here",  // Optional, enables Gemini LLM search
            "MCP_AI_BASE_URL": "http://127.0.0.1:1234",  // Optional, OpenAI-compatible base URL (LM Studio / synthetic.new)
            "MCP_AI_MODEL": "ministral-3-8b-instruct-2512",  // Optional, defaults based on base URL
            "MCP_AI_API_KEY": "your-api-key-here",  // Optional, required for synthetic.new
      }
    }
  }
}
```

### Basic workflow

- Add documents using the `add_document` tool or by placing `.txt`, `.md`, or `.pdf` files into the uploads folder and calling `process_uploads`.
- Search documents with `search_documents` to get ranked chunk hits.
- Use `get_context_window` to fetch neighboring chunks and provide LLMs with richer context.

## Exposed MCP tools

The server exposes several tools (validated with Zod schemas) for document lifecycle and search:

### Document management
- `add_document` — Add a document (title, content, metadata)
- `list_documents` — List documents with pagination; metadata/preview are optional
- `get_document` — Retrieve a full document by id
- `delete_document` — Remove a document, its chunks, and associated original files
- `delete_crawl_session` — Remove all documents created by a crawl session

### File processing
- `process_uploads` — Convert files in uploads folder into documents (chunking + embeddings + backup preservation)
- `get_uploads_path` — Returns the absolute uploads folder path
- `list_uploads_files` — Lists files in uploads folder

### Documentation crawling
- `crawl_documentation` — Crawl public docs from a seed URL with depth/page limits and robots.txt compliance

### Search and analysis
- `search_documents_with_ai` — LLM search using the configured provider (requires provider configuration)
- `search_documents` — Semantic search within a document (returns chunk hits and LLM hint)
- `get_context_window` — Return a window of chunks around a target chunk index

## Configuration & environment variables

Configure behavior via environment variables. Important options:

### Vector Database Configuration
- `MCP_VECTOR_DB` — vector database selection: `lance` (default, LanceDB) or `memory` (legacy in-memory).
- `MCP_LANCE_DB_PATH` — custom path for LanceDB storage (default: `{dataDir}/lancedb`).

**LanceDB characteristics**:
- Disk-based vector search with HNSW indexing
- Scales better than in-memory as the dataset grows
- Lower memory usage during queries
- Metadata filtering support
- Automatic migration of existing JSON documents on first use
- Local-first storage (no external server required)

**When to use LanceDB**:
- Larger document sets
- Frequent search queries
- Metadata filtering
- Limited system memory

**When to use in-memory**:
- Small document sets
- Simple setup without additional storage
- Testing and development

### General Configuration
- `MCP_BASE_DIR` — base directory for data storage (default: `~/.mcp-documentation-server`). Supports `~` expansion for the home directory.
- `MCP_EMBEDDING_PROVIDER` — embedding provider selection: `transformers` or `openai` (optional; defaults to `transformers`).
- `MCP_EMBEDDING_MODEL` — embedding model name. Defaults to `Xenova/all-MiniLM-L6-v2` for Transformers.js or `text-embedding-nomic-embed-text-v1.5` for LM Studio.
- `MCP_EMBEDDING_BASE_URL` — OpenAI-compatible embeddings base URL (required for `openai`, e.g. `http://127.0.0.1:1234`).
- `MCP_EMBEDDING_API_KEY` — OpenAI-compatible embeddings API key (required for remote embeddings).
- `MCP_AI_PROVIDER` — LLM provider selection: `gemini` or `openai` (optional; defaults based on configured keys).
- `MCP_AI_BASE_URL` — OpenAI-compatible base URL (required for `openai`, e.g. `http://127.0.0.1:1234` or `https://api.synthetic.new/openai/v1`).
- `MCP_AI_MODEL` — OpenAI-compatible model name (optional; defaults based on base URL).
- `MCP_AI_API_KEY` — OpenAI-compatible API key (required for synthetic.new, optional for local LM Studio).
- `MCP_AI_MAX_CONTEXT_CHUNKS` — Max chunks included in LLM prompt for OpenAI-compatible providers (default: `6`).
- `GEMINI_API_KEY` — Google Gemini API key for LLM search features (optional, enables `search_documents_with_ai` when provider is Gemini).
- `MCP_INDEXING_ENABLED` — enable/disable the `DocumentIndex` (true/false). Default: `true`.
- `MCP_CACHE_SIZE` — LRU embedding cache size (integer). Default: `1000`.
- `MCP_PARALLEL_ENABLED` — enable parallel chunking (true/false). Default: `true`.
- `MCP_MAX_WORKERS` — number of parallel workers for chunking/indexing. Default: `4`.
- `MCP_STREAMING_ENABLED` — enable streaming reads for large files. Default: `true`.
- `MCP_STREAM_CHUNK_SIZE` — streaming buffer size in bytes. Default: `65536` (64KB).
- `MCP_STREAM_FILE_SIZE_LIMIT` — threshold (bytes) to switch to streaming path. Default: `10485760` (10MB).

## LLM provider setup

- **Gemini** (cloud): set `MCP_AI_PROVIDER=gemini` and `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/app/apikey).
- **LM Studio** (local): set `MCP_AI_PROVIDER=openai` and `MCP_AI_BASE_URL=http://127.0.0.1:1234`. Default model is `ministral-3-8b-instruct-2512` unless `MCP_AI_MODEL` overrides it.
- **synthetic.new** (remote): set `MCP_AI_PROVIDER=openai`, `MCP_AI_BASE_URL=https://api.synthetic.new/openai/v1`, and `MCP_AI_API_KEY`. Default model is `glm-4.7` unless `MCP_AI_MODEL` overrides it.
- If `MCP_AI_PROVIDER` is unset, the server falls back to Gemini when `GEMINI_API_KEY` is set, otherwise it uses OpenAI-compatible settings when `MCP_AI_BASE_URL` is set.

## LLM provider validation

- Start the server with the provider env vars configured.
- Use `list_documents` (with `limit`/`offset`) to obtain a document ID.
- Call `search_documents_with_ai` with a query and verify JSON output contains `search_results` and `relevant_sections`.

## Embedding provider validation

- Set `MCP_EMBEDDING_PROVIDER=openai` and `MCP_EMBEDDING_BASE_URL=http://127.0.0.1:1234`.
- Add a document and run `search_documents` to confirm embeddings are generated via LM Studio.
- Re-ingest documents when switching embedding provider or model.
- Or run the CLI check: `node dist/embedding-cli.js --provider openai --base-url http://127.0.0.1:1234 --model text-embedding-nomic-embed-text-v1.5`.

Example `.env` (defaults applied when variables are not set):

```env
# Vector Database Configuration
MCP_VECTOR_DB=lance               # "lance" (default) or "memory" (legacy)
MCP_LANCE_DB_PATH=~/.data/lancedb  # Custom LanceDB path (optional)

# Base Directory
MCP_BASE_DIR=/path/to/workspace   # Base directory for data storage (default: ~/.mcp-documentation-server)

# Indexing and Performance
MCP_INDEXING_ENABLED=true          # Enable O(1) indexing (default: true)
MCP_CACHE_SIZE=1000                # LRU cache size (default: 1000)
MCP_PARALLEL_ENABLED=true          # Enable parallel processing (default: true)
MCP_MAX_WORKERS=4                  # Parallel worker count (default: 4)
MCP_STREAMING_ENABLED=true         # Enable streaming (default: true)
MCP_STREAM_CHUNK_SIZE=65536        # Stream chunk size (default: 64KB)
MCP_STREAM_FILE_SIZE_LIMIT=10485760 # Streaming threshold (default: 10MB)

# Embedding Provider
MCP_EMBEDDING_PROVIDER=transformers  # "transformers" or "openai" (optional)
MCP_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2  # Embedding model name
MCP_EMBEDDING_BASE_URL=http://127.0.0.1:1234  # OpenAI-compatible embeddings base URL (optional)
MCP_EMBEDDING_API_KEY=your-api-key-here  # OpenAI-compatible embeddings API key (required for remote)

# LLM Provider
MCP_AI_PROVIDER=gemini             # "gemini" or "openai" (optional)
MCP_AI_BASE_URL=http://127.0.0.1:1234  # OpenAI-compatible base URL (optional)
MCP_AI_MODEL=ministral-3-8b-instruct-2512  # OpenAI-compatible model (optional)
MCP_AI_API_KEY=your-api-key-here   # OpenAI-compatible API key (required for synthetic.new)
MCP_AI_MAX_CONTEXT_CHUNKS=6        # Max chunks in LLM prompt (OpenAI-compatible)
GEMINI_API_KEY=your-api-key-here   # Google Gemini API key (optional)
```

Default storage layout (data directory):

```
~/.mcp-documentation-server/  # Or custom path via MCP_BASE_DIR
├── data/        # Document JSON files
│   ├── *.json   # Document metadata and chunks
│   └── *.md     # Markdown versions of documents
├── lancedb/     # LanceDB vector storage (when using LanceDB)
│   └── chunks/  # Vector index and chunk data
└── uploads/     # Drop files (.txt, .md, .pdf) to import
```

## Migration Guide

### Automatic Migration
When you first use LanceDB, the system automatically detects existing JSON documents and migrates them:

1. **First Startup**: LanceDB is initialized
2. **Detection**: System checks for existing JSON documents
3. **Migration**: Documents with embeddings are migrated to LanceDB
4. **Completion**: Migration summary is logged to console

No manual migration is required. Your existing documents are preserved.

### Manual Migration
If you need to re-run migration:

```bash
# Re-initialize by deleting LanceDB directory and restarting
rm -rf ~/.mcp-documentation-server/lancedb
# Restart your MCP server - migration will run automatically
```

### Rollback to In-Memory
To switch back to in-memory storage:

```bash
# Set environment variable
export MCP_VECTOR_DB=memory
# Restart your MCP server
```

### Data Integrity
- **JSON files are preserved**: Original documents remain in `data/` directory
- **Embeddings are cached**: No need to regenerate embeddings
- **Atomic operations**: Migration is transaction-safe
- **Error handling**: If migration fails, system falls back to in-memory

## Usage examples

### Basic Document Operations

Add a document via MCP tool:

```json
{
  "tool": "add_document",
  "arguments": {
    "title": "Python Basics",
    "content": "Python is a high-level programming language...",
    "metadata": {
      "category": "programming",
      "tags": ["python", "tutorial"]
    }
  }
}
```

Search a document:

```json
{
  "tool": "search_documents",
  "arguments": {
    "document_id": "doc-123",
    "query": "variable assignment",
    "limit": 5
  }
}
```

### Crawl Documentation

The crawler ingests public documentation starting from a seed URL, respects `robots.txt`, and uses sitemaps when available.
Crawled content is untrusted; review and sanitize before using it in prompts or responses.

```json
{
  "tool": "crawl_documentation",
  "arguments": {
    "seed_url": "https://example.com/docs",
    "max_pages": 100,
    "max_depth": 5,
    "same_domain_only": true
  }
}
```

To remove a crawl session later:

```json
{
  "tool": "delete_crawl_session",
  "arguments": {
    "crawl_id": "your-crawl-id"
  }
}
```

### LLM search examples

**Analysis** (requires provider configuration):

```json
{
  "tool": "search_documents_with_ai",
  "arguments": {
    "document_id": "doc-123",
    "query": "explain the main concepts and their relationships"
  }
}
```

**Complex questions**:

```json
{
  "tool": "search_documents_with_ai",
  "arguments": {
    "document_id": "doc-123",
    "query": "what are the key architectural patterns and how do they work together?"
  }
}
```

**Summaries**:

```json
{
  "tool": "search_documents_with_ai",
  "arguments": {
    "document_id": "doc-123",
    "query": "summarize the core principles and provide examples"
  }
}
```

### Context Enhancement

Fetch context window:

```json
{
  "tool": "get_context_window",
  "arguments": {
    "document_id": "doc-123",
    "chunk_index": 5,
    "before": 2,
    "after": 2
  }
}
```

### When to use LLM search
- Complex questions where context matters
- Summaries and explanations
- Comparisons across sections or documents

### LLM search behavior
- File mapping cache prevents re-uploading the same content
- Only relevant sections are analyzed by the LLM provider

- Embedding models are downloaded on first use; some models require several hundred MB of downloads.
- The `DocumentIndex` persists an index file and can be rebuilt if necessary.
- The `EmbeddingCache` can be warmed by calling `process_uploads`, issuing curated queries, or using a preload API when available.

### Embedding Models

Embedding model selection depends on the provider:

- **Transformers.js (default)**: set `MCP_EMBEDDING_PROVIDER=transformers` and `MCP_EMBEDDING_MODEL`.
  - **`Xenova/all-MiniLM-L6-v2`** (default) - Fast, good quality (384 dimensions)
  - **`Xenova/paraphrase-multilingual-mpnet-base-v2`** (recommended) - Best quality, multilingual (768 dimensions)
- **OpenAI-compatible (LM Studio / remote)**: set `MCP_EMBEDDING_PROVIDER=openai` and `MCP_EMBEDDING_BASE_URL`.
  - Default model for LM Studio: `text-embedding-nomic-embed-text-v1.5`

The system derives embedding dimensions from the selected provider (Transformers.js model metadata or OpenAI-compatible response length).

**Important**: Changing embedding provider or model requires re-adding all documents as embeddings are incompatible.


## Development

```bash
git clone https://github.com/maxinedotdev/mcp-documentation-server.git
cd mcp-documentation-server
```

```bash
npm run dev
```
```bash
npm run build
```
```bash
npm run inspect
```

### Branch conventions (local)
- `develop` is the active integration branch
- `staging` is the runtime branch; promote by merging `develop` via `./promote-to-staging.sh` (use `--push` to publish, or `npm run promote:staging`)
- `main` tracks upstream and should remain clean locally
- Switch back to the dev worktree with `./switch-to-develop.sh` or `npm run switch:develop` (auto-stashes/restores local changes)

### Local branch protection
This repo includes local git hooks that block commits on `main`, block direct commits on `staging`, and block pushes to `main`.
Run `scripts/setup-githooks.sh` to enable them for this clone.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/name`
3. Follow [Conventional Commits](https://conventionalcommits.org/) for messages
4. Open a pull request

## License

MIT - see [LICENSE](LICENSE) file

## Support

- [Documentation](https://github.com/maxinedotdev/mcp-documentation-server)
- [Report Issues](https://github.com/maxinedotdev/mcp-documentation-server/issues)
- [MCP Community](https://modelcontextprotocol.io/)

## Acknowledgments

This project was originally created by [@andrea9293](https://github.com/andrea9293). It has been forked and is now maintained by [maxinedotdev](https://github.com/maxinedotdev).

**Built with [FastMCP](https://github.com/punkpeye/fastmcp) and TypeScript**
