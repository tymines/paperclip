import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROTOCOL,
  PROFILES,
  cancelRunState,
  claimRun,
  coordinateRunStart,
  deadlineDelayMs,
  parseRequest,
  parseRunnerArgs,
  persistTerminal,
  prepareRunState,
  readStoredEnvelope,
  registerRunProcess,
  runStatePaths,
  scheduleDeadline,
  terminateProcessTree,
} from "./olympus-hermes-runner-v1.mjs";

const temporaryDirs = [];
afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const request = {
  protocol: PROTOCOL,
  runId: "11111111-1111-4111-8111-111111111111",
  agentId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  role: "builder",
  prompt: "do work",
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  workspace: { remoteCwd: "/Users/augi/shared-agent-workspace/project" },
};

describe("versioned Hermes runner", () => {
  it("compiles the exact wrapper allowlist", () => {
    expect(PROFILES).toEqual({
      atlas: { role: "builder", model: "SOL", wrapper: "/Users/augi/.local/bin/atlas" },
      artemis: { role: "builder", model: "Kimi K3", wrapper: "/Users/augi/.local/bin/artemis" },
      chronos: { role: "reviewer", model: "SOL", wrapper: "/Users/augi/.local/bin/chronos" },
      achlys: { role: "reviewer", model: "Kimi K3", wrapper: "/Users/augi/.local/bin/achlys" },
    });
  });

  it("accepts only fixed bounded runner arguments", () => {
    expect(parseRunnerArgs(["--profile", "atlas", "--max-turns", "10"])).toEqual({ operation: "run", profile: "atlas", maxTurns: 10 });
    expect(parseRunnerArgs(["--cancel", "--profile", "atlas", "--run-id", request.runId])).toEqual({ operation: "cancel", profile: "atlas", runId: request.runId });
    expect(() => parseRunnerArgs(["--profile", "other", "--max-turns", "10"])).toThrow(/not allowlisted/);
    expect(() => parseRunnerArgs(["--profile", "atlas", "--max-turns", "26"])).toThrow(/out of bounds/);
    expect(() => parseRunnerArgs(["--profile", "atlas", "--command", "sh"])).toThrow(/fixed/);
    expect(() => parseRunnerArgs(["--cancel", "--profile", "other", "--run-id", request.runId])).toThrow(/not allowlisted/);
    expect(() => parseRunnerArgs(["--cancel", "--profile", "atlas", "--run-id", "not-a-run-id"])).toThrow(/UUID/);
  });

  it("independently validates request protocol, role, fields, and size", () => {
    expect(parseRequest(JSON.stringify(request), "atlas")).toEqual(request);
    expect(() => parseRequest(JSON.stringify({ ...request, protocol: "other" }), "atlas")).toThrow(/protocol/);
    expect(() => parseRequest(JSON.stringify({ ...request, role: "reviewer" }), "atlas")).toThrow(/role/);
    expect(() => parseRequest(JSON.stringify({ ...request, command: "sh" }), "atlas")).toThrow(/unsupported/);
    expect(() => parseRequest("x".repeat(96 * 1024 + 1), "atlas")).toThrow(/oversized/);
    expect(() => parseRequest(JSON.stringify({ ...request, deadlineAt: new Date(Date.now() - 1_000).toISOString() }), "atlas")).toThrow(/passed/);
    expect(() => parseRequest(JSON.stringify({ ...request, deadlineAt: new Date(Date.now() + 31 * 60_000).toISOString() }), "atlas")).toThrow(/out of bounds/);
  });

  it("deduplicates a run/profile lock and returns stored terminal state on retry", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "hermes-runner-test-"));
    temporaryDirs.push(stateRoot);
    const paths = runStatePaths("atlas", request.runId, stateRoot);
    await mkdir(paths.profileDir, { recursive: true });
    expect(await claimRun(paths.lockPath)).toBe(true);
    expect(await claimRun(paths.lockPath)).toBe(false);
    const terminal = { protocol: PROTOCOL, runId: request.runId, profile: "atlas", status: "completed", result: "stored" };
    await writeFile(paths.resultPath, JSON.stringify(terminal));
    expect(await readStoredEnvelope(paths.resultPath)).toEqual(terminal);
  });

  it("keeps the first terminal result when cancellation races late completion", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "hermes-runner-terminal-test-"));
    temporaryDirs.push(stateRoot);
    const paths = runStatePaths("atlas", request.runId, stateRoot);
    await mkdir(paths.profileDir, { recursive: true });
    expect(await claimRun(paths.lockPath)).toBe(true);
    const cancelled = { protocol: PROTOCOL, runId: request.runId, profile: "atlas", status: "cancelled", result: "deadline" };
    const completed = { ...cancelled, status: "completed", result: "late" };
    expect(await persistTerminal(paths.resultPath, cancelled)).toEqual(cancelled);
    expect(await persistTerminal(paths.resultPath, completed)).toEqual(cancelled);
    expect(await readStoredEnvelope(paths.resultPath)).toEqual(cancelled);
  });

  it("does not reclaim a tuple cancelled before the run claims it", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "hermes-runner-before-claim-"));
    temporaryDirs.push(stateRoot);
    const cancelled = await cancelRunState("atlas", request.runId, stateRoot, () => undefined);
    const prepared = await prepareRunState("atlas", request.runId, stateRoot);
    expect(cancelled.status).toBe("cancelled");
    expect(prepared.kind).toBe("terminal");
    expect(prepared.envelope).toEqual(cancelled);
  });

  it("kills a child when cancellation lands between claim and PID registration", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "hermes-runner-before-pid-"));
    temporaryDirs.push(stateRoot);
    const prepared = await prepareRunState("atlas", request.runId, stateRoot);
    expect(prepared.kind).toBe("claimed");
    const cancelled = await cancelRunState("atlas", request.runId, stateRoot, () => undefined);
    const terminated = [];
    const observed = await registerRunProcess(prepared.paths, 4242, (pid) => terminated.push(pid));
    expect(observed).toEqual(cancelled);
    expect(terminated).toEqual([4242]);
  });

  it("cancels by registered PID and ignores a late child completion", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "hermes-runner-after-pid-"));
    temporaryDirs.push(stateRoot);
    const prepared = await prepareRunState("atlas", request.runId, stateRoot);
    expect(prepared.kind).toBe("claimed");
    expect(await registerRunProcess(prepared.paths, 4343, () => undefined)).toBeNull();
    const terminated = [];
    const cancelled = await cancelRunState("atlas", request.runId, stateRoot, (pid) => terminated.push(pid));
    const completed = { ...cancelled, status: "completed", result: "late" };
    expect(terminated).toEqual([4343]);
    expect(await persistTerminal(prepared.paths.resultPath, completed)).toEqual(cancelled);
  });

  it("lets an in-process signal own terminal emission when it lands during PID registration", async () => {
    let locallyTerminal = false;
    const stored = { protocol: PROTOCOL, runId: request.runId, profile: "atlas", status: "cancelled", result: "signal" };
    const outcome = await coordinateRunStart(
      { pidPath: "unused", resultPath: "unused", lockPath: "unused" },
      4444,
      () => locallyTerminal,
      async () => {
        locallyTerminal = true;
        return stored;
      },
    );
    expect(outcome).toEqual({ kind: "local-terminal" });
  });

  it("never reaches prompt readiness when a signal lands after the PID check", async () => {
    let locallyTerminal = false;
    const outcome = await coordinateRunStart(
      { pidPath: "unused", resultPath: "unused", lockPath: "unused" },
      4545,
      () => locallyTerminal,
      async () => {
        locallyTerminal = true;
        return null;
      },
    );
    expect(outcome).toEqual({ kind: "local-terminal" });
  });

  it("suppresses setup failure output when a signal owns the terminal transition", async () => {
    let locallyTerminal = false;
    const outcome = await coordinateRunStart(
      { pidPath: "unused", resultPath: "unused", lockPath: "unused" },
      4646,
      () => locallyTerminal,
      async () => {
        locallyTerminal = true;
        throw new Error("registration failed after signal");
      },
    );
    expect(outcome).toEqual({ kind: "local-terminal" });
  });

  it("computes a bounded deadline delay and rejects malformed deadlines", () => {
    expect(deadlineDelayMs("2026-08-05T12:00:01.000Z", Date.parse("2026-08-05T12:00:00.000Z"))).toBe(1_000);
    expect(deadlineDelayMs("2026-08-05T11:59:00.000Z", Date.parse("2026-08-05T12:00:00.000Z"))).toBe(1);
    expect(() => deadlineDelayMs("invalid", 0)).toThrow(/invalid/);
  });

  it("arms the actual deadline timer path", async () => {
    const fired = await new Promise((resolve) => {
      scheduleDeadline(new Date(Date.now() + 15).toISOString(), () => resolve(true));
    });
    expect(fired).toBe(true);
  });

  it("escalates cancellation when a child ignores SIGTERM", async () => {
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
      detached: true,
      stdio: "ignore",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    terminateProcessTree(child.pid, 50);
    const outcome = await Promise.race([
      new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal }))),
      new Promise((_, reject) => setTimeout(() => reject(new Error("child was not cancelled")), 2_000)),
    ]);
    expect(outcome.code).not.toBe(0);
  });
});
