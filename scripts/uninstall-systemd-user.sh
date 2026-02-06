#!/usr/bin/env bash
set -euo pipefail

LABEL="${SAGA_SYSTEMD_LABEL:-dev.maxinedot.saga-mcp}"
SERVICE_NAME="${SAGA_SYSTEMD_SERVICE:-${LABEL}.service}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/$SERVICE_NAME"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl --user daemon-reload || true
fi

rm -f "$UNIT_PATH"

echo "Uninstalled systemd user service: $SERVICE_NAME"
