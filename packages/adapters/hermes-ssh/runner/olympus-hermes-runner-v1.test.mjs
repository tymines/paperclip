import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROTOCOL,
  PROFILES,
  claimRun,
  parseRequest,
  parseRunnerArgs,
  readStoredEnvelope,
  runStatePaths,
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
  deadlineAt: "2999-01-01T00:00:00.000Z",
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
    expect(parseRunnerArgs(["--profile", "atlas", "--max-turns", "10"])).toEqual({ profile: "atlas", maxTurns: 10 });
    expect(() => parseRunnerArgs(["--profile", "other", "--max-turns", "10"])).toThrow(/not allowlisted/);
    expect(() => parseRunnerArgs(["--profile", "atlas", "--max-turns", "26"])).toThrow(/out of bounds/);
    expect(() => parseRunnerArgs(["--profile", "atlas", "--command", "sh"])).toThrow(/fixed/);
  });

  it("independently validates request protocol, role, fields, and size", () => {
    expect(parseRequest(JSON.stringify(request), "atlas")).toEqual(request);
    expect(() => parseRequest(JSON.stringify({ ...request, protocol: "other" }), "atlas")).toThrow(/protocol/);
    expect(() => parseRequest(JSON.stringify({ ...request, role: "reviewer" }), "atlas")).toThrow(/role/);
    expect(() => parseRequest(JSON.stringify({ ...request, command: "sh" }), "atlas")).toThrow(/unsupported/);
    expect(() => parseRequest("x".repeat(96 * 1024 + 1), "atlas")).toThrow(/oversized/);
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
});
