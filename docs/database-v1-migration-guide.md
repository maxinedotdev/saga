# Saga v1.0.0 Database Migration Guide

This guide provides comprehensive instructions for migrating from the legacy database schema to the new Saga v1.0.0 schema with flattened metadata, normalized tables, and LanceDB as the single source of truth.

## Table of Contents

- [Overview](#overview)
- [What's New in v1.0.0](#whats-new-in-v100)
- [Migration Prerequisites](#migration-prerequisites)
- [Migration Strategies](#migration-strategies)
- [Step-by-Step Migration](#step-by-step-migration)
- [Common Migration Scenarios](#common-migration-scenarios)
- [Troubleshooting](#troubleshooting)
- [Rollback Procedures](#rollback-procedures)
- [Post-Migration Tasks](#post-migration-tasks)

---

## Overview

### Migration Goals

The v1.0.0 migration addresses critical scalability and performance issues in the legacy schema:

| Issue | Legacy Schema | v1.0.0 Schema |
|-------|--------------|---------------|
| Data duplication | JSON + LanceDB + in-memory | LanceDB only |
| Index creation bottlenecks | Fixed IVF_PQ params | Dynamic IVF_PQ scaling |
| Schema inference | Dynamic metadata struct | Flattened, type-safe columns |
| Lock management | File-based locks | LanceDB transactions |
| Scalar indexes | Missing on chunks table | Comprehensive scalar indexes |
| Memory usage | All indexes in memory | Optional LRU caching |

### Key Improvements

- **Single Source of Truth**: LanceDB is the only persistent storage
- **Flattened Metadata**: Type-safe columns instead of dynamic structs
- **Normalized Tables**: Proper relationships for tags and languages
- **Dynamic Indexing**: IVF_PQ parameters scale with dataset size
- **Better Performance**: <100ms query latency targets

---

## What's New in v1.0.0

### Schema Changes

#### New Tables

```typescript
// documents - Document metadata (replaces JSON files)
interface DocumentV1 {
    id: string;
    title: string;
    content_hash: string;           // SHA-256 for deduplication
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

// document_tags - Many-to-many tag relationships
interface DocumentTagV1 {
    id: string;
    document_id: string;
    tag: string;
    is_generated: boolean;
    created_at: string;
}

// document_languages - Many-to-many language relationships
interface DocumentLanguageV1 {
    id: string;
    document_id: string;
    language_code: string;          // ISO 639-1
    created_at: string;
}

// keywords - Inverted index for keyword search
interface KeywordV1 {
    id: string;
    keyword: string;
    document_id: string;
    source: 'title' | 'content';
    frequency: number;
    created_at: string;
}

// schema_version - Migration tracking
interface SchemaVersionV1 {
    id: number;
    version: string;
    applied_at: string;
    description: string;
}
```

#### Modified Tables

```typescript
// chunks - Flattened metadata
interface ChunkV1 {
    id: string;
    document_id: string;
    chunk_index: number;
    start_position: number;
    end_position: number;
    content: string;
    content_length: number;
    embedding: number[];
    surrounding_context: string | null;    // Was in metadata
    semantic_topic: string | null;         // Was in metadata
    created_at: string;
}

// code_blocks - Flattened metadata
interface CodeBlockV1 {
    id: string;
    document_id: string;
    block_id: string;
    block_index: number;
    language: string;
    content: string;
    content_length: number;
    embedding: number[];
    source_url: string | null;            // Was in metadata
    created_at: string;
}
```

### Index Changes

#### Scalar Indexes (New)

| Table | Columns | Purpose |
|-------|---------|---------|
| `documents` | `id`, `content_hash`, `source`, `crawl_id`, `status`, `created_at` | Fast lookups and filtering |
| `chunks` | `document_id`, `chunk_index`, `created_at` | Document queries and ordering |
| `code_blocks` | `document_id`, `block_index`, `language`, `created_at` | Language filtering and ordering |
| `document_tags` | `document_id`, `tag` | Tag-based queries |
| `document_languages` | `document_id`, `language_code` | Language filtering |
| `keywords` | `keyword`, `document_id` | Keyword search |

#### Vector Indexes (Improved)

```typescript
// Dynamic IVF_PQ configuration
function calculateIVF_PQ_Params(vectorCount: number, embeddingDim: number) {
    return {
        type: 'ivf_pq',
        metricType: 'cosine',
        num_partitions: Math.min(2048, Math.max(16, Math.floor(Math.sqrt(vectorCount)))),
        num_sub_vectors: Math.min(256, Math.max(4, Math.floor(embeddingDim / 16)))
    };
}
```

| Vector Count | num_partitions | num_sub_vectors | Build Time |
|--------------|----------------|-----------------|------------|
| < 10K | 100 | 8 | < 30s |
| 10K - 100K | 316 | 16 | < 2 min |
| 100K - 1M | 1,000 | 32 | < 5 min |
| 1M - 10M | 3,162 | 64 | < 15 min |

---

## Migration Prerequisites

### System Requirements

- **Node.js**: v18 or higher
- **Disk Space**: 3x current database size (for backup and migration)
- **Memory**: 4GB minimum (8GB recommended for large datasets)
- **Time**: Allow 30 minutes for every 100K documents

### Pre-Migration Checklist

- [ ] Backup existing database
- [ ] Stop all applications using the database
- [ ] Verify disk space availability
- [ ] Document current schema version
- [ ] Test migration on a copy (recommended)
- [ ] Prepare rollback plan

### Backup Procedure

```bash
# Create timestamped backup
BACKUP_DIR="~/.saga/vector-db.backup.$(date +%Y%m%d_%H%M%S)"
cp -r ~/.saga/vector-db "$BACKUP_DIR"

# Verify backup
ls -lh "$BACKUP_DIR"

# Note the backup location for rollback
echo "Backup location: $BACKUP_DIR"
```

---

## Migration Strategies

### Strategy 1: Automated Migration (Recommended)

Use the provided migration script for a complete, automated migration.

```bash
# Run migration with backup
node dist/scripts/migrate-to-v1.ts --backup --verbose

# Run migration with custom batch size
node dist/scripts/migrate-to-v1.ts --batch-size 500 --verbose

# Dry run to test without changes
node dist/scripts/migrate-to-v1.ts --dry-run --verbose
```

### Strategy 2: Manual Migration

For complete control over the migration process, use the migration utilities directly.

```typescript
import { migrateToV1 } from './src/vector-db/migrate-v1.js';

const result = await migrateToV1('~/.saga/vector-db', {
    batchSize: 1000,
    progressTracking: true,
    rollbackOnFailure: false,
    dryRun: false,
    createIndexes: true,
    validateAfterMigration: true
});

console.log('Migration result:', result);
```

### Strategy 3: Fresh Installation

For new installations or complete resets, initialize a fresh v1.0.0 database.

```bash
# Initialize fresh v1.0.0 database
node dist/scripts/init-db-v1.ts --force --verbose
```

---

## Step-by-Step Migration

### Phase 1: Preparation

#### 1.1 Stop Applications

```bash
# Stop any MCP servers or applications using the database
# Example: Stop VS Code or restart MCP server
```

#### 1.2 Create Backup

```bash
# Create backup
node dist/scripts/migrate-to-v1.ts --backup --dry-run
```

#### 1.3 Verify Database State

```bash
# Check database size
du -sh ~/.saga/vector-db

# Check current schema (if version tracking exists)
node dist/scripts/db-status.ts
```

### Phase 2: Migration

#### 2.1 Run Migration Script

```bash
# Full migration with backup
node dist/scripts/migrate-to-v1.ts \
    --backup \
    --batch-size 1000 \
    --verbose \
    --log migration.log
```

#### 2.2 Monitor Progress

The migration script provides real-time progress:

```
╔══════════════════════════════════════════════════════════╗
║  Saga v1.0.0 Database Migration                          ║
╚══════════════════════════════════════════════════════════╝

Database: /Users/user/.saga/vector-db
Size: 1.2 GB

Migration options:
  • Batch size: 1000
  • Validation: enabled
  • Index creation: enabled
  • Dry run: no

Starting migration...

[INFO] Creating v1.0.0 schema...
[INFO] Created documents table
[INFO] Created document_tags table
[INFO] Created document_languages table
[INFO] Created chunks table
[INFO] Created code_blocks table
[INFO] Created keywords table
[INFO] Created schema_version table

[INFO] Migrating documents table...
[INFO] Found 1,234 unique documents to migrate
[INFO] Migrated 1000/1234 documents
[INFO] Migrated 1234/1234 documents
[INFO] Documents migration complete: 1234 documents

[INFO] Migrating chunks table...
[INFO] Found 45,678 chunks to migrate
[INFO] Migrated 1000/45678 chunks
[INFO] Migrated 2000/45678 chunks
...
[INFO] Chunks migration complete: 45678 chunks

[INFO] Migrating code_blocks table...
[INFO] Found 2,345 code blocks to migrate
[INFO] Code blocks migration complete: 2345 code blocks

[INFO] Building keyword index...
[INFO] Processing 1234 documents for keywords
[INFO] Added 50000 keywords to index
[INFO] Keyword index build complete: 52345 keywords

[INFO] Creating scalar indexes...
[INFO] Created scalar indexes on documents table
[INFO] Created scalar indexes on chunks table
[INFO] Created scalar indexes on code_blocks table
[INFO] Created scalar indexes on document_tags table
[INFO] Created scalar indexes on document_languages table
[INFO] Created scalar indexes on keywords table

[INFO] Creating vector indexes for 45678 vectors...
[INFO] IVF_PQ config: partitions=213, sub_vectors=96
[INFO] Created vector index on chunks table
[INFO] Created vector index on code_blocks table

[INFO] Recording schema version: 1.0.0
[INFO] Schema version 1.0.0 recorded successfully

[INFO] Validating migration...
[INFO] Migration validation passed

═══════════════════════════════════════════════════════════
✓ Migration completed successfully!
═══════════════════════════════════════════════════════════

Duration: 8m 32s

Migration statistics:
  • Documents migrated: 1,234
  • Chunks migrated: 45,678
  • Code blocks migrated: 2,345
  • Tags migrated: 3,456
  • Languages migrated: 1,234
  • Keywords created: 52,345

Backup location: /Users/user/.saga/vector-db.backup.20260202_134258
  You can remove this backup after verifying the migration:
  rm -rf /Users/user/.saga/vector-db.backup.20260202_134258

Schema version: 1.0.0
```

#### 2.3 Validate Migration

```bash
# Check database status
node dist/scripts/db-status.ts

# Verify schema version
# Should show version: 1.0.0
```

### Phase 3: Verification

#### 3.1 Run Validation Tests

```bash
# Run integration tests
npm run test:integration

# Run migration tests
npm run test:unit -- src/__tests__/migration.test.ts
```

#### 3.2 Test Queries

```typescript
import { LanceDBV1 } from './src/vector-db/lance-db-v1.js';

const db = new LanceDBV1('~/.saga/vector-db');
await db.initialize();

// Test vector search
const results = await db.queryByVector(embedding, { limit: 10 });
console.log('Vector search results:', results.results.length);

// Test document retrieval
const doc = await db.getDocument(documentId);
console.log('Document found:', !!doc);

// Test tag filtering
const tagResults = await db.queryByTags(['typescript']);
console.log('Tag results:', tagResults.length);

// Test keyword search
const keywordResults = await db.queryByKeywords(['vector', 'database']);
console.log('Keyword results:', keywordResults.length);

await db.close();
```

#### 3.3 Performance Benchmarks

```bash
# Run performance benchmarks
npm run test:benchmark
```

Expected performance targets:

| Metric | Target |
|--------|--------|
| Vector search (top-10) | < 100ms |
| Scalar filter (document_id) | < 10ms |
| Tag filter query | < 50ms |
| Keyword search | < 75ms |
| Combined query | < 150ms |

### Phase 4: Cleanup

#### 4.1 Archive Old Data

```bash
# Move old JSON files to archive (if they exist)
mkdir -p ~/.saga/archive/old-schema
mv ~/.saga/data/*.json ~/.saga/archive/old-schema/

# Keep backup for rollback period (e.g., 30 days)
# After verification, you can remove the backup:
# rm -rf ~/.saga/vector-db.backup.*
```

#### 4.2 Update Application Code

Update any code that references the old schema:

```typescript
// OLD: Access metadata from dynamic struct
const metadata = chunk.metadata;
const tags = metadata.tags;
const languages = metadata.languages;

// NEW: Access from normalized tables
const tags = await db.queryByTags(['tag1', 'tag2']);
const languages = await db.queryByLanguages(['en', 'no']);
```

---

## Common Migration Scenarios

### Scenario 1: Fresh Installation

**Use case**: New installation, no existing data

```bash
# Initialize fresh v1.0.0 database
node dist/scripts/init-db-v1.ts --verbose

# Verify initialization
node dist/scripts/db-status.ts
```

### Scenario 2: Small Dataset (< 10K documents)

**Use case**: Quick migration with minimal downtime

```bash
# Run migration with default settings
node dist/scripts/migrate-to-v1.ts --backup --verbose

# Expected time: < 5 minutes
```

### Scenario 3: Large Dataset (> 100K documents)

**Use case**: Large dataset requiring optimized migration

```bash
# Run migration with larger batch size
node dist/scripts/migrate-to-v1.ts \
    --backup \
    --batch-size 2000 \
    --skip-indexes \
    --verbose

# After migration, create indexes separately
node dist/scripts/init-db-v1.ts --db-path ~/.saga/vector-db --verbose
```

### Scenario 4: Migration with Validation Disabled

**Use case**: Quick migration when validation is not critical

```bash
# Run migration without validation
node dist/scripts/migrate-to-v1.ts \
    --backup \
    --skip-validation \
    --verbose
```

### Scenario 5: Test Migration (Dry Run)

**Use case**: Test migration without making changes

```bash
# Dry run to test migration
node dist/scripts/migrate-to-v1.ts \
    --dry-run \
    --verbose

# Review output, then run actual migration
node dist/scripts/migrate-to-v1.ts --backup --verbose
```

---

## Troubleshooting

### Common Issues

#### Issue 1: Migration Fails with "Table not found"

**Symptom**: Migration fails with error about missing tables

**Cause**: Old schema doesn't have expected tables

**Solution**:

```bash
# Check what tables exist
ls -la ~/.saga/vector-db/

# If chunks table is missing, you may need to re-index
# or initialize a fresh database
node dist/scripts/init-db-v1.ts --force --verbose
```

#### Issue 2: Vector Index Creation Times Out

**Symptom**: Migration hangs during vector index creation

**Cause**: Large dataset or insufficient resources

**Solution**:

```bash
# Skip index creation during migration
node dist/scripts/migrate-to-v1.ts \
    --backup \
    --skip-indexes \
    --verbose

# Create indexes separately with more time
# Or use a machine with more resources
```

#### Issue 3: Memory Exhausted During Migration

**Symptom**: Migration fails with out-of-memory error

**Cause**: Processing too many documents at once

**Solution**:

```bash
# Reduce batch size
node dist/scripts/migrate-to-v1.ts \
    --backup \
    --batch-size 500 \
    --verbose
```

#### Issue 4: Validation Fails

**Symptom**: Migration completes but validation fails

**Cause**: Data inconsistency between old and new schemas

**Solution**:

```bash
# Check validation logs
cat migration.log | grep -i error

# Re-run migration with verbose logging
node dist/scripts/migrate-to-v1.ts \
    --backup \
    --verbose \
    --log migration-detailed.log
```

#### Issue 5: Backup Creation Fails

**Symptom**: Migration fails to create backup

**Cause**: Insufficient disk space or permissions

**Solution**:

```bash
# Check disk space
df -h ~/.saga

# Check permissions
ls -ld ~/.saga

# Create backup manually
cp -r ~/.saga/vector-db ~/.saga/vector-db.backup.manual

# Then run migration without --backup flag
node dist/scripts/migrate-to-v1.ts --verbose
```

### Debug Mode

Enable debug logging for detailed troubleshooting:

```bash
# Set debug environment variable
export DEBUG=saga:*
export MCP_VERBOSE_TESTS=true

# Run migration with verbose output
node dist/scripts/migrate-to-v1.ts --verbose --log debug.log
```

---

## Rollback Procedures

### Automatic Rollback

If migration fails with `rollbackOnFailure: true`, the migration script will automatically restore from backup.

### Manual Rollback

#### Step 1: Stop Applications

```bash
# Stop all applications using the database
```

#### Step 2: Restore from Backup

```bash
# Find the most recent backup
ls -lht ~/.saga/vector-db.backup.* | head -1

# Restore from backup
BACKUP_PATH="~/.saga/vector-db.backup.20260202_134258"
rm -rf ~/.saga/vector-db
cp -r "$BACKUP_PATH" ~/.saga/vector-db
```

#### Step 3: Verify Restoration

```bash
# Check database status
node dist/scripts/db-status.ts

# Run tests to verify
npm run test:integration
```

#### Step 4: Restart Applications

```bash
# Restart MCP server or applications
```

### Rollback Verification

After rollback, verify:

- [ ] Database tables match old schema
- [ ] Document counts match pre-migration
- [ ] Queries return expected results
- [ ] No data corruption detected

---

## Post-Migration Tasks

### Task 1: Update Application Code

Update code to use new schema:

```typescript
// OLD: Access metadata from chunks
const metadata = chunk.metadata;
const tags = metadata.tags;

// NEW: Query from normalized tables
const db = new LanceDBV1('~/.saga/vector-db');
await db.initialize();

// Get document with tags and languages
const doc = await db.getDocument(documentId);
const tags = await db.queryByTags(['tag1']);
const languages = await db.queryByLanguages(['en']);
```

### Task 2: Update Queries

Update query patterns:

```typescript
// OLD: Filter by metadata
const results = await db.queryByVector(embedding, {
    filters: {
        metadata: {
            tags: ['typescript'],
            languages: ['en']
        }
    }
});

// NEW: Use new filter structure
const results = await db.queryByVector(embedding, {
    filters: {
        tags: ['typescript'],
        languages: ['en'],
        source: ['upload'],
        status: ['active']
    }
});
```

### Task 3: Monitor Performance

Monitor key metrics:

```bash
# Check database stats
node dist/scripts/db-status.ts

# Run performance benchmarks
npm run test:benchmark

# Monitor memory usage
node --max-old-space-size=4096 dist/server.js
```

### Task 4: Clean Up

After successful migration and verification:

```bash
# Remove old JSON files (if they exist)
rm -rf ~/.saga/archive/old-schema

# Remove backup after 30 days (optional)
rm -rf ~/.saga/vector-db.backup.*
```

### Task 5: Update Documentation

Update any documentation that references the old schema:

- Update schema diagrams
- Update query examples
- Update API documentation
- Update troubleshooting guides

---

## Additional Resources

- [Schema Reference](./database-v1-schema-reference.md) - Complete schema documentation
- [API Reference](./database-v1-api-reference.md) - LanceDBV1 API documentation
- [Design Document](../plans/database-schema-v1-design.md) - Detailed design rationale
- [Type Definitions](../src/types/database-v1.ts) - TypeScript type definitions

---

## Support

If you encounter issues during migration:

1. Check the [troubleshooting section](#troubleshooting)
2. Review migration logs (`migration.log`)
3. Enable debug logging for detailed output
4. Check the [GitHub Issues](https://github.com/maxinedotdev/saga/issues)

---

**Last Updated**: 2026-02-02
**Schema Version**: 1.0.0
