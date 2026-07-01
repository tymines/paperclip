#!/bin/bash
# OpenClaw Gateway Wrapper — single-instance lock + temp cleanup + supervised launch
set -euo pipefail

LOCK_PORT=18789
LOG_DIR="$HOME/.openclaw/logs"
mkdir -p "$LOG_DIR"

# --- Single-instance lock via port check ---
if lsof -i :"$LOCK_PORT" -P 2>/dev/null | grep -q LISTEN; then
  existing_pid=$(lsof -i :"$LOCK_PORT" -P 2>/dev/null | awk '/LISTEN/{print $2}' | head -1)
  echo "[gateway-wrapper] Port $LOCK_PORT already in use by PID $existing_pid — exiting" >> "$LOG_DIR/gateway-wrapper.log"
  # If launchd restarts us, the old gateway should have been killed
  # But if it's still alive, check it
  if kill -0 "$existing_pid" 2>/dev/null; then
    echo "[gateway-wrapper] Existing gateway healthy, refusing duplicate" >> "$LOG_DIR/gateway-wrapper.log"
    exit 0
  fi
fi

# Proxy to the actual openclaw binary through the env wrapper
# (launchd handles restart via KeepAlive)
exec /Users/augi/.openclaw/service-env/ai.openclaw.gateway-env-wrapper.sh \
  /Users/augi/.openclaw/service-env/ai.openclaw.gateway.env \
  /opt/homebrew/opt/node/bin/node \
  /opt/homebrew/lib/node_modules/openclaw/dist/index.js \
  gateway --port 18789
