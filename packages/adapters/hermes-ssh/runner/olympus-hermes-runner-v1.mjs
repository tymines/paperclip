#!/usr/bin/env node
import { spawn } from "node:child_process";
import { link, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROTOCOL = "olympus-hermes-run/v1";
export const WORKSPACE_ROOT = "/Users/augi/shared-agent-workspace";
export const MAX_REQUEST_BYTES = 96 * 1024;
export const MAX_RESULT_BYTES = 128 * 1024;
export const MAX_DEADLINE_MS = 30 * 60 * 1000 + 30 * 1000;
export const PROFILES = Object.freeze({
  atlas: Object.freeze({ role: "builder", model: "SOL", wrapper: "/Users/augi/.local/bin/atlas" }),
  artemis: Object.freeze({ role: "builder", model: "Kimi K3", wrapper: "/Users/augi/.local/bin/artemis" }),
  chronos: Object.freeze({ role: "reviewer", model: "SOL", wrapper: "/Users/augi/.local/bin/chronos" }),
  achlys: Object.freeze({ role: "reviewer", model: "Kimi K3", wrapper: "/Users/augi/.local/bin/achlys" }),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_KEYS = new Set(["protocol", "runId", "agentId", "companyId", "role", "prompt", "deadlineAt", "workspace"]);
const STATE_ROOT = path.join(os.homedir(), ".local", "state", "olympus-hermes-runner", "v1");

function fail(message) {
  throw new Error(message);
}

export function parseRunnerArgs(argv) {
  if (argv.length === 5 && argv[0] === "--cancel" && argv[1] === "--profile" && argv[3] === "--run-id") {
    const profile = argv[2];
    const runId = argv[4];
    if (!Object.hasOwn(PROFILES, profile)) fail("profile is not allowlisted");
    if (!UUID_RE.test(runId)) fail("runId must be a UUID");
    return { operation: "cancel", profile, runId };
  }
  if (argv.length !== 4 || argv[0] !== "--profile" || argv[2] !== "--max-turns") {
    fail("runner requires fixed run or cancellation arguments");
  }
  const profile = argv[1];
  if (!Object.hasOwn(PROFILES, profile)) fail("profile is not allowlisted");
  const maxTurns = Number(argv[3]);
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 25) fail("max-turns is out of bounds");
  return { operation: "run", profile, maxTurns };
}

export function parseRequest(raw, profile) {
  if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) fail("request is oversized");
  let request;
  try { request = JSON.parse(raw); } catch { fail("request is malformed JSON"); }
  if (!request || typeof request !== "object" || Array.isArray(request)) fail("request must be an object");
  if (Object.keys(request).some((key) => !REQUEST_KEYS.has(key))) fail("request contains unsupported fields");
  if (request.protocol !== PROTOCOL) fail("protocol mismatch");
  for (const key of ["runId", "agentId", "companyId"]) {
    if (typeof request[key] !== "string" || !UUID_RE.test(request[key])) fail(`${key} must be a UUID`);
  }
  if (request.role !== PROFILES[profile].role) fail("role does not match profile");
  if (typeof request.prompt !== "string" || Buffer.byteLength(request.prompt, "utf8") > 64 * 1024) fail("prompt is invalid or oversized");
  if (typeof request.deadlineAt !== "string" || !Number.isFinite(Date.parse(request.deadlineAt))) fail("deadlineAt is invalid");
  if (Date.parse(request.deadlineAt) <= Date.now()) fail("request deadline has passed");
  if (Date.parse(request.deadlineAt) - Date.now() > MAX_DEADLINE_MS) fail("request deadline is out of bounds");
  if (!request.workspace || typeof request.workspace !== "object" || Array.isArray(request.workspace) || Object.keys(request.workspace).join() !== "remoteCwd") {
    fail("workspace must contain only remoteCwd");
  }
  if (typeof request.workspace.remoteCwd !== "string") fail("remoteCwd is invalid");
  return request;
}

export async function validateWorkspace(remoteCwd) {
  if (remoteCwd.includes("\0") || remoteCwd.includes("\\") || remoteCwd.split("/").includes("..")) fail("remoteCwd contains traversal");
  const normalized = path.posix.normalize(remoteCwd).replace(/\/$/, "");
  if (normalized !== remoteCwd.replace(/\/$/, "")) fail("remoteCwd is not normalized");
  if (normalized !== WORKSPACE_ROOT && !normalized.startsWith(`${WORKSPACE_ROOT}/`)) fail("remoteCwd escapes approved root");
  const [realRoot, realCwd] = await Promise.all([realpath(WORKSPACE_ROOT), realpath(normalized)]);
  if (realCwd !== realRoot && !realCwd.startsWith(`${realRoot}/`)) fail("remoteCwd resolves outside approved root");
  return realCwd;
}

function envelope(runId, profile, status, result) {
  const value = { protocol: PROTOCOL, runId, profile, status, result };
  if (Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_RESULT_BYTES) return value;
  return { ...value, result: "Hermes result exceeded the permitted size" };
}

export function runStatePaths(profile, runId, stateRoot = STATE_ROOT) {
  const profileDir = path.join(stateRoot, profile);
  return {
    profileDir,
    resultPath: path.join(profileDir, `${runId}.json`),
    lockPath: path.join(profileDir, `${runId}.lock`),
    pidPath: path.join(profileDir, `${runId}.lock`, "pid"),
  };
}

export async function readStoredEnvelope(resultPath) {
  const stored = await readFile(resultPath, "utf8").catch(() => null);
  return stored ? JSON.parse(stored) : null;
}

export async function claimRun(lockPath) {
  try {
    await mkdir(lockPath, { mode: 0o700 });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

export async function persistTerminal(resultPath, value) {
  const temporary = `${resultPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    await link(temporary, resultPath);
    return value;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return readStoredEnvelope(resultPath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function signalProcessTree(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    try { process.kill(pid, signal); } catch { /* already exited */ }
  }
}

export function terminateProcessTree(pid, graceMs = 2_000) {
  signalProcessTree(pid, "SIGTERM");
  const timer = setTimeout(() => signalProcessTree(pid, "SIGKILL"), Math.max(1, graceMs));
  return timer;
}

export function deadlineDelayMs(deadlineAt, now = Date.now()) {
  const parsed = Date.parse(deadlineAt);
  if (!Number.isFinite(parsed)) fail("deadlineAt is invalid");
  return Math.max(1, parsed - now);
}

export function scheduleDeadline(deadlineAt, onDeadline, now = Date.now()) {
  return setTimeout(onDeadline, deadlineDelayMs(deadlineAt, now));
}

export async function prepareRunState(profile, runId, stateRoot = STATE_ROOT) {
  const paths = runStatePaths(profile, runId, stateRoot);
  await mkdir(paths.profileDir, { recursive: true, mode: 0o700 });
  const existing = await readStoredEnvelope(paths.resultPath);
  if (existing) return { kind: "terminal", envelope: existing, paths };
  if (!await claimRun(paths.lockPath)) {
    const terminal = await readStoredEnvelope(paths.resultPath);
    return terminal
      ? { kind: "terminal", envelope: terminal, paths }
      : { kind: "busy", paths };
  }
  const terminalAfterClaim = await readStoredEnvelope(paths.resultPath);
  if (terminalAfterClaim) {
    await rm(paths.lockPath, { recursive: true, force: true });
    return { kind: "terminal", envelope: terminalAfterClaim, paths };
  }
  return { kind: "claimed", paths };
}

export async function registerRunProcess(paths, pid, terminate = terminateProcessTree) {
  try {
    await writeFile(paths.pidPath, `${pid}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    terminate(pid);
    throw error;
  }
  const terminal = await readStoredEnvelope(paths.resultPath);
  if (!terminal) return null;
  terminate(pid);
  await rm(paths.lockPath, { recursive: true, force: true });
  return terminal;
}

export async function coordinateRunStart(paths, pid, isLocallyTerminal, register = registerRunProcess) {
  let stored;
  try {
    stored = await register(paths, pid);
  } catch (error) {
    if (isLocallyTerminal()) return { kind: "local-terminal" };
    throw error;
  }
  if (isLocallyTerminal()) return { kind: "local-terminal" };
  return stored ? { kind: "stored-terminal", envelope: stored } : { kind: "ready" };
}

export async function cancelRunState(profile, runId, stateRoot = STATE_ROOT, terminate = terminateProcessTree) {
  const { profileDir, resultPath, pidPath } = runStatePaths(profile, runId, stateRoot);
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const existing = await readStoredEnvelope(resultPath);
  if (existing) return existing;
  const rawPid = await readFile(pidPath, "utf8").catch(() => "");
  const pid = Number(rawPid.trim());
  if (Number.isInteger(pid) && pid > 0) terminate(pid);
  const value = envelope(runId, profile, "cancelled", "Cancelled by Olympus");
  return persistTerminal(resultPath, value);
}

async function cancelRun(profile, runId) {
  const terminal = await cancelRunState(profile, runId);
  return emit(terminal, terminal.status === "completed" ? 0 : 1);
}

async function readStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) fail("request is oversized");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function emit(value, exitCode) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = exitCode;
}

async function run() {
  const parsedArgs = parseRunnerArgs(process.argv.slice(2));
  activeFailureContext.profile = parsedArgs.profile;
  if (parsedArgs.operation === "cancel") {
    activeFailureContext.runId = parsedArgs.runId;
    return cancelRun(parsedArgs.profile, parsedArgs.runId);
  }
  const { profile, maxTurns } = parsedArgs;
  const request = parseRequest(await readStdin(), profile);
  activeFailureContext.runId = request.runId;
  const cwd = await validateWorkspace(request.workspace.remoteCwd);
  const prepared = await prepareRunState(profile, request.runId);
  if (prepared.kind === "terminal") return emit(prepared.envelope, prepared.envelope.status === "completed" ? 0 : 1);
  if (prepared.kind === "busy") return emit(envelope(request.runId, profile, "failed", "This run/profile tuple is already executing"), 1);
  const { resultPath, lockPath } = prepared.paths;

  let child;
  let terminal = false;
  const persist = async (value) => {
    if (terminal) return false;
    terminal = true;
    const stored = await persistTerminal(resultPath, value);
    await rm(lockPath, { recursive: true, force: true });
    return stored ?? value;
  };
  const cancel = async () => {
    if (child?.pid) terminateProcessTree(child.pid);
    const value = envelope(request.runId, profile, "cancelled", "Cancelled by Olympus");
    const stored = await persist(value);
    if (stored) await emit(stored, stored.status === "completed" ? 0 : 1);
  };
  process.once("SIGTERM", () => { void cancel(); });
  process.once("SIGHUP", () => { void cancel(); });
  process.once("SIGINT", () => { void cancel(); });

  const wrapper = PROFILES[profile].wrapper;
  child = spawn(wrapper, [], {
    cwd,
    env: { ...process.env, OLYMPUS_HERMES_MAX_TURNS: String(maxTurns), OLYMPUS_HERMES_RUN_ID: request.runId },
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let earlyChildError = null;
  const childOutcome = new Promise((resolve) => {
    child.once("error", (error) => {
      earlyChildError = error;
      resolve({ error, code: null });
    });
    child.once("close", (code) => resolve({ error: null, code }));
  });
  if (!child.pid) {
    if (terminal) return;
    const failed = await persist(envelope(request.runId, profile, "failed", "Hermes wrapper failed to start"));
    if (!failed) return;
    return emit(failed, 1);
  }
  try {
    const startState = await coordinateRunStart(prepared.paths, child.pid, () => terminal);
    if (startState.kind === "local-terminal") return;
    if (startState.kind === "stored-terminal") {
      return emit(startState.envelope, startState.envelope.status === "completed" ? 0 : 1);
    }
  } catch {
    if (terminal) return;
    const failed = await persist(envelope(request.runId, profile, "failed", "Hermes runner could not record the wrapper process"));
    if (!failed) return;
    return emit(failed, 1);
  }
  if (terminal) return;
  if (earlyChildError) {
    const failed = await persist(envelope(request.runId, profile, "failed", "Hermes wrapper failed to start"));
    if (!failed) return;
    return emit(failed, 1);
  }
  if (terminal) return;
  child.stdin.end(request.prompt);
  let stdout = "";
  let stdoutBytes = 0;
  let oversized = false;
  child.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_RESULT_BYTES) oversized = true;
    if (!oversized) stdout += String(chunk);
  });
  // Drain stderr without forwarding it; wrappers may include prompts or provider details.
  child.stderr.resume();
  const deadlineTimer = scheduleDeadline(request.deadlineAt, () => {
    if (terminal) return;
    terminateProcessTree(child.pid);
    const value = envelope(request.runId, profile, "cancelled", "Hermes run deadline exceeded");
    void persist(value).then((stored) => {
      if (stored) return emit(stored, stored.status === "completed" ? 0 : 1);
    });
  });
  const outcome = await childOutcome;
  clearTimeout(deadlineTimer);
  if (terminal) return;
  if (outcome.error) {
    const failed = await persist(envelope(request.runId, profile, "failed", "Hermes wrapper failed during execution"));
    return emit(failed, 1);
  }
  const exitCode = outcome.code;
  const status = exitCode === 0 && !oversized ? "completed" : "failed";
  const result = oversized
    ? "Hermes result exceeded the permitted size"
    : exitCode === 0
      ? stdout.trim()
      : `Hermes wrapper exited with code ${exitCode ?? -1}`;
  const value = envelope(request.runId, profile, status, result);
  const terminalValue = await persist(value);
  await emit(terminalValue || value, (terminalValue || value).status === "completed" ? 0 : 1);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
const activeFailureContext = { profile: "atlas", runId: "00000000-0000-4000-8000-000000000000" };
if (isMain) {
  run().catch(async (error) => {
    await emit(envelope(activeFailureContext.runId, activeFailureContext.profile, "failed", error instanceof Error ? error.message : "runner failed"), 1);
  });
}
