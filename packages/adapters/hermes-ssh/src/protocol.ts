import {
  MAX_PROMPT_BYTES,
  MAX_REQUEST_BYTES,
  MAX_RESULT_BYTES,
  PROFILE_ALLOWLIST,
  PROTOCOL,
  type HermesProfile,
} from "./constants.js";
import type { ValidatedHermesSshConfig } from "./validation.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface HermesRunRequest {
  protocol: typeof PROTOCOL;
  runId: string;
  agentId: string;
  companyId: string;
  role: "builder" | "reviewer";
  prompt: string;
  deadlineAt: string;
  workspace: { remoteCwd: string };
}

export interface HermesTerminalEnvelope {
  protocol: typeof PROTOCOL;
  runId: string;
  profile: HermesProfile;
  status: "completed" | "failed" | "cancelled";
  result: string;
  sessionId?: string;
}

function assertUuid(value: string, key: string): void {
  if (!UUID_RE.test(value)) throw new Error(`hermes_ssh ${key} must be a UUID`);
}

export function buildRequest(input: {
  runId: string;
  agentId: string;
  companyId: string;
  prompt: string;
  config: ValidatedHermesSshConfig;
  now?: number;
}): HermesRunRequest {
  assertUuid(input.runId, "runId");
  assertUuid(input.agentId, "agentId");
  assertUuid(input.companyId, "companyId");
  if (Buffer.byteLength(input.prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new Error(`hermes_ssh prompt exceeds ${MAX_PROMPT_BYTES} bytes`);
  }
  const request: HermesRunRequest = {
    protocol: PROTOCOL,
    runId: input.runId,
    agentId: input.agentId,
    companyId: input.companyId,
    role: input.config.role,
    prompt: input.prompt,
    deadlineAt: new Date((input.now ?? Date.now()) + input.config.timeoutSec * 1000).toISOString(),
    workspace: { remoteCwd: input.config.remoteCwd },
  };
  if (Buffer.byteLength(JSON.stringify(request), "utf8") > MAX_REQUEST_BYTES) {
    throw new Error(`hermes_ssh request exceeds ${MAX_REQUEST_BYTES} bytes`);
  }
  return request;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseTerminalEnvelope(stdout: string, expected: { runId: string; profile: HermesProfile }): HermesTerminalEnvelope {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) {
    throw new Error(lines.length > 1 ? "hermes_ssh received duplicate terminal messages" : "hermes_ssh received no terminal message");
  }
  if (Buffer.byteLength(lines[0], "utf8") > MAX_RESULT_BYTES) {
    throw new Error(`hermes_ssh terminal envelope exceeds ${MAX_RESULT_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]);
  } catch {
    throw new Error("hermes_ssh received malformed terminal JSON");
  }
  const envelope = record(parsed);
  if (!envelope) throw new Error("hermes_ssh terminal message must be an object");
  const allowedKeys = new Set(["protocol", "runId", "profile", "status", "result", "sessionId"]);
  if (Object.keys(envelope).some((key) => !allowedKeys.has(key))) {
    throw new Error("hermes_ssh terminal message contains unsupported fields");
  }
  if (envelope.protocol !== PROTOCOL) throw new Error("hermes_ssh terminal protocol mismatch");
  if (envelope.runId !== expected.runId) throw new Error("hermes_ssh terminal runId mismatch");
  if (envelope.profile !== expected.profile || !PROFILE_ALLOWLIST[envelope.profile as HermesProfile]) {
    throw new Error("hermes_ssh terminal profile mismatch");
  }
  if (envelope.status !== "completed" && envelope.status !== "failed" && envelope.status !== "cancelled") {
    throw new Error("hermes_ssh terminal status is invalid");
  }
  if (typeof envelope.result !== "string" || Buffer.byteLength(envelope.result, "utf8") > MAX_RESULT_BYTES) {
    throw new Error(`hermes_ssh terminal result must be a string no larger than ${MAX_RESULT_BYTES} bytes`);
  }
  if (envelope.sessionId != null && (typeof envelope.sessionId !== "string" || envelope.sessionId.length > 256)) {
    throw new Error("hermes_ssh terminal sessionId is invalid");
  }
  return envelope as unknown as HermesTerminalEnvelope;
}
