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
            & $pgctl "-D" $dataDir "-l" $pgLog "-o" "-p 5432" "-w" "-t" "60" "start" 2>&1 | ForEach-Object { Log "PG: $_" }
            Log "PG: pg_ctl start issued (exit $LASTEXITCODE)"
        } catch {
            Log "PG: start ERROR $($_.Exception.Message)"
        }
    }
    $n = 0
    while ($n -lt 30 -and -not (Listening 5432)) { Start-Sleep 2; $n++ }
    Log "PG: listening after start = $(Listening 5432)"
}

# 2) Paperclip server (:3100)
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
