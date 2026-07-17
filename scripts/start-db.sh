#!/bin/bash
# Start Paperclip's Postgres (PG18) against the REAL data on :5432.
# NON-DESTRUCTIVE: starts the server against the existing pg18-data dir — it never
# re-initializes or wipes. If :5432 is already up, it does nothing. Run in Git Bash:
#   bash scripts/start-db.sh
set -uo pipefail

PGCTL="/c/Users/Augi-T1/paperclip/node_modules/.pnpm/@embedded-postgres+windows-x64@18.1.0-beta.16/node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe"
DATADIR="/c/Users/Augi-T1/.paperclip/pg18-data"
CONF="$DATADIR/postgresql.conf"
LOG="$DATADIR/startup.log"

echo "[start-db] target: $DATADIR on :5432"

if netstat -ano 2>/dev/null | grep -q ':5432 .*LISTENING'; then
  echo "[start-db] :5432 is already listening — nothing to do."
  exit 0
fi

if [ ! -x "$PGCTL" ]; then echo "[start-db] FATAL: pg_ctl not found at $PGCTL"; exit 1; fi
if [ ! -d "$DATADIR" ]; then echo "[start-db] FATAL: data dir not found at $DATADIR"; exit 1; fi

# PG18 rejects the old 'autovacuum_worker_slots' param — comment it out if present.
if [ -f "$CONF" ]; then
  sed -i 's/^autovacuum_worker_slots/#autovacuum_worker_slots/' "$CONF" 2>/dev/null || true
fi

echo "[start-db] starting PG18…"
"$PGCTL" -D "$DATADIR" -o "-p 5432" -l "$LOG" -w start || true
sleep 3

if netstat -ano 2>/dev/null | grep -q ':5432 .*LISTENING'; then
  echo "[start-db] ✅ Postgres is UP on :5432. Your app should reconnect now (refresh Paperclip)."
else
  echo "[start-db] ❌ Postgres did NOT start. Last lines of the startup log:"
  tail -25 "$LOG" 2>/dev/null || echo "(no log at $LOG)"
  echo "[start-db] Paste that output to Claude."
fi
