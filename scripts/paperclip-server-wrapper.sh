#!/bin/bash
# Paperclip Server Wrapper v3 — stays alive, supervises the server in PRODUCTION mode
# - Single-instance lock via port check
# - tsx pipe cleanup before start
# - Stays alive as long as the server is running
# - launchd tracks THIS PID, restarting only when the server truly dies
#
# v3 CHANGE (2026-07-10): starts the server in PRODUCTION (`node dist/index.js`
# serving ui/dist static) instead of `pnpm dev`. Running `pnpm dev` under the
# supervisor served the Vite dev index (`/src/App.tsx` -> 404) => black tab on
# every supervised restart. Prod mode fixes that permanently. Trade-off: the
# supervisor no longer hot-reloads source; DEPLOYS must rebuild dist (see
# start_server()'s build-if-missing guard, and the deploy runbook).

set -euo pipefail

# --- Toolchain paths (override via env for non-macOS boxes) ---
NODE_BIN="${PAPERCLIP_NODE_BIN:-/opt/homebrew/bin/node}"
PNPM_BIN="${PAPERCLIP_PNPM_BIN:-/opt/homebrew/bin/pnpm}"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node || echo node)"
[ -x "$PNPM_BIN" ] || PNPM_BIN="$(command -v pnpm || echo pnpm)"

REPO_ROOT="${PAPERCLIP_REPO_ROOT:-$HOME/paperclip}"
LOG_DIR="$HOME/.paperclip-logs"
LOCK_PORT="${PAPERCLIP_PORT:-3100}"
PID_FILE="/tmp/paperclip-server.pid"
HEARTBEAT_FILE="/tmp/paperclip-server-heartbeat"
POLL_SECONDS=15

mkdir -p "$LOG_DIR"

log() { echo "[$(date +%H:%M:%S)] $*" >> "$LOG_DIR/server-wrapper.log"; }

# --- Build gate: refuse to restart with broken code ---
# Quick syntax check on changed server .ts files before starting/restarting.
# If the check fails, log the error and exit, leaving the running server (if any)
# untouched — a single bad route edit can NEVER crash all of Paperclip.
build_gate() {
  local server_root="$REPO_ROOT/server"
  if [ -d "$server_root" ]; then
    local tsx_root
    tsx_root="$REPO_ROOT/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx"
    # If the tsx preflight files aren't where we expect, skip the gate rather than
    # wedge the restart loop on a path mismatch.
    if [ ! -f "$tsx_root/dist/preflight.cjs" ] || [ ! -f "$tsx_root/dist/loader.mjs" ]; then
      log "Build gate: tsx preflight not found at $tsx_root — skipping syntax gate"
      return 0
    fi
    local changed_files
    changed_files=$(cd "$server_root" && find src -name '*.ts' -newer "$HEARTBEAT_FILE" 2>/dev/null | head -20)
    if [ -z "$changed_files" ]; then
      changed_files=$(cd "$server_root" && git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' '*.tsx' 2>/dev/null | grep -E '\.tsx?$' | head -20 || true)
    fi
    if [ -n "$changed_files" ]; then
      log "Build gate: checking ${changed_files}"
      for f in $changed_files; do
        local full_path="$server_root/$f"
        if [ -f "$full_path" ]; then
          local output
          if ! output=$(PC_CHK_FILE="$full_path" "$NODE_BIN" \
              --require "$tsx_root/dist/preflight.cjs" \
              --import "file://$tsx_root/dist/loader.mjs" \
              -e 'try { require(process.env.PC_CHK_FILE); process.exit(0); } catch (e) { console.error(e.message); process.exit(1); }' \
              2>&1); then
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

# --- Start the server: PREFER production (ui/dist static), FALL BACK to dev ---
# Production == `node dist/index.js` serving ui/dist static (uiMode=static, no black tab).
# But prod only works once the whole monorepo is compiled to dist (@paperclipai/db,
# @paperclipai/shared, etc.). While that build isn't viable, `node dist/index.js`
# exits immediately on unresolved workspace packages — so we detect that and fall
# back to `pnpm dev` (tsx watch), which serves the SAME source and stays up. This
# way the wrapper can never wedge: prod when healthy, working dev otherwise.
start_dev_fallback() {
  cd "$REPO_ROOT"
  "$PNPM_BIN" dev >> "$LOG_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PID_FILE"
  log "Started DEV server (pnpm dev, PID $SERVER_PID) — prod build not viable yet"
}

start_server() {
  # Only attempt prod if the server+ui dist AND the @paperclipai/db workspace dist
  # are present. db/dist is the piece that was missing and made `node dist/index.js`
  # die at boot on an unresolved workspace package (=> silent fallback to dev).
  if [ -f "$REPO_ROOT/server/dist/index.js" ] \
     && [ -f "$REPO_ROOT/ui/dist/index.html" ] \
     && [ -f "$REPO_ROOT/packages/db/dist/index.js" ]; then
    cd "$REPO_ROOT/server"
    # PROD: dev middleware OFF (uiMode=static). Never set PAPERCLIP_UI_DEV_MIDDLEWARE=true here.
    unset PAPERCLIP_UI_DEV_MIDDLEWARE
    NODE_ENV=production "$NODE_BIN" dist/index.js >> "$LOG_DIR/server.log" 2>&1 &
    SERVER_PID=$!
    # Give prod a few seconds; if it dies or never listens, fall back to dev.
    sleep 5
    if kill -0 "$SERVER_PID" 2>/dev/null && check_port; then
      echo "$SERVER_PID" > "$PID_FILE"
      log "Started PRODUCTION server (node dist/index.js, PID $SERVER_PID)"
      return 0
    fi
    kill "$SERVER_PID" 2>/dev/null || true
    log "Production start failed (exited or no listen on :$LOCK_PORT) — falling back to dev"
  else
    log "No prod build present (server/dist or ui/dist missing) — using dev"
  fi
  start_dev_fallback
}

log "Wrapper started (PID $$) — node=$NODE_BIN pnpm=$PNPM_BIN repo=$REPO_ROOT"

# --- Phase 1: Pre-flight cleanup ---
"$REPO_ROOT/scripts/cleanup-tsx-pipes.sh" || true

# --- Phase 2: Single-instance lock ---
check_port() {
  lsof -i :"$LOCK_PORT" -P -sTCP:LISTEN 2>/dev/null | grep -q LISTEN
}

if check_port; then
  existing_pid=$(lsof -i :"$LOCK_PORT" -P -sTCP:LISTEN 2>/dev/null | awk '/LISTEN/{print $2}' | head -1)
  log "Port $LOCK_PORT already in use by PID $existing_pid — monitoring existing server"
  SERVER_PID="$existing_pid"
  MANAGED=false
else
  build_gate
  MANAGED=true
  start_server

  # Wait for the server to actually listen
  for i in $(seq 1 20); do
    sleep 3
    if check_port; then
      actual_pid=$(lsof -i :"$LOCK_PORT" -P -sTCP:LISTEN 2>/dev/null | awk '/LISTEN/{print $2}' | head -1)
      log "Server listening on :$LOCK_PORT (PID $actual_pid, start attempt $i)"
      SERVER_PID="$actual_pid"
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      log "Production server exited prematurely (attempt $i) — retrying"
      start_server
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
      "$REPO_ROOT/scripts/cleanup-tsx-pipes.sh" || true
      start_server
      MANAGED=true
    else
      log "Was monitoring external instance — exiting so launchd can restart cleanly"
      exit 1
    fi
  fi
done
