#!/usr/bin/env bash
set -euo pipefail
PORT="${WORLDVIEW_PORT:-8788}"
LABEL="${WORLDVIEW_LABEL:-com.paperclip.worldview-collector}"
if ! curl --fail --silent --max-time 8 "http://127.0.0.1:${PORT}/health" >/dev/null; then
  logger -t worldview-watchdog "health failed; restarting ${LABEL}"
  launchctl kickstart -k "gui/$(id -u)/${LABEL}"
  exit 1
fi
