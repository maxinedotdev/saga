#!/usr/bin/env bash
set -euo pipefail

LABEL="${SAGA_SYSTEMD_LABEL:-dev.maxinedot.saga-mcp}"
SERVICE_NAME="${SAGA_SYSTEMD_SERVICE:-${LABEL}.service}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${SAGA_RUNTIME_DIR:-$REPO_DIR}"
NODE_BIN="${SAGA_NODE_BIN:-$(command -v node)}"
SERVER_JS="${SAGA_SERVER_JS:-$RUNTIME_DIR/dist/server.js}"
CONFIG_TOML="${SAGA_CONFIG_TOML:-$HOME/.saga/saga.toml}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/$SERVICE_NAME"
LOG_DIR="${SAGA_LOG_DIR:-$HOME/.saga/logs}"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found. This script requires systemd." >&2
  exit 1
fi

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node binary not found or not executable: $NODE_BIN" >&2
  exit 1
fi

if [[ ! -f "$SERVER_JS" ]]; then
  echo "Saga server not found: $SERVER_JS" >&2
  echo "Build the runtime first (for example: npm run build)." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_TOML" ]]; then
  echo "Saga config not found: $CONFIG_TOML" >&2
  echo "Create it first (example in README)." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR" "$LOG_DIR"

cat > "$UNIT_PATH" <<EOF_UNIT
[Unit]
Description=Saga MCP single-instance server
After=network.target

[Service]
Type=simple
ExecStart=$NODE_BIN $SERVER_JS --config $CONFIG_TOML
WorkingDirectory=$RUNTIME_DIR
Restart=always
RestartSec=2
Environment=PATH=/usr/local/bin:/usr/bin:/bin
StandardOutput=append:$LOG_DIR/saga-mcp.out.log
StandardError=append:$LOG_DIR/saga-mcp.err.log

[Install]
WantedBy=default.target
EOF_UNIT

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

echo "Installed and started systemd user service: $SERVICE_NAME"
echo "Unit: $UNIT_PATH"
echo "Logs: $LOG_DIR/saga-mcp.out.log"
