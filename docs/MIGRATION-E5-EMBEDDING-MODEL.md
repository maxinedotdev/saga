# Migration Guide: E5 Embedding Model

## Overview

The default embedding model for the OpenAI-compatible provider has been updated from `text-embedding-nomic-embed-text-v1.5` to `text-embedding-multilingual-e5-large-instruct`.

## Why the Change?

The E5 model provides significant improvements:

- **Better multilingual support**: Supports 100+ languages with strong cross-lingual retrieval performance
- **Superior performance**: Consistently outperforms Nomic embeddings on standard benchmarks (MTEB, BEIR)
- **Instruction-tuned**: Understands task instructions for better zero-shot performance
- **Industry adoption**: Widely used in production systems for semantic search and RAG applications

## Migration Steps

### For LM Studio Users

1. **Open LM Studio** and navigate to the "Discover" tab
2. **Search for** `text-embedding-multilingual-e5-large-instruct`
3. **Download the model** (GGUF format recommended for local use)
4. **Load the model** in LM Studio's embedding server
5. **Restart your MCP client** to apply the changes

### Option: Keep Using the Old Model

If you prefer to continue using the Nomic embedding model, set this environment variable explicitly:

```bash
MCP_EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
```

Or in your MCP configuration:

```json
{
  "mcpServers": {
    "saga": {
      "command": "saga",
      "env": {
        "MCP_BASE_DIR": "~/.saga",
        "MCP_EMBEDDING_PROVIDER": "openai",
        "MCP_EMBEDDING_BASE_URL": "http://127.0.0.1:1234",
        "MCP_EMBEDDING_MODEL": "text-embedding-nomic-embed-text-v1.5"
      }
    }
  }
}
```

## Verifying the Change

To verify which model is being used, check the MCP server logs. When using the default, you should see the E5 model name in embedding requests.

You can also test the embedding endpoint directly:

```bash
curl http://127.0.0.1:1234/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": ["test"], "model": "text-embedding-multilingual-e5-large-instruct"}'
```

## Troubleshooting

### Model Not Found Error

If you see errors like:
```
OpenAI-compatible embeddings request failed: model not found
```

**Solution**: Ensure the E5 model is downloaded and loaded in LM Studio before starting the MCP server.

### Dimension Mismatch

If you have existing documents indexed with the old model, you may need to reindex them for optimal search performance with the new model.

**To reindex**:
1. Clear the LanceDB data: `rm -rf ~/.saga/lancedb/`
2. Re-add your documents using `process_uploads` or `add_document`

## Backward Compatibility

- Users with **explicit** `MCP_EMBEDDING_MODEL` settings are **unaffected**
- The change only affects users using the **default** model with LM Studio
- All existing functionality remains compatible
