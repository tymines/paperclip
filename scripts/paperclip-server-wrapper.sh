#!/bin/bash
# Paperclip Server Wrapper v2 — stays alive, supervises the server
# - Single-instance lock via port check
# - tsx pipe cleanup before start
# - Stays alive as long as the server is running
# - launchd tracks THIS PID, restarting only when the server truly dies

set -euo pipefail

# --- Build gate: refuse to restart with broken code ---
# Runs a quick syntax check on changed server .ts files before starting/restarting.
# If the check fails, the wrapper logs the error and exits, leaving the running
# server (if any) untouched — a single bad route edit can NEVER crash all of Paperclip.
build_gate() {
  local server_root="$REPO_ROOT/server"
  if [ -d "$server_root" ]; then
    local changed_files
    changed_files=$(cd "$server_root" && find src -name '*.ts' -newer /tmp/paperclip-server-heartbeat 2>/dev/null | head -20)
    # If no files changed recently, check any new/changed files via git
    if [ -z "$changed_files" ]; then
      changed_files=$(cd "$server_root" && git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' '*.tsx' 2>/dev/null | grep -E '\.tsx?$' | head -20 || true)
    fi
    
    if [ -n "$changed_files" ]; then
      log "Build gate: checking ${changed_files}"
      for f in $changed_files; do
        local full_path="$server_root/$f"
        if [ -f "$full_path" ]; then
          local output
          if ! output=$(/opt/homebrew/bin/node             --require /Users/augi/paperclip/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/preflight.cjs             --import file:///Users/augi/paperclip/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs             -e "try { require(\"$full_path\"); process.exit(0); } catch(e) { console.error(e.message); process.exit(1); }"             2>&1); then
            log "BUILD GATE REJECTED: $f — $output"
            log "Refusing to restart. Fix the code and restart manually."
            exit 1
          fi
        fi
      done
      log "Build gate: all checks passed"
    fi
  fi
}

REPO_ROOT="$HOME/paperclip"
LOG_DIR="$HOME/.paperclip-logs"
LOCK_PORT=3100
PID_FILE="/tmp/paperclip-server.pid"
HEARTBEAT_FILE="/tmp/paperclip-server-heartbeat"
POLL_SECONDS=15

mkdir -p "$LOG_DIR"

log() { echo "[$(date +%H:%M:%S)] $*" >> "$LOG_DIR/server-wrapper.log"; }

log "Wrapper started (PID $$)"

# --- Phase 1: Pre-flight cleanup ---
"$REPO_ROOT/scripts/cleanup-tsx-pipes.sh"

# --- Phase 2: Single-instance lock ---
check_port() {
  lsof -i :"$LOCK_PORT" -P -sTCP:LISTEN 2>/dev/null | grep -q LISTEN
}

if check_port; then
  existing_pid=$(lsof -i :"$LOCK_PORT" -P -sTCP:LISTEN 2>/dev/null | awk '/LISTEN/{print $2}' | head -1)
  log "Port $LOCK_PORT already in use by PID $existing_pid — monitoring existing server"
  SERVER_PID="$existing_pid"
  # Don't start a new server, just monitor the existing one
  MANAGED=false
else
  build_gate
  $old_init
  MANAGED=true

  # Start pnpm dev in background
  cd "$REPO_ROOT"
  /opt/homebrew/bin/pnpm dev &
  SERVER_PID=$!
  log "Started pnpm dev (PID $SERVER_PID)"
  
  # Wait for the server to actually listen
  for i in $(seq 1 20); do
    sleep 3
    if check_port; then
      actual_pid=$(lsof -i :"$LOCK_PORT" -P -sTCP:LISTEN 2>/dev/null | awk '/LISTEN/{print $2}' | head -1)
      log "Server listening on :$LOCK_PORT (PID $actual_pid, start attempt $i)"
      SERVER_PID="$actual_pid"
      break
    fi
    if ! kill -0 $SERVER_PID 2>/dev/null; then
      log "pnpm dev exited prematurely (attempt $i)"
      # Try once more
      /opt/homebrew/bin/pnpm dev &
      SERVER_PID=$!
      log "Restarted pnpm dev (PID $SERVER_PID)"
    fi
  done
fi

# --- Phase 3: Heartbeat loop — stay alive as long as server is running ---
log "Entering heartbeat loop (poll every ${POLL_SECONDS}s, managed=$MANAGED)"

while true; do
  echo "$(date +%s)" > "$HEARTBEAT_FILE"
  sleep "$POLL_SECONDS"
  
  if ! check_port; then
    log "Server on :$LOCK_PORT is DOWN!"
    if [ "$MANAGED" = true ]; then
      build_gate
    $old_restart
      "$REPO_ROOT/scripts/cleanup-tsx-pipes.sh"
      cd "$REPO_ROOT"
      /opt/homebrew/bin/pnpm dev &
      SERVER_PID=$!
      log "Started new pnpm dev (PID $SERVER_PID)"
      MANAGED=true
    else
      log "Was monitoring external instance — exiting so launchd can restart cleanly"
      exit 1
    fi
  fi
done
