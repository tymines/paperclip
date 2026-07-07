# install-services.ps1 - RAIL Phase 1 box hardening (idempotent)
# Run as Administrator once. Safe to re-run; skips anything already running.
# Tyler's 30-second morning item. Do NOT run unelevated - will fail with access denied.
#
# What this does:
#   1. Starts OpenSSH server (installed, config correct, just needs START)
#   2. Installs Paperclip server as a Windows service (WinSW wrapper)
#   3. Installs cloudflared tunnel as a Windows service
#   4. Verifies PostgreSQL auto-start via existing HKCU Run entry
#
# All services: auto-start, restart-on-failure. No console login needed post-reboot.
# fleet-boot.ps1 stays as fallback; services take over the primary path.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$log = Join-Path $PSScriptRoot 'install-services.log'
function Log($m) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "$ts  $m" | Add-Content -Path $log
    Write-Host "$ts  $m"
}

Log '=== install-services.ps1 start ==='

# --- 1. OpenSSH server -----------------------------------------------
$sshd = Get-Service sshd -ErrorAction SilentlyContinue
if ($sshd -and $sshd.Status -eq 'Running') {
    Log 'sshd: already running (skip)'
} else {
    Set-Service sshd -StartupType Automatic
    Start-Service sshd
    Log 'sshd: started + auto-start set'
}

# Firewall: allow SSH from Tailscale range only
$fwRule = Get-NetFirewallRule -DisplayName 'SSH (Tailscale only)' -ErrorAction SilentlyContinue
if (-not $fwRule) {
    New-NetFirewallRule -DisplayName 'SSH (Tailscale only)' `
        -Direction Inbound -Protocol TCP -LocalPort 22 `
        -RemoteAddress 100.64.0.0/10 -Action Allow
    Log 'sshd: firewall rule added (tailnet only)'
} else {
    Log 'sshd: firewall rule exists (skip)'
}

# --- 2. Paperclip server as Windows service (WinSW) ------------------
$winswDir = 'C:\Users\Augi-T1\paperclip\services'
$winswExe = Join-Path $winswDir 'WinSW-x64.exe'
$paperclipXml = Join-Path $winswDir 'paperclip-server.xml'

if (-not (Test-Path $winswDir)) { New-Item -ItemType Directory -Path $winswDir -Force | Out-Null }

if (-not (Test-Path $winswExe)) {
    Log 'winsw: downloading...'
    Invoke-WebRequest -Uri 'https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.5/WinSW-x64.exe' `
        -OutFile $winswExe
}

$xmlContent = @'
<service>
  <id>PaperclipServer</id>
  <name>Paperclip Server</name>
  <description>Paperclip control-plane server (port 3100)</description>
  <executable>C:\Users\Augi-T1\paperclip\start-paperclip-server.cmd</executable>
  <workingdirectory>C:\Users\Augi-T1\paperclip\server</workingdirectory>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
'@
$xmlContent | Set-Content -Path $paperclipXml

$svc = Get-Service PaperclipServer -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq 'Running') {
    Log 'paperclip-server: already running (skip)'
} else {
    & $winswExe install $paperclipXml
    Start-Service PaperclipServer
    Log 'paperclip-server: installed + started'
}

# --- 3. cloudflared tunnel as service ---------------------------------
$cfSvc = Get-Service cloudflared -ErrorAction SilentlyContinue
if ($cfSvc -and $cfSvc.Status -eq 'Running') {
    Log 'cloudflared: already running (skip)'
} else {
    $cf = 'C:\Users\Augi-T1\bin\cloudflared.exe'
    if (Test-Path $cf) {
        & $cf service install
        Start-Service cloudflared
        Log 'cloudflared: installed + started'
    } else {
        Log "cloudflared: binary not found at $cf - SKIP (fleet-boot handles)"
    }
}

# --- 4. PostgreSQL auto-start via registry ----------------------------
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$fleetBoot = Get-ItemProperty -Path $runKey -Name 'FleetBoot' -ErrorAction SilentlyContinue
if ($fleetBoot) {
    Log 'pg/fleet: HKCU Run FleetBoot entry exists (skip)'
} else {
    Set-ItemProperty -Path $runKey -Name 'FleetBoot' -Value 'C:\Users\Augi-T1\paperclip\fleet-boot.cmd'
    Log 'pg/fleet: HKCU Run FleetBoot added'
}

# --- Done --------------------------------------------------------------
Log '=== install-services.ps1 done ==='
Log ''
Log 'Verify:'
Log '  sc query sshd'
Log '  sc query PaperclipServer'
Log '  sc query cloudflared'
Log '  ssh Augi-T1@100.103.95.73  # from Box 1'
