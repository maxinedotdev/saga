#!/usr/bin/env python3
"""
MLX-based reranker using Jina Reranker V3 MLX
This script runs locally on Apple Silicon (M1/M2/M3) using the MLX framework.
"""

import sys
import json
import argparse
from pathlib import Path

try:
    import mlx.core as mx
    from mlx_lm import load, generate
except ImportError as e:
    print(json.dumps({"error": f"MLX dependencies not installed: {e}"}), file=sys.stderr)
    sys.exit(1)


def load_model(model_path: str):
    """Load the MLX reranker model."""
    try:
        # Try to load the model from the specified path
        # For Jina Reranker V3 MLX, we would typically use a specialized loading function
        # This is a placeholder - actual implementation depends on the model format
        model, tokenizer = load(model_path)
        return model, tokenizer
    except Exception as e:
        raise RuntimeError(f"Failed to load model from {model_path}: {e}")


def rerank_documents(query: str, documents: list, model_path: str, top_k: int = 10):
    """
    Rerank documents based on query relevance using MLX.
    
    Args:
        query: The search query
        documents: List of document strings to rerank
        model_path: Path to the MLX model
        top_k: Number of top results to return
    
    Returns:
        List of dictionaries with 'index' and 'score' keys
    """
    try:
        model, tokenizer = load_model(model_path)
        
        # For a proper reranker implementation, we would:
        # 1. Encode the query and documents
        # 2. Compute similarity scores
        # 3. Return top-k results with scores
        
        # Placeholder implementation using simple text similarity
        # In production, this would use the actual MLX reranker model
        results = []
        for idx, doc in enumerate(documents):
            # Simple similarity score (placeholder)
            # Real implementation would use the model's scoring mechanism
            query_words = set(query.lower().split())
            doc_words = set(doc.lower().split())
            overlap = len(query_words & doc_words)
            total = len(query_words | doc_words)
            score = overlap / total if total > 0 else 0.0
            
            results.append({
                "index": idx,
                "score": float(score)
            })
        
        # Sort by score descending and take top_k
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]
        
    except Exception as e:
        raise RuntimeError(f"Reranking failed: {e}")


def main():
    """Main entry point for the MLX reranker script."""
    parser = argparse.ArgumentParser(description="MLX-based document reranker")
    parser.add_argument("--query", required=True, help="Search query")
    parser.add_argument("--model", required=True, help="Path to MLX model")
    parser.add_argument("--top-k", type=int, default=10, help="Number of top results to return")
    parser.add_argument("--documents", required=True, help="JSON array of documents to rerank")
    
    args = parser.parse_args()
    
    try:
        # Parse documents from JSON
        documents = json.loads(args.documents)
        
        if not isinstance(documents, list):
            raise ValueError("Documents must be a JSON array")
        
        # Perform reranking
        results = rerank_documents(
            query=args.query,
            documents=documents,
            model_path=args.model,
            top_k=args.top_k
        )
        
        # Output results as JSON
        print(json.dumps({"results": results}))
        
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON in documents: {e}"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
