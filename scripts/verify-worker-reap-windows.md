# Windows Verification Package for PR #11 (v3 review-fix)

Run everything on a Windows box with Node.js, pnpm, and Git available. Do not run these commands against any other machine.

## 1. Check out the branch

```powershell
git fetch fork
git checkout fix/vitest-worker-leak
pnpm install
```

## 2. Audit self-test (anti-false-zero proof)

This exercises the platform kill-path and proves the audit never resolves an enumeration error to "zero".

```powershell
node scripts/run-vitest-stable.mjs --audit-self-test
```

Expected output:

```text
[test:run] audit self-test: planting sentinels
[test:run] tracked-child sentinel
[test:run] audit self-test: tracked sentinel found=true pid=<N>
[test:run] audit self-test: pattern sentinel found=true pid=<N>
[test:run] audit self-test: reaping sentinels via platform kill-path
[test:run] audit self-test: final enumeration
[test:run] audit self-test: PASSED (tracked + pattern found, reaped, final zero)
[test:run] zero cwd-attached vitest/tinypool survivors
```

If you see `audit unavailable` or `final enumeration not zero`, stop and paste the full output as a PR comment.

## 3. Scoped suite run with runner audit

Run the general-server group. The runner's built-in Windows audit (PowerShell `Get-CimInstance Win32_Process`) must report zero cwd/CommandLine-attributed survivors at the end.

```powershell
node scripts/run-vitest-stable.mjs --mode general --group general-server
```

Expected final lines:

```text
[test:run] zero cwd-attached vitest/tinypool survivors
```

### Independent cross-check (not the runner grading itself)

In another PowerShell window, while the suite is running or immediately after it finishes, run:

```powershell
$repo = (Resolve-Path .).Path
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { ($_.CommandLine -like "*vitest*" -or $_.CommandLine -like "*tinypool*") -and $_.CommandLine -like "*$repo*" } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

After the suite exits, this list should be empty. If it is not empty, those are leaked workers.

## 4. Induced-kill (orphaned-tree reality)

This exercises the case where the runner process is killed mid-run, leaving an orphaned tree. `Stop-Process` alone does not reap the child tree on Windows, so the runner provides a dedicated `--reap-orphans` mode.

1. Start the suite in one PowerShell window and note its PID:

   ```powershell
   $job = Start-Process -FilePath "node" -ArgumentList "scripts/run-vitest-stable.mjs","--mode","general","--group","general-server" -PassThru -WindowStyle Normal
   $job.Id
   ```

2. Wait 10-15 seconds for workers to start, then force-kill only the runner:

   ```powershell
   Stop-Process -Id $job.Id -Force
   ```

3. Wait 5 seconds for the system to settle.

4. Verify orphaned workers exist with the independent check:

   ```powershell
   $repo = (Resolve-Path .).Path
   Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
     Where-Object { ($_.CommandLine -like "*vitest*" -or $_.CommandLine -like "*tinypool*") -and $_.CommandLine -like "*$repo*" } |
     Select-Object ProcessId, ParentProcessId, CommandLine
   ```

   This will usually show orphaned `node (vitest)` / `node.exe` processes.

5. Reap the orphaned tree with the runner's audit/reap mode:

   ```powershell
   node scripts/run-vitest-stable.mjs --reap-orphans
   ```

   Expected output (the PIDs are your own run's explicit PIDs):

   ```text
   [test:run] reaping any cwd-attached vitest/tinypool orphans
   [test:run] leak detected: N cwd-attached worker(s) still alive: <pid1>, <pid2>, ...
   [test:run] escalating to SIGKILL: <pid1>, <pid2>, ...
   ```

6. Run the independent check again:

   ```powershell
   $repo = (Resolve-Path .).Path
   Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
     Where-Object { ($_.CommandLine -like "*vitest*" -or $_.CommandLine -like "*tinypool*") -and $_.CommandLine -like "*$repo*" } |
     Select-Object ProcessId, ParentProcessId, CommandLine
   ```

   Expected: empty list.

## 5. What to paste back

Paste the following into a PR #11 comment:

1. The complete console output from step 2 (`--audit-self-test`).
2. The complete console output from step 3 (scoped suite run), including the final `[test:run] zero cwd-attached vitest/tinypool survivors` line.
3. The output of the independent PowerShell cross-check from step 3.
4. The complete console output from step 4 (induced-kill), including:
   - the runner PID,
   - the independent check showing orphans after `Stop-Process`,
   - the `--reap-orphans` output,
   - the final independent check showing zero.

## Automated helper

`scripts/verify-worker-reap.ps1` automates steps 2-4 above. Run it as:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\verify-worker-reap.ps1
```

Read the script first so you know what it does.
