# [1.0.1](https://github.com/maxinedotdev/saga/compare/v1.0.0...v1.0.1) (2026-02-04)

### Fixes

* Update README branding for npm listing and publishing workflow readiness.

# [1.0.0](https://github.com/maxinedotdev/saga/compare/v0.2.0...v1.0.0) (2026-02-02)

### Breaking Changes

* **Remove legacy components: Transformers.js, SearchEngine, and searchDocuments()**: Removed local transformer-based embedding support and legacy search components
  - **Removed components**:
    - `TransformersEmbeddingProvider` class (local embedding provider using @xenova/transformers)
    - `SimpleEmbeddingProvider` class (fallback hash-based embedding provider)
    - `SearchEngine` class (thin wrapper around DocumentManager)
    - `searchDocuments()` method (single-document vector search in DocumentManager)
    - `@xenova/transformers` dependency
  - **Migration required**: Users must configure an OpenAI-compatible embedding provider (LM Studio, synthetic.new, or any OpenAI-compatible API)
  - **Performance improvements**: Expected 100-500MB RAM reduction and 1-5 minute cold start improvement
  - **Configuration changes**:
    - `MCP_EMBEDDING_PROVIDER` now only accepts `openai` (removed `transformers` option)
    - `MCP_EMBEDDING_BASE_URL` is now required (must point to OpenAI-compatible API)
    - `MCP_EMBEDDING_MODEL` defaults to `text-embedding-llama-nemotron-embed-1b-v2@q4_k_s`
  - **Migration**: Saga v1 is migrationless. Delete legacy data and re-ingest.

* **Update default embedding model for OpenAI-compatible provider**: Changed from `text-embedding-nomic-embed-text-v1.5` to `text-embedding-llama-nemotron-embed-1b-v2@q4_k_s`
  - **Migration required**: Users with existing LM Studio setups must download the new model (`text-embedding-llama-nemotron-embed-1b-v2@q4_k_s`)
  - Users who have explicitly set `MCP_EMBEDDING_MODEL` are unaffected
  - See migration guide below for LM Studio download instructions

### Features

* **Multi-Provider Support for Embeddings and AI Search**: Add support for configuring multiple providers simultaneously with priority-based fallback
  - New `MCP_EMBEDDING_PROVIDERS` environment variable for multi-provider embedding configuration (JSON array format)
  - New `MCP_AI_PROVIDERS` environment variable for multi-provider AI search configuration (JSON array format)
  - `MultiEmbeddingProvider` class implements fallback logic across multiple embedding providers
  - `MultiAiSearchProvider` class implements fallback logic across multiple AI search providers
  - Provider health tracking with configurable failure thresholds (`MCP_PROVIDER_FAILURE_THRESHOLD`, default: 3)
  - Automatic recovery with configurable timeout (`MCP_PROVIDER_RECOVERY_TIMEOUT`, default: 300000ms = 5 minutes)
  - Full backward compatibility with existing single-provider configuration
  - Clear logging for provider selection and fallback events
  - Dimension validation to warn about mismatched embedding dimensions across providers

### Configuration Example

```bash
# Multi-provider embedding configuration (JSON format)
MCP_EMBEDDING_PROVIDERS='[
  {"provider": "openai", "priority": 1, "baseUrl": "http://127.0.0.1:1234", "model": "text-embedding-multilingual-e5-large-instruct"},
  {"provider": "openai", "priority": 2, "baseUrl": "https://api.openai.com/v1", "model": "text-embedding-3-small", "apiKey": "sk-..."}
]'

# Multi-provider AI search configuration (JSON format)
MCP_AI_PROVIDERS='[
  {"provider": "openai", "priority": 1, "baseUrl": "http://127.0.0.1:1234", "model": "ministral-3-8b-instruct-2512"},
  {"provider": "openai", "priority": 2, "baseUrl": "https://api.synthetic.new/openai/v1", "model": "glm-4.7", "apiKey": "sk-..."}
]'
```

### Embedding Model Notes

**For LM Studio users:**
1. Open LM Studio and go to the "Discover" tab
2. Search for `text-embedding-llama-nemotron-embed-1b-v2@q4_k_s`
3. Download the model (GGUF format recommended)
4. Load the model in LM Studio's embedding server
5. Restart your MCP client

### Dependencies

* upgrade zod from v3.25.64 to v4.3.6
  - No breaking changes in this upgrade
  - All tests pass successfully
  - Migration guide available at `openspec/changes/upgrade-zod-v4/migration-guide.md`

# [0.2.0](https://github.com/maxinedotdev/saga/compare/v0.1.0...v0.2.0) (2026-01-26)

### Breaking Changes

* **Remove Google Gemini AI provider support**: Removed all Gemini Cloud integration and dependencies
  - Removed `gemini-search-service.ts` and `gemini-file-mapping-service.ts`
  - Removed `@google/genai` dependency from package.json
  - Removed `GEMINI_API_KEY` and `MCP_AI_PROVIDER=gemini` environment variable options
  - Updated AI provider selection to only support OpenAI-compatible endpoints (LM Studio, synthetic.new)
  - This change enables fully local/offline workflows and simplifies the codebase

### Migration Instructions

If you were previously using Gemini AI, you must migrate to an OpenAI-compatible provider:

**For local AI (recommended):**
1. Install LM Studio: https://lmstudio.ai/
2. Start LM Studio and load a model
3. Set environment variables:
   ```
   MCP_AI_BASE_URL=http://127.0.0.1:1234
   MCP_AI_MODEL=ministral-3-8b-instruct-2512
   ```

**For remote AI:**
1. Set environment variables:
   ```
   MCP_AI_BASE_URL=https://api.synthetic.new/openai/v1
   MCP_AI_API_KEY=your-api-key-here
   ```

**Optional cleanup:**
If you previously used Gemini AI, you may want to clean up the orphaned runtime data file:
- Remove `~/.saga/data/gemini_file_mappings.json` (or your configured MCP_BASE_DIR)
- This file is no longer used and can be safely deleted to free up space

### Features

* add OpenAI-compatible AI search providers (LM Studio, synthetic.new) with configurable provider selection
* add OpenAI-compatible embeddings provider (LM Studio / remote) alongside Transformers.js
* add documentation crawler tools with crawl session deletion and robots/sitemap handling

### Bug Fixes

* expand `~` in MCP_BASE_DIR to the home directory

## [0.1.0](https://github.com/maxinedotdev/saga/compare/v0.0.0...v0.1.0) (2025-12-02)


### Features

* add configurable base directory via MCP_BASE_DIR env var ([eaa5cf8](https://github.com/maxinedotdev/saga/commit/eaa5cf84b8937793500daec46dde27dfdab92eda))

## [0.0.11](https://github.com/maxinedotdev/saga/compare/v0.0.10...v0.0.11) (2025-12-02)


### Bug Fixes

* upgrade fastmcp to v3.24.0 ([f4e14ba](https://github.com/maxinedotdev/saga/commit/f4e14babdad2a5bb3d44e9eaefb21e419c7b3aa9))

## [0.0.10](https://github.com/maxinedotdev/saga/compare/v0.0.9...v0.0.10) (2025-09-13)


### Bug Fixes

* **document-manager:** fix method add_document for creating document with md extension method documentation ([e704267](https://github.com/maxinedotdev/saga/commit/e704267536f126aa6d209bac90271a1d14ad5dba))
* **server:** add_document metadata parameters description adjusted ([52e19e4](https://github.com/maxinedotdev/saga/commit/52e19e4930621c3f2e75407ced23f9e1b5757de8))

## [0.0.9](https://github.com/maxinedotdev/saga/compare/v0.0.8...v0.0.9) (2025-09-11)


### Features

* **AI-Powered Document Intelligence**: Add Google Gemini AI integration for advanced document analysis
  - New `search_documents_with_ai` tool for natural language queries and intelligent summaries
  - Smart file mapping prevents re-uploading the same files to Gemini
  - Requires `GEMINI_API_KEY` environment variable (optional feature)

* **Intelligent File Management**: Enhanced file handling with copy-based storage
  - Files are now copied to data directory instead of moved, preserving originals in uploads
  - Complete deletion removes both JSON files and associated original files
  - Improved data safety and backup preservation

#### ⚠️ Important Notes

* **AI Compatibility**: Gemini AI analysis works only on documents imported with this version or later
* **File Preservation**: This version copies files from upload folder, ensuring originals remain available for AI analysis.
* **Migration**: Existing documents without original files in uploads folder cannot use AI features. If you want to use AI features on existing documents, you can re-upload them or copy in data folder renaming with the same name of the respective JSON with embeddings.
* **Optional Feature**: AI functionality requires `GEMINI_API_KEY` and doesn't affect core operations


* add file backup functionality during document upload ([db31495](https://github.com/maxinedotdev/saga/commit/db31495312f82edb2ee01c89ac7e14938df1a7a4))
* enhance document deletion to remove associated files and improve error handling ([b2fd308](https://github.com/maxinedotdev/saga/commit/b2fd3086f3b1db2652adf03fd5d874ee63736bcc))
* integrate Gemini AI for advanced document search ([34e0960](https://github.com/maxinedotdev/saga/commit/34e09600e46eb2061ef69b952bc821ef004b7a9b))

## [0.0.8](https://github.com/maxinedotdev/saga/compare/v0.0.7...v0.0.8) (2025-09-05)


### Bug Fixes

* **indexing:** avoid fs-extra ESM/CJS interop causing fs.readdir error ([ccd92e1](https://github.com/maxinedotdev/saga/commit/ccd92e164b63f6b116a20c5ddd8327844855511f)), closes [#8](https://github.com/maxinedotdev/saga/issues/8)

## [0.0.7](https://github.com/maxinedotdev/saga/compare/v0.0.6...v0.0.7) (2025-08-25)


### Features

* add readme to reflect the status of the server ([2f01eba](https://github.com/maxinedotdev/saga/commit/2f01eba015546a55bcf8968a8a9bb694982fb2d8))

## [0.0.6](https://github.com/maxinedotdev/saga/compare/v0.0.5...v0.0.6) (2025-08-25)


### Features

* Phase 1 (scalability) - O(1) DocumentIndex, LRU embedding cache, parallel chunking & streaming, closes [#7](https://github.com/maxinedotdev/saga/issues/7)

**Implement Phase 1 scalability improvements:**
- Adds `DocumentIndex` (O(1) lookup, deduplication, keyword index, persistence).
- Adds `EmbeddingCache` (LRU) to avoid recomputing embeddings.
- Updates chunker to support parallel chunking and batch processing.
- Adds streaming file reader to handle large files without loading entire content into memory.
- Integrates index/cache into the server and MCP tools (updated: process_uploads, search, get_context_window).
- Small changes to `embedding-provider` and `types` to leverage the cache.
- Updates `tsconfig.json` for stricter compilation settings.

Operational notes / migration:
- To warm the cache immediately: run `process_uploads`.
- Relevant environment variables:
  - MCP_INDEXING_ENABLED=true
  - MCP_CACHE_SIZE=1000
  - MCP_PARALLEL_ENABLED=true
  - MCP_MAX_WORKERS=4
  - MCP_STREAMING_ENABLED=true


Refs: PR [#7](https://github.com/maxinedotdev/saga/issues/7) (Implement Phase 1 Scalability Improvements)

## [0.0.5](https://github.com/maxinedotdev/saga/compare/v0.0.4...v0.0.5) (2025-08-23)


### Features

* Fix critical PDF vulnerability (CVE-2024-4139) by replacing pdf-ts with unpdf ([f28f93b](https://github.com/maxinedotdev/saga/commit/f28f93b4c26d25511055a449ecee241aeddb2a3b))

## [0.0.3](https://github.com/maxinedotdev/saga/compare/v1.6.0...v1.7.0) (2025-07-25)


### Features

* update all docs e and bugfixing ([c202ee5](https://github.com/maxinedotdev/saga/commit/c202ee5124563b8d4eeba0ddde07e3c4efc34358))

## [0.0.2](https://github.com/maxinedotdev/saga/compare/v1.5.1...v1.6.0) (2025-07-19)


### Bug Fixes

* add dotenv import to load environment variables from .env files ([b91f578](https://github.com/maxinedotdev/saga/commit/b91f5781bd3fe6d3c7bc89511d2560bb4fc37d3e))


### Features

* add get_context_window tool to retrieve surrounding chunks of a document ([c92f530](https://github.com/maxinedotdev/saga/commit/c92f530cf6dac48ab91bf6bc8358222ef6e54fe4))
* add getOnlyContentDocument method and get_context_window tool; enhance EmbeddingProvider with getDimensions ([f94746b](https://github.com/maxinedotdev/saga/commit/f94746bd1b2b6e8bdc63e8e3e0c0259c174dd50c))
* enhance embedding providers with model dimensions and lazy initialization ([d8b3321](https://github.com/maxinedotdev/saga/commit/d8b3321cac4a02fc60d3447ef94a91f5ebf7b975))
* enhance search_documents tool with truncation notice and context retrieval hint ([8750830](https://github.com/maxinedotdev/saga/commit/8750830b9f62ecc86f29d7b6bc73bc3ee93240a5))
* implement intelligent chunking for document processing ([d7dc3c9](https://github.com/maxinedotdev/saga/commit/d7dc3c94d246bc16beda982b19bbcace6772c46f))
* update README to enhance feature descriptions and add context window retrieval example ([77514d8](https://github.com/maxinedotdev/saga/commit/77514d8b312d5f297eda823711657deb6b20bc0c))

## [0.0.1](https://github.com/maxinedotdev/saga/compare/v1.5.0...v1.5.1) (2025-06-19)


### Bug Fixes

* update document search logic and improve error handling ([7397bcf](https://github.com/maxinedotdev/saga/commit/7397bcfe30c91541e94306caee7cc37771dc7c83))
* update search_documents tool to include query parameter for improved search functionality ([ddf4e1c](https://github.com/maxinedotdev/saga/commit/ddf4e1cc3e6ac4477408878fbbe6e4cd6918de8a))

## [0.0.0](https://github.com/maxinedotdev/saga/compare/v1.4.0...v1.5.0) (2025-06-16)


### Features

* increase content preview length in get_document tool ([7920c59](https://github.com/maxinedotdev/saga/commit/7920c595c82e5d2ba1d729363cae5d9868e6e3a6))

## [0.0.0](https://github.com/maxinedotdev/saga/compare/v1.3.0...v1.4.0) (2025-06-16)


### Features

* enhance file upload support and improve directory management in DocumentManager ([2d1a9c9](https://github.com/maxinedotdev/saga/commit/2d1a9c9cad2887c9fcfba57fb53c68ea9e6f1aa6))

## [0.0.0](https://github.com/maxinedotdev/saga/compare/v1.2.0...v1.3.0) (2025-06-16)


### Bug Fixes

* improve code readability by adding spacing in TransformersEmbeddingProvider ([40f8e14](https://github.com/maxinedotdev/saga/commit/40f8e1488af37db919310a23d2b1a37f09a2e23c))


### Features

* add PDF text extraction support ([1fa17d9](https://github.com/maxinedotdev/saga/commit/1fa17d9f8f8ee28bf69582b6377fbd9dac1da61e))

## [0.0.0](https://github.com/maxinedotdev/saga/compare/v1.1.1...v1.2.0) (2025-06-15)


### Features

* add comprehensive document deletion functionality and improve documentation ([00329c4](https://github.com/maxinedotdev/saga/commit/00329c4b147c3a47af30219b2055a71c7767c322))

## [0.0.0](https://github.com/maxinedotdev/saga/compare/v1.1.0...v1.1.1) (2025-06-15)


### Bug Fixes

* correct bin path in package.json for proper executable resolution ([d7674f4](https://github.com/maxinedotdev/saga/commit/d7674f413bc07e7abd8c24f2208b757f114f29fd))

## [0.0.0](https://github.com/maxinedotdev/saga/compare/v1.0.0...v1.1.0) (2025-06-15)


### Features

* add publishConfig to package.json for public access ([4602c1e](https://github.com/maxinedotdev/saga/commit/4602c1e6fa093a5605a2bcaa216c42c8beb1aed9))

# [0.0.0](2025-06-15)


### Bug Fixes

* update Node.js version in GitHub Actions workflow to 20 ([1a32615](https://github.com/maxinedotdev/saga/commit/1a3261527d3896555fead50461d6061ff04622d6))
* update workflow to handle test script and fix GitHub Actions configuration ([3c21a05](https://github.com/maxinedotdev/saga/commit/3c21a05c96a7c9ea82e640d27172251a166f7b56))


### Features

* Update package configuration and embedding model ([edf04bd](https://github.com/maxinedotdev/saga/commit/edf04bd73cde1bdaad961ea2db913e0f82764ca9))
