/**
 * Vector Database Abstraction Layer
 * 
 * This module provides a unified interface for vector database operations
 * using LanceDB as the single, supported backend.
 */

export { LanceDBAdapter, createVectorDatabase } from './lance-db.js';
export { migrateFromJson } from './migrate.js';
export { LanceDBV1 } from './lance-db-v1.js';
