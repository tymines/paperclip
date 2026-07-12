#!/bin/bash
# Paperclip keepalive supervisor (Windows Git Bash compatible).
# Keeps the server up: prefers PRODUCTION (node dist/index.js, static ui/dist);
# if prod won't stay up after repeated tries, falls back to dev so the site is
# never left down. Launched (detached) by go-live.sh. Poll: 15s.
set -uo pipefail

REPO_ROOT="${PAPERCLIP_REPO_ROOT:-$HOME/paperclip}"
PORT="${PAPERCLIP_PORT:-3100}"
LOGDIR="$HOME/.paperclip-logs"; mkdir -p "$LOGDIR"
SRVLOG="$LOGDIR/server.log"
log(){ echo "[keepalive $(date +%H:%M:%S)] $*" >>"$LOGDIR/keepalive.log"; }

http_code(){ curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null; }
have_prod(){ [ -f "$REPO_ROOT/packages/db/dist/index.js" ] && [ -f "$REPO_ROOT/server/dist/index.js" ] && [ -f "$REPO_ROOT/ui/dist/index.html" ]; }
# Never migrate on boot (DB already migrated; non-TTY boot would auto-apply drifted
# migrations and crash — e.g. 0001 agent_runtime_state whose table already exists).
# 2026-07-12 (Fable, WS5): code CONTRADICTED the comment above — it set
# PAPERCLIP_MIGRATION_AUTO_APPLY=true on every supervised restart (the exact
# 07-11 journal-drift trap). Fixed to match the comment: never migrate on boot.
start_prod(){ ( cd "$REPO_ROOT/server" && unset PAPERCLIP_UI_DEV_MIDDLEWARE && NODE_ENV=production PAPERCLIP_MIGRATION_PROMPT=never nohup node dist/index.js >>"$SRVLOG" 2>&1 & ); }
start_dev(){ ( cd "$REPO_ROOT" && PAPERCLIP_MIGRATION_PROMPT=never nohup pnpm dev >>"$SRVLOG" 2>&1 & ); }

log "keepalive started (poll 15s, port $PORT, repo $REPO_ROOT)"
fails=0
while true; do
  if [ "$(http_code)" = "200" ]; then fails=0; sleep 15; continue; fi
  log "server DOWN — restarting"
  if have_prod; then
    start_prod
    up=""; for _ in $(seq 1 10); do sleep 2; [ "$(http_code)" = "200" ] && { up=1; break; }; done
    if [ -n "$up" ]; then log "prod back up ✓"; fails=0
    else
      fails=$((fails+1)); log "prod did not come up (consecutive fails: $fails)"
 