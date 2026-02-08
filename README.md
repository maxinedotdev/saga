![npm version](https://img.shields.io/npm/v/@maxinedotdev/saga)

# Saga MCP Server

Saga is a local-first MCP server for document ingestion and semantic search.
It provides document, chunk, and code-block retrieval tools over MCP (stdio or HTTP stream).

## Requirements

- Node.js 22+
- npm 10+

## Install

### From npm

```bash
npm install -g @maxinedotdev/saga
```

### From source

```bash
git clone https://github.com/maxinedotdev/saga.git
cd saga
npm install
npm run build
```

## Server Setup

Create `~/.saga/saga.toml`:

```toml
[server]
transport = "httpStream"
base_dir = "~/.saga"

[server.http]
host = "127.0.0.1"
port = 8080
endpoint = "/mcp"
stateless = true

[env]
MCP_EMBEDDING_BASE_URL = "http://127.0.0.1:1234/v1"
MCP_EMBEDDING_MODEL = "llama-nemotron-embed-1b-v2"
```

Notes:
- `stateless = true` is recommended and avoids session/SSE stream churn.
- If you want stdio instead of HTTP, set `transport = "stdio"` and use `command` mode in your MCP client.

## Run

### Foreground

```bash
node dist/server.js --config ~/.saga/saga.toml
```

### Background service

macOS:
```bash
npm run service:install:mac
npm run service:status:mac
```

Linux (systemd user service):
```bash
npm run service:install:linux
npm run service:status:linux
```

Windows (run terminal as Administrator):
```bash
npm run service:install:windows
npm run service:status:windows
```

## MCP Client Config

### URL mode (HTTP stream)

Use:

```txt
http://127.0.0.1:8080/mcp
```

Kilo (`mcp_settings.json`):

```json
{
  "saga": {
    "type": "streamable-http",
    "url": "http://127.0.0.1:8080/mcp",
    "timeout": 600,
    "disabled": false
  }
}
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.saga]
enabled = true
url = "http://127.0.0.1:8080/mcp"
```

### Command mode (stdio)

```json
{
  "mcpServers": {
    "saga": {
      "command": "saga",
      "env": {
        "MCP_BASE_DIR": "~/.saga",
        "MCP_EMBEDDING_BASE_URL": "http://127.0.0.1:1234/v1",
        "MCP_EMBEDDING_MODEL": "llama-nemotron-embed-1b-v2"
      }
    }
  }
}
```

## Tools

- `add_document`
- `crawl_documentation`
- `search_documents`
- `get_document`
- `list_documents`
- `get_uploads_path`
- `process_uploads`
- `list_uploads_files`
- `delete_document`
- `delete_crawl_session`
- `get_context_window`
- `query`
- `search_code_blocks`
- `get_code_blocks`
- `search_documents_with_ai` (only registered when AI provider config is present)

## Key Config

Config source precedence:
1. Environment variables
2. TOML config (`MCP_CONFIG_TOML` or `SAGA_CONFIG_TOML`)
3. Defaults

Common variables:

- `MCP_BASE_DIR` (default `~/.saga`)
- `MCP_TRANSPORT` (`stdio` or `httpStream`)
- `MCP_HTTP_HOST` (default `127.0.0.1`)
- `MCP_HTTP_PORT` (default `8080`)
- `MCP_HTTP_ENDPOINT` (default `/mcp`)
- `MCP_HTTP_PUBLIC` (`true` binds to `0.0.0.0`)
- `MCP_HTTP_STATELESS` (default HTTP behavior is stateless; set `false` for session mode)
- `MCP_EMBEDDING_BASE_URL` (required)
- `MCP_EMBEDDING_MODEL`
- `MCP_AI_BASE_URL` (enables `search_documents_with_ai`)
- `MCP_AI_MODEL`
- `MCP_AI_API_KEY`

## Development

```bash
npm run dev
npm run build
npm run test
npm run test:unit
npm run test:integration
npm run test:benchmark
npm run test:coverage
npm run db:init
npm run db:drop
npm run db:benchmark
```

## Data Layout

By default Saga stores data under `~/.saga/`:

- `uploads/`
- `data/`
- `lancedb/`
- `logs/` (when `MCP_LOG_TO_FILE=true`)

## Troubleshooting

If logs show lines like `establishing new SSE stream for session ID ...`, Saga is running HTTP stream in stateful mode. Set `MCP_HTTP_STATELESS=true` (or `server.http.stateless = true` in TOML) and restart.

Saga does not automatically publish logs to a VS Code UI panel.
Use process stdout/stderr or service log files:
- macOS/Linux service scripts: `~/.saga/logs/saga-mcp.out.log` and `~/.saga/logs/saga-mcp.err.log`
- Foreground run: terminal output
- Optional file logging: set `MCP_LOG_TO_FILE=true` (writes under `~/.saga/logs/`)

## License

MIT
