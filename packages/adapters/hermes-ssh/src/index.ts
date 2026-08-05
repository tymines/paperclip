import type { AdapterConfigSchema, AdapterEnvironmentTestResult, ServerAdapterModule } from "@paperclipai/adapter-utils";
import { execute } from "./execute.js";
import { PROFILE_ALLOWLIST, REMOTE_WORKSPACE_ROOT, SSH_ALIAS } from "./constants.js";
import { validateConfig } from "./validation.js";

export const type = "hermes_ssh";
export const label = "Hermes over strict SSH";
export const models = [
  { id: "SOL", label: "SOL" },
  { id: "Kimi K3", label: "Kimi K3" },
];

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      { key: "profile", label: "Hermes profile", type: "select", required: true, options: Object.keys(PROFILE_ALLOWLIST).map((value) => ({ value, label: value })) },
      { key: "role", label: "Role", type: "select", required: true, options: [{ value: "builder", label: "Builder" }, { value: "reviewer", label: "Reviewer" }] },
      { key: "model", label: "Model family", type: "select", required: true, options: models.map(({ id, label: modelLabel }) => ({ value: id, label: modelLabel })) },
      { key: "sshAlias", label: "SSH alias", type: "text", required: true, default: SSH_ALIAS, hint: `Fixed value: ${SSH_ALIAS}` },
      { key: "remoteCwd", label: "Remote workspace", type: "text", required: true, default: REMOTE_WORKSPACE_ROOT, hint: `Must be ${REMOTE_WORKSPACE_ROOT} or a normalized descendant.` },
      { key: "timeoutSec", label: "Timeout (seconds)", type: "number", default: 900 },
      { key: "maxTurns", label: "Maximum turns", type: "number", default: 10 },
    ],
  };
}

async function testEnvironment(ctx: Parameters<ServerAdapterModule["testEnvironment"]>[0]): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentTestResult["checks"] = [];
  try {
    const config = validateConfig(ctx.config);
    checks.push({ code: "config_allowlist", level: "info", message: `Configuration matches ${config.profile} allowlist.` });
    checks.push({ code: "connection_not_tested", level: "info", message: "Validation is offline; no SSH connection or remote process was opened." });
    return { adapterType: type, status: "pass", checks, testedAt: new Date().toISOString() };
  } catch (error) {
    checks.push({ code: "config_invalid", level: "error", message: error instanceof Error ? error.message : String(error) });
    return { adapterType: type, status: "fail", checks, testedAt: new Date().toISOString() };
  }
}

export function createServerAdapter(): ServerAdapterModule {
  return {
    type,
    execute,
    testEnvironment,
    models,
    getConfigSchema,
    detectModel: async () => null,
    supportsLocalAgentJwt: false,
    supportsInstructionsBundle: false,
    requiresMaterializedRuntimeSkills: false,
    agentConfigurationDoc: `# hermes_ssh agent configuration\n\nThis external adapter dispatches one authorized run to an allowlisted Box 1 Hermes profile through the strict ${SSH_ALIAS} alias. Validation is offline and does not connect. Heartbeats must remain disabled until separately authorized.`,
  };
}

export { execute, PROFILE_ALLOWLIST, REMOTE_WORKSPACE_ROOT, SSH_ALIAS };
export { validateConfig, validateRemoteCwd } from "./validation.js";
export { buildRequest, parseTerminalEnvelope } from "./protocol.js";
