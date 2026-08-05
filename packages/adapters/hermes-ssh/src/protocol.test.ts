import { describe, expect, it } from "vitest";
import { MAX_PROMPT_BYTES, PROTOCOL } from "./constants.js";
import { buildRequest, parseTerminalEnvelope } from "./protocol.js";
import { validateConfig } from "./validation.js";

const ids = {
  runId: "11111111-1111-4111-8111-111111111111",
  agentId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
};
const config = validateConfig({ profile: "atlas", remoteCwd: "/Users/augi/shared-agent-workspace/project" });

describe("hermes_ssh protocol", () => {
  it("builds the exact stdin request contract", () => {
    expect(buildRequest({ ...ids, prompt: "work", config, now: 0 })).toEqual({
      protocol: PROTOCOL,
      ...ids,
      role: "builder",
      prompt: "work",
      deadlineAt: "1970-01-01T00:15:00.000Z",
      workspace: { remoteCwd: "/Users/augi/shared-agent-workspace/project" },
    });
  });

  it("rejects oversized prompts and malformed IDs", () => {
    expect(() => buildRequest({ ...ids, prompt: "x".repeat(MAX_PROMPT_BYTES + 1), config })).toThrow(/prompt exceeds/);
    expect(() => buildRequest({ ...ids, runId: "bad", prompt: "ok", config })).toThrow(/runId must be a UUID/);
  });

  it("accepts one matching terminal envelope", () => {
    const raw = JSON.stringify({ protocol: PROTOCOL, runId: ids.runId, profile: "atlas", status: "completed", result: "done" });
    expect(parseTerminalEnvelope(raw, { runId: ids.runId, profile: "atlas" })).toMatchObject({ status: "completed", result: "done" });
  });

  it.each([
    ["malformed", "{"],
    ["wrong protocol", JSON.stringify({ protocol: "v2", runId: ids.runId, profile: "atlas", status: "completed", result: "done" })],
    ["wrong run", JSON.stringify({ protocol: PROTOCOL, runId: ids.agentId, profile: "atlas", status: "completed", result: "done" })],
    ["wrong profile", JSON.stringify({ protocol: PROTOCOL, runId: ids.runId, profile: "chronos", status: "completed", result: "done" })],
    ["duplicate", `${JSON.stringify({ protocol: PROTOCOL, runId: ids.runId, profile: "atlas", status: "completed", result: "done" })}\n${JSON.stringify({ protocol: PROTOCOL, runId: ids.runId, profile: "atlas", status: "completed", result: "late" })}`],
  ])("rejects %s terminal output", (_name, raw) => {
    expect(() => parseTerminalEnvelope(raw, { runId: ids.runId, profile: "atlas" })).toThrow();
  });
});
