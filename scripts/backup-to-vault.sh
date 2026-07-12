#!/bin/bash
# Paperclip OFF-DRIVE backup (Windows Git Bash compatible).
#
#   bash scripts/backup-to-vault.sh
#
# Why: Paperclip's own backups land INSIDE the embedded-PG instance dir
# (~/.paperclip/instances/default/data/backups) — the exact folder that gets
# wiped in the "instance setup required" failure. This job produces a fresh dump
# via the app's proven backup engine, then copies EVERY backup to the VAULT drive
# (F:), which is a separate disk that also syncs off-machine, and prunes old ones.
# A wipe of the embedded PG can no longer take the backups with it.
set -uo pipefail

REPO_ROOT="${PAPERCLIP_REPO_ROOT:-$HOME/paperclip}"
INSTANCE_BACKUPS="${PAPERCLIP_INSTANCE_BACKUPS:-$HOME/.paperclip/instances/default/data/backups}"
VAULT_BACKUPS="${PAPERCLIP_VAULT_BACKUPS:-/f/Augi Vault/06 - Projects/Paperclip DB Backups}"
RETAIN_DAYS="${PAPERCLIP_BACKUP_RETAIN_DAYS:-30}"
LOGDIR="$HOME/.paperclip-logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/backup-to-vault.log"
log(){ echo "[backup $(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

if ! mkdir -p "$VAULT_BACKUPS" 2>/dev/null; then
  log "FATAL: cannot reach vault dir '$VAULT_BACKUPS' (is the F: drive available?)"; exit 1
fi

# 1) Fresh dump via the app's own backup engine (handles pg_dump vs JS fallback).
#    Writes a timestamped .sql.gz into the instance backups dir. Requires the
#    embedded PG to be running; if it's not, we still copy existing backups below.
log "creating fresh DB backup (pnpm paperclipai db:backup)…"
if ( cd "$REPO_ROOT" && pnpm paperclipai db:backup ) >>"$LOG" 2>&1; then
  log "fresh backup created ✓"
else
  log "WARN fresh backup failed (server/PG may be down) — copying existing backups anyway"
fi

# 1.5) Verify + checksum the newest dump (2026-07-12, Fable, WS7).
#      gzip -t catches truncated/corrupt archives at CREATION time instead of at
#      restore time; the .sha256 sidecar proves the vault copy matches the source.
newest_src="$(ls -1t "$INSTANCE_BACKUPS"/paperclip-*.sql.gz 2>/dev/null | head -1)"
if [ -n "$newest_src" ]; then
  if gzip -t "$newest_src" 2>>"$LOG"; then
    log "verify: gzip integrity OK for $(basename "$newest_src")"
    if command -v sha256sum >/dev/null 2>&1 && [ ! -f "$newest_src.sha256" ]; then
      ( cd "$(dirname "$newest_src")" && sha256sum "$(basename "$newest_src")" > "$(basename "$newest_src").sha256" )
      log "verify: wrote $(basename "$newest_src").sha256"
    fi
  else
    log "ALERT: gzip integrity FAILED for $(basename "$newest_src") — do NOT rely on this backup"
  fi
fi

# 2) Copy any instance backups (+ .sha256 sidecars) not already on the vault drive.
copied=0
if [ -d "$INSTANCE_BACKUPS" ]; then
  for f in "$INSTANCE_BACKUPS"/*.sql.gz; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    if [ ! -