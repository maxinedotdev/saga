[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/72109e6a-27fa-430d-9034-571e7065fe05) [![npm version](https://badge.fury.io/js/@andrea9293%2Fmcp-documentation-server.svg)](https://badge.fury.io/js/@andrea9293%2Fmcp-documentation-server) [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/andrea9293/mcp-documentation-server) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![Donate with PayPal](https://i.ibb.co/SX4qQBfm/paypal-donate-button171.png)](https://www.paypal.com/donate/?hosted_button_id=HXATGECV8HUJN) 

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/andrea.bravaccino)


# MCP Documentation Server

A TypeScript-based [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides local-first document management and semantic search using embeddings. The server exposes a collection of MCP tools and is optimized for performance with on-disk persistence, an in-memory index, and caching.

## 🚀 AI-Powered Document Intelligence

**NEW!** Enhanced with configurable AI providers for advanced document analysis and contextual understanding. Use Gemini (cloud) or any OpenAI-compatible endpoint such as LM Studio (local) or synthetic.new (remote).

### Key AI Features:
- **Intelligent Document Analysis**: AI providers understand context, relationships, and concepts
- **Natural Language Queries**: Ask a question, not just keywords
- **Smart Summarization**: Get comprehensive overviews and explanations
- **Contextual Insights**: Understand how different parts of your documents relate
- **File Mapping Cache**: Avoid re-uploading the same files to Gemini for efficiency


## Core capabilities

### 🔍 Search & Intelligence
- **AI-Powered Search** 🤖: Advanced document analysis with the configured AI provider for contextual understanding and intelligent insights
- **Traditional Semantic Search**: Chunk-based search using embeddings plus in-memory keyword index
- **Context Window Retrieval**: Gather surrounding chunks for richer LLM answers

### ⚡ Performance & Optimization
- **O(1) Document lookup** and keyword index through `DocumentIndex` for instant retrieval
- **LRU `EmbeddingCache`** to avoid recomputing embeddings and speed up repeated queries
- **Parallel chunking** and batch processing to accelerate ingestion of large documents
- **Streaming file reader** to process large files without high memory usage

### 📁 File Management
- **Intelligent file handling**: copy-based storage with automatic backup preservation
- **Complete deletion**: removes both JSON files and associated original files
- **Local-only storage**: no external database required. All data resides in `~/.mcp-documentation-server/`

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
        "@andrea9293/mcp-documentation-server"
      ],
      "env": {
            "MCP_BASE_DIR": "/path/to/workspace",  // Optional, custom data directory (default: ~/.mcp-documentation-server)
            "MCP_EMBEDDING_PROVIDER": "transformers",  // Optional, "transformers" or "openai"
            "MCP_EMBEDDING_MODEL": "Xenova/all-MiniLM-L6-v2",
            "MCP_EMBEDDING_BASE_URL": "http://127.0.0.1:1234",  // Optional, OpenAI-compatible embeddings base URL
            "MCP_EMBEDDING_API_KEY": "your-api-key-here",  // Optional, required for remote embeddings
            "MCP_AI_PROVIDER": "gemini",  // Optional, "gemini" or "openai"
            "GEMINI_API_KEY": "your-api-key-here",  // Optional, enables Gemini AI search
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

### 📄 Document Management
- `add_document` — Add a document (title, content, metadata)
- `list_documents` — List stored documents and metadata
- `get_document` — Retrieve a full document by id
- `delete_document` — Remove a document, its chunks, and associated original files

### 📁 File Processing
- `process_uploads` — Convert files in uploads folder into documents (chunking + embeddings + backup preservation)
- `get_uploads_path` — Returns the absolute uploads folder path
- `list_uploads_files` — Lists files in uploads folder

### 🔍 Search & Intelligence
- `search_documents_with_ai` — **🤖 AI-powered search using the configured provider** for advanced document analysis (requires provider configuration)
- `search_documents` — Semantic search within a document (returns chunk hits and LLM hint)
- `get_context_window` — Return a window of chunks around a target chunk index

## Configuration & environment variables

Configure behavior via environment variables. Important options:

- `MCP_BASE_DIR` — base directory for data storage (default: `~/.mcp-documentation-server`). Set this to use independent workspaces.
- `MCP_EMBEDDING_PROVIDER` — embedding provider selection: `transformers` or `openai` (optional; defaults to `transformers`).
- `MCP_EMBEDDING_MODEL` — embedding model name. Defaults to `Xenova/all-MiniLM-L6-v2` for Transformers.js or `text-embedding-nomic-embed-text-v1.5` for LM Studio.
- `MCP_EMBEDDING_BASE_URL` — OpenAI-compatible embeddings base URL (required for `openai`, e.g. `http://127.0.0.1:1234`).
- `MCP_EMBEDDING_API_KEY` — OpenAI-compatible embeddings API key (required for remote embeddings).
- `MCP_AI_PROVIDER` — AI provider selection: `gemini` or `openai` (optional; defaults based on configured keys).
- `MCP_AI_BASE_URL` — OpenAI-compatible base URL (required for `openai`, e.g. `http://127.0.0.1:1234` or `https://api.synthetic.new/openai/v1`).
- `MCP_AI_MODEL` — OpenAI-compatible model name (optional; defaults based on base URL).
- `MCP_AI_API_KEY` — OpenAI-compatible API key (required for synthetic.new, optional for local LM Studio).
- `MCP_AI_MAX_CONTEXT_CHUNKS` — Max chunks included in AI prompt for OpenAI-compatible providers (default: `6`).
- `GEMINI_API_KEY` — **Google Gemini API key** for AI-powered search features (optional, enables `search_documents_with_ai` when provider is Gemini).
- `MCP_INDEXING_ENABLED` — enable/disable the `DocumentIndex` (true/false). Default: `true`.
- `MCP_CACHE_SIZE` — LRU embedding cache size (integer). Default: `1000`.
- `MCP_PARALLEL_ENABLED` — enable parallel chunking (true/false). Default: `true`.
- `MCP_MAX_WORKERS` — number of parallel workers for chunking/indexing. Default: `4`.
- `MCP_STREAMING_ENABLED` — enable streaming reads for large files. Default: `true`.
- `MCP_STREAM_CHUNK_SIZE` — streaming buffer size in bytes. Default: `65536` (64KB).
- `MCP_STREAM_FILE_SIZE_LIMIT` — threshold (bytes) to switch to streaming path. Default: `10485760` (10MB).

## AI provider setup

- **Gemini** (cloud): set `MCP_AI_PROVIDER=gemini` and `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/app/apikey).
- **LM Studio** (local): set `MCP_AI_PROVIDER=openai` and `MCP_AI_BASE_URL=http://127.0.0.1:1234`. Default model is `ministral-3-8b-instruct-2512` unless `MCP_AI_MODEL` overrides it.
- **synthetic.new** (remote): set `MCP_AI_PROVIDER=openai`, `MCP_AI_BASE_URL=https://api.synthetic.new/openai/v1`, and `MCP_AI_API_KEY`. Default model is `glm-4.7` unless `MCP_AI_MODEL` overrides it.
- If `MCP_AI_PROVIDER` is unset, the server falls back to Gemini when `GEMINI_API_KEY` is set, otherwise it uses OpenAI-compatible settings when `MCP_AI_BASE_URL` is set.

## AI provider validation

- Start the server with the provider env vars configured.
- Use `list_documents` to obtain a document ID.
- Call `search_documents_with_ai` with a query and verify JSON output contains `search_results` and `relevant_sections`.

## Embedding provider validation

- Set `MCP_EMBEDDING_PROVIDER=openai` and `MCP_EMBEDDING_BASE_URL=http://127.0.0.1:1234`.
- Add a document and run `search_documents` to confirm embeddings are generated via LM Studio.
- Re-ingest documents when switching embedding provider or model.
- Or run the CLI check: `node dist/embedding-cli.js --provider openai --base-url http://127.0.0.1:1234 --model text-embedding-nomic-embed-text-v1.5`.

Example `.env` (defaults applied when variables are not set):

```env
MCP_BASE_DIR=/path/to/workspace   # Base directory for data storage (default: ~/.mcp-documentation-server)
MCP_INDEXING_ENABLED=true          # Enable O(1) indexing (default: true)
MCP_EMBEDDING_PROVIDER=transformers  # "transformers" or "openai" (optional)
MCP_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2  # Embedding model name
MCP_EMBEDDING_BASE_URL=http://127.0.0.1:1234  # OpenAI-compatible embeddings base URL (optional)
MCP_EMBEDDING_API_KEY=your-api-key-here  # OpenAI-compatible embeddings API key (required for remote)
MCP_AI_PROVIDER=gemini             # "gemini" or "openai" (optional)
MCP_AI_BASE_URL=http://127.0.0.1:1234  # OpenAI-compatible base URL (optional)
MCP_AI_MODEL=ministral-3-8b-instruct-2512  # OpenAI-compatible model (optional)
MCP_AI_API_KEY=your-api-key-here   # OpenAI-compatible API key (required for synthetic.new)
MCP_AI_MAX_CONTEXT_CHUNKS=6        # Max chunks in AI prompt (OpenAI-compatible)
GEMINI_API_KEY=your-api-key-here   # Google Gemini API key (optional)
MCP_CACHE_SIZE=1000                # LRU cache size (default: 1000)
MCP_PARALLEL_ENABLED=true          # Enable parallel processing (default: true)
MCP_MAX_WORKERS=4                  # Parallel worker count (default: 4)
MCP_STREAMING_ENABLED=true         # Enable streaming (default: true)
MCP_STREAM_CHUNK_SIZE=65536        # Stream chunk size (default: 64KB)
MCP_STREAM_FILE_SIZE_LIMIT=10485760 # Streaming threshold (default: 10MB)
```

Default storage layout (data directory):

```
~/.mcp-documentation-server/  # Or custom path via MCP_BASE_DIR
├── data/      # Document JSON files
└── uploads/   # Drop files (.txt, .md, .pdf) to import
```

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

### 🤖 AI-Powered Search Examples

**Advanced Analysis** (requires AI provider configuration):

```json
{
  "tool": "search_documents_with_ai",
  "arguments": {
    "document_id": "doc-123",
    "query": "explain the main concepts and their relationships"
  }
}
```

**Complex Questions**:

```json
{
  "tool": "search_documents_with_ai",
  "arguments": {
    "document_id": "doc-123",
    "query": "what are the key architectural patterns and how do they work together?"
  }
}
```

**Summarization Requests**:

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

### When to Use AI-Powered Search:
- **Complex Questions**: "How do these concepts relate to each other?"
- **Summarization**: "Give me an overview of the main principles"
- **Analysis**: "What are the key patterns and their trade-offs?"
- **Explanation**: "Explain this topic as if I were new to it"
- **Comparison**: "Compare these different approaches"

### Performance Benefits:
- **Smart Caching**: File mapping prevents re-uploading the same content
- **Efficient Processing**: Only relevant sections are analyzed by the AI provider
- **Contextual Results**: More accurate and comprehensive answers
- **Natural Interaction**: Ask questions in plain English

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

⚠️ **Important**: Changing embedding provider or model requires re-adding all documents as embeddings are incompatible.


## Development

```bash
git clone https://github.com/andrea9293/mcp-documentation-server.git
```
```bash
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

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/name`
3. Follow [Conventional Commits](https://conventionalcommits.org/) for messages
4. Open a pull request

## License

MIT - see [LICENSE](LICENSE) file
 

## Support

- 📖 [Documentation](https://github.com/andrea9293/mcp-documentation-server)
- 🐛 [Report Issues](https://github.com/andrea9293/mcp-documentation-server/issues)
- 💬 [MCP Community](https://modelcontextprotocol.io/)

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=andrea9293/mcp-documentation-server&type=Date)](https://www.star-history.com/#andrea9293/mcp-documentation-server&Date)


**Built with [FastMCP](https://github.com/punkpeye/fastmcp) and TypeScript** 🚀
