/**
 * Vector Database Abstraction Layer
 * 
 * This module provides a unified interface for vector database operations,
 * allowing different implementations (LanceDB, in-memory, etc.) to be used
 * interchangeably.
 */

export { LanceDBAdapter, InMemoryVectorDB, createVectorDatabase } from './lance-db.js';
export { migrateFromJson } from './migrate.js';
