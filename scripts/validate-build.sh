#!/usr/bin/env bash
# Standalone build validation script
# Usage: ./scripts/validate-build.sh [path/to/server.js]

set -euo pipefail

SERVER_JS="${1:-dist/server.js}"

REQUIRED_TOOLS=(
    "add_document"
    "query"
    "search_documents"
    "search_code_blocks"
    "get_document"
    "delete_document"
    "list_documents"
    "crawl_documentation"
    "delete_crawl_session"
    "process_uploads"
    "list_uploads_files"
    "get_code_blocks"
)

if [[ ! -f "$SERVER_JS" ]]; then
    echo "ERROR: File not found: $SERVER_JS" >&2
    exit 1
fi

echo "Validating $SERVER_JS..."
missing=0

for tool in "${REQUIRED_TOOLS[@]}"; do
    if grep -qE "name:\s*[\"']${tool}[\"']" "$SERVER_JS"; then
        echo "  ✓ $tool"
    else
        echo "  ✗ $tool" >&2
        ((missing++)) || true
    fi
done

if [[ $missing -gt 0 ]]; then
    echo ""
    echo "ERROR: $missing tool(s) missing from build" >&2
    exit 1
fi

echo ""
echo "Validation passed. All tools present."
exit 0
