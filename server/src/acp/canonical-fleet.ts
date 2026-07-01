/**
 * Canonical Paperclip fleet model map — LEAN ROSTER (16 agents).
 *
 * Updated 2026-06-30 during the ACP cutover: removed all 14 legacy OpenClaw
 * persona entries (Atlas, Forge, Codex, Coder B, Builder, Vision Coder,
 * Designer, Researcher, Reviewer, Security, Brainstorm, Zeus Brainstorm,
 * Zeus Coding, Zeus Reviewer, Zeus Vision) and added the 9 new Hermes-framework
 * agents. Preserved standalones (Augi, August, Baily AI) + orchestrators
 * (Zeus, Hermes, Ares, Zeus Book Keeper, Zeus Dispatch, Zeus Critic).
 *
 * The ACP Fleet panel now builds from this canonical DB map and no longer
 * depends on the OpenClaw gateway handshake (skipGateway=true).
 */

export interface CanonicalModel {
  /** Display string shown on the capability card (provider/model form). */
  model: string;
  /**
   * Substring used to resolve a richer record against the live shared model
   * catalog (models.list). null when the model is not in the gateway catalog
   * (e.g. MiniMax, Qwen, Codex/GPT, Kimi-Code, remote-peer).
   */
  catalogMatch: string | null;
  /** One-line provenance for the model choice. */
  source: string;
}

/** Normalize an agent display name to a stable lookup key. */
export function fleetKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Canonical model per agent, keyed by normalized display name. Every value is
 * traceable to the live fleet config or vault soul assignment.
 */
export const CANONICAL_FLEET_MODELS: Record<string, CanonicalModel> = {
  // ── Orchestrators ──────────────────────────────────────────────────────
  zeus: {
    model: "deepseek/deepseek-chat",
    catalogMatch: "deepseek-chat",
    source: "Zeus (Chief of Staff) on Windows = DeepSeek V4 Flash",
  },
  "zeus book keeper": {
    model: "deepseek/deepseek-chat",
    catalogMatch: "deepseek-chat",
    source: "Zeus Book Keeper on Windows = DeepSeek V4 Flash (fleet memory scribe)",
  },
  "zeus critic": {
    model: "deepseek/deepseek-chat",
    catalogMatch: "deepseek-chat",
    source: "Zeus Critic on Windows = DeepSeek V4 Flash (plan adversary)",
  },
  "zeus dispatch": {
    model: "deepseek/deepseek-chat",
    catalogMatch: "deepseek-chat",
    source: "Zeus Dispatch on Windows = DeepSeek V4 Flash (operations dispatcher)",
  },
  hermes: {
    model: "moonshot/kimi-k2.6",
    catalogMatch: "kimi-k2.6",
    source: "Hermes orchestrator on Box 1 = Kimi k2.6",
  },
  ares: {
    model: "moonshot/kimi-k2.6",
    catalogMatch: "kimi-k2.6",
    source: "Ares (COO/review boss) on Box 2 = Kimi k2.6",
  },

  // ── Hermes cluster (Box 1, under Hermes) ──────────────────────────────
  "hermes coder 1": {
    model: "moonshot/kimi-k2.6",
    catalogMatch: "kimi-k2.6",
    source: "Hermes Coder 1 on Box 1 = Kimi k2.6 (deep-reasoning)",
  },
  "hermes coder 2": {
    model: "z.ai/glm-5.2",
    catalogMatch: "glm-5.2",
    source: "Hermes Coder 2 on Box 1 = GLM-5.2 (1M ctx, large-context)",
  },
  "hermes coder 3": {
    model: "deepseek/deepseek-chat",
    catalogMatch: "deepseek-chat",
    source: "Hermes Coder 3 on Box 1 = DeepSeek V4 Flash (fast-iteration)",
  },
  "hermes designer": {
    model: "openai/gpt-4o",
    catalogMatch: "gpt-4o",
    source: "Hermes Designer on Box 1 = GPT-4o (vision-capable, UI/UX)",
  },
  "hermes researcher": {
    model: "deepseek/deepseek-chat",
    catalogMatch: "deepseek-chat",
    source: "Hermes Researcher on Box 1 = DeepSeek V4 Flash (research/recon)",
  },

  // ── Ares cluster (Box 2, under Ares) ──────────────────────────────────
  "ares evidence verifier": {
    model: "openai/gpt-4o-mini",
    catalogMatch: "gpt-4o-mini",
    source: "Ares Evidence Verifier on Box 2 = GPT-4o-mini (proof gatekeeper)",
  },
  "ares reviewer 1": {
    model: "moonshot/kimi-k2.6",
    catalogMatch: "kimi-k2.6",
    source: "Ares Reviewer 1 on Box 2 = Kimi k2.6 (depth-focused review)",
  },
  "ares reviewer 2": {
    model: "deepseek/deepseek-chat",
    catalogMatch: "deepseek-chat",
    source: "Ares Reviewer 2 on Box 2 = DeepSeek V4 Flash (cross-check review)",
  },

  // ── Standalone agents (preserved) ─────────────────────────────────────
  augi: {
    model: "deepseek/deepseek-chat",
    catalogMatch: "deepseek-chat",
    source: "Augi standalone on Box 1 = DeepSeek V4 Flash",
  },
  august: {
    model: "openclaw-peer - remote model",
    catalogMatch: null,
    source: "August standalone on Box 2 = remote Hermes profile (own model)",
  },
  "baily ai": {
    model: "qwen/qwen3-vl-8b",
    catalogMatch: null,
    source: "BailysApp in-app Qwen (qwen3-vl-8b) assistant",
  },
};

/** Look up the canonical model for an agent display name (undefined if unknown). */
export function canonicalModelFor(name: string): CanonicalModel | undefined {
  return CANONICAL_FLEET_MODELS[fleetKey(name)];
}

// ───── Host map ──────────────────────────────────────────────────────────────
//
// Maps every Fleet agent to its host machine + parent/main agent.
// Updated 2026-06-30 for the lean 16-agent roster.

export interface HostEntry {
  /** Display name for the host machine (e.g. AugiAIs-Mini or WindowsAugi). */
  machine: string;
  /** Short platform label (e.g. Mac or Windows). */
  platform: string;
  /** The main/parent agent this agent runs under (e.g. Zeus, Hermes, Ares). */
  parent: string;
}

/**
 * Canonical host map per agent, keyed by normalized display name.
 */
export const CANONICAL_HOST_MAP: Record<string, HostEntry> = {
  // ── Windows (Zeus's PC) ───────────────────────────────────────────────
  zeus:              { machine: "WindowsAugi", platform: "Windows", parent: "Zeus" },
  "zeus book keeper": { machine: "WindowsAugi", platform: "Windows", parent: "Zeus" },
  "zeus critic":     { machine: "WindowsAugi", platform: "Windows", parent: "Zeus" },
  "zeus dispatch":   { machine: "WindowsAugi", platform: "Windows", parent: "Zeus" },

  // ── Box 1 — AugiAIs-Mini (Mac, under Hermes) ──────────────────────────
  hermes:            { machine: "AugiAIs-Mini", platform: "Mac", parent: "Hermes" },
  augi:              { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  "hermes coder 1":  { machine: "AugiAIs-Mini", platform: "Mac", parent: "Hermes" },
  "hermes coder 2":  { machine: "AugiAIs-Mini", platform: "Mac", parent: "Hermes" },
  "hermes coder 3":  { machine: "AugiAIs-Mini", platform: "Mac", parent: "Hermes" },
  "hermes designer": { machine: "AugiAIs-Mini", platform: "Mac", parent: "Hermes" },
  "hermes researcher": { machine: "AugiAIs-Mini", platform: "Mac", parent: "Hermes" },

  // ── Box 2 — AugiBot2s-Mini (Mac, under Ares) ──────────────────────────
  ares:                { machine: "AugiBot2s-Mini", platform: "Mac", parent: "Ares" },
  august:              { machine: "AugiBot2s-Mini", platform: "Mac", parent: "August" },
  "ares evidence verifier": { machine: "AugiBot2s-Mini", platform: "Mac", parent: "Ares" },
  "ares reviewer 1":       { machine: "AugiBot2s-Mini", platform: "Mac", parent: "Ares" },
  "ares reviewer 2":       { machine: "AugiBot2s-Mini", platform: "Mac", parent: "Ares" },

  // ── BailysApp (external) ──────────────────────────────────────────────
  "baily ai":        { machine: "BailysApp", platform: "Cloud", parent: "Baily AI" },
};

/** Look up the host entry for an agent display name (undefined if unknown). */
export function hostFor(name: string): HostEntry | undefined {
  return CANONICAL_HOST_MAP[fleetKey(name)];
}
