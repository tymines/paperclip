#!/bin/bash
# Paperclip one-shot GO-LIVE (Windows Git Bash compatible).
#
#   bash scripts/go-live.sh
#
# What it does, safely and idempotently:
#   1. Backs up the DB (precautionary; this script never mutates data).
#   2. Builds the WHOLE workspace (`pnpm -r build`) — this is the core fix:
#      it creates packages/db/dist, which was missing and made prod crash at boot.
#   3. Verifies the three required build artifacts exist.
#   4. Swaps the running server to PRODUCTION (node dist/index.js serving static
#      ui/dist — no dev file-watcher, no black tab).
#   5. Health-checks :3100; if prod is up, launches the keepalive supervisor.
#   6. If prod will NOT boot, it restores dev so the site is NEVER left down,
#      and prints the exact prod error to fix forward.
set -uo pipefail

REPO_ROOT="${PAPERCLIP_REPO_ROOT:-$HOME/paperclip}"
PORT="${PAPERCLIP_PORT:-3100}"
LOGDIR="$HOME/.paperclip-logs"; mkdir -p "$LOGDIR"
SRVLOG="$LOGDIR/server.log"
say(){ echo "[go-live $(date +%H:%M:%S)] $*"; }

cd "$REPO_ROOT" 2>/dev/null || { say "FATAL: no repo at $REPO_ROOT (set PAPERCLIP_REPO_ROOT)"; exit 1; }

port_pid(){ netstat -ano 2>/dev/null | grep ":$PORT " | grep -i LISTENING | awk '{print $NF}' | head -1; }
http_code(){ curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" 2>/dev/null; }

stop_server(){
  pnpm dev:stop >/dev/null 2>&1 || true
  local pid; pid="$(port_pid)"
  if [ -n "${pid:-}" ]; then
    say "stopping PID $pid on :$PORT"
    taskkill //PID "$pid" //F >/dev/null 2>&1 || kill "$pid" 2>/dev/null || true
  fi
  sleep 3
}
# PAPERCLIP_MIGRATION_PROMPT=never: the DB is already fully migrated; a non-TTY boot
# would otherwise AUTO-APPLY drifted "pending" migrations (e.g. 0001 agent_runtime_state,
# whose table already exists) and crash the server. Never migrate on boot here.
# 2026-07-12 (Fable, WS5): the code below CONTRADICTED this comment — it set
# PAPERCLIP_MIGRATION_AUTO_APPLY=true, wiring the 07-11 journal-drift trap into
# every boot. Fixed to match the comment: never migrate on boot; migrations are
# an explicit, deliberate deploy step (pnpm db:migrate).
start_prod(){ ( cd "$REPO_ROOT/server" && unset PAPERCLIP_UI_DEV_MIDDLEWARE && NODE_ENV=production PAPERCLIP_MIGRATION_PROMPT=never nohup node dist/index.js >>"$SRVLOG" 2>&1 & ); }
start_dev(){ ( cd "$REPO_ROOT" && PAPERCLIP_MIGRATION_PROMPT=never nohup pnpm dev >>"$SRVLOG" 2>&1 & ); }
wait_up(){ local n="${1:-20}"; for _ in $(seq 1 "$n"); do sleep 2; [ "$(http_code)" = "200" ] && return 0; done; return 1; }

# 1) Backup (warn-only: build + restart are data-safe)
say "backup…"
if pnpm db:backup >>"$LOGDIR/backup.log" 2>&1; then say "backup ok"; else say "WARN backup non-zero (restart is data-safe; ensure a recent backup exists)"; fi

# 2) Build the three required packages in dependency order.
#    db is the missing piece (its build creates packages/db/dist). shared + adapters
#    + plugin-sdk already have dist. We build only what the server needs so an
#    unrelated plugin package with stale type errors can't abort the deploy.
say "building @paperclipai/db (the missing dist — this is the core fix)…"
pnpm --filter @paperclipai/db build >>"$LOGDIR/build.log" 2>&1 || say "WARN db build reported errors; checking artifact…"
say "building @paperclipai/server…"
pnpm --filter @paperclipai/server build >>"$LOGDIR/build.log" 2>&1 || say "WARN server build reported errors; checking artifact…"
say "building @paperclipai/ui (bundles the new War Room mobile layout + Gym tab)…"
pnpm --filter @paperclipai/ui build >>"$LOGDIR/build.log" 2>&1 || say "WARN ui build reported errors; checking artifact…"

# 3) Verify required dist artifacts
miss=""
[ -f "$REPO_ROOT/packages/db/dist/index.js" ] || miss="$miss packages/db/dist"
[ -f "$REPO_ROOT/server/dist/index.js" ]      || miss="$miss server/dist"
[ -f "$REPO_ROOT/ui/dist/index.html" ]        || miss="$miss ui/dist"
if [ -n "$miss" ]; then
  say "BUILD INCOMPLETE — missing:$miss"
  say "---- tail build.log ----"; tail -30 "$LOGDIR/build.log"
  if [ "$(http_code)" != "200" ]; then
    say "site is down — restoring dev"; stop_server; start_dev
    wait_up 25 && say "dev restored (site up)" || say "DEV RESTORE FAILED — investigate"
  fi
  exit 1
fi
say "all prod dist present ✓ (db + server + ui)"

# 4) Swap to production
stop_server
say "starting PRODUCTION (node dist/index.js, static ui/dist)…"
start_prod
if wait_up 25; then
  idx="$(curl -s "http://127.0.0.1:$PORT/" | grep -oE '/(assets|src)/[^"]*\.(js|tsx)' | head -1)"
  say "PROD UP on :$PORT (200). serving: ${idx:-?}"
  case "$idx" in
    */assets/*) say "confirmed STATIC prod bundle ✓ (no dev watcher, no black tab)";;
    */src/*)    say "WARN serving /src (dev index) — check PAPERCLIP_UI_DEV_MIDDLEWARE is unset";;
  esac
  # 5) keepalive so it stays up
  nohup bash "$REPO_ROOT/scripts/paperclip-keepalive.sh" >>"$LOGDIR/keepalive.log" 2>&1 &
  say "keepalive launched — auto-restarts prod if it ever dies."
  say "DONE ✅ production is live. For reboot-persistence, register scripts/paperclip-keepalive.sh in Task Scheduler (at logon)."
  exit 0
fi

# 6) Prod failed to boot → restore dev, surface the error
say "PROD FAILED to