#!/bin/bash
# Hermes + OpenClaw Agent Session Auto-Rotation
# Prevents session bloat (e.g. Augi's 10.4MB wedge) by:
#   1. Rotating sessions over 5MB to a compressed archive
#   2. Keeping only the last 7 days of active sessions
#   3. Compacting/compressing old session trajectories
# Designed to run as a cron job (append to existing 4AM session-cleanup)

set -euo pipefail

LOG="$HOME/.openclaw/logs/session-rotation.log"
NOW=$(date +%s)
MAX_SESSION_MB=5
MAX_SESSION_AGE_DAYS=7

echo "[$(date)] Session rotation starting..." >> "$LOG"

# --- 1. Rotate Hermes sessions (Windows AppData or macOS ~/Library) ---
for sessions_dir in \
  "$HOME/Library/Application Support/hermes/sessions" \
  "$HOME/AppData/Local/hermes/sessions"; do
  [ -d "$sessions_dir" ] || continue
  echo "  Checking Hermes sessions: $sessions_dir" >> "$LOG"

  find "$sessions_dir" -name '*.db' -o -name 'sessions*.db' -o -name '*.sqlite' 2>/dev/null | while read -r session_file; do
    size_bytes=$(stat -f%z "$session_file" 2>/dev/null || stat --format=%s "$session_file" 2>/dev/null || echo 0)
    size_mb=$((size_bytes / 1048576))

    if [ "$size_mb" -ge "$MAX_SESSION_MB" ]; then
      archive_name="${session_file}.$(date +%Y%m%d).tar.gz"
      gzip -c "$session_file" > "$archive_name" 2>/dev/null
      # Truncate the original — Hermes recreates as needed
      : > "$session_file"
      echo "  ROTATED $session_file (${size_mb}MB → archived)" >> "$LOG"
    fi
  done
done

# --- 2. Rotate OpenClaw agent sessions ---
AGENT_SESSIONS_DIR="$HOME/.openclaw/agents/main/sessions"
if [ -d "$AGENT_SESSIONS_DIR" ]; then
  echo "  Checking OpenClaw sessions: $AGENT_SESSIONS_DIR" >> "$LOG"

  # Archive old trajectory files
  find "$AGENT_SESSIONS_DIR" -name '*.trajectory-path.json' -mtime +$MAX_SESSION_AGE_DAYS 2>/dev/null | while read -r old_traj; do
    rm -f "$old_traj"
    echo "  REMOVED stale trajectory: $(basename "$old_traj")" >> "$LOG"
  done

  # Check total session file size
  total_size=$(du -sm "$AGENT_SESSIONS_DIR" 2>/dev/null | awk '{print $1}')
  if [ "${total_size:-0}" -gt 50 ]; then
    # Compact: remove sessions older than 30 days
    find "$AGENT_SESSIONS_DIR" -name '*.jsonl' -mtime +30 2>/dev/null | while read -r old_session; do
      rm -f "$old_session"
      echo "  REMOVED old session: $(basename "$old_session")" >> "$LOG"
    done
  fi
fi

# --- 3. Compact the main sessions.json (strip to recent only) ---
SESSIONS_FILE="$HOME/.openclaw/agents/main/sessions/sessions.json"
if [ -f "$SESSIONS_FILE" ]; then
  file_size_mb=$(du -m "$SESSIONS_FILE" 2>/dev/null | awk '{print $1}')
  if [ "${file_size_mb:-0}" -ge 2 ]; then
    python3 -c "
import json, time, os
now = time.time()
cutoff = now - (7 * 86400)  # 7 days
try:
    with open('$SESSIONS_FILE') as f:
        sessions = json.load(f)
    if isinstance(sessions, dict):
        original = len(sessions)
        sessions = {k: v for k, v in sessions.items() 
                    if isinstance(v, dict) and v.get('timestamp', 0) > cutoff}
        removed = original - len(sessions)
        with open('$SESSIONS_FILE', 'w') as f:
            json.dump(sessions, f)
        print(f'  COMPACTED sessions.json: {original}→{len(sessions)} ({removed} removed)')
except Exception as e:
        print(f'  ERROR compacting sessions.json: {e}')
" 2>/dev/null >> "$LOG"
  fi
fi

echo "[$(date)] Session rotation complete." >> "$LOG"
