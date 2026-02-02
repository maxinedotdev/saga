/**
 * Diagnostic script to inspect old database schema
 * Run with: npx tsx tmp-saga-debug/inspect-old-schema.ts
 */

import * as lancedb from '@lancedb/lancedb';

async function inspectOldSchema() {
    const dbPath = process.env.MCP_BASE_DIR 
        ? `${process.env.MCP_BASE_DIR}/vector-db`
        : `${process.env.HOME}/.saga/vector-db`;
    
    console.log(`Connecting to database at: ${dbPath}`);
    
    const db = await lancedb.connect(dbPath);
    
    // Check if chunks table exists
    try {
        const chunksTable = await db.openTable('chunks');
        
        // Get schema
        const schema = await chunksTable.schema();
        console.log('\n=== CHUNKS TABLE SCHEMA ===');
        console.log(JSON.stringify(schema, null, 2));
        
        // Get first few rows to inspect data structure
        const chunks = await chunksTable.query().limit(5).toArray();
        console.log(`\n=== FIRST ${chunks.length} CHUNKS ===`);
        
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`\n--- Chunk ${i + 1} ---`);
            console.log(`ID: ${chunk.id}`);
            console.log(`Document ID: ${chunk.document_id}`);
            console.log(`Chunk Index: ${chunk.chunk_index}`);
            console.log(`Content Length: ${chunk.content?.length || 0}`);
            
            // Inspect embedding field structure
            console.log(`\nEmbedding field type: ${typeof chunk.embedding}`);
            console.log(`Embedding is array: ${Array.isArray(chunk.embedding)}`);
            console.log(`Embedding is null: ${chunk.embedding === null}`);
            console.log(`Embedding is undefined: ${chunk.embedding === undefined}`);
            
            if (chunk.embedding !== null && chunk.embedding !== undefined) {
                if (Array.isArray(chunk.embedding)) {
                    console.log(`Embedding array length: ${chunk.embedding.length}`);
                    console.log(`First 5 values: ${chunk.embedding.slice(0, 5)}`);
                } else if (typeof chunk.embedding === 'object') {
                    console.log(`Embedding object keys: ${Object.keys(chunk.embedding)}`);
                    console.log(`Embedding object:`, JSON.stringify(chunk.embedding, null, 2));
                } else {
                    console.log(`Embedding value: ${chunk.embedding}`);
                }
            }
            
            // Inspect metadata field
            if (chunk.metadata) {
                console.log(`\nMetadata keys: ${Object.keys(chunk.metadata)}`);
                console.log(`Metadata:`, JSON.stringify(chunk.metadata, null, 2));
            }
        }
        
        // Count total chunks
        const count = await chunksTable.countRows();
        console.log(`\nTotal chunks in table: ${count}`);
        
    } catch (error) {
        console.error('Error inspecting chunks table:', error);
    }
    
    await db.close();
}

inspectOldSchema().catch(console.error);
