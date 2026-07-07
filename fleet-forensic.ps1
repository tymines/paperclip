# fleet-forensic.ps1 — FIX-8: Forensic Collection Script (Hephaestus Tool)
# Collects fleet state snapshot for diagnostics. Operated by Hephaestus (seat #17).
# Output: timestamped Markdown report → F:/Augi Vault/08 - Consolidation/
#
# ponytail: one script, one report. No external dependencies beyond what's on the box.

param(
    [switch]$Json,           # Output JSON instead of Markdown
    [string]$OutputDir = "F:\Augi Vault\08 - Consolidation",
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"
$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$fileTimestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputFile = Join-Path $OutputDir "Fleet Forensic $fileTimestamp.md"
$jsonFile = Join-Path $OutputDir "Fleet Forensic $fileTimestamp.json"

$psql = "C:\Users\Augi-T1\AppData\Local\hermes\hermes-agent\venv\Lib\site-packages\pgserver\pginstall\bin\psql.exe"
$pgHost = "127.0.0.1"
$pgPort = 54329
$pgUser = "paperclip"
$pgDb   = "paperclip"

# ── Collectors ──

function Get-DbCount($table) {
    try {
        $result = & $psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -t -A -c "SELECT COUNT(*) FROM $table;" 2>$null
        return ($result -replace '\s+','').Trim()
    } catch { return "ERR" }
}

function Get-DbQuery($query, $label) {
    try {
        $result = & $psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -t -A -c $query 2>$null
        return $result
    } catch { return "ERR" }
}

function Get-ServerStatus {
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:3100/api/health" -TimeoutSec 5
        return $r | ConvertTo-Json -Compress
    } catch { return "DOWN: $_" }
}

# ── Collect ──

$data = @{
    timestamp = $timestamp
    host = $env:COMPUTERNAME
    user = $env:USERNAME
}

# Server status
$data.server = Get-ServerStatus

# DB table counts
$data.db_tables = @{}
@("companies","issues","agents","account","activity_log","agent_api_keys","heartbeat_run_events") | ForEach-Object {
    $data.db_tables[$_] = Get-DbCount $_
}

# Agent roster
$data.agents = @()
$agentRows = Get-DbQuery "SELECT name, role, status, title, adapter_type FROM agents ORDER BY name;" "agents"
if ($agentRows -ne "ERR") {
    $agentRows -split "`n" | ForEach-Object {
        if ($_ -match '^(.+?)\|(.+?)\|(.+?)\|(.+?)\|(.+)$') {
            $data.agents += @{
                name = $Matches[1]
                role = $Matches[2]
                status = $Matches[3]
                title = $Matches[4]
                adapter = $Matches[5]
            }
        }
    }
}

# Backup directory listing
$backupDir = "C:\Users\Augi-T1\.paperclip\instances\default\data\backups"
$data.backups = @()
if (Test-Path $backupDir) {
    Get-ChildItem $backupDir -Filter "*.sql.gz" | Sort-Object LastWriteTime -Descending | Select-Object -First 20 | ForEach-Object {
        $data.backups += @{
            name = $_.Name
            size = $_.Length
            modified = $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
        }
    }
}

# Disk usage
$data.disk = @{}
try {
    $drive = Get-PSDrive -Name C
    $data.disk.C = @{
        used_gb = [math]::Round($drive.Used / 1GB, 2)
        free_gb = [math]::Round($drive.Free / 1GB, 2)
        total_gb = [math]::Round(($drive.Used + $drive.Free) / 1GB, 2)
    }
} catch {}

try {
    $drive = Get-PSDrive -Name F
    $data.disk.F = @{
        used_gb = [math]::Round($drive.Used / 1GB, 2)
        free_gb = [math]::Round($drive.Free / 1GB, 2)
        total_gb = [math]::Round(($drive.Used + $drive.Free) / 1GB, 2)
    }
} catch {}

# Process list — key services
$data.processes = @{}
@(
    @{Name="cloudflared"; Pattern="cloudflared"},
    @{Name="postgres"; Pattern="postgres"},
    @{Name="paperclip-server"; Pattern="tsx.*index"},
    @{Name="hermes"; Pattern="Hermes"}
) | ForEach-Object {
    $procs = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match $_.Pattern }
    if (-not $procs) {
        $procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $_.Pattern }
    }
    $data.processes[$_.Name] = if ($procs) { ($procs | Measure-Object).Count } else { 0 }
}

# Port states
$data.ports = @{}
@(3100, 3101, 5432, 54329) | ForEach-Object {
    $listening = Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue
    $data.ports["$_"] = [bool]$listening
}

# Cron jobs (Hermes)
$data.cron_jobs = @()
try {
    $cronOutput = & hermes cronjob list 2>&1
    $data.cron_raw = ($cronOutput -join "`n")
} catch {
    $data.cron_raw = "hermes CLI not available"
}

# Fleet-boot guard status
$pgVersionFile = "C:\Users\Augi-T1\.paperclip\instances\default\db\PG_VERSION"
$data.guard = @{
    pg_version = if (Test-Path $pgVersionFile) { (Get-Content $pgVersionFile -TotalCount 1) } else { "MISSING" }
    config_exists = Test-Path "C:\Users\Augi-T1\.paperclip\instances\default\config.json"
    fleet_boot_log = if (Test-Path "C:\Users\Augi-T1\paperclip\fleet-boot.log") {
        (Get-Content "C:\Users\Augi-T1\paperclip\fleet-boot.log" -Tail 10) -join "`n"
    } else { "not found" }
}

# ── Output ──

if ($DryRun) {
    Write-Host "Dry run — collected $(($data.PSObject.Properties | Measure-Object).Count) data points"
    exit 0
}

if ($Json) {
    $data | ConvertTo-Json -Depth 4 | Set-Content -Path $jsonFile
    Write-Host "JSON: $jsonFile"
    exit 0
}

# Markdown report
$md = @"
# Fleet Forensic Report

**Generated**: $timestamp  
**Host**: $($env:COMPUTERNAME)  
**User**: $($env:USERNAME)  
**Tool**: fleet-forensic.ps1 (Hephaestus — seat #17)

---

## Server

`$($data.server)`

## Database

| Table | Count |
|-------|-------|
$(
    ($data.db_tables.GetEnumerator() | Sort-Object Name | ForEach-Object {
        "| $($_.Key) | $($_.Value) |"
    }) -join "`n"
)

## Agent Roster ($($data.agents.Count) agents)

| Name | Role | Status | Adapter |
|------|------|--------|---------|
$(
    ($data.agents | ForEach-Object {
        "| $($_.name) | $($_.role) | $($_.status) | $($_.adapter) |"
    }) -join "`n"
)

## Backups (latest 20)

| File | Size | Modified |
|------|------|----------|
$(
    ($data.backups | ForEach-Object {
        $sizeKb = [math]::Round($_.size / 1KB, 1)
        "| $($_.name) | ${sizeKb} KB | $($_.modified) |"
    }) -join "`n"
)

## Disk Usage

| Drive | Used (GB) | Free (GB) | Total (GB) |
|-------|-----------|-----------|-------------|
$(
    ($data.disk.GetEnumerator() | ForEach-Object {
        "| $($_.Key) | $($_.Value.used_gb) | $($_.Value.free_gb) | $($_.Value.total_gb) |"
    }) -join "`n"
)

## Process Status

| Service | Running |
|---------|---------|
$(
    ($data.processes.GetEnumerator() | ForEach-Object {
        $status = if ($_.Value -gt 0) { "✅ ($($_.Value))" } else { "❌" }
        "| $($_.Key) | $status |"
    }) -join "`n"
)

## Port States

| Port | Listening |
|------|-----------|
$(
    ($data.ports.GetEnumerator() | Sort-Object Name | ForEach-Object {
        $status = if ($_.Value) { "✅" } else { "❌" }
        "| $($_.Key) | $status |"
    }) -join "`n"
)

## Guard Status

- **PG_VERSION**: $($data.guard.pg_version)
- **Config exists**: $($data.guard.config_exists)

### Fleet Boot Log (last 10 lines)
```
$($data.guard.fleet_boot_log)
```

---

*Generated by fleet-forensic.ps1 — FIX-8 / Hephaestus tool*
"@

# Ensure output directory exists
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$md | Set-Content -Path $outputFile -Encoding UTF8
Write-Host "Report: $outputFile"
