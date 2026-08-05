import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { renderPaperclipWakePrompt, runChildProcess } from "@paperclipai/adapter-utils/server-utils";
import { REMOTE_RUNNER } from "./constants.js";
import { buildRequest, parseTerminalEnvelope } from "./protocol.js";
import { validateConfig } from "./validation.js";

function promptFromContext(context: Record<string, unknown>): string {
  if (typeof context.prompt === "string" && context.prompt.trim()) return context.prompt.trim();
  return renderPaperclipWakePrompt(context.paperclipWake, { resumedSession: false }).trim();
}

function transportError(stderr: string, exitCode: number | null): string {
  const normalized = stderr.toLowerCase();
  if (normalized.includes("host key verification failed") || normalized.includes("remote host identification has changed")) {
    return "Hermes SSH host-key verification failed";
  }
  if (normalized.includes("could not resolve hostname") || normalized.includes("connection timed out") || normalized.includes("connection refused") || normalized.includes("no route to host")) {
    return "Hermes SSH host is unreachable";
  }
  return `Hermes SSH transport exited with code ${exitCode ?? -1}`;
}

const discardTransportLog = async () => undefined;

async function bestEffortCancel(ctx: AdapterExecutionContext, profile: string): Promise<void> {
  const args = [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ClearAllForwardings=yes",
    "-o", "ForwardAgent=no",
    "-o", "ForwardX11=no",
    "-o", "PermitLocalCommand=no",
    "-o", "RequestTTY=no",
    "augi-mac-1",
    REMOTE_RUNNER,
    "--cancel",
    "--profile",
    profile,
    "--run-id",
    ctx.runId,
  ];
  try {
    await runChildProcess(`${ctx.runId}:cancel`, "ssh", args, {
      cwd: process.cwd(),
      env: {},
      timeoutSec: 10,
      graceSec: 2,
      onLog: discardTransportLog,
    });
  } catch {
    // Cancellation is deliberately best effort. The remote deadline remains
    // authoritative if this second strict SSH connection cannot be opened.
  }
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  let config;
  try {
    config = validateConfig(ctx.config);
  } catch (error) {
    return { exitCode: 1, signal: null, timedOut: false, errorMessage: error instanceof Error ? error.message : String(error) };
  }

  if (ctx.runtime.sessionId || ctx.runtime.sessionParams) {
    return { exitCode: 1, signal: null, timedOut: false, errorMessage: "hermes_ssh does not permit session resume" };
  }
  if (ctx.authToken) {
    // The token is intentionally ignored and never forwarded. Keeping this explicit
    // prevents later refactors from accidentally adding it to transport metadata.
  }

  let request;
  try {
    request = buildRequest({
      runId: ctx.runId,
      agentId: ctx.agent.id,
      companyId: ctx.agent.companyId,
      prompt: promptFromContext(ctx.context),
      config,
    });
  } catch (error) {
    return { exitCode: 1, signal: null, timedOut: false, errorMessage: error instanceof Error ? error.message : String(error) };
  }

  const args = [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ClearAllForwardings=yes",
    "-o", "ForwardAgent=no",
    "-o", "ForwardX11=no",
    "-o", "PermitLocalCommand=no",
    "-o", "RequestTTY=no",
    config.sshAlias,
    REMOTE_RUNNER,
    "--profile",
    config.profile,
    "--max-turns",
    String(config.maxTurns),
  ];

  await ctx.onMeta?.({
    adapterType: "hermes_ssh",
    command: "ssh",
    commandArgs: args,
    commandNotes: [
      `Fixed strict SSH alias: ${config.sshAlias}`,
      `Allowlisted profile: ${config.profile} (${config.role}, ${config.model})`,
      `Approved remote workspace: ${config.remoteCwd}`,
      `Bounded request: ${Buffer.byteLength(JSON.stringify(request), "utf8")} bytes`,
    ],
    context: { protocol: request.protocol, runId: request.runId, profile: config.profile },
  });

  const proc = await runChildProcess(ctx.runId, "ssh", args, {
    cwd: process.cwd(),
    env: {},
    timeoutSec: config.timeoutSec,
    graceSec: 5,
    onSpawn: ctx.onSpawn,
    // stdout is the terminal protocol envelope and stderr may contain provider
    // details. Neither stream is safe for ordinary run logs.
    onLog: discardTransportLog,
    stdin: `${JSON.stringify(request)}\n`,
  });

  if (proc.timedOut) {
    await bestEffortCancel(ctx, config.profile);
    return { exitCode: (proc.exitCode ?? 1) === 0 ? 1 : proc.exitCode ?? 1, signal: proc.signal, timedOut: true, errorMessage: `Hermes SSH timed out after ${config.timeoutSec}s` };
  }
  if (proc.signal) await bestEffortCancel(ctx, config.profile);

  let envelope;
  try {
    envelope = parseTerminalEnvelope(proc.stdout, { runId: ctx.runId, profile: config.profile });
  } catch (error) {
    return {
      exitCode: (proc.exitCode ?? 0) === 0 ? 1 : proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage: (proc.exitCode ?? 0) !== 0
        ? transportError(proc.stderr, proc.exitCode)
        : error instanceof Error ? error.message : String(error),
    };
  }

  if ((proc.exitCode ?? 0) !== 0 && envelope.status !== "failed" && envelope.status !== "cancelled") {
    return { exitCode: proc.exitCode, signal: proc.signal, timedOut: false, errorMessage: "Hermes SSH exited nonzero without a valid failure envelope" };
  }
  const succeeded = envelope.status === "completed" && (proc.exitCode ?? 0) === 0;
  return {
    exitCode: succeeded ? 0 : ((proc.exitCode ?? 1) === 0 ? 1 : proc.exitCode ?? 1),
    signal: proc.signal,
    timedOut: false,
    errorMessage: succeeded ? null : envelope.result || `Hermes run ${envelope.status}`,
    provider: "hermes",
    biller: config.model === "SOL" ? "sol" : "kimi",
    billingType: "unknown",
    model: config.model,
    summary: envelope.result,
    // v1 may report a diagnostic Hermes session id, but Olympus must not
    // persist or resume it. The envelope remains available in resultJson.
    sessionId: null,
    sessionDisplayId: null,
    sessionParams: null,
    clearSession: true,
    resultJson: { ...envelope },
  };
}
