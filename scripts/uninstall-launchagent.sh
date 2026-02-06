#!/usr/bin/env bash
set -euo pipefail

LABEL="${SAGA_LAUNCHD_LABEL:-dev.maxinedot.saga-mcp}"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_VALUE="$(id -u)"

launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"

echo "Uninstalled LaunchAgent: $LABEL"
