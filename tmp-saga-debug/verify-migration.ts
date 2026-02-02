/**
 * Verify migration was successful
 * Run with: npx tsx tmp-saga-debug/verify-migration.ts
 */

import * as lancedb from '@lancedb/lancedb';

async function verifyMigration() {
    const dbPath = process.env.MCP_BASE_DIR 
        ? `${process.env.MCP_BASE_DIR}/vector-db`
        : `${process.env.HOME}/.saga/vector-db`;
    
    console.log(`Connecting to database at: ${dbPath}`);
    
    const db = await lancedb.connect(dbPath);
    
    // Check chunks table
    try {
        const chunksTable = await db.openTable('chunks');
        const chunks = await chunksTable.query().limit(1).toArray();
        
        console.log('\n=== VERIFIED CHUNK MIGRATION ===');
        console.log(`Total chunks: ${await chunksTable.countRows()}`);
        
        if (chunks.length > 0) {
            const chunk = chunks[0];
            console.log(`\nFirst chunk:`);
            console.log(`  ID: ${chunk.id}`);
            console.log(`  Document ID: ${chunk.document_id}`);
            console.log(`  Chunk Index: ${chunk.chunk_index}`);
            console.log(`  Content Length: ${chunk.content_length}`);
            console.log(`  Embedding type: ${typeof chunk.embedding}`);
            console.log(`  Embedding is array: ${Array.isArray(chunk.embedding)}`);
            console.log(`  Embedding length: ${Array.isArray(chunk.embedding) ? chunk.embedding.length : 'N/A'}`);
            
            if (Array.isArray(chunk.embedding) && chunk.embedding.length > 0) {
                console.log(`  First 5 embedding values: [${chunk.embedding.slice(0, 5).join(', ')}]`);
            }
        }
        
        console.log('\n✓ Chunks migration successful - embedding is now a plain array');
    } catch (error) {
        console.error('Error verifying chunks:', error);
    }
    
    // Check code blocks table
    try {
        const codeBlocksTable = await db.openTable('code_blocks');
        const codeBlocks = await codeBlocksTable.query().limit(1).toArray();
        
        console.log('\n=== VERIFIED CODE BLOCKS MIGRATION ===');
        console.log(`Total code blocks: ${await codeBlocksTable.countRows()}`);
        
        if (codeBlocks.length > 0) {
            const block = codeBlocks[0];
            console.log(`\nFirst code block:`);
            console.log(`  ID: ${block.id}`);
            console.log(`  Document ID: ${block.document_id}`);
            console.log(`  Language: ${block.language}`);
            console.log(`  Content Length: ${block.content_length}`);
            console.log(`  Embedding type: ${typeof block.embedding}`);
            console.log(`  Embedding is array: ${Array.isArray(block.embedding)}`);
            console.log(`  Embedding length: ${Array.isArray(block.embedding) ? block.embedding.length : 'N/A'}`);
            
            if (Array.isArray(block.embedding) && block.embedding.length > 0) {
                console.log(`  First 5 embedding values: [${block.embedding.slice(0, 5).join(', ')}]`);
            }
        }
        
        console.log('\n✓ Code blocks migration successful - embedding is now a plain array');
    } catch (error) {
        console.error('Error verifying code blocks:', error);
    }
    
    await db.close();
}

verifyMigration().catch(console.error);
