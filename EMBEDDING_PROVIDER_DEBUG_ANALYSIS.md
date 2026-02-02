# Embedding Provider Singleton Cache Debug Analysis

## Problem Statement
The previous singleton caching fix for the qwen model respawning issue did not work. Multiple qwen models are still being spawned without proper utilization.

## Investigation Summary

### 5-7 Possible Sources Identified

1. **Multiple direct calls to `createLazyEmbeddingProvider()` in `server.ts`**
   - Line 133: In `initializeDocumentManager()` 
   - Line 283: In `search_documents` tool
   - Line 656: In `search_code_blocks` tool
   - Each call potentially creates a new cached instance

2. **Configuration comparison issue in singleton cache**
   - The `getCachedEmbeddingProvider()` function compares `parseMultiEmbeddingProviderConfig()` results
   - If this returns different objects each time (even with same content), the cache might not work

3. **Each `OpenAiEmbeddingProvider` creates its own `EmbeddingCache`**
   - Even if the provider is cached, each provider instance has its own cache
   - This could lead to multiple cache instances

4. **The `IntelligentChunker` might be creating separate providers**
   - The `DocumentManager` passes the embedding provider to `IntelligentChunker`
   - Need to verify if it's creating additional providers internally

5. **Vector database operations might create separate providers**
   - The `search_documents` and `search_code_blocks` tools create their own providers
   - These bypass the singleton cache or create multiple cached instances

6. **Module-level singleton cache might be reset**
   - If the module is reloaded or if there are multiple worker processes
   - The cache variables are module-level but could be reset

7. **The cache key comparison might be failing**
   - The `currentConfig` string comparison might not work as expected
   - JSON.stringify of objects might produce different strings for equivalent objects

### Most Likely Sources (Distilled to 1-2)

**Primary Issue: Multiple direct calls to `createLazyEmbeddingProvider()` in `server.ts`**

The `search_documents` (line 283) and `search_code_blocks` (line 656) tools create their own embedding providers instead of using the one from `documentManager`. This is the most likely cause because:
- These tools are called frequently during search operations
- Each call creates a new provider instance (even if cached, it's a separate cache entry)
- The `documentManager` already has an embedding provider that should be reused

**Secondary Issue: Each `OpenAiEmbeddingProvider` instance creates its own `EmbeddingCache`**

Even if the provider singleton works, each provider instance has its own cache, which means:
- Multiple providers = multiple caches
- Caches are not shared between providers
- This defeats the purpose of caching embeddings

## Logging Added

### 1. Enhanced `getCachedEmbeddingProvider()` logging
- Tracks call stack to see where it's being called from
- Logs configuration hash comparison
- Shows whether cached instance is being reused or new one created
- Tracks total provider creation count

### 2. `OpenAiEmbeddingProvider` instance tracking
- Each instance gets a unique ID
- Logs when new instances are created
- Shows model name and base URL for each instance

### 3. Server.ts call site logging
- Logs when embedding providers are created in `search_documents`
- Logs when embedding providers are created in `search_code_blocks`

## Next Steps

### Please run the server and perform the following actions:

1. **Start the server** and observe the logs
2. **Add a document** to see the initial provider creation
3. **Search for documents** to see if new providers are created
4. **Search for code blocks** to see if new providers are created
5. **Share the logs** showing:
   - All calls to `getCachedEmbeddingProvider()`
   - All `OpenAiEmbeddingProvider` instance creations
   - The call stacks showing where providers are being created

### What to look for in the logs:

✓ **If you see multiple "Creating NEW embedding provider instance" messages** with different call stacks, this confirms the primary issue

✓ **If you see multiple "Creating new instance: OpenAiEmbeddingProvider_*" messages** with different instance IDs, this confirms multiple providers are being created

✓ **If you see the same provider instance ID being reused**, the singleton cache is working but there might be other issues

## Expected Fix (After Diagnosis Confirmation)

Based on the logs, the fix will likely involve:

1. **Removing direct calls to `createLazyEmbeddingProvider()` in search tools**
   - Instead, use the embedding provider from `documentManager`
   - This ensures a single provider instance is used throughout

2. **Making the `EmbeddingCache` a true singleton**
   - Share a single cache instance across all `OpenAiEmbeddingProvider` instances
   - Or ensure only one provider instance is ever created

3. **Adding a getter method to `DocumentManager`**
   - Allow tools to access the existing embedding provider
   - Prevent creating new providers unnecessarily

## Files Modified

1. `src/embedding-provider.ts`
   - Enhanced `getCachedEmbeddingProvider()` with detailed logging
   - Added instance tracking to `OpenAiEmbeddingProvider`
   - Added provider creation counter

2. `src/server.ts`
   - Added logging for `search_documents` tool
   - Added logging for `search_code_blocks` tool

## Questions for User

1. Can you run the server and perform some search operations?
2. Can you share the logs showing the provider creation?
3. Are you seeing multiple qwen model processes being spawned?
4. What operations trigger the respawning (add document, search, etc.)?

Once we have the logs, I can confirm the diagnosis and implement the correct fix.
