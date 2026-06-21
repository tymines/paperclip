#!/bin/bash
# Paperclip server watchdog
# Pings health endpoint; kickstarts the server after 2 consecutive failures.
# Intended as a launchctl periodic timer (every 2 minutes).

HEALTH_URL="http://127.0.0.1:3100/api/companies"
LABEL="com.paperclip.server"
FAILURE_FILE="/tmp/paperclip-watchdog-failures"
MAX_FAILURES=2

# Atomic concurrency guard
LOCKDIR="/tmp/paperclip-watchdog.lock"
mkdir "$LOCKDIR" 2>/dev/null || exit 0
trap 'rmdir "$LOCKDIR"' EXIT

code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null)

if [ "$code" = "200" ]; then
  rm -f "$FAILURE_FILE"
  exit 0
fi

# Read previous failure count
failures=$(cat "$FAILURE_FILE" 2>/dev/null || echo 0)
failures=$((failures + 1))
echo "$failures" > "$FAILURE_FILE"

if [ "$failures" -lt "$MAX_FAILURES" ]; then
  exit 0
fi

# Threshold reached — kickstart
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Health failing (HTTP $code, $failures consecutive) — kickstarting $LABEL" >> /tmp/paperclip-watchdog.log
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null
echo "[$(date '+%Y-%m-%d %H:%M:%S')] kickstart exit code: $?" >> /tmp/paperclip-watchdog.log
rm -f "$FAILURE_FILE"
