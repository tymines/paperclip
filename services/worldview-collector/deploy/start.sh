#!/usr/bin/env bash
# Start the World View Collector on augibot2 (Box 2).
# Listens on 0.0.0.0:${WORLDVIEW_PORT:-8788} so Box 1 can read it over Tailscale.
set -euo pipefail
cd "$(dirname "$0")/.."
export WORLDVIEW_PORT="${WORLDVIEW_PORT:-8788}"
export WORLDVIEW_POLL_MS="${WORLDVIEW_POLL_MS:-300000}"
echo "[worldview-collector] node $(node -v); port ${WORLDVIEW_PORT}; poll ${WORLDVIEW_POLL_MS}ms"
exec node server.mjs
