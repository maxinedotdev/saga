#!/usr/bin/env bash
set -euo pipefail

LABEL="${SAGA_SYSTEMD_LABEL:-dev.maxinedot.saga-mcp}"
SERVICE_NAME="${SAGA_SYSTEMD_SERVICE:-${LABEL}.service}"
URL="${SAGA_HTTP_URL:-http://127.0.0.1:8080/mcp}"

echo "Service: $SERVICE_NAME"
echo

echo "systemd state:"
systemctl --user --no-pager --full status "$SERVICE_NAME" || true

echo
echo "Saga processes:"
ps -Ao pid,ppid,%cpu,etime,command | rg "node .*saga.*/dist/server.js" | rg -v rg || true

echo
echo "Endpoint check: $URL"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$URL" || true
