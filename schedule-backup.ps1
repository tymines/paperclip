# schedule-backup.ps1 — FIX-4: Register safe backup as Windows Scheduled Task
# Non-admin approach: HKCU Run key + persistent Python scheduler
# Windows Scheduled Task requires admin; this runs as a user-logon trigger.
#
# ponytail: single registration script. schtasks needs admin — use Run key + loop.

param(
    [switch]$Register,
    [switch]$Unregister,
    [switch]$Status
)

$taskName = "PaperclipSafeBackup"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$python = (Get-Command python3 -ErrorAction SilentlyContinue) ?? (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) { $python = "python" }
$python = $python.Source
$watchdogScript = "C:\Users\Augi-T1\paperclip\backup-scheduler.py"
$logFile = "C:\Users\Augi-T1\.paperclip\instances\default\data\backups\scheduler.log"

function Log($m) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "$ts  $m" | Add-Content -Path $logFile -ErrorAction SilentlyContinue
    Write-Host "$ts  $m"
}

if ($Status) {
    $regValue = Get-ItemProperty -Path $runKey -Name $taskName -ErrorAction SilentlyContinue
    if ($regValue) {
        Write-Host "Registered in HKCU Run: $($regValue.$taskName)"
    } else {
        Write-Host "NOT registered in HKCU Run"
    }

    # Check if scheduler is running
    $running = Get-Process -Name "python*" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "backup-scheduler" }
    if ($running) {
        Write-Host "Scheduler running: PID $($running.Id)"
    } else {
        Write-Host "Scheduler NOT running"
    }

    # Check last backup
    $backupDir = "C:\Users\Augi-T1\.paperclip\instances\default\data\backups"
    if (Test-Path $logFile) {
        Get-Content $logFile -Tail 10
    }
    exit 0
}

if ($Unregister) {
    Remove-ItemProperty -Path $runKey -Name $taskName -ErrorAction SilentlyContinue
    Log "Unregistered from HKCU Run"
    # Kill running scheduler
    Get-Process -Name "python*" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "backup-scheduler" } |
        Stop-Process -Force
    Log "Scheduler stopped"
    exit 0
}

if ($Register) {
    # Write the Python scheduler script
    $pyContent = @'
"""backup-scheduler.py — Persistent 3 AM backup trigger (FIX-4)
Runs via HKCU Run key at logon. Waits until next 3 AM, then executes
safe-backup.ps1 daily. Independent of Hermes and fleet infrastructure.

ponytail: one script, one loop. No external scheduler dependency.
"""

import subprocess, time, datetime, os, sys

BACKUP_SCRIPT = r"C:\Users\Augi-T1\paperclip\safe-backup.ps1"
LOG_FILE = r"C:\Users\Augi-T1\.paperclip\instances\default\data\backups\scheduler.log"
TARGET_HOUR = 3
TARGET_MINUTE = 0

def log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts}  {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except:
        pass

def seconds_until(hour, minute):
    now = datetime.datetime.now()
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += datetime.timedelta(days=1)
    return (target - now).total_seconds()

def run_backup():
    log("Running safe-backup.ps1...")
    try:
        result = subprocess.run(
            ["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", BACKUP_SCRIPT],
            capture_output=True, text=True, timeout=600,  # 10 min timeout
        )
        log(f"Backup exit: {result.returncode}")
        if result.stdout:
            for line in result.stdout.strip().split("\n")[-5:]:
                log(f"  {line.strip()}")
        if result.returncode != 0 and result.stderr:
            log(f"STDERR: {result.stderr[:500]}")
    except subprocess.TimeoutExpired:
        log("Backup TIMED OUT after 10 minutes")
    except Exception as e:
        log(f"Backup ERROR: {e}")

def main():
    log("=== Backup scheduler started ===")
    log(f"Target: {TARGET_HOUR:02d}:{TARGET_MINUTE:02d} daily")

    while True:
        try:
            wait = seconds_until(TARGET_HOUR, TARGET_MINUTE)
            log(f"Next backup in {wait/3600:.1f} hours ({datetime.datetime.now() + datetime.timedelta(seconds=wait):%Y-%m-%d %H:%M})")

            # Sleep in 5-minute chunks to avoid missing the window
            while wait > 300:
                time.sleep(300)
                wait = seconds_until(TARGET_HOUR, TARGET_MINUTE)

            # Fine-grained sleep for the last 5 minutes
            time.sleep(max(0, wait))

            run_backup()

        except KeyboardInterrupt:
            log("Scheduler stopped by user")
            break
        except Exception as e:
            log(f"Scheduler loop error: {e}")
            time.sleep(60)

if __name__ == "__main__":
    main()
'@

    $pyContent | Set-Content -Path $watchdogScript -Encoding UTF8
    Log "Written: $watchdogScript"

    # Register in HKCU Run
    $cmdLine = "`"$python`" `"$watchdogScript`""
    Set-ItemProperty -Path $runKey -Name $taskName -Value $cmdLine
    Log "Registered in HKCU Run: $cmdLine"

    # Start it now
    $proc = Start-Process -FilePath $python -ArgumentList "`"$watchdogScript`"" -WindowStyle Hidden -PassThru
    Log "Scheduler started: PID $($proc.Id)"

    Write-Host "Backup scheduler registered + started."
    Write-Host "Runs safe-backup.ps1 daily at $TARGET_HOUR`:00 AM."
    Write-Host "Status: schedule-backup.ps1 -Status"
    Write-Host "Unregister: schedule-backup.ps1 -Unregister"
    exit 0
}

Write-Host "Usage: schedule-backup.ps1 -Register | -Unregister | -Status"
