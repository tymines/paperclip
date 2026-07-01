# TYL-168: Paperclip → Windows Migration Plan

> **Status:** Phase 0 — Inventory + Written Plan
> **Date:** 2026-06-28
> **Source of Truth (until cutover):** Box 1 (Mac Mini `augiais-mac-mini`)
> **Target:** Windows Desktop (`Augi-T1`, localhost)
> **Backup Status:** ⚠️ NOT YET PERFORMED — Phase 1

---

## Table of Contents

1. [Goal & Scope](#goal--scope)
2. [Current Architecture (Box 1 Mac)](#current-architecture-box-1-mac)
3. [Full Inventory Manifest](#full-inventory-manifest)
4. [Mac→Windows Change Matrix](#macwindows-change-matrix)
5. [Migration Phases](#migration-phases)
   - [Phase 0: Inventory + Plan (THIS DOCUMENT)](#phase-0-inventory--plan)
   - [Phase 1: Full Verified Backup](#phase-1-full-verified-backup)
   - [Phase 2: Stand Up on Windows (Parallel)](#phase-2-stand-up-on-windows-parallel)
   - [Phase 3: Data Integrity Verification](#phase-3-data-integrity-verification)
   - [Phase 4: Cutover Hold (Tyler Approves)](#phase-4-cutover-hold-tyler-approves)
6. [Rollback Plan](#rollback-plan)
7. [Estimated Downtime](#estimated-downtime)
8. [What Stays Identical](#what-stays-identical)
9. [What This Fixes](#what-this-fixes)

---

## Goal & Scope

**Goal:** Move Paperclip (server, UI, DB, plugins, tunnel, agents, cron, scripts, secrets) from the Mac Mini ("Box 1") to the Windows Desktop ("Augi-T1") — eliminating the cross-box seam and Mac SPOF.

**Scope:** Full Paperclip ecosystem — everything in the inventory below. No UI redesign, no database schema changes, no feature work.

**Non-scope (separate tasks):**
- Feature work (Book Writing, Gym, etc.) — tracked on their own TYL issues
- Dyad-vs-ZeusCoding Bake-Off (TYL-167)
- API version upgrades or dependency updates

---

## Current Architecture (Box 1 Mac)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BOX 1 (Mac Mini)                                 │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  launchd (supervisor)                                            │   │
│  │  ├── cloudflared tunnel → paperclip.augiport.com :443            │   │
│  │  ├── cloudflared local tunnel → localhost:5174 (dev UI)          │   │
│  │  ├── port-proxy (3100 → localhost:3100)                          │   │
│  │  ├── watchdog (auto-restart paperclip server)                    │   │
│  │  ├── room-ttl-sweep (DB cleanup)                                 │   │
│  │  └── ai.hermes.gateway (Hermes gateway)                         │   │
│  │                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │  Paperclip Server (tsx watch, port 3100)                 │    │   │
│  │  │  ├── Express API + REST routes                           │    │   │
│  │  │  ├── WebSocket for agents                                │    │   │
│  │  │  ├── Postgres (Homebrew, PG 17.8, DB: paperclip)        │    │   │
│  │  │  ├── Plugin system (Agent Pixels etc.)                   │    │   │
│  │  │  └── MLflow tracking (port 5566?)                        │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  │                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │  File System                                             │    │   │
│  │  │  ├── ~/paperclip/ (5.5 GB) — repo + node_modules         │    │   │
│  │  │  ├── ~/.paperclip/ — plugins, uploads, artifacts, state  │    │   │
│  │  │  ├── ~/.cloudflared/ — tunnel certs, credentials         │    │   │
│  │  │  ├── ~/.hermes/ — profiles, skills, cron, memories       │    │   │
│  │  │  ├── ~/.openclaw/ — cron scripts, logs, plugins           │    │   │
│  │  │  ├── ~/.zshrc — env vars, secrets                        │    │   │
│  │  │  └── /tmp/ — pid files, logs                             │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  │                                                                  │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │  Agent Adapters + Bridges (openclaw_gateway WS)          │    │   │
│  │  │  ├── Box 2 (Ares/August) → ws://100.68.190.105:18790    │    │   │
│  │  │  ├── Scanner MCPs → Box 2 via SSH tunnel                │    │   │
│  │  │  └── Paperclip-MCP → Box 2 via board API keys           │    │   │
│  │  └─────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  BOX 2 (Ares VM — Linux at 100.68.190.105)                      │   │
│  │  ├── zeus-sidecar (port 18790) — agents, scanner MCPs           │   │
│  │  ├── Scanner daemons (GithubScanner, CodingConnection, etc.)    │   │
│  │  └── Paperclip-MCP — MCP server tools                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Full Inventory Manifest

| # | Item | Path (Box 1 Mac) | Size | Criticality |
|---|------|-------------------|------|-------------|
| 1 | Repo (code) | `~/paperclip/` | 5.5 GB | 🔴 Must migrate |
| 2 | Postgres DB | `paperclip` (PG 17.8, port 5432) | TBD MB | 🔴 Must migrate |
| 3 | Plugin data | `~/.paperclip/plugins/` | TBD | 🔴 Must migrate |
| 4 | Uploads/Artifacts | `~/.paperclip/uploads/` (?) | TBD | 🔴 Must migrate |
| 5 | Adapter plugins | `~/.paperclip/adapter-plugins/` | TBD | 🔴 Must migrate |
| 6 | Env file | `~/paperclip/.env` | ~2 KB | 🔴 Must migrate |
| 7 | Server env | `~/paperclip/server/.env` (?) | TBD | 🔴 Must migrate |
| 8 | Cloudflared config | `~/.cloudflared/` | TBD | 🟡 Must migrate |
| 9 | Cloudflared token | Root process with `--token` | — | 🟡 Must re-auth |
| 10 | Hermes skills | `~/.hermes/` | TBD | 🟡 Optional |
| 11 | Openclaw scripts | `~/.openclaw/` | TBD | 🟡 Optional |
| 12 | Cron jobs | `crontab -l` | — | 🟡 Must migrate |
| 13 | Launchd plists | `~/Library/LaunchAgents/` | — | 🟡 Must migrate |
| 14 | zshrc exports | `~/.zshrc` | — | 🟡 Must migrate |
| 15 | MLflow data | `~/mlflow*` (?), port 5566 | TBD | 🟡 Optional |
| 16 | Logs | `/tmp/paperclip-tunnel.log`, `/tmp/pc-server*` | TBD | 🔵 Nice-to-have |
| 17 | Agent Adapter configs | Paperclip API (`openclaw_gateway`, gatewayUrl) | — | 🔴 Must update |

---

## Mac→Windows Change Matrix

This is the definitive mapping of every system, file, config, path, and behavior that changes in the Mac→Windows migration.

### 1. Native Node Modules (reinstall/rebuild)

| Module | Mac | Windows | Action |
|--------|-----|---------|--------|
| **esbuild** | Prebuilt macOS binary in `node_modules` | Needs Windows binary | `npm rebuild esbuild` or fresh `npm install` |
| **better-sqlite3** | Compiled native addon for arm64 | Needs Windows x64 build | `npm rebuild better-sqlite3` (needs build tools) |
| **sharp** | macOS arm64 binary | Needs Windows x64 prebuilt binary | `npm install sharp` (downloads Windows binary) |
| **node-pty** | macOS pty interface | Needs Windows winpty equivalent | `npm rebuild node-pty` (needs node-gyp + VS build tools) |
| **bcrypt** | Compiled macOS addon | Needs Windows x64 build | `npm rebuild bcrypt` |
| **fsevents** | macOS file watcher (macOS-only) | **Not available** — unused/dropped | Remove from deps or use `chokidar` fallback |
| **All native deps** | arm64/universal binaries | x64 Windows binaries | **NEVER copy `node_modules/` across OS** — always `npm install` / `pnpm install` fresh |

**Windows build prereqs:** Python 3.x, Visual Studio Build Tools 2022 (or `windows-build-tools`), node-gyp configured.

### 2. PostgreSQL

| Aspect | Mac (Box 1) | Windows | Action |
|--------|-------------|---------|--------|
| Version | PostgreSQL 17.8 via Homebrew | PostgreSQL 17.x via EDB installer or `winget` | Install fresh on Windows |
| Data dir | `/opt/homebrew/var/postgresql@17/` | `C:\Program Files\PostgreSQL\17\data\` | **Do NOT copy data files** — use `pg_dump`/`pg_restore` |
| DB name | `paperclip` | `paperclip` | Keep same name |
| User | `paperclip` (peer auth) | `paperclip` (password auth) | Create same role Windows |
| Port | 5432 (also 54329?) | 5432 | Use same port |
| Auth | `trust` (pg_hba.conf — local all trust) | `md5` or `scram-sha-256` | Update `.env` PGPASSWORD / DATABASE_URL |
| Migration method | `pg_dump -U paperclip paperclip > backup.sql` | `psql -U paperclip -d paperclip < backup.sql` | **Phase 1 backup + test-restore** |

**Migration method:** `pg_dump` on Mac → `pg_restore` on Windows. Mac Postgres data files are **not portable** across OSes (different endianness, file format versions, paths). Never tar the PG data directory.

### 3. Plugins (Agent Pixels, etc.)

| Plugin | Mac Path | Windows Equivalent | Action |
|--------|----------|--------------------|--------|
| Agent Pixels | `~/.paperclip/plugins/agent-pixels/` | `C:\Users\Augi-T1\.paperclip\plugins\agent-pixels\` | Copy directory tree, `npm install`/rebuild native deps |
| Other plugins | `~/.paperclip/plugins/*/` | `C:\Users\Augi-T1\.paperclip\plugins\*/` | Copy + rebuild each |
| Adapter plugins | `~/.paperclip/adapter-plugins/*/` | `C:\Users\Augi-T1\.paperclip\adapter-plugins\*/` | Copy + rebuild each |
| Uploaded files | `~/.paperclip/uploads/` (if exists) | `C:\Users\Augi-T1\.paperclip\uploads\` | Copy all files |

**Potential issue:** Some plugins may have hardcoded Mac paths in their configs. Grep for `/Users/augi/` inside `~/.paperclip/plugins/` after copy.

### 4. launchd Services → Windows Task Scheduler / NSSM / PM2

Each macOS launchd plist must be replaced on Windows:

| Service | Mac (launchd label) | Windows Equivalent | Purpose |
|---------|--------------------|--------------------|---------|
| **Paperclip server** | `com.paperclip.watchdog` | **NSSM** (Non-Sucking Service Manager) or **PM2** | Auto-start Paperclip server, restart on crash |
| **cloudflared tunnel** | `com.paperclip.cloudflared` | **NSSM** wrapping `cloudflared tunnel run --token ...` | Expose Paperclip via paperclip.augiport.com |
| **port-proxy** | `com.paperclip.port-proxy` | **NSSM** or Windows `netsh interface portproxy` | Forward external port to localhost |
| **room-ttl-sweep** | `com.paperclip.room-ttl-sweep` | **Task Scheduler** (run every 5 min) | Clean up expired rooms |
| **Hermes gateway** | `ai.hermes.gateway` (exit code 1 — currently broken) | **NSSM** or skip if not needed | Runs Hermes gateway on Windows |
| **ai.openviking.server** | `ai.openviking.server` (MLflow?) | Evaluate if needed on Windows | Unknown service — investigate |

**NSSM install:** `nssm install <servicename> <path-to-node> <args>` — creates a Windows Service with auto-restart.
**PM2 on Windows:** `npm install -g pm2` → `pm2 start ecosystem.config.js` — process manager, survives reboots with `pm2 startup`.

**Recommended approach for server:** NSSM for the Paperclip server and cloudflared (proper Windows services). Task Scheduler for periodic sweeps.

### 5. Cron Jobs → Task Scheduler

| Job | Mac crontab | Schedule | Windows Equivalent |
|-----|-------------|----------|-------------------|
| Auto-backup | `/Users/augi/.openclaw/workspace/auto-backup.sh` | Daily 1:00 AM | Task Scheduler, daily trigger, run `bash auto-backup.sh` (Git Bash) |
| Session cleanup | `session-cleanup.sh` | Daily 4:00 AM | Task Scheduler |
| Security sentinel | `security-scan.sh` | Daily 5:00 AM | Task Scheduler |
| Slack nightly report | `slack-nightly-report.sh` | Daily midnight | Task Scheduler |
| Tech scanner | `ai-tech-scanner.sh` | Daily 6:00 AM | Task Scheduler |
| Nightly build | `nightly-build.sh` | Daily 3:00 AM | Task Scheduler |
| API cost tracker | `api-cost-tracker.py` | Daily 6:00 AM | Task Scheduler |
| Memory consolidation | `memory-consolidation-scheduler.py` | Daily 2:00 AM | Task Scheduler |
| Browser cleanup safety-net | `browser-cleanup-safety-net.py` | Every 15 min | Task Scheduler |
| Browser cleanup | `browser-cleanup.sh` | Every 30 min | Task Scheduler |
| **ENOSPC guard** | `cleanup-tsx-pipes.sh` | Every 30 min | Task Scheduler (Git Bash) |
| **Session rotation** | `rotate-agent-sessions.sh` | Every 6 hours | Task Scheduler (Git Bash) |
| **Browser cleanup enhanced** | `browser-cleanup-enhanced.sh` | Every 15 min | Task Scheduler |

**All cron scripts live under `~/.openclaw/`** — copy the entire directory, then create Task Scheduler entries.

**Task Scheduler CLI equivalent:**
```powershell
schtasks /create /tn "Paperclip-ENOSPC-Guard" /tr "C:\Program Files\Git\bin\bash.exe -c 'C:\Users\Augi-T1\.openclaw\bin\cleanup-tsx-pipes.sh'" /sc minute /mo 30 /f
```

### 6. Bash Scripts → Git Bash or PowerShell Port

| Script | Mac Path | Windows Runner | Notes |
|--------|----------|---------------|-------|
| `auto-backup.sh` | `~/.openclaw/workspace/auto-backup.sh` | Git Bash | Should work as-is if paths use `$HOME` |
| `session-cleanup.sh` | `~/.openclaw/workspace/session-cleanup.sh` | Git Bash | Check for `launchctl`/`osascript` calls — need porting |
| `security-scan.sh` | `~/.openclaw/plugins/security-sentinel/scripts/security-scan.sh` | Git Bash | Check for macOS-specific commands |
| `slack-nightly-report.sh` | `~/.openclaw/bin/slack-nightly-report.sh` | Git Bash | Likely pure curl/API — should work |
| `ai-tech-scanner.sh` | `~/.openclaw/bin/ai-tech-scanner.sh` | Git Bash | Check for Mac binaries |
| `build-gate.sh` | `~/paperclip/scripts/build-gate.sh` | Git Bash | Already uses Node/npm — should work |
| `server-wrapper.sh` | `~/paperclip/scripts/server-wrapper.sh` | Git Bash or NSSM | Convert to service rather than wrapper |
| `cleanup-tsx-pipes.sh` | `~/paperclip/scripts/cleanup-tsx-pipes.sh` | Git Bash | Should work (just `rm` + `find`) |
| `rotate-agent-sessions.sh` | `~/paperclip/scripts/rotate-agent-sessions.sh` | Git Bash | Check paths |
| `nightly-build.sh` | `~/.openclaw/bin/nightly-build.sh` | Git Bash | Likely pure Node — should work |
| `api-cost-tracker.py` | `~/.openclaw/workspace/api-cost-tracker.py` | Python 3.11 (Windows) | Should work as-is |
| `memory-consolidation-scheduler.py` | `~/.openclaw/workspace/memory-consolidation-scheduler.py` | Python 3.11 (Windows) | Should work as-is |

**Key check for each script:** Grep for `/Users/augi`, `launchctl`, `osascript`, `brew`, `pbcopy`, `open`, `ditto`, `plist` — any macOS-specific commands need a Windows replacement.

### 7. Hardcoded Paths

| Pattern | Mac | Windows | Where to Fix |
|---------|-----|---------|-------------|
| `/Users/augi/...` | Absolute home path | `C:\Users\Augi-T1\...` | **Grep entire repo + DB** |
| `/Users/augi/paperclip/` | Repo root | `C:\Users\Augi-T1\paperclip\` | `.env`, configs, startup scripts |
| `/Users/augi/.paperclip/` | Plugin/upload root | `C:\Users\Augi-T1\.paperclip\` | Plugin configs, server config |
| `/Users/augi/.cloudflared/` | Tunnel config | `C:\Users\Augi-T1\.cloudflared\` | Tunnel startup command |
| `/Users/augi/.hermes/` | Hermes config | `C:\Users\Augi-T1\AppData\Local\hermes\` | Hermes profiles, skills paths |
| `/Users/augi/.openclaw/` | Openclaw scripts | `C:\Users\Augi-T1\.openclaw\` | All cron/script references |
| `/opt/homebrew/...` | Homebrew paths | N/A | Replace with Windows equivalents |
| `/tmp/` | Temp files | `C:\Users\Augi-T1\AppData\Local\Temp\` or `%TEMP%` | Log files, pid files |
| `/Users/augi/Library/...` | Library files | N/A | Replace with AppData equivalents |

**DB path check:** After restoring the DB, query for stored file paths:
```sql
SELECT id, file_path FROM uploaded_files WHERE file_path LIKE '/Users/%';
SELECT id, artifact_path FROM artifacts WHERE artifact_path LIKE '/Users/%';
-- Also check JSONB columns in companies, skills, plugins
```

**Repo grep:**
```bash
cd paperclip
grep -rn '/Users/augi/' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' --include='*.sh' --include='*.yaml' --include='*.yml' --include='*.env*' .
# Also check for /Users/augi in DB dumps
```

**Path separator changes:**
- **Code:** TypeScript/JavaScript uses `/` internally (path.join handles this). Only `.env` files and shell scripts use literal paths.
- **Shell scripts:** `$HOME` is portable. `$(dirname "$0")` is portable. But `pwd`, `cd`, and explicit paths need review.
- **Config files:** `.env` uses `DATABASE_URL=postgresql://...` — this is fine. But `PAPERCLIP_DATA_DIR=/Users/augi/.paperclip` must change.

### 8. cloudflared Tunnel (paperclip.augiport.com)

| Aspect | Mac | Windows |
|--------|-----|---------|
| Tunnel type | `cloudflared tunnel run --token <TOKEN>` (root process) | Same command via NSSM |
| Auth token | Stored in process args (printed above as `--token eyJhIj...dyJ9`) | Copy token, don't print |
| Certificate | `~/.cloudflared/cert.pem` (should exist) | Copy to same relative path |
| Config | `~/.cloudflared/config.yml` | Copy, update origin URL to Windows port |
| Tunnel origin | `http://localhost:5174` (Vite dev) or `http://localhost:3100` (server) | `http://localhost:3100` (Windows server) |
| Log file | `/tmp/paperclip-tunnel.log` | `C:\Users\Augi-T1\AppData\Local\Temp\paperclip-tunnel.log` |

**Action items:**
1. Copy `~/.cloudflared/` directory to Windows
2. Verify tunnel token still valid (`cloudflared tunnel info`)
3. Update origin URL to point to Windows server port
4. Install `cloudflared` on Windows: `winget install Cloudflare.cloudflared`
5. Register as Windows Service via NSSM

### 9. IP/Endpoint Repointing (Agent Adapters, Hermes Config)

**This is the fix for the gateway issue.** Every agent adapterConfig and Hermes config that points to Box 1 must be repointed to Windows localhost.

| Config Location | Old Value (Mac) | New Value (Windows) | Fixes |
|-----------------|-----------------|---------------------|-------|
| Zeus agent `agentBridge.gatewayUrl` (Paperclip DB) | `ws://100.68.190.105:18790` | `ws://127.0.0.1:18790` or `ws://<windows-tailscale-ip>:18790` | Gateway WS connection |
| All agents `adapterConfig.url` (Paperclip DB) | `http://100.68.190.105:3100` or `http://127.0.0.1:3100` | `http://127.0.0.1:3100` (Windows) | Agent→Paperclip API |
| Hermes config `PAPERCLIP_API_URL` | `http://100.68.190.105:3100` (via SSH tunnel) | `http://127.0.0.1:3100` | Hermes→Paperclip API |
| Box 1 bridge daemon `--peer-map` | Maps Zeus to `ws://100.68.190.105:18790` | Map Zeus to `ws://127.0.0.1:18790` | Cross-box agent routing |
| Scanner MCPs on Box 2 | `Box1:3100` via SSH tunnel | Remove tunnel — direct to Windows `127.0.0.1:3100` | Scanner→Paperclip |
| Paperclip-MCP on Box 2 | Boards API via `100.68.190.105:3100` tunnel | Boards API direct to `127.0.0.1:3100` | MCP tool routing |

**How to update:**
1. Query Paperclip API for all agents → patch each `agentBridge.gatewayUrl`
2. Query Paperclip API for all agents → patch each `adapterConfig.url`
3. Update Hermes config.yaml `paperclip_api_url`
4. Update Box 2 daemon configs

**Post-migration, the SSH tunnel from Box 1→Windows port 3100 is no longer needed.** The cross-box seam is eliminated because everything runs on Windows.

### 10. Box 2 (Ares/August) + Scanner MCPs + Paperclip-MCP

| Component | Current Setup | Post-Migration Setup | Decision |
|-----------|--------------|---------------------|----------|
| Ares (Box 2 VM) | Linux at `100.68.190.105:18790` | **Stay on Box 2** — repoint to Windows Paperclip | Keep co-located on Box 2 |
| Scanner MCPs | Box 2, tunneled through Box 1 to PG | Box 2, **directly** to Windows Paperclip API | Keep on Box 2, remove Box 1 dependency |
| Paperclip-MCP | Box 2, tunneled through Box 1 | Box 2, direct to Windows | Keep on Box 2 |
| zeus-sidecar | Box 2, port 18790 | Stay on Box 2, update gateway URL | Keep on Box 2 |

**Why keep Box 2:** The scanner MCPs (GitHubScanner, CodingConnection, etc.) and Paperclip-MCP run as daemons on the Linux VM. Moving them to Windows adds no value and risks breaking their Linux-native dependencies. Just repoint their Paperclip API endpoints from `localhost:3100` (Box 1 tunnel) to `127.0.0.1:3100` (Windows). The `zeus-sidecar` stays on Box 2 as the agent WebSocket server, and its gatewayURL in each agent's Paperclip record must point to Box 2's Tailscale address.

**Co-location decision:** Box 2 stays as the agent runtime host. Windows becomes the Paperclip server + DB host. This is the correct split — compute (agents) on Box 2, data (Paperclip) on Windows.

### 11. Env / Secrets

| Secret | Mac Location | Windows Location | Notes |
|--------|-------------|-----------------|-------|
| DeepSeek API key | `~/.zshrc` export + `~/paperclip/.env` | `~\.paperclip\.env` or `User%` env vars | Move to `.env` in repo or system env |
| Firecrawl API key | `~/.zshrc` export + `.env` | Same | Move to `.env` |
| ElevenLabs key | `.env` | Same | Move to `.env` |
| FAL key | `.env` | Same | Move to `.env` |
| GLM / Z.ai key | `.env` | Same | Move to `.env` |
| OpenAI key | `.env` | Same | Move to `.env` |
| Anthropic key | `.env` | Same | Move to `.env` |
| Paperclip DB password | `~/.zshrc` + PG_HBA trust auth | `.env` `PGPASSWORD` | Switch from trust to password auth |
| cloudflared token | Embedded in launchd plist arg | NSSM service args | Move to service config |
| Hermes secrets | `~/.hermes/*/.env` | `~\AppData\Local\hermes\*\.env` | Copy files |

**Rules:**
- **Never print keys in output.** Redact all but last 4 chars.
- **Never commit secrets to git.** `.env` is gitignored.
- **ACLs instead of chmod:** On Windows, use `icacls` to restrict file permissions instead of `chmod 600`. Default `.env` location under user profile is already user-only.
- **Move from `~/.zshrc`** — Windows has no `.zshrc` by default. Use `.env` files sourced by the startup scripts, or Windows `setx` for system-level env vars (rare — prefer `.env`).

### 12. Line Endings / Git autocrlf / Case Sensitivity

| Issue | Mac | Windows | Fix |
|-------|-----|---------|-----|
| Line endings | `LF` (Unix) | `CRLF` default | **Set `git config core.autocrlf input`** — commits LF, checks out LF. Avoids CRLF in shell scripts. |
| Case sensitivity | **Case-sensitive** filesystem (APFS) | **Case-insensitive** (NTFS) | **Major risk.** Two files named `Foo.ts` and `foo.ts` are different on Mac but the same on Windows. Grep repo for case collisions: `find . -name '*.ts' | tr '[:upper:]' '[:lower:]' | sort | uniq -d` |
| Git case collisions | Repo may have case-only filename diffs | NTFS may silently clobber | Run `git mv` before checkout on Windows to disambiguate |
| shebang lines | `#!/bin/bash` or `#!/usr/bin/env bash` | Git Bash at `C:\Program Files\Git\bin\bash.exe` | shebang works in Git Bash; paths may need adjustment |
| Execute bit | `chmod +x` (stored in git) | No execute bit in NTFS | `git config core.filemode false` |
| Line ending detection | Git auto-detects LF | Git may detect CRLF | `.gitattributes`: `* text=auto eol=lf` for shell scripts |
| npm scripts `cross-env` | `PORT=3100` | `cross-env` needed | Already using `cross-env` in server scripts ✓ |

**.gitattributes recommendation for migration:**
```
* text=auto
*.sh text eol=lf
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.json text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.md text eol=lf
*.env text eol=lf
```

### 13. External App Dependencies — Baily's App & MissionControl

**Traced by source-code audit of Paperclip server. These are the ONLY external apps that hit a Paperclip endpoint from outside the Tailnet/agent infrastructure.**

#### Baily's App (iOS)

| Aspect | Finding |
|--------|---------|
| **What it is** | iOS app (ships as an IPA) — "Daily planner & focus companion shipping real user feedback." |
| **Where it connects** | `POST https://paperclip.augiport.com/api/app-feedback` → **public tunnel** endpoint |
| **Auth** | `x-app-token` header. Default: `baily-feedback-7c4f2a9e` (configurable via `APP_FEEDBACK_TOKEN` env var). Ships in the IPA — NOT a secret, defense-in-depth speed bump. |
| **Route location in code** | `server/src/app.ts` lines 367–451. **Mounted BEFORE the auth-guarded `/api` router** — intentionally reachable off-Tailnet with no session. |
| **What it does** | Creates Paperclip issues (`originKind: "app-feedback"`, `originId: "bailysapp"`) as user-submitted bugs/feature requests, including optional base64 photo attachments. Creates issues in the Tyler Co company (`414c172d...`). |
| **Survives move?** | **✅ YES** — hits the public tunnel. As long as `cloudflared` on Windows forwards `paperclip.augiport.com → localhost:<paperclip-port>`, this endpoint works identically. No config change needed in Baily's App. |
| **Cutover risk** | None — the public DNS stays `paperclip.augiport.com`. The tunnel target changes from Box 1 to Windows during Phase 4. If cloudflared is up on Windows, the app keeps working. |
| **Rollback risk** | If Windows cloudflared fails after cutover but Box 1 tunnel is still down, Baily's App goes dark. **Mitigation:** keep Box 1 tunnel alive during Phase 4 soak window, only kill it after the app is verified working against Windows. |

#### MissionControl (AugiMissionControl)

| Aspect | Finding |
|--------|---------|
| **What it is** | "The operations cockpit — your agent fleet's home base." A Paperclip UI feature accessible via the App Dev tab at `GET /api/app-dev/apps` → `key: "missioncontrol"`, `kind: "cockpit"`. **Has NO separate backend** — it IS part of Paperclip's own server codebase (`repo: paperclipai/paperclip`). |
| **Where it connects** | **Paperclip's own API** — wherever Paperclip is served. If accessed via the public tunnel: `https://paperclip.augiport.com/api/app-dev/apps`. If accessed locally: `http://localhost:3100/api/app-dev/apps`. No external hostname. |
| **Auth** | Whatever Paperclip auth applies (Bearer token / session for the guarded API routes). |
| **What it does** | Aggregated dashboard for app dev operations: app registry (apps + feedback counts), image generation gallery ("Library" tab), build pipeline status. Also reads `GET /api/image-studio/generations`. |
| **Survives move?** | **✅ YES** — it's part of Paperclip's server code. When Paperclip runs on Windows, MissionControl runs there too. No separate config to update. |
| **Cutover risk** | Zero — moves with Paperclip. MissionControl is just another route in the Express app. |
| **Rollback risk** | Zero — rolls back with Paperclip. |

#### Post-Cutover Bug-Tests (add to Phase 3 verification)

```
# Baily's App — feedback endpoint works on Windows
curl -s -X POST "http://localhost:3101/api/app-feedback" \
  -H "x-app-token: baily-feedback-7c4f2a9e" \
  -H "Content-Type: application/json" \
  -d '{"kind":"feature","title":"[TEST] Cutover verification","body":"Automated post-cutover test from Windows.","app":"bailysapp","appVersion":"99.test"}' \
  --write-out "\nHTTP %{http_code}\n"
# Expected: 200 {"ok":true,"issueId":"...","attachments":[]}

# Baily's App — token mismatch rejected (security boundary intact)
curl -s -X POST "http://localhost:3101/api/app-feedback" \
  -H "x-app-token: wrong-token" \
  -H "Content-Type: application/json" \
  -d '{"kind":"bug","title":"[TEST] Bad token"}' \
  --write-out "\nHTTP %{http_code}\n"
# Expected: 401 {"error":"unauthorized"}

# MissionControl — App Dev API serves cockpit data
curl -s "http://localhost:3101/api/companies/414c172d-7013-4728-b781-aad604d8e2d7/app-dev/apps" \
  -H "Cookie: <session-cookie-or-bearer-token>" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);apps=d.get('apps',[]);print([a['name']+'('+a['kind']+')' for a in apps])"
# Expected: ["MissionControl(cockpit)", "Baily's App(app)"]

# Baily's App — feedback endpoint via public tunnel (post-cutover only)
curl -s -X POST "https://paperclip.augiport.com/api/app-feedback" \
  -H "x-app-token: baily-feedback-7c4f2a9e" \
  -H "Content-Type: application/json" \
  -d '{"kind":"feature","title":"[TEST] Post-cutover validation","body":"Hit via public tunnel after cutover.","app":"bailysapp","appVersion":"99.test"}' \
  --write-out "\nHTTP %{http_code}\n"
# Expected: 200

# Verify test feedback issue was created in Paperclip
curl -s "http://localhost:3101/api/companies/414c172d-7013-4728-b781-aad604d8e2d7/issues?originKind=app-feedback&originId=bailysapp&limit=1" \
  -H "Cookie: <session>" | python3 -c "import sys,json;d=json.load(sys.stdin);items=d.get('issues',d.get('data',[]));print(f'Latest feedback: {items[0][\"title\"]}' if items else 'No feedback found')"
# Expected: "[Baily • feature] [TEST] Cutover verification"
```

**Critical gate:** Baily's App feedback test **must pass** against the Windows server AND against the public tunnel (after cloudflared is repointed) before cutover is finalized. MissionControl is verified implicitly when the Paperclip UI loads and the App Dev tab shows the cockpit card.

---

## What This Fixes

### 🔴 SPOF Eliminated: Box 1 Mac Mini

| Risk | Before (Mac) | After (Windows) |
|------|-------------|-----------------|
| Mac Mini crash = full Paperclip outage | ✅ Server dies, agents orphaned, UI unreachable | Windows has better uptime, UPS support |
| Mac rebuild = days of downtime | Must reinstall Homebrew, Postgres, Node, rebuild all native deps | Windows already has Node 22.23 |
| Mac disk failure = data loss | APFS on consumer SSD, no hardware RAID | NTFS on desktop hardware |
| Heat/performance throttling | Mac Mini thermal throttles under sustained load | Desktop chassis has active cooling |
| Remote access unreliable | Tailscale + SSH flaky | Windows always on, RDP available |

### 🔴 Cross-Box Seam Eliminated

| Pain Point | Before | After |
|------------|--------|-------|
| SSH tunnel Box 1→Windows port 3100 | Required for Hermes to reach Paperclip | Hermes runs on same machine as Paperclip |
| SSH tunnel Box 1→Windows port 18790 | Required for zeus-sidecar reach | Agents and Paperclip on same network |
| agentBridge.gatewayUrl pointing to Box 2 | Every heartbeat goes through Box 1→Box 2 | Direct Windows→Box 2 |
| Box 1 port proxy (3100→3100) | Forwarding layer adds complexity | Direct access |
| `100.68.190.105:3100` SSH tunnel setup | Separate SSH config maintenance | No tunnel needed — `127.0.0.1:3100` |
| Gateway WS connection flaky | Cross-box WebSocket breaks under load | Same-machine WebSocket reliable |

### 🟡 Other Improvements

- **Faster builds:** Windows has more RAM and CPU than Mac Mini
- **Simplified networking:** Remove `port-proxy`, SSH tunnels, bridge daemon
- **Unified env management:** All env vars in `.env` files, not scattered across `.zshrc` + `.env` + launchd plists
- **Hermes on same host as Paperclip:** No more SSH hop for API calls

---

## What Stays Identical

| Layer | Stays the Same | Reason |
|-------|---------------|--------|
| Database schema | Same Postgres 17.x, same dump/restore | No schema changes |
| Application code | Same git branch, same TS/JS source | Only config changes |
| UI code | Same React components, same routes | No UI changes |
| API endpoints | Same routes, same contracts | Agents don't need updates |
| Agent logic | Same skills, same prompts | Agents are client-side (on Box 2) |
| Plugin architecture | Same plugin loading system | Plugins rebuild, not rewrite |
| Cloudflared tunnel URL | `paperclip.augiport.com` | DNS unchanged |
| Git repo | Same `origin` | No repo migration needed |
| Task board data | Same issues, comments, approvals | DB migration preserves everything |
| User accounts | Same companies, same auth | Auth mechanism unchanged |

---

## Migration Phases

### Phase 0: Inventory + Plan (THIS DOCUMENT)

**Status:** ✅ Written
**Deliverable:** This plan document, saved to `.hermes/plans/2026-06-28_TYL-168_Paperclip-Windows-Migration.md`

### Phase 1: Full Verified Backup

**Critical path — must pass before any migration work.**

1. **Stop the Paperclip server** on Box 1 (gracefully)
2. **`pg_dump`** the paperclip database to a compressed file:
   ```bash
   /opt/homebrew/opt/postgresql@17/bin/pg_dump \
     -U paperclip -h localhost -d paperclip \
     --format=custom --compress=9 \
     --file=/Users/augi/backups/paperclip-$(date +%Y%m%d-%H%M%S).dump
   ```
3. **Tar the repo** excluding `node_modules` and `.git`:
   ```bash
   tar czf /Users/augi/backups/paperclip-repo-$(date +%Y%m%d).tar.gz \
     -C /Users/augi paperclip --exclude=node_modules --exclude=.git
   ```
4. **Tar `~/.paperclip/`** (plugins, uploads, state):
   ```bash
   tar czf /Users/augi/backups/paperclip-dotdir-$(date +%Y%m%d).tar.gz \
     -C /Users/augi .paperclip
   ```
5. **Tar env secrets** (`.env`, `.zshrc`, cloudflared, hermes profiles):
   ```bash
   tar czf /Users/augi/backups/paperclip-env-$(date +%Y%m%d).tar.gz \
     /Users/augi/paperclip/.env \
     /Users/augi/.cloudflared/ \
     /Users/augi/.hermes/ \
     /Users/augi/.openclaw/ \
     /Users/augi/.zshrc
   ```
6. **Copy backups to at least 2 locations:**
   - Local Box 1: `/Users/augi/backups/`
   - Copy to Windows: `scp` or copy via Tailscale/SMB
   - (Optional) Off-box: Backblaze/Dropbox/S3
7. **Checksum verification:**
   ```bash
   sha256sum /Users/augi/backups/*.dump /Users/augi/backups/*.tar.gz
   ```
8. **Test-restore the DB** into a scratch database on either Box 1 or Windows:
   ```bash
   pg_restore --format=custom --dbname=paperclip_test_verify \
     /Users/augi/backups/paperclip-20260628-*.dump
   ```
   Verify row counts match expected baselines (record these counts here after Phase 1 runs):
   - `issues` count:
   - `comments` count:
   - `approvals` count:
   - `agents` count:
   - `companies` count:
   - `skills` count:
   - `plugins` count:
   - `runs` count:

**Blocking gate:** Phase 2 cannot begin until Phase 1 is verified good.

### Phase 2: Stand Up on Windows (Non-Destructive)

Box 1 stays fully live as fallback. All changes on Windows only.

1. **Install PostgreSQL 17.x** on Windows (EDB installer or `winget install PostgreSQL.PostgreSQL.17`)
2. **Restore the DB:**
   ```powershell
   pg_restore -U postgres --format=custom -d paperclip C:\backups\paperclip-20260628.dump
   ```
   - Create `paperclip` role with password
   - Update `pg_hba.conf` for password auth
3. **Copy the env files** from backup to `C:\Users\Augi-T1\paperclip\.env`
   - Update `DATABASE_URL` for Windows PG connection (host, port, password)
   - Update `PAPERCLIP_DATA_DIR` to Windows path
4. **Copy `~/.paperclip/`** to `C:\Users\Augi-T1\.paperclip\`
5. **Fresh `npm install` / `pnpm install`** in repo (NEVER copy node_modules from Mac):
   ```bash
   cd ~/paperclip
   npm install  # or pnpm install
   ```
6. **Rebuild native modules** (sharp, esbuild, better-sqlite3, node-pty, bcrypt):
   ```bash
   npm rebuild
   ```
7. **Install cloudflared:** `winget install Cloudflare.cloudflared`
   - Copy `~/.cloudflared/` to Windows
   - Verify tunnel token
   - Set up as NSSM service
8. **Install NSSM** for Windows services
9. **Set up Task Scheduler** entries for cron replacements
10. **Start Paperclip server** on Windows:
    ```bash
    cd ~/paperclip && npm run dev  # or the equivalent start command
    ```
11. **Box 1 stays running** — the cloudflared tunnel on Mac still points to paperclip.augiport.com, so Tyler accesses Box 1 as usual

### Phase 3: Data Integrity Verification

1. **Row counts match:** Query Windows PG and compare to Phase 1 baseline
2. **Spot-check specific tasks:** TYL-131, 135, 139, 166 — verify they render correctly in UI
3. **Plugins load:** Agent Pixels and other registered plugins initialize
4. **Agents present:** Fleet tab shows all agents
5. **Board renders:** Kanban board loads, columns populated
6. **API responds:** `curl http://localhost:3100/api/health` (or equivalent)
7. **Build gate:** `npm run build` passes on Windows
8. **UI loads:** Hit `http://localhost:3000` (or Paperclip UI port)

### Phase 4: Cutover Hold (Tyler Approves)

**Do NOT cut over until Tyler signs off.**

1. Deliver verified Windows instance + backup proof + integrity report
2. Mark TYL-168 as needs_approval
3. Tyler reviews, either:
   - ✅ **Approve:** Proceed with final cutover
   - 🔄 **Request changes:** Fix issues, re-verify
4. **Upon approval:**
   - Stop Box 1 Paperclip server (graceful shutdown)
   - Stop Box 1 cloudflared tunnel
   - Update cloudflared on Windows to point to Windows Paperclip port
   - Update DNS if needed (should not be — cloudflared handles this)
   - Update Box 2 agent configs to point to Windows endpoints
   - **Verify tunnel:** `https://paperclip.augiport.com` loads Windows Paperclip
   - Box 1 is now cold spare — can be recommissioned later

---

## Rollback Plan

| Scenario | Rollback Action | Estimated Time |
|----------|----------------|---------------|
| Windows PG restore fails | Box 1 stays live, fix backup + retry | 15 min |
| Build fails on Windows | Box 1 stays live, fix deps + retry | 30 min |
| Data integrity mismatch | Box 1 stays live, fix Windows restore + re-verify | 30 min |
| cloudflared tunnel fails on Windows | Box 1 tunnel still active — no user impact | Fix Windows tunnel while Box 1 serves |
| Windows server crashes after cutover | Restart Box 1 server + cloudflared → `paperclip.augiport.com` back to Mac | 5 min |
| Critical bug found only on Windows | Full cutover reverse: Box 1 primary, Windows cold spare | 10 min |

**Golden rule:** Box 1 is untouched until Phase 4 cutover is approved. The rollback is always: stop Windows Paperclip, ensure Box 1 is running, verify paperclip.augiport.com resolves to Box 1.

---

## Estimated Downtime

| Phase | Duration | User-Facing Impact |
|-------|----------|-------------------|
| Phase 1 (Backup) | ~15-30 min | Brief Paperclip pause for clean pg_dump |
| Phase 2 (Windows setup) | ~2-4 hours | **Zero** — Box 1 still live |
| Phase 3 (Verification) | ~30 min | **Zero** — testing against Windows copy |
| Phase 4 Cutover | ~5-10 min | Paperclip unreachable during tunnel switch |

**Total user-facing downtime:** 5-10 minutes at cutover (Phase 4). Plus 15-30 minutes during Phase 1 backup if server must be paused for a clean dump.

---

*End of TYL-168 Plan. Ready for Brainstorm critique on the Mac→Windows Change Matrix addition before dispatch.*
