# MCP Documentation Server

A TypeScript-based [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for local-first document management and semantic search using embeddings. Features LanceDB vector storage, web crawling, and optional LLM integration.

## Installation

### Local Development

Since the package is not yet published to npm, clone and link locally:

```bash
# Clone and build
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
        "MCP_EMBEDDING_PROVIDER": "transformers",
        "MCP_EMBEDDING_MODEL": "Xenova/all-MiniLM-L6-v2"
      }
    }
  }
}
```

### Via npm (When Published)

> **Note:** This method requires the package to be published to npm first.

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
        "MCP_EMBEDDING_PROVIDER": "transformers",
        "MCP_EMBEDDING_MODEL": "Xenova/all-MiniLM-L6-v2"
      }
    }
  }
}
```

> **Note:** If you didn't run `npm link` during installation, use the direct path method shown in the Installation section above.

### Basic Usage

1. **Add documents**: Use `add_document` tool or place `.txt`/`.md` files in the uploads folder and call `process_uploads`
2. **Search**: Use `query` for semantic document discovery
3. **Analyze**: Use `search_documents` for chunk-level search or `search_documents_with_ai` for LLM-powered analysis (requires LLM configuration)

## Features

- **Semantic Search**: Vector-based search with LanceDB and HNSW indexing
- **Query-First Discovery**: Find relevant documents quickly with hybrid ranking (vector + keyword fallback)
- **Web Crawling**: Crawl public documentation with `crawl_documentation`
- **LLM Integration**: Optional AI-powered analysis via OpenAI-compatible providers (LM Studio, synthetic.new)
- **Performance**: LRU caching, parallel processing, streaming file reads
- **Local-First**: All data stored in `~/.saga/` - no external services required

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
- `search_documents` - Semantic search within documents (chunk-level)
- `search_documents_with_ai` - LLM-powered analysis (requires provider config)
- `get_context_window` - Get neighboring chunks for context
- `crawl_documentation` - Crawl public docs from a seed URL
- `delete_crawl_session` - Remove all documents from a crawl session

## Configuration

Configure via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_BASE_DIR` | Data storage directory | `~/.saga` |
| `MCP_EMBEDDING_PROVIDER` | `transformers` or `openai` | `transformers` |
| `MCP_EMBEDDING_MODEL` | Embedding model name | `Xenova/all-MiniLM-L6-v2` |
| `MCP_EMBEDDING_BASE_URL` | OpenAI-compatible base URL | - |
| `MCP_AI_BASE_URL` | LLM provider URL (LM Studio/synthetic.new) | - |
| `MCP_AI_MODEL` | LLM model name | Provider default |
| `MCP_AI_API_KEY` | API key for remote providers | - |
| `MCP_TAG_GENERATION_ENABLED` | Auto-generate tags with AI | `false` |
| `MCP_SIMILARITY_THRESHOLD` | Min similarity score (0.0-1.0) | `0.3` |

### LLM Provider Examples

**LM Studio (local)**:
```env
MCP_AI_BASE_URL=http://127.0.0.1:1234
MCP_AI_MODEL=ministral-3-8b-instruct-2512
```

**synthetic.new (remote)**:
```env
MCP_AI_BASE_URL=https://api.synthetic.new/openai/v1
MCP_AI_API_KEY=your-api-key
```

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
npm test         # Run tests
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/name`
3. Follow [Conventional Commits](https://conventionalcommits.org/)
4. Open a pull request

## License

MIT - see [LICENSE](LICENSE) file

---

**Built with [FastMCP](https://github.com/punkpeye/fastmcp) and TypeScript**
