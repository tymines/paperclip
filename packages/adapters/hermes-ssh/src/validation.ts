import path from "node:path";
import {
  MAX_MAX_TURNS,
  MAX_TIMEOUT_SEC,
  MIN_MAX_TURNS,
  MIN_TIMEOUT_SEC,
  PROFILE_ALLOWLIST,
  REMOTE_WORKSPACE_ROOT,
  SSH_ALIAS,
  type HermesProfile,
} from "./constants.js";

const ALLOWED_CONFIG_KEYS = new Set([
  "profile",
  "role",
  "model",
  "sshAlias",
  "remoteCwd",
  "timeoutSec",
  "maxTurns",
]);

export interface ValidatedHermesSshConfig {
  profile: HermesProfile;
  role: "builder" | "reviewer";
  model: "SOL" | "Kimi K3";
  sshAlias: typeof SSH_ALIAS;
  remoteCwd: string;
  timeoutSec: number;
  maxTurns: number;
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`hermes_ssh requires ${key}`);
  }
  return value.trim();
}

function boundedInteger(value: unknown, key: string, fallback: number, min: number, max: number): number {
  const resolved = value == null ? fallback : value;
  if (typeof resolved !== "number" || !Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`hermes_ssh ${key} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

export function validateRemoteCwd(value: unknown): string {
  const raw = requiredString(value, "remoteCwd");
  if (raw.includes("\0") || raw.includes("\\")) {
    throw new Error("hermes_ssh remoteCwd contains invalid characters");
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized.startsWith("/") || normalized !== raw.replace(/\/$/, "") || raw.split("/").includes("..")) {
    throw new Error("hermes_ssh remoteCwd must be a normalized absolute path without traversal");
  }
  if (normalized !== REMOTE_WORKSPACE_ROOT && !normalized.startsWith(`${REMOTE_WORKSPACE_ROOT}/`)) {
    throw new Error(`hermes_ssh remoteCwd must remain under ${REMOTE_WORKSPACE_ROOT}`);
  }
  return normalized;
}

export function validateConfig(config: Record<string, unknown>): ValidatedHermesSshConfig {
  const unknownKeys = Object.keys(config).filter((key) => !ALLOWED_CONFIG_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`hermes_ssh rejects unsupported config fields: ${unknownKeys.sort().join(", ")}`);
  }

  const profile = requiredString(config.profile, "profile") as HermesProfile;
  const allowed = PROFILE_ALLOWLIST[profile];
  if (!allowed) throw new Error(`hermes_ssh profile is not allowlisted: ${profile}`);

  const role = config.role == null ? allowed.role : requiredString(config.role, "role");
  const model = config.model == null ? allowed.model : requiredString(config.model, "model");
  if (role !== allowed.role || model !== allowed.model) {
    throw new Error(`hermes_ssh profile ${profile} requires role ${allowed.role} and model ${allowed.model}`);
  }

  const sshAlias = config.sshAlias == null ? SSH_ALIAS : requiredString(config.sshAlias, "sshAlias");
  if (sshAlias !== SSH_ALIAS) throw new Error(`hermes_ssh only permits SSH alias ${SSH_ALIAS}`);

  return {
    profile,
    role: allowed.role,
    model: allowed.model,
    sshAlias: SSH_ALIAS,
    remoteCwd: validateRemoteCwd(config.remoteCwd),
    timeoutSec: boundedInteger(config.timeoutSec, "timeoutSec", 900, MIN_TIMEOUT_SEC, MAX_TIMEOUT_SEC),
    maxTurns: boundedInteger(config.maxTurns, "maxTurns", 10, MIN_MAX_TURNS, MAX_MAX_TURNS),
  };
}
