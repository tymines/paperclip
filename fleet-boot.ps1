# fleet-boot.ps1 - idempotent boot orchestrator for the Paperclip stack.
# Launched at logon via HKCU\...\Run value "FleetBoot" -> fleet-boot.cmd.
# Starts (only if not already up): Postgres 17, Paperclip server, both cloudflared tunnels.
# Safe to run anytime: anything already listening is skipped.

$log = "C:\Users\Augi-T1\paperclip\fleet-boot.log"
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m" | Add-Content -Path $log }
function Listening($port) { return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }

Log "=== fleet-boot start ==="

# 1) Postgres 17 (external DB) - data dir C:\Users\Augi-T1\.hermes\postgresql\data
if (Listening 5432) {
    Log "PG: already up on 5432 (skip)"
} else {
    $pgctl   = "C:\Users\Augi-T1\.hermes\postgresql\pgsql\bin\pg_ctl.exe"
    $dataDir = "C:\Users\Augi-T1\.hermes\postgresql\data"
    $pgLog   = "C:\Users\Augi-T1\.hermes\postgresql\logfile"
    $pidFile = Join-Path $dataDir "postmaster.pid"
    $canStart = $true
    if (Test-Path $pidFile) {
        $stale = ""
        try { $stale = (Get-Content $pidFile -TotalCount 1 -ErrorAction SilentlyContinue).ToString().Trim() } catch { $stale = "" }
        $alive = $null
        if ($stale -match '^\d+$') { $alive = Get-Process -Id ([int]$stale) -ErrorAction SilentlyContinue }
        if ($alive) {
            $canStart = $false
            Log "PG: postmaster.pid pid $stale is alive but 5432 not listening; NOT starting (avoid conflict)"
        } else {
            Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
            Log "PG: removed stale postmaster.pid (pid '$stale' not alive)"
        }
    }
    if ($canStart) {
        try {
            # NOTE (2026-07-04 fix): do NOT pipe pg_ctl output into PowerShell.
            # postgres inherits the pipe handles and the pipeline blocks for minutes
            # after pg_ctl exits, wedging this script before the Server/Tunnels steps
            # (root cause of Paperclip not starting after the 07-03/07-04 crashes).
            # Run via cmd with file redirection instead; -Wait returns when pg_ctl exits.
            $pgOut = "C:\Users\Augi-T1\paperclip\pgctl-start.log"
            $cmdLine = "`"$pgctl`" -D `"$dataDir`" -l `"$pgLog`" -o `"-p 5432`" -w -t 60 start > `"$pgOut`" 2>&1"
            $p = Start-Process -FilePath "cmd.exe" -ArgumentList '/c', $cmdLine -Wait -PassThru -WindowStyle Hidden
            Log "PG: pg_ctl start issued (exit $($p.ExitCode)); output in pgctl-start.log"
        } catch {
            Log "PG: start ERROR $($_.Exception.Message)"
        }
    }
    $n = 0
    while ($n -lt 30 -and -not (Listening 5432)) { Start-Sleep 2; $n++ }
    Log "PG: listening after start = $(Listening 5432)"
}

# 2) PRE-FLIGHT DATA INTEGRITY GUARD (FIX-1: 2026-07-07)
# Guards against destructive first-run db re-initialization when db/ is missing.
# server/src/index.ts:428-440 silently calls embeddedPostgres.initialise() → fresh cluster
# if PG_VERSION is absent. This guard stops the server BEFORE that code path fires.

$instanceDir = "C:\Users\Augi-T1\.paperclip\instances\default"
$pgVersionFile = Join-Path $instanceDir "db\PG_VERSION"
$configFile    = Join-Path $instanceDir "config.json"
$envFile       = Join-Path $instanceDir ".env"
$forceInit     = [Environment]::GetEnvironmentVariable("PAPERCLIP_FORCE_INIT") -eq "true"

if (-not (Test-Path $pgVersionFile)) {
    Log "GUARD: PG_VERSION MISSING in db/ — data directory absent or corrupted"
    $hasArtifacts = (Test-Path $configFile) -or (Test-Path $envFile)
    if ($hasArtifacts) {
        Log "GUARD: config.json/.env exist but db/ is gone — DESTRUCTIVE RE-INIT WOULD FIRE"
        if (-not $forceInit) {
            $msg = @"
:rotating_light: FLEET-BOOT ABORTED — DATA DIRECTORY MISSING

`db/PG_VERSION` not found at `$instanceDir\db\`
but `config.json` / `.env` are present.
The Paperclip server would silently re-initialize a blank database.

**Recovery:**
- Restore from backup: `$instanceDir\data\backups\`
- Or set `PAPERCLIP_FORCE_INIT=true` env var to acknowledge and proceed

Boot aborted at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss').
"@
            Log "GUARD: ABORTING BOOT — data dir missing, no FORCE_INIT override"
            Write-Host $msg
            # Post to Slack #ai-notifications (if Slack webhook configured)
            $slackUrl = $env:FLEET_SLACK_WEBHOOK_URL
            if ($slackUrl) {
                try {
                    $body = @{text=$msg} | ConvertTo-Json -Compress
                    Invoke-RestMethod -Uri $slackUrl -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
                    Log "GUARD: Slack alert posted"
                } catch { Log "GUARD: Slack alert FAILED: $($_.Exception.Message)" }
            }
            exit 1
        } else {
            Log "GUARD: PAPERCLIP_FORCE_INIT=true — bypassing guard (LEGITIMATE FRESH INSTALL)"
        }
    } else {
        Log "GUARD: No config.json/.env either — fresh install, proceeding"
    }
} else {
    $pgVer = Get-Content $pgVersionFile -TotalCount 1
    Log "GUARD: PG_VERSION = $pgVer (OK)"

    # Data integrity assertions — verify the DB has real data before starting server
    $psql = "C:\Users\Augi-T1\AppData\Local\hermes\hermes-agent\venv\Lib\site-packages\pgserver\pginstall\bin\psql.exe"
    if (Test-Path $psql) {
        $integrityOk = $true
        try {
            # Check company exists
            $coCount = & $psql -h 127.0.0.1 -p 54329 -U paperclip -d paperclip -t -A -c "SELECT COUNT(*) FROM companies;" 2>$null
            if ([int]$coCount -eq 0) {
                Log "GUARD: INTEGRITY FAIL — 0 companies in DB"
                $integrityOk = $false
            }
            # Check issues exist
            $issCount = & $psql -h 127.0.0.1 -p 54329 -U paperclip -d paperclip -t -A -c "SELECT COUNT(*) FROM issues;" 2>$null
            if ([int]$issCount -eq 0) {
                Log "GUARD: INTEGRITY FAIL — 0 issues in DB"
                $integrityOk = $false
            }
            # Check agents exist
            $agtCount = & $psql -h 127.0.0.1 -p 54329 -U paperclip -d paperclip -t -A -c "SELECT COUNT(*) FROM agents;" 2>$null
            if ([int]$agtCount -eq 0) {
                Log "GUARD: INTEGRITY FAIL — 0 agents in DB"
                $integrityOk = $false
            }
            if ($integrityOk) {
                Log "GUARD: Data integrity OK — companies=$coCount, issues=$issCount, agents=$agtCount"
            } else {
                Log "GUARD: INTEGRITY CHECK FAILED — aborting boot"
                if (-not $forceInit) {
                    exit 1
                }
            }
        } catch {
            Log "GUARD: Integrity query ERROR (DB not up yet?): $($_.Exception.Message)"
            # Don't abort — DB might not be started yet (embedded PG starts with Paperclip)
        }
    } else {
        Log "GUARD: psql not found at $psql — skipping integrity assertions"
    }
}

# ponytail: single guard block, one exit point. PAPERCLIP_FORCE_INIT is the override.
# postgres binary PATH update after vendor switch if this becomes slow.

# 3) Paperclip server (:3100)
if (Listening 3100) {
    Log "Server: already up on 3100 (skip)"
} else {
    Start-Process -FilePath "cmd.exe" -ArgumentList '/c','C:\Users\Augi-T1\paperclip\start-paperclip-server.cmd' -WindowStyle Hidden
    Log "Server: launched start-paperclip-server.cmd"
    $n = 0
    while ($n -lt 45 -and -not (Listening 3100)) { Start-Sleep 2; $n++ }
    Log "Server: listening after start = $(Listening 3100)"
}

# 3+4) cloudflared tunnels: paperclip-windows + augiport
$cfCount = (Get-Process cloudflared -ErrorAction SilentlyContinue | Measure-Object).Count
if ($cfCount -ge 2) {
    Log "Tunnels: cloudflared count $cfCount (assume up, skip)"
} else {
    Start-Process -FilePath "cmd.exe" -ArgumentList '/c','C:\Users\Augi-T1\scripts\cloudflared-paperclip-windows.bat' -WindowStyle Hidden
    Log "Tunnels: launched paperclip-windows"
    Start-Process -FilePath "C:\Users\Augi-T1\bin\cloudflared.exe" -ArgumentList 'tunnel','--config','C:\Users\Augi-T1\.cloudflared\config.yml','run' -WindowStyle Hidden
    Log "Tunnels: launched augiport-tunnel"
    Start-Sleep 6
    Log "Tunnels: cloudflared count now $((Get-Process cloudflared -ErrorAction SilentlyContinue | Measure-Object).Count)"
}

Log "=== fleet-boot done ==="
