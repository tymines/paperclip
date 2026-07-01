#!/bin/bash
# ENOSPC Guard — clear stale tsx/temp pipes before server start + standalone sweep
# Prevents the tsx pipe-leak from suffocating the filesystem (ENOSPC).
# Run this as a pre-start hook and as a cron job.

LOG="/tmp/tsx-cleanup.log"
echo "[$(date)] tsx pipe cleanup starting..." >> "$LOG"

# 1. Clear tsx temp socket files from known leak locations
#    tsx leaks named pipes under /var/folders/fv/.../T/tsx-* on each HMR restart
for tsxdir in /var/folders/fv/*/T/tsx-* /tmp/tsx-*; do
  [ -d "$tsxdir" ] || continue
  count=$(ls -1 "$tsxdir" 2>/dev/null | wc -l)
  if [ "$count" -gt 10 ]; then
    rm -rf "$tsxdir" 2>/dev/null
    echo "  PURGED $tsxdir ($count files)" >> "$LOG"
  fi
done

# 2. Clear /tmp/node-compile-cache except the running Node version
if [ -d /tmp/node-compile-cache ]; then
  keep_version=$(node --version 2>/dev/null || echo "v0")
  for cachedir in /tmp/node-compile-cache/*/; do
    [ -d "$cachedir" ] || continue
    dirname=$(basename "$cachedir")
    if [ "$dirname" != "$keep_version" ] && [ "$dirname" != "openclaw" ]; then
      rm -rf "$cachedir" 2>/dev/null
      echo "  REMOVED stale compile-cache: $dirname" >> "$LOG"
    fi
  done
fi

# 3. Clear stray .pid files from crashed Paperclip instances
rm -f /tmp/paperclip-*.pid 2>/dev/null

echo "[$(date)] tsx cleanup complete." >> "$LOG"
