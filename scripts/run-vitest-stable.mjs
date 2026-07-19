#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const repoRoot = process.cwd();
const serverRoot = path.join(repoRoot, "server");
const serverTestsDir = path.join(repoRoot, "server", "src", "__tests__");
const nonServerProjects = [
  "@paperclipai/shared",
  "@paperclipai/db",
  "@paperclipai/adapter-utils",
  "@paperclipai/adapter-acpx-local",
  "@paperclipai/adapter-codex-local",
  "@paperclipai/adapter-opencode-local",
  "@paperclipai/plugin-sdk",
  "@paperclipai/ui",
  "paperclipai",
];
const routeTestPattern = /[^/]*(?:route|routes|authz)[^/]*\.test\.ts$/;
const additionalSerializedServerTests = new Set([
  "server/src/__tests__/approval-routes-idempotency.test.ts",
  "server/src/__tests__/assets.test.ts",
  "server/src/__tests__/authz-company-access.test.ts",
  "server/src/__tests__/companies-route-path-guard.test.ts",
  "server/src/__tests__/company-portability.test.ts",
  "server/src/__tests__/costs-service.test.ts",
  "server/src/__tests__/express5-auth-wildcard.test.ts",
  "server/src/__tests__/health-dev-server-token.test.ts",
  "server/src/__tests__/health.test.ts",
  "server/src/__tests__/heartbeat-dependency-scheduling.test.ts",
  "server/src/__tests__/heartbeat-issue-liveness-escalation.test.ts",
  "server/src/__tests__/heartbeat-process-recovery.test.ts",
  "server/src/__tests__/invite-accept-existing-member.test.ts",
  "server/src/__tests__/invite-accept-gateway-defaults.test.ts",
  "server/src/__tests__/invite-accept-replay.test.ts",
  "server/src/__tests__/invite-expiry.test.ts",
  "server/src/__tests__/invite-join-manager.test.ts",
  "server/src/__tests__/invite-onboarding-text.test.ts",
  "server/src/__tests__/issues-checkout-wakeup.test.ts",
  "server/src/__tests__/issues-service.test.ts",
  "server/src/__tests__/opencode-local-adapter-environment.test.ts",
  "server/src/__tests__/project-routes-env.test.ts",
  "server/src/__tests__/redaction.test.ts",
  "server/src/__tests__/routines-e2e.test.ts",
]);
let invocationIndex = 0;
const serializedModeName = "serialized";
const generalModeName = "general";
const allModeName = "all";
const generalServerGroupName = "general-server";
const generalWorkspacesAGroupName = "general-workspaces-a";
const generalWorkspacesBGroupName = "general-workspaces-b";
const generalWorkspacesAProjects = ["@paperclipai/ui", "paperclipai"];
const generalWorkspacesBProjects = nonServerProjects.filter((project) => !generalWorkspacesAProjects.includes(project));
const generalGroupNames = [generalServerGroupName, generalWorkspacesAGroupName, generalWorkspacesBGroupName];

const createdTempRoots = new Set();
const trackedChildPids = new Set();
const isWindows = process.platform === "win32";
const repoRootResolved = path.resolve(repoRoot);

const WORKER_PATTERN = /node.*(?:\(vitest|tinypool|vitest\/dist\/workers)/i;

function log(message) {
  console.log(`[test:run] ${message}`);
}

function logError(message) {
  console.error(`[test:run] ${message}`);
}

function getProcessList() {
  return new Promise((resolve) => {
    execFile("ps", ["-eo", "pid,ppid,pgid,etime,command"], (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, output: "", error: error.message || String(stderr || error) });
        return;
      }
      resolve({ ok: true, output: String(stdout) });
    });
  });
}

function parsePsOutput(psOutput) {
  const processes = [];
  const pidToPpid = new Map();
  const lines = psOutput.split(/\r?\n/);
  // Skip header line.
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    const ppid = Number.parseInt(match[2], 10);
    const command = match[5].trim();
    if (!Number.isInteger(pid) || pid <= 0) continue;
    processes.push({ pid, ppid, command });
    pidToPpid.set(pid, ppid);
  }
  return { processes, pidToPpid };
}

function isWorkerCommand(command) {
  return WORKER_PATTERN.test(command);
}

function getCwdForPid(pid) {
  return new Promise((resolve) => {
    execFile("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      for (const line of String(stdout).split(/\r?\n/)) {
        if (line.startsWith("n")) {
          resolve(line.slice(1));
          return;
        }
      }
      resolve(null);
    });
  });
}

function collectDescendants(rootPids, pidToPpid) {
  const descendants = new Set(rootPids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, ppid] of pidToPpid) {
      if (!descendants.has(pid) && descendants.has(ppid)) {
        descendants.add(pid);
        changed = true;
      }
    }
  }
  return descendants;
}

async function getOwnWorkerPidsPosix() {
  const result = await getProcessList();
  if (!result.ok) {
    return { ok: false, reason: `ps enumeration failed: ${result.error}`, psOutput: "", ownPids: new Set() };
  }
  const psOutput = result.output;
  const { processes, pidToPpid } = parsePsOutput(psOutput);

  // Descendants of tracked invocation children (includes the tracked children themselves).
  const trackedDescendants = collectDescendants(trackedChildPids, pidToPpid);

  // Pattern-matched node workers whose cwd is under the repo root.
  const ownPids = new Set();
  for (const { pid, command } of processes) {
    if (trackedDescendants.has(pid)) {
      ownPids.add(pid);
      continue;
    }
    if (!isWorkerCommand(command)) continue;
    const cwd = await getCwdForPid(pid);
    if (cwd && (path.resolve(cwd) === repoRootResolved || path.resolve(cwd).startsWith(`${repoRootResolved}${path.sep}`))) {
      ownPids.add(pid);
    }
  }

  return { ok: true, psOutput, ownPids };
}

function getWindowsProcessList() {
  return new Promise((resolve) => {
    const psCommand =
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", psCommand],
      { maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, output: "", error: error.message || String(stderr || error) });
          return;
        }
        resolve({ ok: true, output: String(stdout) });
      },
    );
  });
}

function parseWindowsProcessList(output) {
  const text = output.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
    return [];
  } catch (err) {
    throw new Error(`Win32_Process JSON parse failed: ${err.message}`);
  }
}

async function getOwnWorkerPidsWindows() {
  const result = await getWindowsProcessList();
  if (!result.ok) {
    return { ok: false, reason: `Win32_Process enumeration failed: ${result.error}`, psOutput: "", ownPids: new Set() };
  }
  const psOutput = result.output;
  let processes;
  try {
    processes = parseWindowsProcessList(psOutput);
  } catch (err) {
    return { ok: false, reason: err.message, psOutput, ownPids: new Set() };
  }

  const pidToPpid = new Map();
  const pidToCommand = new Map();
  for (const proc of processes) {
    const pid = Number.parseInt(proc.ProcessId, 10);
    const ppid = Number.parseInt(proc.ParentProcessId, 10);
    const command = proc.CommandLine || "";
    if (Number.isInteger(pid) && pid > 0) {
      pidToPpid.set(pid, Number.isInteger(ppid) && ppid > 0 ? ppid : 0);
      pidToCommand.set(pid, command);
    }
  }

  const trackedDescendants = collectDescendants(trackedChildPids, pidToPpid);
  const repoRootLower = repoRootResolved.toLowerCase().replace(/\//g, "\\");

  const ownPids = new Set();
  for (const [pid, command] of pidToCommand) {
    if (trackedDescendants.has(pid)) {
      ownPids.add(pid);
      continue;
    }
    if (!isWorkerCommand(command)) continue;
    const commandLower = command.toLowerCase().replace(/\//g, "\\");
    if (commandLower.includes(repoRootLower)) {
      ownPids.add(pid);
    }
  }

  return { ok: true, psOutput, ownPids };
}

async function getOwnWorkerPids() {
  if (isWindows) {
    return getOwnWorkerPidsWindows();
  }
  return getOwnWorkerPidsPosix();
}

function formatPids(pids) {
  return Array.from(pids).sort((a, b) => a - b).join(", ") || "(none)";
}

async function killTree(signal, target, targetIsWindows) {
  if (targetIsWindows) {
    await new Promise((resolve) => {
      const child = spawn("taskkill", ["/T", "/F", "/PID", String(target)], { stdio: "ignore" });
      child.on("error", () => resolve(undefined));
      child.on("close", () => resolve(undefined));
    });
    return;
  }
  try {
    process.kill(-target, signal);
  } catch {
    // Ignore
  }
}

async function waitForPidsToExit(pids, timeoutMs = 5000, intervalMs = 200) {
  const remaining = new Set(pids);
  const deadline = Date.now() + timeoutMs;
  while (remaining.size > 0 && Date.now() < deadline) {
    for (const pid of remaining) {
      try {
        process.kill(pid, 0);
      } catch {
        remaining.delete(pid);
      }
    }
    if (remaining.size > 0) {
      await delay(intervalMs);
    }
  }
  return remaining;
}

async function enforceZeroSurvivors() {
  const audit = await getOwnWorkerPids();
  if (!audit.ok) {
    logError(`audit unavailable: ${audit.reason}`);
    logError("FATAL: cannot enumerate survivors; refusing to report zero");
    process.exitCode = 1;
    return;
  }

  const { ownPids } = audit;
  if (ownPids.size === 0) {
    log("zero cwd-attached vitest/tinypool survivors");
    return;
  }

  logError(`leak detected: ${ownPids.size} cwd-attached worker(s) still alive: ${formatPids(ownPids)}`);
  for (const pid of ownPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore
    }
  }
  await waitForPidsToExit(ownPids, 5000);

  const secondAudit = await getOwnWorkerPids();
  if (!secondAudit.ok) {
    logError(`audit unavailable during re-check: ${secondAudit.reason}`);
    process.exitCode = 1;
    return;
  }
  const stillAlive = secondAudit.ownPids;
  if (stillAlive.size > 0) {
    logError(`escalating to SIGKILL: ${formatPids(stillAlive)}`);
    for (const pid of stillAlive) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore
      }
    }
    await waitForPidsToExit(stillAlive, 5000);
  }

  const finalAudit = await getOwnWorkerPids();
  if (!finalAudit.ok) {
    logError(`audit unavailable during final check: ${finalAudit.reason}`);
    process.exitCode = 1;
    return;
  }
  const final = finalAudit.ownPids;
  if (final.size > 0) {
    logError(`FATAL: could not reap survivors: ${formatPids(final)}`);
    process.exitCode = 1;
  }
}

function cleanupTempRoots() {
  for (const root of createdTempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      files.push(...walk(absolute));
    } else if (stats.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function toRepoPath(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function toServerPath(file) {
  return path.relative(serverRoot, file).split(path.sep).join("/");
}

function isRouteOrAuthzTest(file) {
  if (routeTestPattern.test(file)) {
    return true;
  }

  return additionalSerializedServerTests.has(file);
}

function fail(message) {
  logError(message);
  process.exit(1);
}

function readOptionValue(argv, index, argName) {
  const value = argv[index + 1];
  if (value === undefined) {
    fail(`Missing value for ${argName}`);
  }

  return value;
}

function parseNonNegativeInteger(value, argName) {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isInteger(parsed) || parsed < 0) {
    fail(`${argName} must be a non-negative integer. Received "${value}".`);
  }

  return parsed;
}

function parsePositiveInteger(value, argName) {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isInteger(parsed) || parsed < 1) {
    fail(`${argName} must be a positive integer. Received "${value}".`);
  }

  return parsed;
}

function parseCliOptions(argv) {
  let mode = allModeName;
  let shardIndex = null;
  let shardCount = null;
  let group = null;
  let dryRun = false;
  let auditSelfTest = false;
  let reapOrphans = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }

    if (arg === "--mode") {
      mode = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
      continue;
    }

    if (arg === "--shard-index") {
      shardIndex = parseNonNegativeInteger(readOptionValue(argv, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--shard-index=")) {
      shardIndex = parseNonNegativeInteger(arg.slice("--shard-index=".length), "--shard-index");
      continue;
    }

    if (arg === "--shard-count") {
      shardCount = parsePositiveInteger(readOptionValue(argv, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--shard-count=")) {
      shardCount = parsePositiveInteger(arg.slice("--shard-count=".length), "--shard-count");
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--group") {
      group = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--group=")) {
      group = arg.slice("--group=".length);
      continue;
    }

    if (arg === "--audit-self-test") {
      auditSelfTest = true;
      continue;
    }

    if (arg === "--reap-orphans") {
      reapOrphans = true;
      continue;
    }

    fail(`Unknown argument "${arg}".`);
  }

  if (!new Set([allModeName, generalModeName, serializedModeName]).has(mode)) {
    fail(`Unknown mode "${mode}". Expected one of: ${allModeName}, ${generalModeName}, ${serializedModeName}.`);
  }

  if ((shardIndex === null) !== (shardCount === null)) {
    fail("--shard-index and --shard-count must be provided together.");
  }

  if (mode !== serializedModeName && shardIndex !== null) {
    fail("--shard-index/--shard-count are only valid with --mode serialized.");
  }

  if (group !== null && mode !== generalModeName) {
    fail("--group is only valid with --mode general.");
  }

  if (group !== null && !generalGroupNames.includes(group)) {
    fail(`Unknown group "${group}". Expected one of: ${generalGroupNames.join(", ")}.`);
  }

  if (mode === serializedModeName) {
    const resolvedShardCount = shardCount ?? 1;
    const resolvedShardIndex = shardIndex ?? 0;
    if (resolvedShardIndex >= resolvedShardCount) {
      fail(`--shard-index must be less than --shard-count. Received ${resolvedShardIndex} of ${resolvedShardCount}.`);
    }

    return {
      mode,
      shardIndex: resolvedShardIndex,
      shardCount: resolvedShardCount,
      group: null,
      dryRun,
      auditSelfTest,
      reapOrphans,
    };
  }

  return {
    mode,
    shardIndex: null,
    shardCount: null,
    group,
    dryRun,
    auditSelfTest,
    reapOrphans,
  };
}

function selectSerializedSuites(routeTests, shardIndex, shardCount) {
  return routeTests.filter((_, index) => index % shardCount === shardIndex);
}

async function runTrackedCommand(command, args, env, label) {
  log(`${label}`);
  invocationIndex += 1;

  const spawnOptions = {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell: isWindows,
    detached: !isWindows,
  };

  const child = spawn(command, args, spawnOptions);
  let exitCode = null;

  if (child.pid) {
    trackedChildPids.add(child.pid);
  }

  const childClosed = new Promise((resolve) => {
    child.on("error", (err) => {
      logError(`Failed to start ${command}: ${err.message}`);
      exitCode = 1;
      resolve();
    });
    child.on("close", (code) => {
      exitCode = code ?? 1;
      resolve();
    });
  });

  const forwardSignal = async (signal) => {
    if (!child.pid) return;
    await killTree(signal, child.pid, isWindows);
  };

  const sigintHandler = () => forwardSignal("SIGINT");
  const sigtermHandler = () => forwardSignal("SIGTERM");

  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

  try {
    await childClosed;
  } finally {
    process.off("SIGINT", sigintHandler);
    process.off("SIGTERM", sigtermHandler);
    if (child.pid) {
      await killTree("SIGTERM", child.pid, isWindows);
      await waitForPidsToExit([child.pid], 5000);
      trackedChildPids.delete(child.pid);
    }
  }

  if (exitCode !== 0) {
    throw new Error(`${command} invocation failed with exit code ${exitCode ?? -1}`);
  }
}

async function runVitest(args, label) {
  invocationIndex += 1;
  const tempRootParent = isWindows ? os.tmpdir() : "/tmp";
  const testRoot = mkdtempSync(path.join(tempRootParent, `pcvt-${process.pid}-${invocationIndex}-`));
  createdTempRoots.add(testRoot);
  // Keep per-run paths compact so Unix socket fixtures stay under macOS path limits.
  const env = {
    ...process.env,
    PAPERCLIP_HOME: path.join(testRoot, "h"),
    PAPERCLIP_INSTANCE_ID: `vt-${process.pid}-${invocationIndex}`,
    TMPDIR: path.join(testRoot, "t"),
  };
  mkdirSync(env.PAPERCLIP_HOME, { recursive: true });
  mkdirSync(env.TMPDIR, { recursive: true });

  try {
    await runTrackedCommand("pnpm", ["exec", "vitest", "run", ...args], env, label);
  } finally {
    try {
      rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    createdTempRoots.delete(testRoot);
  }
}

async function runGeneralSuites(routeTests) {
  for (const groupName of generalGroupNames) {
    await runGeneralGroup(routeTests, groupName);
  }
}

async function runProjectGroup(projects, groupName) {
  for (const project of projects) {
    await runVitest(["--project", project], `${groupName} project ${project}`);
  }
}

async function runGeneralGroup(routeTests, groupName) {
  if (groupName === generalServerGroupName) {
    const excludeRouteArgs = routeTests.flatMap((file) => ["--exclude", file.serverPath]);
    await runVitest(
      ["--project", "@paperclipai/server", ...excludeRouteArgs],
      `${groupName} server suites excluding ${routeTests.length} serialized suites`,
    );
    return;
  }

  if (groupName === generalWorkspacesAGroupName) {
    await runProjectGroup(generalWorkspacesAProjects, groupName);
    return;
  }

  if (groupName === generalWorkspacesBGroupName) {
    await runProjectGroup(generalWorkspacesBProjects, groupName);
    return;
  }

  fail(`Unknown group "${groupName}".`);
}

async function runSerializedSuites(routeTests, shardIndex, shardCount) {
  const shardTests = selectSerializedSuites(routeTests, shardIndex, shardCount);
  log(
    `serialized shard ${shardIndex + 1}/${shardCount} running ${shardTests.length} of ${routeTests.length} suites`,
  );

  for (const routeTest of shardTests) {
    await runVitest(
      [
        "--project",
        "@paperclipai/server",
        routeTest.repoPath,
        "--pool=forks",
        "--poolOptions.forks.isolate=true",
      ],
      routeTest.repoPath,
    );
  }
}

async function runAuditSelfTest() {
  log("audit self-test: planting sentinels");

  // Tracked-child sentinel: spawned as an invocation child so the audit must find it by descendant walk.
  const trackedSentinelEnv = { ...process.env };
  const trackedSentinelPromise = runTrackedCommand(
    "node",
    ["-e", "setTimeout(function(){},60000)"],
    trackedSentinelEnv,
    "tracked-child sentinel",
  ).catch(() => {
    // Expected to be killed before natural exit.
  });

  // Pattern sentinel: command line contains "tinypool" so the worker filter catches it.
  const patternSentinelEnv = { ...process.env };
  const patternSentinel = spawn(
    "node",
    ["-e", "/* tinypool sentinel */ setTimeout(function(){},60000)", repoRootResolved],
    {
      cwd: repoRoot,
      env: patternSentinelEnv,
      stdio: "ignore",
      shell: false,
      detached: !isWindows,
    },
  );

  if (!patternSentinel.pid) {
    fail("audit self-test: failed to start pattern sentinel");
  }

  // Allow sentinels to settle.
  await delay(800);

  log("audit self-test: first enumeration");
  const firstAudit = await getOwnWorkerPids();
  if (!firstAudit.ok) {
    fail(`audit self-test: first audit unavailable: ${firstAudit.reason}`);
  }

  const trackedPid = trackedChildPids.values().next().value ?? null;
  const patternPid = patternSentinel.pid ?? null;
  const foundTracked = trackedPid !== null && firstAudit.ownPids.has(trackedPid);
  const foundPattern = patternPid !== null && firstAudit.ownPids.has(patternPid);

  log(`audit self-test: tracked sentinel found=${foundTracked} pid=${trackedPid ?? "(none)"}`);
  log(`audit self-test: pattern sentinel found=${foundPattern} pid=${patternPid ?? "(none)"}`);

  if (!foundTracked || !foundPattern) {
    logError(`audit self-test: first enumeration missed sentinels (own=${formatPids(firstAudit.ownPids)})`);
    // Best-effort cleanup.
    if (trackedPid !== null) {
      await killTree("SIGKILL", trackedPid, isWindows);
    }
    if (patternPid !== null) {
      await killTree("SIGKILL", patternPid, isWindows);
    }
    fail("audit self-test: sentinel detection failed");
  }

  log("audit self-test: reaping sentinels via platform kill-path");
  if (trackedPid !== null) {
    await killTree("SIGKILL", trackedPid, isWindows);
    await waitForPidsToExit([trackedPid], 5000);
  }
  if (patternPid !== null) {
    await killTree("SIGKILL", patternPid, isWindows);
    await waitForPidsToExit([patternPid], 5000);
  }

  // Ensure the tracked sentinel promise resolves (it will error/close because we killed it).
  try {
    await Promise.race([trackedSentinelPromise, delay(3000)]);
  } catch {
    // Ignore.
  }

  log("audit self-test: final enumeration");
  const finalAudit = await getOwnWorkerPids();
  if (!finalAudit.ok) {
    fail(`audit self-test: final audit unavailable: ${finalAudit.reason}`);
  }

  if (finalAudit.ownPids.size !== 0) {
    fail(`audit self-test: final enumeration not zero: ${formatPids(finalAudit.ownPids)}`);
  }

  log("audit self-test: PASSED (tracked + pattern found, reaped, final zero)");
}

const routeTests = walk(serverTestsDir)
  .filter((file) => isRouteOrAuthzTest(toRepoPath(file)))
  .map((file) => ({
    repoPath: toRepoPath(file),
    serverPath: toServerPath(file),
  }))
  .sort((a, b) => a.repoPath.localeCompare(b.repoPath));

const options = parseCliOptions(process.argv.slice(2));

async function main() {
  if (options.dryRun) {
    const serializedSuites =
      options.mode === serializedModeName
        ? selectSerializedSuites(routeTests, options.shardIndex, options.shardCount)
        : routeTests;
    console.log(
      JSON.stringify(
        {
          mode: options.mode,
          shardIndex: options.shardIndex,
          shardCount: options.shardCount,
          group: options.group,
          availableGeneralGroups: generalGroupNames,
          serializedSuiteCount: routeTests.length,
          selectedSerializedSuites: serializedSuites.map((routeTest) => routeTest.repoPath),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (options.auditSelfTest) {
    try {
      await runAuditSelfTest();
    } catch (err) {
      logError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    } finally {
      await enforceZeroSurvivors();
    }
    return;
  }

  if (options.reapOrphans) {
    log("reaping any cwd-attached vitest/tinypool orphans");
    await enforceZeroSurvivors();
    return;
  }

  try {
    if (options.mode === generalModeName || options.mode === allModeName) {
      if (options.group) {
        await runGeneralGroup(routeTests, options.group);
      } else {
        await runGeneralSuites(routeTests);
      }
    }

    if (options.mode === serializedModeName || options.mode === allModeName) {
      await runSerializedSuites(routeTests, options.shardIndex ?? 0, options.shardCount ?? 1);
    }
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await enforceZeroSurvivors();
    cleanupTempRoots();
  }
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    logError(`unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
