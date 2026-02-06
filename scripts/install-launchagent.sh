#!/usr/bin/env bash
set -euo pipefail

LABEL="${SAGA_LAUNCHD_LABEL:-dev.maxinedot.saga-mcp}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${SAGA_RUNTIME_DIR:-$REPO_DIR}"
NODE_BIN="${SAGA_NODE_BIN:-$(command -v node)}"
SERVER_JS="${SAGA_SERVER_JS:-$RUNTIME_DIR/dist/server.js}"
CONFIG_TOML="${SAGA_CONFIG_TOML:-$HOME/.saga/saga.toml}"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="${SAGA_LOG_DIR:-$HOME/.saga/logs}"
UID_VALUE="$(id -u)"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node binary not found or not executable: $NODE_BIN" >&2
  exit 1
fi

if [[ ! -f "$SERVER_JS" ]]; then
  echo "Saga server not found: $SERVER_JS" >&2
  echo "Build the runtime first (for example in saga-staging: npm run build)." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_TOML" ]]; then
  echo "Saga config not found: $CONFIG_TOML" >&2
  echo "Create it first (example in README)." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
      <string>$NODE_BIN</string>
      <string>$SERVER_JS</string>
      <string>--config</string>
      <string>$CONFIG_TOML</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$RUNTIME_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/saga-mcp.out.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/saga-mcp.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
  </dict>
</plist>
EOF

launchctl bootout "gui/$UID_VALUE" "$PLIST_PATH" >/dev/null 2>&1 || \
  launchctl bootout "gui/$UID_VALUE/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_VALUE" "$PLIST_PATH"
launchctl kickstart -k "gui/$UID_VALUE/$LABEL"

echo "Installed and started LaunchAgent: $LABEL"
echo "Plist: $PLIST_PATH"
echo "Logs:  $LOG_DIR/saga-mcp.out.log"
