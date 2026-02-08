# Contributing to Saga

🎉 Thank you for your interest in contributing to Saga! This project aims to provide a robust, TypeScript-based Model Context Protocol server for document management and semantic search.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)
- [Release Process](#release-process)
- [Project Structure](#project-structure)

## Code of Conduct

This project follows a standard code of conduct. Please be respectful and constructive in all interactions. We're here to build something great together! 🚀

## Getting Started

### Prerequisites

- **Node.js** >= 22.0.0
- **npm** >= 10.0.0
- **Git** for version control
- Basic knowledge of TypeScript and the [Model Context Protocol](https://modelcontextprotocol.io/)

### Types of Contributions

We welcome various types of contributions:

- 🐛 **Bug fixes**
- ✨ **New features** 
- 📚 **Documentation improvements**
- 🎨 **Code quality improvements**
- 🔧 **Performance optimizations**
- 🧪 **Test additions**
- 🌐 **Embedding model support**
- 📄 **File format support** (beyond .txt, .md, .pdf)

## Development Setup

### 1. Fork & Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/saga.git
cd saga

# Add upstream remote
git remote add upstream https://github.com/maxinedotdev/saga.git
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Verify Setup

```bash
# Build the project
npm run build

# Run in development mode
npm run dev

# Test the inspector
npm run inspect
```

### 4. Environment Setup

Create a `.env` file for local development (optional):
```bash
MCP_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
```

## Development Workflow

### Daily Development

```bash
# Start development server with hot reload
npm run dev

# Build and test changes
npm run build

# Inspect MCP tools (opens web interface)
npm run inspect

# Run direct without FastMCP wrapper
npm run dev:direct
```

### Making Changes

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

2. **Make your changes** following our [code standards](#code-standards)

3. **Test your changes**:
   ```bash
   npm run build
   npm run inspect  # Test MCP functionality
   ```

4. **Commit with conventional commits**:
   ```bash
   git commit -m "feat: add PDF text extraction support"
   git commit -m "fix: resolve embedding model initialization error"
   git commit -m "docs: update README with new features"
   ```

## Code Standards

### TypeScript Guidelines

- **Strict mode**: Use TypeScript strict mode settings
- **Type safety**: Prefer explicit types over `any`
- **Interfaces**: Use interfaces for object shapes
- **Async/await**: Prefer async/await over Promises
- **Error handling**: Always handle errors appropriately

### Code Style

```typescript
// ✅ Good
interface DocumentMetadata {
    source: string;
    processedAt: string;
    fileExtension: string;
}

async function processDocument(content: string): Promise<Document> {
    try {
        const chunks = await this.createChunks(content);
        return { /* ... */ };
    } catch (error) {
        throw new Error(`Failed to process document: ${error.message}`);
    }
}

// ❌ Avoid
function processDoc(content: any) {
    // No error handling, no types
    const chunks = this.createChunks(content);
    return chunks;
}
```

### File Organization

- **Single responsibility**: One class/function per file when appropriate
- **Clear naming**: Use descriptive file and function names
- **Imports**: Group imports (external libraries, internal modules)
- **Exports**: Use named exports when possible

### Documentation

- **JSDoc comments** for public methods and classes
- **README updates** for new features
- **Inline comments** for complex logic
- **Type annotations** for better IDE support

## Testing

Currently, the project uses manual testing through the MCP inspector. We welcome contributions to improve our testing strategy:

### Manual Testing Checklist

- [ ] Document upload (.txt, .md, .pdf)
- [ ] Semantic search functionality
- [ ] Document listing and retrieval
- [ ] Error handling for malformed files
- [ ] Embedding model initialization
- [ ] Directory creation and permissions

### Future Testing Goals

- Unit tests for core functions
- Integration tests for MCP protocol
- Performance tests for large documents
- Automated testing in CI/CD

## Pull Request Process

### Before Submitting

1. **Sync with upstream**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Ensure build passes**:
   ```bash
   npm run build
   ```

3. **Test manually** using `npm run inspect`

4. **Update documentation** if needed

### PR Requirements

- **Clear title**: Use conventional commit format
- **Description**: Explain what, why, and how
- **Testing**: Describe how you tested the changes
- **Breaking changes**: Clearly mark any breaking changes
- **Screenshots**: Include for UI changes (inspector interface)

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring

## Testing
- [ ] Built successfully (`npm run build`)
- [ ] Tested with MCP inspector (`npm run inspect`)
- [ ] Manual testing performed
- [ ] No breaking changes (or clearly documented)

## Screenshots (if applicable)

## Additional Notes
```

## Issue Guidelines

### Bug Reports

Use this template for bug reports:

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Upload file type '...'
2. Run command '...'
3. See error

**Expected behavior**
What you expected to happen.

**Environment:**
- OS: [e.g. Windows 11, macOS 14, Ubuntu 22.04]
- Node.js version: [e.g. 22.0.0]
- Package version: [e.g. 1.4.0]

**Additional context**
Add any other context about the problem here.
```

### Feature Requests

```markdown
**Is your feature request related to a problem?**
A clear description of what the problem is.

**Describe the solution you'd like**
A clear description of what you want to happen.

**Describe alternatives you've considered**
Alternative solutions or features you've considered.

**Additional context**
Add any other context or screenshots about the feature request.
```

## Release Process

Saga uses a manual version bump with automated publishing via GitHub Actions
(npm trusted publishing).

### Commit Message Format

We follow [Conventional Commits](https://conventionalcommits.org/):

- `feat:` - New features (minor version bump)
- `fix:` - Bug fixes (patch version bump)
- `docs:` - Documentation changes
- `style:` - Code formatting changes
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Build process or auxiliary tool changes

### Breaking Changes

For breaking changes, add `BREAKING CHANGE:` in the commit body:

```bash
feat: change document storage format

BREAKING CHANGE: Document storage format has changed.
Existing documents need to be re-imported.
```

### Release Flow

1. Bump `package.json` and update `CHANGELOG.md` on `develop`.
2. Merge `develop` into `main`.
3. GitHub Actions runs unit tests only (no external AI dependencies).
4. GitHub Actions publishes to npm on every `main` push **when `package.json` changes**.
5. Optionally create a GitHub Release with notes.

## Project Structure

```
src/
├── server.ts              # Main MCP server implementation
├── document-manager.ts    # Document storage and retrieval
├── embedding-provider.ts  # AI embedding abstraction
├── search-engine.ts       # Semantic search functionality
├── types.ts              # TypeScript type definitions
├── utils.ts              # Utility functions
├── reranking/            # Reranking module
│   ├── index.ts          # Module exports
│   ├── config.ts         # Configuration management
│   └── api-reranker.ts   # API-based reranker implementation
├── embeddings/           # Embedding-related modules
├── indexing/             # Document indexing
└── vector-db/            # Vector database abstraction

.github/
├── workflows/            # CI/CD workflows
└── copilot-instructions.md

docs/
├── README.md
├── SECURITY.md
└── CONTRIBUTING.md (this file)
```

## Reranking Development

### Overview

Saga implements a two-stage retrieval system using API-based cross-encoder reranking to improve search result quality. The reranking feature is opt-out (enabled by default) and gracefully degrades to vector-only search on failures.

### Architecture

```
Query → Vector Search (Stage 1) → API Reranker (Stage 2) → Ranked Results
         ↓                        ↓
    Retrieve 5x candidates     Re-score with cross-encoder
```

### Key Components

- **`src/reranking/config.ts`**: Configuration management with environment variable loading
- **`src/reranking/api-reranker.ts`**: API-based reranker supporting multiple providers
- **`src/document-manager.ts`**: Integration of two-stage retrieval in query pipeline

### Supported Providers

1. **Cohere** (default): `rerank-multilingual-v3.0`
2. **Jina AI**: `jina-reranker-v1-base-en`
3. **OpenAI**: Custom models via OpenAI-compatible endpoints
4. **Custom**: Any OpenAI-compatible reranking API

### Configuration

```bash
# Enable/disable reranking (default: true)
MCP_RERANKING_ENABLED=true

# Provider selection (cohere, jina, openai, custom)
MCP_RERANKING_PROVIDER=cohere

# API key for the reranking service
MCP_RERANKING_API_KEY=your-api-key

# Model name
MCP_RERANKING_MODEL=rerank-multilingual-v3.0

# Base URL (for custom providers)
MCP_RERANKING_BASE_URL=https://api.cohere.ai/v1

# Maximum candidates for reranking (default: 50)
MCP_RERANKING_MAX_CANDIDATES=50

# Top K results to return (default: 10)
MCP_RERANKING_TOP_K=10

# Request timeout in ms (default: 30000)
MCP_RERANKING_TIMEOUT=30000
```

### Development Guidelines

#### Adding New Providers

To add a new reranking provider:

1. Update `RerankerProviderType` in `src/types.ts`
2. Add provider-specific logic in `src/reranking/api-reranker.ts`
3. Update configuration validation in `src/reranking/config.ts`
4. Add tests in `src/reranking/__tests__/reranker.test.ts`

#### Testing Reranking

```bash
# Run reranking-specific tests
npm test -- src/reranking/__tests__/

# Run performance benchmarks
npm test -- src/reranking/__tests__/performance.test.ts

# Test with real API (requires API key)
MCP_RERANKING_ENABLED=true MCP_RERANKING_API_KEY=your-key npm run inspect
```

#### Per-Query Override

Users can override reranking on a per-query basis:

```typescript
const results = await documentManager.query(query, {
    useReranking: false  // Disable reranking for this query
});
```

#### Error Handling

The reranking system implements graceful degradation:
- API failures fall back to vector-only search
- Timeouts are configurable and handled
- Invalid configurations are validated at startup
- Errors are logged but don't break the query pipeline

### Performance Considerations

- **Candidate Retrieval**: Retrieves 5x the requested results as candidates
- **API Latency**: Expect 100-500ms additional latency per query
- **Rate Limits**: Respect provider rate limits (Cohere: 1000 calls/min)
- **Cost**: API-based reranking has per-call costs

### Testing Strategy

1. **Unit Tests**: Test configuration, validation, and provider logic
2. **Integration Tests**: Test DocumentManager integration with mocked APIs
3. **Performance Tests**: Benchmark latency and throughput
4. **Manual Testing**: Test with real queries and API keys

### Future Enhancements

Potential areas for contribution:
- Local model support (e.g., using transformers.js)
- Caching layer for frequently reranked queries
- Batch reranking for multiple queries
- Custom scoring functions
- A/B testing framework for reranking models

### Key Components

- **FastMCP**: Framework for building MCP servers
- **pdf-ts**: PDF text extraction
- **Zod**: Runtime type validation

## Getting Help

- 📖 **Documentation**: Check the [README](README.md) first
- 🐛 **Issues**: [GitHub Issues](https://github.com/maxinedotdev/saga/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/maxinedotdev/saga/discussions)
- 📧 **Email**: [maxine@mcp.dev] for sensitive questions

## Recognition

Contributors will be recognized in:
- Release notes for their contributions
- GitHub contributors list
- Special thanks in major releases

---

**Happy Contributing!** 🎉

*Let's build an amazing Saga together!*
