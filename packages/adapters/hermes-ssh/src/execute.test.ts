import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { PROTOCOL } from "./constants.js";

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>("@paperclipai/adapter-utils/server-utils");
  return { ...actual, runChildProcess: vi.fn() };
});

import { runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import { createServerAdapter } from "./index.js";

const ids = {
  runId: "11111111-1111-4111-8111-111111111111",
  agentId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
};
const prompt = "private prompt that must only use stdin";
const secret = "paperclip-secret-token";

function terminal(status: "completed" | "failed" | "cancelled", result = "done") {
  return `${JSON.stringify({ protocol: PROTOCOL, runId: ids.runId, profile: "atlas", status, result })}\n`;
}

function processResult(overrides: Record<string, unknown> = {}) {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: terminal("completed"),
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function context(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    runId: ids.runId,
    agent: {
      id: ids.agentId,
      companyId: ids.companyId,
      name: "Atlas",
      adapterType: "hermes_ssh",
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: {
      profile: "atlas",
      role: "builder",
      model: "SOL",
      sshAlias: "augi-mac-1",
      remoteCwd: "/Users/augi/shared-agent-workspace/project",
      timeoutSec: 30,
      maxTurns: 4,
    },
    context: { prompt },
    onLog: vi.fn(async () => undefined),
    onMeta: vi.fn(async () => undefined),
    onSpawn: vi.fn(async () => undefined),
    authToken: secret,
    ...overrides,
  };
}

describe("hermes_ssh execution", () => {
  beforeEach(() => vi.mocked(runChildProcess).mockReset());

  it("loads through the complete generic external adapter contract without side effects", async () => {
    const adapter = createServerAdapter();
    expect(adapter.type).toBe("hermes_ssh");
    expect(adapter.execute).toBeTypeOf("function");
    expect(adapter.testEnvironment).toBeTypeOf("function");
    expect(adapter.getConfigSchema).toBeTypeOf("function");
    expect(adapter.detectModel).toBeTypeOf("function");
    const result = await adapter.testEnvironment({ companyId: ids.companyId, adapterType: "hermes_ssh", config: context().config });
    expect(result.status).toBe("pass");
    expect(runChildProcess).not.toHaveBeenCalled();
  });

  it("uses only fixed SSH arguments and puts the request exclusively on stdin", async () => {
    vi.mocked(runChildProcess).mockResolvedValue(processResult());
    const ctx = context();
    const result = await createServerAdapter().execute(ctx);
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("done");
    expect(result.sessionId).toBeNull();
    expect(result.clearSession).toBe(true);
    const [, command, args, options] = vi.mocked(runChildProcess).mock.calls[0];
    expect(command).toBe("ssh");
    expect(args).toEqual([
      "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ClearAllForwardings=yes",
      "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "PermitLocalCommand=no", "-o", "RequestTTY=no",
      "augi-mac-1", "/Users/augi/.local/bin/olympus-hermes-runner-v1.mjs", "--profile", "atlas", "--max-turns", "4",
    ]);
    expect(JSON.parse(options.stdin!.trim())).toMatchObject({ protocol: PROTOCOL, prompt, workspace: { remoteCwd: "/Users/augi/shared-agent-workspace/project" } });
    const serializedArgs = JSON.stringify(args);
    const serializedMeta = JSON.stringify(vi.mocked(ctx.onMeta!).mock.calls);
    expect(serializedArgs).not.toContain(prompt);
    expect(serializedArgs).not.toContain(secret);
    expect(serializedMeta).not.toContain(prompt);
    expect(serializedMeta).not.toContain(secret);
    expect(options.env).toEqual({});
  });

  it("rejects session resume before spawning", async () => {
    const result = await createServerAdapter().execute(context({ runtime: { sessionId: "old", sessionParams: { sessionId: "old" }, sessionDisplayId: "old", taskKey: null } }));
    expect(result.errorMessage).toMatch(/does not permit session resume/);
    expect(runChildProcess).not.toHaveBeenCalled();
  });

  it("handles valid failure and cancellation envelopes", async () => {
    vi.mocked(runChildProcess).mockResolvedValueOnce(processResult({ exitCode: 1, stdout: terminal("failed", "remote failed") }));
    expect((await createServerAdapter().execute(context())).errorMessage).toBe("remote failed");
    vi.mocked(runChildProcess).mockResolvedValueOnce(processResult({ exitCode: 1, stdout: terminal("cancelled", "cancelled") }));
    expect((await createServerAdapter().execute(context())).errorMessage).toBe("cancelled");
  });

  it("handles timeout without accepting late output", async () => {
    vi.mocked(runChildProcess).mockResolvedValue(processResult({ timedOut: true, stdout: terminal("completed", "late") }));
    const result = await createServerAdapter().execute(context());
    expect(result.timedOut).toBe(true);
    expect(result.summary).toBeUndefined();
  });

  it.each([
    ["host key mismatch", "Host key verification failed."],
    ["unreachable host", "ssh: connect to host augi-mac-1 port 22: Connection refused"],
  ])("classifies %s without exposing stderr", async (_name, stderr) => {
    vi.mocked(runChildProcess).mockResolvedValue(processResult({ exitCode: 255, stdout: "", stderr }));
    const result = await createServerAdapter().execute(context());
    expect(result.errorMessage).toMatch(/host-key verification failed|host is unreachable/);
    expect(result.errorMessage).not.toContain(stderr);
  });

  it.each([
    ["malformed", "not json", 0],
    ["duplicate", `${terminal("completed")}${terminal("completed", "late")}`, 0],
    ["nonzero success", terminal("completed"), 42],
  ])("rejects %s output", async (_name, stdout, exitCode) => {
    vi.mocked(runChildProcess).mockResolvedValue(processResult({ stdout, exitCode }));
    const result = await createServerAdapter().execute(context());
    expect(result.exitCode).not.toBe(0);
    expect(result.errorMessage).toBeTruthy();
  });
});
