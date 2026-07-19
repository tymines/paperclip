#!/usr/bin/env node
import { execFile } from "node:child_process";
import path from "node:path";
import os from "node:os";

const repoRoot = process.cwd();
const repoRootResolved = path.resolve(repoRoot);
const isWindows = process.platform === "win32";

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        error: error ? error.message : null,
      });
    });
  });
}

async function snapshotPosix() {
  const ps = await run("ps", ["-eo", "pid,ppid,pgid,etime,command"]);
  if (!ps.ok) {
    return { ok: false, error: ps.error, raw: ps.stdout };
  }

  const workerLines = [];
  const workerPids = [];
  for (const line of ps.stdout.split(/\r?\n/)) {
    if (/node.*(?:\(vitest|tinypool|vitest\/dist\/workers)/i.test(line)) {
      workerLines.push(line);
      const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? "", 10);
      if (Number.isInteger(pid) && pid > 0) workerPids.push(pid);
    }
  }

  const own = [];
  for (const pid of workerPids) {
    const lsof = await run("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    let cwd = null;
    for (const line of lsof.stdout.split(/\r?\n/)) {
      if (line.startsWith("n")) {
        cwd = line.slice(1);
        break;
      }
    }
    const resolvedCwd = cwd ? path.resolve(cwd) : null;
    const isOwn =
      resolvedCwd &&
      (resolvedCwd === repoRootResolved || resolvedCwd.startsWith(`${repoRootResolved}${path.sep}`));
    own.push({ pid, cwd: resolvedCwd, own: Boolean(isOwn) });
  }

  return { ok: true, raw: ps.stdout, workerLines, own };
}

async function snapshotWindows() {
  const psCommand =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
  const ps = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
    maxBuffer: 1024 * 1024,
  });
  if (!ps.ok) {
    return { ok: false, error: ps.error, raw: ps.stdout };
  }

  let processes;
  try {
    const parsed = JSON.parse(ps.stdout.trim());
    processes = Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    return { ok: false, error: `JSON parse failed: ${err.message}`, raw: ps.stdout };
  }

  const repoRootLower = repoRootResolved.toLowerCase().replace(/\//g, "\\");
  const workerLines = [];
  const own = [];
  for (const proc of processes) {
    const command = proc.CommandLine || "";
    if (/node.*(?:\(vitest|tinypool|vitest\/dist\/workers)/i.test(command)) {
      const pid = Number.parseInt(proc.ProcessId, 10);
      workerLines.push(`${pid} ${command}`);
      const commandLower = command.toLowerCase().replace(/\//g, "\\");
      const isOwn = commandLower.includes(repoRootLower);
      own.push({ pid, cwd: command, own: Boolean(isOwn) });
    }
  }

  return { ok: true, raw: ps.stdout, workerLines, own };
}

async function main() {
  const snapshot = isWindows ? await snapshotWindows() : await snapshotPosix();
  const report = {
    ts: new Date().toISOString(),
    platform: process.platform,
    repoRoot: repoRootResolved,
    ok: snapshot.ok,
    error: snapshot.error || undefined,
    cwdAttributedPids: snapshot.ok ? snapshot.own.filter((o) => o.own).map((o) => o.pid) : undefined,
    ownSetDetails: snapshot.ok ? snapshot.own : undefined,
    workerLines: snapshot.ok ? snapshot.workerLines : undefined,
    boxWideRaw: snapshot.raw,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(`[snapshot-pidset] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
