export const PROTOCOL = "olympus-hermes-run/v1" as const;
export const SSH_ALIAS = "augi-mac-1" as const;
export const REMOTE_WORKSPACE_ROOT = "/Users/augi/shared-agent-workspace" as const;
export const REMOTE_RUNNER = "/Users/augi/.local/bin/olympus-hermes-runner-v1.mjs" as const;

export const MAX_PROMPT_BYTES = 64 * 1024;
export const MAX_REQUEST_BYTES = 96 * 1024;
export const MAX_RESULT_BYTES = 128 * 1024;
export const MIN_TIMEOUT_SEC = 5;
export const MAX_TIMEOUT_SEC = 30 * 60;
export const MIN_MAX_TURNS = 1;
export const MAX_MAX_TURNS = 25;

export const PROFILE_ALLOWLIST = {
  atlas: {
    role: "builder",
    model: "SOL",
    wrapper: "/Users/augi/.local/bin/atlas",
  },
  artemis: {
    role: "builder",
    model: "Kimi K3",
    wrapper: "/Users/augi/.local/bin/artemis",
  },
  chronos: {
    role: "reviewer",
    model: "SOL",
    wrapper: "/Users/augi/.local/bin/chronos",
  },
  achlys: {
    role: "reviewer",
    model: "Kimi K3",
    wrapper: "/Users/augi/.local/bin/achlys",
  },
} as const;

export type HermesProfile = keyof typeof PROFILE_ALLOWLIST;
export type HermesRole = (typeof PROFILE_ALLOWLIST)[HermesProfile]["role"];
