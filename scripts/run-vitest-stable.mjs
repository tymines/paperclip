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

function getProcessList() {
  return new Promise((resolve) => {
    execFile("ps", ["-eo", "pid,ppid,pgid,etime,command"], (error, stdout) => {
      resolve(error ? "" : String(stdout));
    });
  });
}

function parseWorkerPids(psOutput) {
  const pids = new Set();
  for (const line of psOutput.split(/\r?\n/)) {
    if (!/node.*(?:tinypool|vitest\/dist\/workers)/.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = Number.parseInt(parts[0] ?? "", 10);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  return pids;
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

async function getOwnWorkerPids() {
  const psOutput = await getProcessList();
  const allWorkerPids = parseWorkerPids(psOutput);
  const ownPids = new Set();
  const repoRootResolved = path.resolve(repoRoot);
  for (const pid of allWorkerPids) {
    const cwd = await getCwdForPid(pid);
    if (cwd && path.resolve(cwd).startsWith(`${repoRootResolved}${path.sep}`)) {
      ownPids.add(pid);
    }
  }
  return { psOutput, ownPids };
}

function formatPids(pids) {
  return Array.from(pids).sort((a, b) => a - b).join(", ") || "(none)";
}

async function killTree(signal, target, isWindows) {
  if (isWindows) {
    await new Promise((resolve) => {
      const child = spawn("taskkill", ["/T", "/PID", String(target)], { stdio: "ignore" });
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
  const { ownPids } = await getOwnWorkerPids();
  if (ownPids.size === 0) {
    console.log("[test:run] zero cwd-attached vitest/tinypool survivors");
    return;
  }

  console.error(
    `[test:run] leak detected: ${ownPids.size} cwd-attached worker(s) still alive: ${formatPids(ownPids)}`,
  );
  for (const pid of ownPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Ignore
    }
  }
  await waitForPidsToExit(ownPids, 5000);

  const { ownPids: stillAlive } = await getOwnWorkerPids();
  if (stillAlive.size > 0) {
    console.error(`[test:run] escalating to SIGKILL: ${formatPids(stillAlive)}`);
    for (const pid of stillAlive) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore
      }
    }
    await waitForPidsToExit(stillAlive, 5000);
  }

  const { ownPids: final } = await getOwnWorkerPids();
  if (final.size > 0) {
    console.error(`[test:run] FATAL: could not reap survivors: ${formatPids(final)}`);
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
  console.error(`[test:run] ${message}`);
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
    };
  }

  return {
    mode,
    shardIndex: null,
    shardCount: null,
    group,
    dryRun,
  };
}

function selectSerializedSuites(routeTests, shardIndex, shardCount) {
  return routeTests.filter((_, index) => index % shardCount === shardIndex);
}

async function runVitest(args, label) {
  console.log(`\n[test:run] ${label}`);
  invocationIndex += 1;
  const tempRootParent = process.platform === "win32" ? os.tmpdir() : "/tmp";
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

  const isWindows = process.platform === "win32";
  const command = "pnpm";
  const vitestArgs = ["exec", "vitest", "run", ...args];
  const spawnOptions = {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell: false,
    detached: !isWindows,
  };

  const child = spawn(command, vitestArgs, spawnOptions);
  let exitCode = null;

  const childClosed = new Promise((resolve) => {
    child.on("error", (err) => {
      console.error(`[test:run] Failed to start Vitest: ${err.message}`);
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
    }
    try {
      rmSync(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    createdTempRoots.delete(testRoot);
  }

  if (exitCode !== 0) {
    throw new Error(`Vitest invocation failed with exit code ${exitCode ?? -1}`);
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
  console.log(
    `\n[test:run] serialized shard ${shardIndex + 1}/${shardCount} running ${shardTests.length} of ${routeTests.length} suites`,
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
    console.error(`[test:run] ${err instanceof Error ? err.message : String(err)}`);
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
    console.error(`[test:run] unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
