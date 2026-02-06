#!/usr/bin/env bash
set -euo pipefail

LABEL="${SAGA_LAUNCHD_LABEL:-dev.maxinedot.saga-mcp}"
UID_VALUE="$(id -u)"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
URL="${SAGA_HTTP_URL:-http://127.0.0.1:8080/mcp}"

echo "Label: $LABEL"
echo "Plist: $PLIST_PATH"

if [[ -f "$PLIST_PATH" ]]; then
  echo "Plist exists: yes"
else
  echo "Plist exists: no"
fi

echo
echo "launchctl state:"
if launchctl print "gui/$UID_VALUE/$LABEL" >/tmp/saga-launchctl-status.txt 2>&1; then
  rg -n "state =|pid =" /tmp/saga-launchctl-status.txt || cat /tmp/saga-launchctl-status.txt
else
  cat /tmp/saga-launchctl-status.txt
fi

echo
echo "Saga processes:"
ps -Ao pid,ppid,%cpu,etime,command | rg "node .*saga.*/dist/server.js|dev.maxinedot.saga-mcp" | rg -v rg || true

echo
echo "Endpoint check: $URL"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$URL" || true
