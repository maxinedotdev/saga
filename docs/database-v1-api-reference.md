# Saga v1.0.0 Database API Reference

Complete API reference for the LanceDBV1 class, including all public methods, parameters, usage examples, error handling patterns, and best practices.

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Constructor](#constructor)
- [Initialization](#initialization)
- [Document Operations](#document-operations)
- [Chunk Operations](#chunk-operations)
- [Code Block Operations](#code-block-operations)
- [Query Operations](#query-operations)
- [Search Operations](#search-operations)
- [Database Management](#database-management)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)
- [Type Definitions](#type-definitions)

---

## Overview

The [`LanceDBV1`](../src/vector-db/lance-db-v1.ts:116) class provides a complete database interface for the Saga v1.0.0 schema with:

- Flattened metadata
- Normalized tables
- LanceDB as single source of truth
- Dynamic IVF_PQ indexes
- Comprehensive scalar indexes
- Transaction-based writes with retry logic

### Key Features

- **Type-safe**: Full TypeScript support with defined interfaces
- **Performant**: <100ms query latency targets
- **Scalable**: Dynamic indexing that scales with dataset size
- **Reliable**: Transaction-based writes with automatic retry
- **Flexible**: Comprehensive query options with filters

---

## Getting Started

### Installation

```typescript
import { LanceDBV1 } from './src/vector-db/lance-db-v1.js';
```

### Basic Usage

```typescript
// Create database instance
const db = new LanceDBV1('~/.saga/lancedb', {
    embeddingDim: 2048
});

// Initialize database
await db.initialize();

// Perform operations
const documentId = await db.addDocument({
    title: 'My Document',
    content_hash: 'abc123',
    content_length: 1000,
    source: 'upload',
    original_filename: 'doc.txt',
    file_extension: 'txt',
    crawl_id: null,
    crawl_url: null,
    author: 'John Doe',
    description: 'A sample document',
    content_type: 'documentation',
    chunks_count: 5,
    code_blocks_count: 2,
    status: 'active'
});

// Query database
const results = await db.queryByVector(embedding, {
    limit: 10,
    include_metadata: true
});

// Close connection
await db.close();
```

---

## Constructor

### `new LanceDBV1(dbPath, options)`

Creates a new LanceDBV1 instance.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `dbPath` | `string` | Yes | - | Path to the LanceDB database directory |
| `options` | `object` | No | `{}` | Configuration options |
| `options.embeddingDim` | `number` | No | `2048` | Embedding vector dimension |

#### Example

```typescript
// Default configuration
const db = new LanceDBV1('~/.saga/lancedb');

// Custom embedding dimension
const db = new LanceDBV1('~/.saga/lancedb', {
    embeddingDim: 768  // For smaller models
});

// Custom path
const db = new LanceDBV1('/custom/path/to/database');
```

#### Notes

- The `dbPath` directory will be created if it doesn't exist
- `embeddingDim` should match your embedding model's output dimension
- Common values: 2048 (llama-nemotron-embed-1b-v2), 1536 (OpenAI), 768 (BERT), 384 (smaller models)

---

## Initialization

### `initialize()`

Initializes the database connection and schema. Creates tables and indexes if they don't exist.

#### Returns

`Promise<void>`

#### Throws

- `Error` - If database initialization fails

#### Example

```typescript
const db = new LanceDBV1('~/.saga/lancedb');

try {
    await db.initialize();
    console.log('Database initialized successfully');
} catch (error) {
    console.error('Failed to initialize database:', error);
}
```

#### Behavior

- Creates all required tables if they don't exist
- Creates scalar indexes on all tables
- Creates vector indexes if data exists
- Safe to call multiple times (idempotent)

#### Notes

- Must be called before any other database operations
- Automatically handles table creation and index setup
- Logs progress during initialization

---

### `isInitialized()`

Checks if the database has been initialized.

#### Returns

`boolean` - `true` if initialized, `false` otherwise

#### Example

```typescript
const db = new LanceDBV1('~/.saga/lancedb');

if (!db.isInitialized()) {
    await db.initialize();
}
```

---

### `close()`

Closes the database connection and releases resources.

#### Returns

`Promise<void>`

#### Example

```typescript
try {
    await db.close();
    console.log('Database connection closed');
} catch (error) {
    console.error('Error closing database:', error);
}
```

#### Notes

- Should be called when done using the database
- Safe to call multiple times
- Automatically called on process exit in most cases

---

## Document Operations

### `addDocument(doc)`

Adds a document to the database.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `doc` | `Omit<DocumentV1, 'id' \| 'created_at' \| 'updated_at' \| 'processed_at'>` | Yes | Document data (auto-generated fields omitted) |

#### Returns

`Promise<string>` - The document ID (UUID v4)

#### Throws

- `Error` - If database not initialized
- `Error` - If document addition fails (with retry logic)

#### Example

```typescript
const documentId = await db.addDocument({
    title: 'TypeScript Best Practices',
    content_hash: 'a1b2c3d4e5f6a7b8',
    content_length: 15234,
    source: 'upload',
    original_filename: 'typescript-guide.md',
    file_extension: 'md',
    crawl_id: null,
    crawl_url: null,
    author: 'John Doe',
    description: 'Comprehensive guide to TypeScript',
    content_type: 'documentation',
    chunks_count: 45,
    code_blocks_count: 12,
    status: 'active'
});

console.log('Document added with ID:', documentId);
```

#### Auto-Generated Fields

The following fields are automatically generated:

- `id` - UUID v4
- `created_at` - Current ISO 8601 timestamp
- `updated_at` - Current ISO 8601 timestamp
- `processed_at` - Current ISO 8601 timestamp

#### Retry Logic

- Automatically retries on commit conflicts (up to 5 times)
- Uses exponential backoff (100ms base, max 5s)
- Logs retry attempts

---

### `getDocument(documentId)`

Retrieves a document by ID.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | `string` | Yes | Document ID to retrieve |

#### Returns

`Promise<DocumentV1 \| null>` - Document data or `null` if not found

#### Throws

- `Error` - If database not initialized
- `Error` - If query fails

#### Example

```typescript
const document = await db.getDocument('550e8400-e29b-41d4-a716-446655440000');

if (document) {
    console.log('Title:', document.title);
    console.log('Author:', document.author);
    console.log('Chunks:', document.chunks_count);
} else {
    console.log('Document not found');
}
```

---

### `deleteDocument(documentId)`

Deletes a document and all related data (chunks, code blocks, tags, languages, keywords).

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | `string` | Yes | Document ID to delete |

#### Returns

`Promise<void>`

#### Throws

- `Error` - If database not initialized
- `Error` - If deletion fails (with retry logic)

#### Example

```typescript
try {
    await db.deleteDocument('550e8400-e29b-41d4-a716-446655440000');
    console.log('Document deleted successfully');
} catch (error) {
    console.error('Failed to delete document:', error);
}
```

#### Behavior

- Deletes all chunks for the document
- Deletes all code blocks for the document
- Deletes all tag relationships
- Deletes all language relationships
- Deletes all keyword entries
- Finally deletes the document itself

#### Retry Logic

- Automatically retries on commit conflicts (up to 5 times)
- Uses exponential backoff (100ms base, max 5s)

---

## Chunk Operations

### `addChunks(chunks, batchSize)`

Adds chunks to the database in batches.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chunks` | `Omit<ChunkV1, 'id' \| 'created_at'>[]` | Yes | - | Array of chunks to add |
| `batchSize` | `number` | No | `1000` | Batch size for insertion |

#### Returns

`Promise<void>`

#### Throws

- `Error` - If database not initialized
- `Error` - If chunk addition fails (with retry logic)

#### Example

```typescript
const chunks = [
    {
        document_id: '550e8400-e29b-41d4-a716-446655440000',
        chunk_index: 0,
        start_position: 0,
        end_position: 512,
        content: 'TypeScript is a strongly typed programming language...',
        content_length: 512,
        embedding: [0.1, 0.2, 0.3, ...],
        surrounding_context: 'Introduction to TypeScript...',
        semantic_topic: 'programming languages'
    },
    {
        document_id: '550e8400-e29b-41d4-a716-446655440000',
        chunk_index: 1,
        start_position: 512,
        end_position: 1024,
        content: 'It adds optional static typing to JavaScript...',
        content_length: 512,
        embedding: [0.2, 0.3, 0.4, ...],
        surrounding_context: null,
        semantic_topic: null
    }
];

await db.addChunks(chunks, 1000);
console.log('Chunks added successfully');
```

#### Auto-Generated Fields

The following fields are automatically generated for each chunk:

- `id` - UUID v4
- `created_at` - Current ISO 8601 timestamp

#### Batch Processing

- Chunks are inserted in batches of `batchSize` (default: 1000)
- Progress is logged for each batch
- Larger batches are more efficient but use more memory

#### Retry Logic

- Automatically retries on commit conflicts (up to 5 times)
- Uses exponential backoff (100ms base, max 5s)

---

### `queryByDocumentId(documentId)`

Retrieves all chunks for a document.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | `string` | Yes | Document ID to query |

#### Returns

`Promise<ChunkV1[]>` - Array of chunks, sorted by `chunk_index`

#### Throws

- `Error` - If database not initialized
- `Error` - If query fails

#### Example

```typescript
const chunks = await db.queryByDocumentId('550e8400-e29b-41d4-a716-446655440000');

console.log(`Found ${chunks.length} chunks`);
for (const chunk of chunks) {
    console.log(`Chunk ${chunk.chunk_index}: ${chunk.content.substring(0, 50)}...`);
}
```

#### Behavior

- Returns all chunks for the specified document
- Chunks are sorted by `chunk_index` in ascending order
- Includes all chunk metadata and embeddings

---

## Code Block Operations

### `addCodeBlocks(blocks, batchSize)`

Adds code blocks to the database in batches.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `blocks` | `Omit<CodeBlockV1, 'id' \| 'created_at'>[]` | Yes | - | Array of code blocks to add |
| `batchSize` | `number` | No | `1000` | Batch size for insertion |

#### Returns

`Promise<void>`

#### Throws

- `Error` - If database not initialized
- `Error` - If code block addition fails (with retry logic)

#### Example

```typescript
const codeBlocks = [
    {
        document_id: '550e8400-e29b-41d4-a716-446655440000',
        block_id: 'code-001',
        block_index: 0,
        language: 'typescript',
        content: 'interface User {\n  name: string;\n  age: number;\n}',
        content_length: 45,
        embedding: [0.2, 0.3, 0.4, ...],
        source_url: 'https://example.com/code'
    },
    {
        document_id: '550e8400-e29b-41d4-a716-446655440000',
        block_id: 'code-002',
        block_index: 1,
        language: 'typescript',
        content: 'function greet(name: string): string {\n  return `Hello, ${name}!`;\n}',
        content_length: 65,
        embedding: [0.3, 0.4, 0.5, ...],
        source_url: null
    }
];

await db.addCodeBlocks(codeBlocks, 1000);
console.log('Code blocks added successfully');
```

#### Auto-Generated Fields

The following fields are automatically generated for each code block:

- `id` - UUID v4
- `created_at` - Current ISO 8601 timestamp

#### Batch Processing

- Code blocks are inserted in batches of `batchSize` (default: 1000)
- Progress is logged for each batch
- Larger batches are more efficient but use more memory

#### Retry Logic

- Automatically retries on commit conflicts (up to 5 times)
- Uses exponential backoff (100ms base, max 5s)

---

## Query Operations

### `queryByVector(embedding, options)`

Queries the database by vector embedding with optional filters.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `embedding` | `number[]` | Yes | - | Query vector embedding |
| `options` | `QueryOptionsV1` | No | `{}` | Query options |

#### QueryOptionsV1

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `limit` | `number` | `10` | Maximum number of results |
| `offset` | `number` | `0` | Offset for pagination |
| `include_metadata` | `boolean` | `true` | Include document metadata |
| `filters` | `MetadataFilterV1` | `{}` | Metadata filters |
| `useReranking` | `boolean` | `false` | Use reranking (if available) |

#### MetadataFilterV1

| Property | Type | Description |
|----------|------|-------------|
| `tags` | `string[]` | Filter by tags |
| `languages` | `string[]` | Filter by languages |
| `source` | `('upload' \| 'crawl' \| 'api')[]` | Filter by source type |
| `crawl_id` | `string` | Filter by crawl session ID |
| `author` | `string` | Filter by author |
| `content_type` | `string` | Filter by content type |
| `status` | `('active' \| 'archived' \| 'deleted')[]` | Filter by status |
| `created_after` | `string` | Filter by creation date (ISO 8601) |
| `created_before` | `string` | Filter by creation date (ISO 8601) |
| `updated_after` | `string` | Filter by update date (ISO 8601) |
| `updated_before` | `string` | Filter by update date (ISO 8601) |

#### Returns

`Promise<QueryResponseV1>` - Query results with pagination

#### Throws

- `Error` - If database not initialized
- `Error` - If query fails

#### Example

```typescript
// Basic vector search
const results = await db.queryByVector(embedding, {
    limit: 10,
    include_metadata: true
});

console.log('Results:', results.results);
console.log('Pagination:', results.pagination);

// Vector search with filters
const filteredResults = await db.queryByVector(embedding, {
    limit: 10,
    filters: {
        tags: ['typescript', 'react'],
        languages: ['en'],
        source: ['upload'],
        status: ['active']
    },
    include_metadata: true
});

// Vector search with date filters
const dateFilteredResults = await db.queryByVector(embedding, {
    limit: 10,
    filters: {
        created_after: '2026-01-01T00:00:00.000Z',
        created_before: '2026-02-01T00:00:00.000Z'
    }
});

// Paginated query
const page1 = await db.queryByVector(embedding, {
    limit: 10,
    offset: 0
});

const page2 = await db.queryByVector(embedding, {
    limit: 10,
    offset: 10
});
```

#### QueryResponseV1

```typescript
interface QueryResponseV1 {
    results: QueryResultV1[];
    pagination: QueryPaginationV1;
}

interface QueryResultV1 {
    document_id: string;
    title: string;
    score: number;
    chunk?: {
        id: string;
        content: string;
        chunk_index: number;
    };
    metadata?: DocumentMetadataV1;
}

interface QueryPaginationV1 {
    total_documents: number;
    returned: number;
    has_more: boolean;
    next_offset: number | null;
}
```

#### Scoring

- Scores are normalized to 0-1 range
- Higher scores indicate better matches
- Scores are calculated from cosine distance: `(2 - distance) / 2`

---

## Search Operations

### `queryByTags(tags)`

Searches for documents by tags.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tags` | `string[]` | Yes | Array of tags to search for |

#### Returns

`Promise<string[]>` - Array of document IDs

#### Throws

- `Error` - If database not initialized
- `Error` - If query fails

#### Example

```typescript
const documentIds = await db.queryByTags(['typescript', 'react']);

console.log(`Found ${documentIds.length} documents with tags`);
for (const docId of documentIds) {
    const doc = await db.getDocument(docId);
    console.log(`- ${doc?.title}`);
}
```

#### Behavior

- Returns documents that have ANY of the specified tags
- Tags are case-insensitive (lowercased)
- Returns unique document IDs

---

### `queryByKeywords(keywords)`

Searches for documents by keywords using the inverted index.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `keywords` | `string[]` | Yes | Array of keywords to search for |

#### Returns

`Promise<Array<{ document_id: string; score: number }>>` - Array of document IDs with scores

#### Throws

- `Error` - If database not initialized
- `Error` - If query fails

#### Example

```typescript
const keywordResults = await db.queryByKeywords(['typescript', 'interface', 'type']);

console.log('Keyword search results:');
for (const result of keywordResults) {
    console.log(`Document ${result.document_id}: score ${result.score}`);
}
```

#### Behavior

- Returns documents matching ANY of the keywords
- Scores are aggregated by keyword frequency
- Results are sorted by score (highest first)
- Keywords are case-insensitive (lowercased)

---

## Database Management

### `getStats()`

Retrieves database statistics.

#### Returns

`Promise<DatabaseStats>` - Database statistics

#### Throws

- `Error` - If database not initialized
- `Error` - If query fails

#### Example

```typescript
const stats = await db.getStats();

console.log('Schema version:', stats.schemaVersion);
console.log('Documents:', stats.documentCount);
console.log('Chunks:', stats.chunkCount);
console.log('Code blocks:', stats.codeBlockCount);
console.log('Tags:', stats.tagCount);
console.log('Languages:', stats.languageCount);
console.log('Keywords:', stats.keywordCount);
console.log('Vector indexes:', stats.indexes.vector);
console.log('Scalar indexes:', stats.indexes.scalar);
```

#### DatabaseStats

```typescript
interface DatabaseStats {
    schemaVersion: string;
    documentCount: number;
    chunkCount: number;
    codeBlockCount: number;
    tagCount: number;
    languageCount: number;
    keywordCount: number;
    storageUsage: {
        documents: number;
        chunks: number;
        codeBlocks: number;
        keywords: number;
        total: number;
    };
    indexes: {
        vector: string[];
        scalar: string[];
    };
}
```

---

## Error Handling

### Error Types

The database can throw various errors:

#### Initialization Errors

```typescript
try {
    await db.initialize();
} catch (error) {
    if (error.message.includes('LanceDB v1.0.0 initialization failed')) {
        console.error('Database initialization failed');
        // Handle initialization error
    }
}
```

#### Query Errors

```typescript
try {
    const results = await db.queryByVector(embedding, { limit: 10 });
} catch (error) {
    if (error.message.includes('Vector query failed')) {
        console.error('Query failed');
        // Handle query error
    }
}
```

#### Write Errors

```typescript
try {
    await db.addDocument(doc);
} catch (error) {
    if (error.message.includes('commit conflict')) {
        console.error('Write conflict - will retry automatically');
        // Retry logic is built-in
    } else {
        console.error('Write failed:', error);
        // Handle other write errors
    }
}
```

### Retry Logic

Write operations (`addDocument`, `addChunks`, `addCodeBlocks`, `deleteDocument`) include automatic retry logic:

- **Max retries**: 5
- **Base delay**: 100ms
- **Max delay**: 5s
- **Backoff**: Exponential
- **Condition**: Commit conflicts only

### Best Practices

#### 1. Always Initialize First

```typescript
const db = new LanceDBV1('~/.saga/lancedb');
await db.initialize();  // Always call before other operations
```

#### 2. Handle Errors Gracefully

```typescript
try {
    const results = await db.queryByVector(embedding);
} catch (error) {
    console.error('Query failed:', error);
    // Fallback or retry logic
}
```

#### 3. Use Appropriate Batch Sizes

```typescript
// For large inserts, use batch sizes of 1000-2000
await db.addChunks(largeChunkArray, 1000);
await db.addCodeBlocks(largeBlockArray, 1000);
```

#### 4. Close Connections When Done

```typescript
try {
    // Use database
    await db.queryByVector(embedding);
} finally {
    await db.close();
}
```

#### 5. Use Pagination for Large Results

```typescript
// Don't fetch all results at once
const results = await db.queryByVector(embedding, {
    limit: 10,
    offset: 0
});
```

#### 6. Leverage Filters

```typescript
// Always filter when possible to reduce result set
const results = await db.queryByVector(embedding, {
    filters: {
        tags: ['typescript'],
        status: ['active']
    }
});
```

#### 7. Check Initialization Status

```typescript
if (!db.isInitialized()) {
    await db.initialize();
}
```

---

## Best Practices

### Performance Optimization

#### 1. Use Scalar Indexes

Always filter by indexed columns when possible:

```typescript
// Good - uses scalar indexes
const results = await db.queryByVector(embedding, {
    filters: {
        document_id: 'specific-id',  // Indexed
        status: 'active'             // Indexed
    }
});

// Avoid - non-indexed filters
const results = await db.queryByVector(embedding, {
    filters: {
        author: 'John Doe'  // Not indexed
    }
});
```

#### 2. Minimize Metadata Fetching

```typescript
// Faster - no metadata
const results = await db.queryByVector(embedding, {
    limit: 10,
    include_metadata: false
});

// Slower - includes metadata
const results = await db.queryByVector(embedding, {
    limit: 10,
    include_metadata: true
});
```

#### 3. Use Appropriate Limits

```typescript
// Good - reasonable limit
const results = await db.queryByVector(embedding, { limit: 10 });

// Avoid - too large
const results = await db.queryByVector(embedding, { limit: 1000 });
```

### Data Integrity

#### 1. Use Content Hash for Deduplication

```typescript
import * as crypto from 'crypto';

function calculateContentHash(content: string): string {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return hash.substring(0, 16);
}

const contentHash = calculateContentHash(documentContent);
```

#### 2. Normalize Tags and Languages

```typescript
// Tags should be lowercase
const tags = ['typescript', 'react', 'best-practices'].map(t => t.toLowerCase());

// Languages should be ISO 639-1 codes
const languages = ['en', 'no', 'de'];
```

#### 3. Use ISO 8601 Timestamps

```typescript
const timestamp = new Date().toISOString();
// Example: "2026-02-02T10:00:00.000Z"
```

### Memory Management

#### 1. Process Large Datasets in Batches

```typescript
const allChunks = [...]; // Large array

for (let i = 0; i < allChunks.length; i += 1000) {
    const batch = allChunks.slice(i, i + 1000);
    await db.addChunks(batch, 1000);
}
```

#### 2. Close Connections When Done

```typescript
const db = new LanceDBV1('~/.saga/lancedb');
try {
    await db.initialize();
    // Use database
} finally {
    await db.close();
}
```

### Query Optimization

#### 1. Combine Filters

```typescript
// Good - single query with multiple filters
const results = await db.queryByVector(embedding, {
    filters: {
        tags: ['typescript'],
        languages: ['en'],
        status: ['active']
    }
});

// Avoid - multiple queries
const tagResults = await db.queryByTags(['typescript']);
const langResults = await db.queryByVector(embedding, {
    filters: { languages: ['en'] }
});
// Then combine results manually
```

#### 2. Use Specific Filters

```typescript
// Good - specific filter
const results = await db.queryByVector(embedding, {
    filters: {
        document_id: 'specific-id'
    }
});

// Avoid - broad filter
const results = await db.queryByVector(embedding, {
    filters: {
        status: ['active']  // Returns all active documents
    }
});
```

---

## Type Definitions

### DocumentV1

```typescript
interface DocumentV1 {
    id: string;
    title: string;
    content_hash: string;
    content_length: number;
    source: 'upload' | 'crawl' | 'api';
    original_filename: string | null;
    file_extension: string | null;
    crawl_id: string | null;
    crawl_url: string | null;
    author: string | null;
    description: string | null;
    content_type: string | null;
    created_at: string;
    updated_at: string;
    processed_at: string;
    chunks_count: number;
    code_blocks_count: number;
    status: 'active' | 'archived' | 'deleted';
}
```

### ChunkV1

```typescript
interface ChunkV1 {
    id: string;
    document_id: string;
    chunk_index: number;
    start_position: number;
    end_position: number;
    content: string;
    content_length: number;
    embedding: number[];
    surrounding_context: string | null;
    semantic_topic: string | null;
    created_at: string;
}
```

### CodeBlockV1

```typescript
interface CodeBlockV1 {
    id: string;
    document_id: string;
    block_id: string;
    block_index: number;
    language: string;
    content: string;
    content_length: number;
    embedding: number[];
    source_url: string | null;
    created_at: string;
}
```

### QueryOptionsV1

```typescript
interface QueryOptionsV1 {
    limit?: number;
    offset?: number;
    include_metadata?: boolean;
    filters?: MetadataFilterV1;
    useReranking?: boolean;
}
```

### MetadataFilterV1

```typescript
interface MetadataFilterV1 {
    tags?: string[];
    languages?: string[];
    source?: ('upload' | 'crawl' | 'api')[];
    crawl_id?: string;
    author?: string;
    content_type?: string;
    status?: ('active' | 'archived' | 'deleted')[];
    created_after?: string;
    created_before?: string;
    updated_after?: string;
    updated_before?: string;
}
```

### QueryResponseV1

```typescript
interface QueryResponseV1 {
    results: QueryResultV1[];
    pagination: QueryPaginationV1;
}
```

### QueryResultV1

```typescript
interface QueryResultV1 {
    document_id: string;
    title: string;
    score: number;
    chunk?: {
        id: string;
        content: string;
        chunk_index: number;
    };
    metadata?: DocumentMetadataV1;
}
```

### DocumentMetadataV1

```typescript
interface DocumentMetadataV1 {
    author: string | null;
    description: string | null;
    content_type: string | null;
    source: 'upload' | 'crawl' | 'api';
    tags: string[];
    languages: string[];
    created_at: string;
    updated_at: string;
    chunks_count: number;
    code_blocks_count: number;
}
```

### QueryPaginationV1

```typescript
interface QueryPaginationV1 {
    total_documents: number;
    returned: number;
    has_more: boolean;
    next_offset: number | null;
}
```

### DatabaseStats

```typescript
interface DatabaseStats {
    schemaVersion: string;
    documentCount: number;
    chunkCount: number;
    codeBlockCount: number;
    tagCount: number;
    languageCount: number;
    keywordCount: number;
    storageUsage: {
        documents: number;
        chunks: number;
        codeBlocks: number;
        keywords: number;
        total: number;
    };
    indexes: {
        vector: string[];
        scalar: string[];
    };
}
```

---

## Additional Resources

- [Schema Reference](./database-v1-schema-reference.md) - Complete schema documentation
- [Design Document](../plans/database-schema-v1-design.md) - Detailed design rationale
- [Type Definitions](../src/types/database-v1.ts) - TypeScript type definitions

---

**Last Updated**: 2026-02-02
**Schema Version**: 1.0.0
