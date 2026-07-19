#requires -Version 5.1
<#
.SYNOPSIS
  Windows verification helper for PR #11 v3 (Vitest/tinypool worker-leak fix).

.DESCRIPTION
  Automates the proof steps Zeus runs on his Windows box:
    1. Audit self-test (anti-false-zero).
    2. Scoped suite run with independent survivor cross-check.
    3. Induced-kill: Stop-Process the runner mid-run, then --reap-orphans, then verify zero.

  Run from the repo root with:
    powershell.exe -ExecutionPolicy Bypass -File scripts\verify-worker-reap.ps1
#>

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path .).Path

function Invoke-NodeCapture {
  param([Parameter(Mandatory=$true)][string[]]$NodeArguments)

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & node @NodeArguments 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }

  return [pscustomobject]@{ Output = @($output); ExitCode = $exitCode }
}

function Get-RepoNodeWorkerProcesses {
  return Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
      ($_.CommandLine -like "*vitest*" -or $_.CommandLine -like "*tinypool*") -and
      $_.CommandLine -like "*$repo*"
    } |
    Select-Object ProcessId, ParentProcessId, CommandLine
}

function Invoke-AuditSelfTest {
  Write-Host "`n=== STEP 1: audit self-test ===" -ForegroundColor Cyan
  $result = Invoke-NodeCapture @("scripts/run-vitest-stable.mjs", "--audit-self-test")
  $output = $result.Output
  $output | ForEach-Object { Write-Host $_ }
  if ($result.ExitCode -ne 0) {
    throw "Audit self-test exited $($result.ExitCode)."
  }
  $joined = $output -join "`n"
  if ($joined -notmatch "PASSED \(tracked \+ pattern found, reaped, final zero\)") {
    throw "Audit self-test did not report PASS."
  }
  if ($joined -notmatch "zero cwd-attached vitest/tinypool survivors") {
    throw "Audit self-test did not report zero survivors."
  }
  Write-Host "STEP 1 passed." -ForegroundColor Green
}

function Invoke-ScopedSuiteRun {
  Write-Host "`n=== STEP 2: scoped suite run ===" -ForegroundColor Cyan
  $result = Invoke-NodeCapture @("scripts/run-vitest-stable.mjs", "--mode", "general", "--group", "general-server")
  $output = $result.Output
  $output | ForEach-Object { Write-Host $_ }
  Write-Host "Scoped suite exit code: $($result.ExitCode) (worker-reap proof continues)."
  $joined = $output -join "`n"
  if ($joined -notmatch "zero cwd-attached vitest/tinypool survivors") {
    throw "Scoped suite run did not report zero survivors."
  }

  Write-Host "`nIndependent cross-check after suite exit:" -ForegroundColor Yellow
  $survivors = Get-RepoNodeWorkerProcesses
  $survivors | Format-Table -AutoSize | Out-String | Write-Host
  if ($survivors) {
    throw "Independent cross-check found survivors after scoped suite run."
  }
  Write-Host "STEP 2 passed." -ForegroundColor Green
}

function Invoke-InducedKill {
  Write-Host "`n=== STEP 3: induced-kill (orphaned-tree reality) ===" -ForegroundColor Cyan

  Write-Host "Starting runner..."
  $job = Start-Process -FilePath "node" -ArgumentList "scripts/run-vitest-stable.mjs", "--mode", "general", "--group", "general-server" -PassThru -WindowStyle Normal
  $runnerPid = $job.Id
  Write-Host "Runner PID: $runnerPid"

  Write-Host "Waiting 12s for workers to start..."
  Start-Sleep -Seconds 12

  Write-Host "Mid-run independent check (expect workers):" -ForegroundColor Yellow
  $mid = Get-RepoNodeWorkerProcesses
  $mid | Format-Table -AutoSize | Out-String | Write-Host
  if (-not $mid) {
    Write-Warning "No workers detected mid-run; continuing, but this may indicate a timing issue."
  }

  Write-Host "Force-stopping runner PID $runnerPid ..."
  Stop-Process -Id $runnerPid -Force -ErrorAction SilentlyContinue

  Write-Host "Waiting 5s for settle..."
  Start-Sleep -Seconds 5

  Write-Host "Post-kill independent check (expect orphans):" -ForegroundColor Yellow
  $orphans = Get-RepoNodeWorkerProcesses
  $orphans | Format-Table -AutoSize | Out-String | Write-Host

  Write-Host "Running --reap-orphans ..."
  $reapResult = Invoke-NodeCapture @("scripts/run-vitest-stable.mjs", "--reap-orphans")
  $reapOutput = $reapResult.Output
  $reapOutput | ForEach-Object { Write-Host $_ }
  if ($reapResult.ExitCode -ne 0) {
    throw "Orphan reap exited $($reapResult.ExitCode)."
  }

  Write-Host "Waiting 3s for settle..."
  Start-Sleep -Seconds 3

  Write-Host "Final independent check (expect zero):" -ForegroundColor Yellow
  $final = Get-RepoNodeWorkerProcesses
  $final | Format-Table -AutoSize | Out-String | Write-Host
  if ($final) {
    throw "Final independent check found survivors after --reap-orphans."
  }
  Write-Host "STEP 3 passed." -ForegroundColor Green
}

function Main {
  Invoke-AuditSelfTest
  Invoke-ScopedSuiteRun
  Invoke-InducedKill
  Write-Host "`nAll Windows verification steps passed." -ForegroundColor Green
}

Main
