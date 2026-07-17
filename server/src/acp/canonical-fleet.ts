/**
 * Canonical Paperclip fleet model map — LEAN ROSTER (14 active agents + 3 standalones).
 *
 * Updated 2026-07-01: diversified per-agent model map. Every agent now has an
 * explicit model/provider assignment so the Fleet UI shows a model on every card.
 *
 * Provider IDs (from Hermes provider_models_cache):
 *   deepseek   → deepseek-v4-pro, deepseek-v4-flash
 *   kimi-coding→ kimi-k2.6, kimi-k2.7-code
 *   zai        → glm-5.2
 *   gemini     → gemini-2.5-flash
 */

export interface CanonicalModel {
  /** Display string shown on the capability card (provider/model form). */
  model: string;
  /**
   * Substring used to resolve a richer record against the live shared model
   * catalog (models.list). null when the model is not in the gateway catalog
   * (e.g. Kimi, Z.ai, Qwen, remote-peer).
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
    model: "deepseek/deepseek-v4-pro",
    catalogMatch: "deepseek-v4-pro",
    source: "Zeus (Chief of Staff) on Windows = DeepSeek V4 Pro (deepseek)",
  },
  "zeus book keeper": {
    model: "deepseek/deepseek-v4-flash",
    catalogMatch: "deepseek-v4-flash",
    source: "Zeus Book Keeper on Windows = DeepSeek V4 Flash (deepseek)",
  },
  "zeus critic": {
    model: "kimi-coding/kimi-k2.6",
    catalogMatch: null,
    source: "Zeus Critic on Windows = Kimi K2.6 (kimi-coding / moonshot)",
  },
  "zeus dispatch": {
    model: "deepseek/deepseek-v4-flash",
    catalogMatch: "deepseek-v4-flash",
    source: "Zeus Dispatch on Windows = DeepSeek V4 Flash (deepseek)",
  },
  hermes: {
    model: "deepseek/deepseek-v4-flash",
    catalogMatch: "deepseek-v4-flash",
    source: "Hermes orchestrator on Box 1 = DeepSeek V4 Flash (deepseek)",
  },
  ares: {
    model: "kimi-coding/kimi-k2.6",
    catalogMatch: null,
    source: "Ares (COO/review boss) on Box 2 = Kimi K2.6 (kimi-coding / moonshot)",
  },

  // ── Hermes cluster (Box 1, under Hermes) ──────────────────────────────
  "hermes coder 1": {
    model: "kimi-coding/kimi-k2.7-code",
    catalogMatch: null,
    source: "Hermes Coder 1 on Box 1 = Kimi K2.7-Code (kimi-coding / moonshot)",
  },
  "hermes coder 2": {
    model: "zai/glm-5.2",
    catalogMatch: null,
    source: "Hermes Coder 2 on Box 1 = GLM 5.2 (zai / Z.ai)",
  },
  "hermes coder 3": {
    model: "deepseek/deepseek-v4-flash",
    catalogMatch: "deepseek-v4-flash",
    source: "Hermes Coder 3 on Box 1 = DeepSeek V4 Flash (deepseek)",
  },
  "hermes designer": {
    model: "gemini/gemini-2.5-flash",
    catalogMatch: "gemini-2.5-flash",
    source: "Hermes Designer on Box 1 = Gemini 2.5 Flash (gemini / Google)",
  },
  "hermes researcher": {
    model: "deepseek/deepseek-v4-flash",
    catalogMatch: "deepseek-v4-flash",
    source: "Hermes Researcher on Box 1 = DeepSeek V4 Flash (deepseek)",
  },

  // ── Ares cluster (Box 2, under Ares) ──────────────────────────────────
  "ares evidence verifier": {
    model: "openai/gpt-4o-mini",
    catalogMatch: "gpt-4o-mini",
    source: "Ares Evidence Verifier on Box 2 = GPT-4o-mini (OpenAI — cross-model independent verifier)",
  },
  "ares reviewer 1": {
    model: "kimi-coding/kimi-k2.6",
    catalogMatch: null,
    source: "Ares Reviewer 1 on Box 2 = Kimi K2.6 (kimi-coding / moonshot)",
  },
  "ares reviewer 2": {
    model: "deepseek/deepseek-v4-flash",
    catalogMatch: "deepseek-v4-flash",
    source: "Ares Reviewer 2 on Box 2 = DeepSeek V4 Flash (deepseek)",
  },

  // ── Standalone agents (preserved) ─────────────────────────────────────
  augi: {
    model: "deepseek/deepseek-v4-flash",
    catalogMatch: "deepseek-v4-flash",
    source: "Augi standalone on Box 1 = DeepSeek V4 Flash (deepseek)",
  },
  august: {
    model: "deepseek/deepseek-v4-flash",
    catalogMatch: "deepseek-v4-flash",
    source: "August standalone on Box 2 = DeepSeek V4 Flash (deepseek)",
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
