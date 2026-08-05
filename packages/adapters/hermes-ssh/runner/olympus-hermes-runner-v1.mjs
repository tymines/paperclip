#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROTOCOL = "olympus-hermes-run/v1";
export const WORKSPACE_ROOT = "/Users/augi/shared-agent-workspace";
export const MAX_REQUEST_BYTES = 96 * 1024;
export const MAX_RESULT_BYTES = 128 * 1024;
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
  if (argv.length !== 4 || argv[0] !== "--profile" || argv[2] !== "--max-turns") {
    fail("runner requires fixed --profile and --max-turns arguments");
  }
  const profile = argv[1];
  if (!Object.hasOwn(PROFILES, profile)) fail("profile is not allowlisted");
  const maxTurns = Number(argv[3]);
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 25) fail("max-turns is out of bounds");
  return { profile, maxTurns };
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
  const bounded = Buffer.byteLength(result, "utf8") <= MAX_RESULT_BYTES ? result : "Hermes result exceeded the permitted size";
  return { protocol: PROTOCOL, runId, profile, status, result: bounded };
}

export function runStatePaths(profile, runId, stateRoot = STATE_ROOT) {
  const profileDir = path.join(stateRoot, profile);
  return {
    profileDir,
    resultPath: path.join(profileDir, `${runId}.json`),
    lockPath: path.join(profileDir, `${runId}.lock`),
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
  const { profile, maxTurns } = parseRunnerArgs(process.argv.slice(2));
  const request = parseRequest(await readStdin(), profile);
  const cwd = await validateWorkspace(request.workspace.remoteCwd);
  const { profileDir, resultPath, lockPath } = runStatePaths(profile, request.runId);
  await mkdir(profileDir, { recursive: true, mode: 0o700 });

  const stored = await readStoredEnvelope(resultPath);
  if (stored) return emit(stored, stored.status === "completed" ? 0 : 1);
  if (!await claimRun(lockPath)) return emit(envelope(request.runId, profile, "failed", "This run/profile tuple is already executing"), 1);

  let child;
  let terminal = false;
  const persist = async (value) => {
    if (terminal) return false;
    terminal = true;
    const temporary = `${resultPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, resultPath);
    await rm(lockPath, { recursive: true, force: true });
    return true;
  };
  const cancel = async () => {
    child?.kill("SIGTERM");
    const value = envelope(request.runId, profile, "cancelled", "Cancelled by Olympus");
    if (await persist(value)) await emit(value, 1);
  };
  process.once("SIGTERM", () => { void cancel(); });
  process.once("SIGHUP", () => { void cancel(); });
  process.once("SIGINT", () => { void cancel(); });

  const wrapper = PROFILES[profile].wrapper;
  child = spawn(wrapper, [], {
    cwd,
    env: { ...process.env, OLYMPUS_HERMES_MAX_TURNS: String(maxTurns), OLYMPUS_HERMES_RUN_ID: request.runId },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
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
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  if (terminal) return;
  const status = exitCode === 0 && !oversized ? "completed" : "failed";
  const result = oversized
    ? "Hermes result exceeded the permitted size"
    : exitCode === 0
      ? stdout.trim()
      : `Hermes wrapper exited with code ${exitCode ?? -1}`;
  const value = envelope(request.runId, profile, status, result);
  await persist(value);
  await emit(value, status === "completed" ? 0 : 1);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  run().catch(async (error) => {
    const profileArg = process.argv[process.argv.indexOf("--profile") + 1];
    const profile = Object.hasOwn(PROFILES, profileArg) ? profileArg : "atlas";
    const runId = "00000000-0000-4000-8000-000000000000";
    await emit(envelope(runId, profile, "failed", error instanceof Error ? error.message : "runner failed"), 1);
  });
}
