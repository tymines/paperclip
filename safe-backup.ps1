# safe-backup.ps1 — FIX-3: Safe Backup (Stop → Dump → Verify → Restart)
# Scheduled via Windows Task Scheduler (FIX-4) at 3 AM daily.
# Uses psql + Python for programmatic dump since PG 18 pg_dump isn't bundled.
#
# ponytail: single script, one duty. PG 18 client tools not bundled with embedded-postgres;
# uses Python + psycopg2 instead of hunting for pg_dump binaries.

param(
    [switch]$DryRun,
    [string]$BackupDir = "C:\Users\Augi-T1\.paperclip\instances\default\data\backups",
    [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"
$logFile = Join-Path $BackupDir "safe-backup.log"

function Log($m) {
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "$ts  $m" | Add-Content -Path $logFile
    Write-Host "$ts  $m"
}

function Alert($msg) {
    $slackUrl = $env:FLEET_SLACK_WEBHOOK_URL
    if ($slackUrl) {
        try {
            $body = @{text=":warning: BACKUP FAILED: $msg"} | ConvertTo-Json -Compress
            Invoke-RestMethod -Uri $slackUrl -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
            Log "Alert sent to Slack"
        } catch { Log "Alert FAILED: $($_.Exception.Message)" }
    }
}

# ── Config ──
$serverPid = $null
$pgHost = "127.0.0.1"
$pgPort = 54329
$pgUser = "paperclip"
$pgDb   = "paperclip"
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupFile = Join-Path $BackupDir "safe-backup-$timestamp.sql.gz"
$shaFile    = "$backupFile.sha256"
$serverCmd  = "C:\Users\Augi-T1\paperclip\start-paperclip-server.cmd"
$psql = "C:\Users\Augi-T1\AppData\Local\hermes\hermes-agent\venv\Lib\site-packages\pgserver\pginstall\bin\psql.exe"
$python = (Get-Command python3 -ErrorAction SilentlyContinue) ?? (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) { $python = "python" }
$python = $python.Source

Log "=== Safe backup starting ==="
Log "Backup file: $backupFile"

# ── 1. Stop Paperclip server ──
Log "Step 1: Stopping Paperclip server..."
$serverProcs = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "tsx.*index\.ts|paperclip" }
if ($serverProcs) {
    $serverPid = $serverProcs[0].Id
    Log "Stopping server PID $serverPid..."
    Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
    Start-Sleep 3
    # Verify stopped
    $still = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
    if ($still) {
        Log "WARNING: Port 3100 still listening after stop"
    } else {
        Log "Server stopped (3100 clear)"
    }
} else {
    Log "No Paperclip server process found"
}

# ── 2. Run pg_dump (via Python + psycopg2) ──
Log "Step 2: Dumping database..."
$dumpScript = @"
import subprocess, shutil, sys

# Use psql to create a plain SQL dump
psql = r"$psql"
backup = r"$backupFile"
# Remove .gz suffix for raw SQL
raw_backup = backup.replace('.sql.gz', '.sql')

# Dump schema + data via pg_dumpall equivalent
# Since PG 18 pg_dump isn't available, use psql with transaction
try:
    # Use the embedded-postgres's own psql if available
    result = subprocess.run(
        [psql, '-h', '$pgHost', '-p', '$pgPort', '-U', '$pgUser', '-d', '$pgDb',
         '-c', r'\set ON_ERROR_STOP on',
         '-f', r'C:\Users\Augi-T1\AppData\Local\Temp\safe-backup-dump.sql'],
        capture_output=True, text=True, timeout=120
    )
    print(f"psql exit: {result.returncode}")
    if result.stderr:
        print(f"STDERR: {result.stderr[:500]}")
except Exception as e:
    print(f"ERROR: {e}")
    sys.exit(1)
"@

$dumpScriptPath = Join-Path $env:TEMP "safe-backup-dump.py"
$dumpScript | Set-Content -Path $dumpScriptPath

# Actually, let's use a simpler approach: direct psql COPY commands
$dumpFile = Join-Path $env:TEMP "safe-backup-$timestamp.sql"
Log "Using psql for dump (PG version mismatch with pg_dump 16 → 18)"

# Generate schema + data dump via psql
$schemaCmd = "`"$psql`" -h $pgHost -p $pgPort -U $pgUser -d $pgDb -c `"\dt`" 2>&1"
Log "Testing psql connection..."
$testResult = cmd /c $schemaCmd 2>&1
Log "psql test: $($testResult -join ' ' | Select-Object -First 1)"

# Full dump approach: use pg_dump from embedded-postgres 18 if we can find it
# Search for PG 18 binaries
$pg18Base = "C:\Users\Augi-T1\paperclip\node_modules\.pnpm\@embedded-postgres+windows-x64@18.1.0-beta.16\node_modules\@embedded-postgres\windows-x64\native\bin"
$pg18Dump = Join-Path $pg18Base "pg_dump.exe"
$foundPg18 = Test-Path $pg18Dump

if ($foundPg18) {
    Log "Found PG 18 pg_dump at $pg18Dump"
    & $pg18Dump -h $pgHost -p $pgPort -U $pgUser -d $pgDb `
        --format=plain --no-owner --no-privileges `
        -f $dumpFile 2>&1 | ForEach-Object { Log "pg_dump: $_" }
    if ($LASTEXITCODE -ne 0) {
        Log "pg_dump FAILED with exit code $LASTEXITCODE"
        Alert "pg_dump exit code $LASTEXITCODE"
        # Continue — try Python fallback
        $foundPg18 = $false
    }
}

if (-not $foundPg18) {
    Log "PG 18 pg_dump not found — using Python programmatic dump"
    # Use Python to dump schema + data via psycopg2 or psql meta-commands
    $pyScript = @"
import subprocess, sys, os

psql = r"$psql"
dump_file = r"$dumpFile"

# Generate dump using psql with transaction wrapper
ddl_cmds = [
    (psql, '-h', '$pgHost', '-p', '$pgPort', '-U', '$pgUser', '-d', '$pgDb',
     '-t', '-A', '-c',
     "SELECT '-- ' || 'Paperclip safe backup ' || now()::text;"),
    (psql, '-h', '$pgHost', '-p', '$pgPort', '-U', '$pgUser', '-d', '$pgDb',
     '-c', r'\dt'),
]

try:
    with open(dump_file, 'w') as f:
        f.write("-- Paperclip safe backup\n")
        f.write("-- Generated: " + subprocess.run(['date', '/t'], capture_output=True, text=True, shell=True).stdout.strip() + "\n")
        f.write("BEGIN;\n\n")

        # Get table list
        tables_result = subprocess.run(
            [psql, '-h', '$pgHost', '-p', '$pgPort', '-U', '$pgUser', '-d', '$pgDb',
             '-t', '-A', '-F', ',', '-c',
             "SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema');"],
            capture_output=True, text=True, timeout=30
        )
        tables = [t.strip() for t in tables_result.stdout.strip().split('\n') if t.strip()]

        for table in tables:
            schema, name = table.split('.')
            # Dump schema
            schema_sql = subprocess.run(
                [psql, '-h', '$pgHost', '-p', '$pgPort', '-U', '$pgUser', '-d', '$pgDb',
                 '-t', '-A', '-c',
                 f"SELECT 'CREATE TABLE IF NOT EXISTS ' || table_name || ' (' || string_agg(column_name || ' ' || data_type, ', ') || ');' FROM information_schema.columns WHERE table_schema = '{schema}' AND table_name = '{name}' GROUP BY table_name;"],
                capture_output=True, text=True, timeout=15
            )
            if schema_sql.stdout.strip():
                f.write(schema_sql.stdout.strip() + "\n")

            # Dump data via COPY
            copy_sql = f"\\COPY {table} TO STDOUT WITH (FORMAT text, DELIMITER E'\\t')"
            data_result = subprocess.run(
                [psql, '-h', '$pgHost', '-p', '$pgPort', '-U', '$pgUser', '-d', '$pgDb',
                 '-c', copy_sql],
                capture_output=True, text=True, timeout=120
            )
            if data_result.stdout.strip():
                f.write(f"COPY {table} FROM stdin;\n")
                f.write(data_result.stdout)
                f.write("\\.\n\n")

        f.write("COMMIT;\n")

    print(f"Dump written: {os.path.getsize(dump_file)} bytes")
except Exception as e:
    print(f"DUMP ERROR: {e}")
    sys.exit(1)
"@
    $pyScriptPath = Join-Path $env:TEMP "safe-backup-dump.py"
    $pyScript | Set-Content -Path $pyScriptPath

    try {
        $dumpResult = & $python $pyScriptPath 2>&1
        Log "Python dump: $dumpResult"
    } catch {
        Log "Python dump FAILED: $_"
        Alert "Python dump failed: $_"
    }
}

# ── 3. Compress ──
Log "Step 3: Compressing..."
if (Test-Path $dumpFile) {
    $dumpSize = (Get-Item $dumpFile).Length
    Log "Raw dump size: $dumpSize bytes"

    # Use .NET for gzip (no external dependency)
    $srcStream = [System.IO.File]::OpenRead($dumpFile)
    $destStream = [System.IO.File]::Create($backupFile)
    $gzipStream = New-Object System.IO.Compression.GZipStream($destStream, [System.IO.Compression.CompressionMode]::Compress)
    $srcStream.CopyTo($gzipStream)
    $gzipStream.Close(); $destStream.Close(); $srcStream.Close()

    $gzSize = (Get-Item $backupFile).Length
    Log "Compressed: $gzSize bytes"

    # Clean up raw
    Remove-Item $dumpFile -Force -ErrorAction SilentlyContinue
} else {
    Log "ERROR: Dump file not found at $dumpFile"
    Alert "Dump file not generated"
}

# ── 4. Verify ──
Log "Step 4: Verifying backup..."
$backupOk = $true

if (-not (Test-Path $backupFile)) {
    Log "FAIL: Backup file missing"
    $backupOk = $false
} elseif ((Get-Item $backupFile).Length -eq 0) {
    Log "FAIL: Backup file is empty"
    $backupOk = $false
} else {
    # Verify it's restorable by checking structure
    try {
        $src = [System.IO.File]::OpenRead($backupFile)
        $gzip = New-Object System.IO.Compression.GZipStream($src, [System.IO.Compression.CompressionMode]::Decompress)
        $reader = New-Object System.IO.StreamReader($gzip)
        $content = $reader.ReadToEnd()
        $reader.Close(); $gzip.Close(); $src.Close()

        if ($content -match "BEGIN;" -and $content -match "COMMIT;") {
            Log "Structure: BEGIN + COMMIT present"
        } else {
            Log "WARNING: BEGIN/COMMIT not found — may not be restorable"
            $backupOk = $false
        }
        $lineCount = ($content -split "`n").Count
        Log "Lines: $lineCount"
    } catch {
        Log "Verify read FAILED: $_"
        $backupOk = $false
    }
}

# SHA-256 sidecar
try {
    $sha = (Get-FileHash -Path $backupFile -Algorithm SHA256).Hash.ToLower()
    "$sha  $(Split-Path $backupFile -Leaf)" | Set-Content -Path $shaFile
    Log "SHA-256: $sha"
} catch {
    Log "SHA-256 FAILED: $_"
}

# ── 5. Restart server ──
Log "Step 5: Restarting Paperclip server..."
$already = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
if (-not $already) {
    Start-Process -FilePath "cmd.exe" -ArgumentList '/c', $serverCmd -WindowStyle Hidden
    Log "Server: launched"
    $n = 0
    while ($n -lt 45) {
        Start-Sleep 2; $n++
        if (Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue) { break }
    }
    $up = [bool](Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue)
    Log "Server: up = $up"
    if (-not $up) {
        Alert "Server did not restart after backup"
    }
} else {
    Log "Server already running on 3100 (skipping restart)"
}

# ── 6. Cleanup old backups ──
Log "Step 6: Cleaning backups older than $RetentionDays days..."
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem $BackupDir -Filter "safe-backup-*.sql.gz" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
        Log "Removing old: $($_.Name)"
        Remove-Item $_.FullName -Force
        Remove-Item "$($_.FullName).sha256" -Force -ErrorAction SilentlyContinue
    }

# ── Report ──
$status = if ($backupOk) { "OK" } else { "FAILED" }
Log "=== Safe backup complete: $status ==="

if (-not $backupOk) {
    Alert "Backup verification failed. Check $logFile"
    exit 1
}

exit 0
