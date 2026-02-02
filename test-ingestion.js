#!/usr/bin/env node

import { DocumentManager } from './dist/document-manager.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('Testing ingestion with symlink support...\n');
  
  const manager = new DocumentManager();
  
  console.log('Uploads directory:', manager.uploadsDir);
  
  try {
    const result = await manager.processUploadsFolder();
    console.log('\n=== Ingestion Results ===');
    console.log('Files processed:', result.filesProcessed);
    console.log('Documents added:', result.documentsAdded);
    console.log('Chunks created:', result.chunksCreated);
    console.log('Code blocks extracted:', result.codeBlocksExtracted);
    console.log('Errors:', result.errors);
  } catch (error) {
    console.error('Error during ingestion:', error);
  }
}

main().catch(console.error);
