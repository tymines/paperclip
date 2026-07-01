/**
 * Canonical Paperclip fleet model map.
 *
 * The ACP Fleet panel previously rendered the OpenClaw gateway's *self-described*
 * persona pool (`agents.list` -> main / automation / ceo / cfo / cmo / coo / cpo /
 * cto / dev / intake / content / social / researcher / codex / Vision Analyst).
 * Those are the OpenClaw persona seeds in ~/.openclaw/agents, NOT Tyler's real
 * Paperclip fleet -- so the panel showed invented C-suite titles and only three
 * models (deepseek-v4-flash, kimi-k2.6, pixtral). This map lets the panel render
 * the REAL roster (names + roles from the Paperclip DB) with each agent's ACTUAL
 * model, reconciled from the live fleet config.
 *
 * SOURCES (per-agent model, with provenance):
 *   - Bridge personas/peers:  ~/.openclaw/agent-rooms-v1/bridge-daemon.mjs
 *       (PERSONA_BY_IDENTITY model="augivector-*"; PEER_BY_IDENTITY comments)
 *   - LiteLLM aliases:        ~/.openclaw/augivector-config.yaml
 *       augivector-research -> openai/kimi-k2.6 (Moonshot)
 *       augivector-auto/-code -> deepseek/deepseek-chat
 *       augivector-review -> openai/MiniMax-M2.7
 *       augivector-glm -> openai/glm-5.2 (Z.AI)
 *       augivector-vision -> moonshot vision (bridge vision routing)
 *   - Paperclip DB agent titles (already encode the model for most lanes)
 *   - Operator known-truths: vision/visual reviewer = Gemini; BailysApp = Qwen.
 *
 * This module is additive and pure data + a lookup helper. It does NOT touch the
 * bridge, gateway, OpenViking, QMD, or memory-core.
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
 * traceable to the fleet config (see SOURCES above).
 */
export const CANONICAL_FLEET_MODELS: Record<string, CanonicalModel> = {
  hermes: {
    model: "moonshot/kimi-k2.6",
    catalogMatch: "kimi-k2.6",
    source: "bridge PERSONA hermes=augivector-research -> openai/kimi-k2.6",
  },
  brainstorm: {
    model: "z.ai/glm-5.2",
    catalogMatch: "glm-5.2",
    source: "strategist/plan-critic lane -> GLM-5.2 (augivector-glm)",
  },
  ares: {
    model: "moonshot/kimi-k2.6",
    catalogMatch: "kimi-k2.6",
    source: "bridge PEER ares = Hermes v0.16 (kimi-k2.6) on August's box",
  },
  augi: {
    model: "deepseek/deepseek-chat",
    catalogMatch: "deepseek-chat",
    source: "bridge PERSONA augi=augivector-auto -> deepseek/deepseek-chat",
  },
  august: {
    model: "openclaw-peer - remote model",
    catalogMatch: null,
    source: "bridge PEER august = remote OpenClaw v.19 (own model)",
  },
  forge: {
    model: "kimi/k2.7-code (aider)",
    catalogMatch: null,
    source: "bridge: Forge = aider + Kimi K2.7-Code (forge-sidecar)",
  },
  atlas: {
    model: "z.ai/glm-5.2",
    catalogMatch: "glm-5.2",
    source: "bridge PEER atlas = aider + GLM-5.2 (1M ctx, text-only)",
  },
  reviewer: {
    model: "minimax/MiniMax-M2.7",
    catalogMatch: "minimax",
    source: "bridge PERSONA reviewer=augivector-review -> MiniMax-M2.7",
  },
  security: {
    model: "moonshot/kimi-k2.6",
    catalogMatch: "kimi-k2.6",
    source: "bridge PERSONA security=augivector-research -> kimi-k2.6",
  },
  codex: {
    model: "openai/gpt-5.5 (codex cli)",
    catalogMatch: null,
    source: "bridge PEER codex = ChatGPT Pro via Codex CLI sidecar",
  },
  researcher: {
    model: "moonshot/kimi-k2.6",
    catalogMatch: "kimi-k2.6",
    source: "research lane (bridged OpenClaw) -> kimi-k2.6",
  },
  designer: {
    model: "google/gemini-2.5-flash",
    catalogMatch: "gemini-2.5-flash",
    source: "App-Dev design agent = Gemini vision (DB title; vision=Gemini)",
  },
  "vision coder": {
    model: "google/gemini-2.5-flash",
    catalogMatch: "gemini-2.5-flash",
    source: "vision/visual reviewer lane = Gemini (operator known-truth)",
  },
  builder: {
    model: "xcodebuild - CI gate (no LLM)",
    catalogMatch: null,
    source: "Builder = xcodebuild build gate (deterministic, no LLM)",
  },
  "coder b": {
    model: "custom-api-deepseek-com/deepseek-v4-flash",
    catalogMatch: "deepseek-v4-flash",
    source: "DB title: Coding Executor (DeepSeek-V4-flash) - BailysApp lane",
  },
  "baily ai": {
    model: "qwen/qwen3-vl-8b",
    catalogMatch: null,
    source: "DB title: BailysApp in-app Qwen (qwen3-vl-8b) assistant",
  },
  "zeus vision": {
    model: "google/gemini-2.5-flash",
    catalogMatch: "gemini-2.5-flash",
    source: "Zeus Vision profile on Windows = Gemini 2.5 Flash (vision/fidelity agent)",
  },

  "zeus": {
    model: "deepseek-v4-pro",
    catalogMatch: "deepseek-v4-pro",
    source: "Zeus (Chief of Staff) on Windows = DeepSeek V4 Pro",
  },
  "zeus coding": {
    model: "deepseek-v4-pro",
    catalogMatch: "deepseek-v4-pro",
    source: "Zeus Coding executor on Windows = DeepSeek V4 Pro",
  },
  "zeus brainstorm": {
    model: "z.ai/glm-5.2",
    catalogMatch: "glm-5.2",
    source: "Zeus Brainstorm on Windows = GLM glm-5.2 via Z.ai (plan critic)",
  },
  "zeus reviewer": {
    model: "moonshot/kimi-k2.6",
    catalogMatch: "kimi-k2.6",
    source: "Zeus Reviewer on Windows = Moonshot Kimi k2.6 (final QC agent) — currently suspended",
  },
};

/** Look up the canonical model for an agent display name (undefined if unknown). */
export function canonicalModelFor(name: string): CanonicalModel | undefined {
  return CANONICAL_FLEET_MODELS[fleetKey(name)];
}

// ───── Host map ──────────────────────────────────────────────────────────────
//
// Maps every Fleet agent to its host machine + parent/main agent.
// Sources (verified 2026-06-27):
//   - Bridge daemon PERSONA_BY_IDENTITY → local persona on Box 1 (AugiAIs-Mini)
//   - Bridge daemon PEER_BY_IDENTITY → remote gateway (Box 2 / Windows)
//   - Canonical fleet model comments → inferred from lane names

export interface HostEntry {
  /** Display name for the host machine (e.g. AugiAIs-Mini or WindowsAugi). */
  machine: string;
  /** Short platform label (e.g. Mac or Windows). */
  platform: string;
  /** The main/parent agent this agent runs under (e.g. Augi, August, Zeus). */
  parent: string;
}

/**
 * Canonical host map per agent, keyed by normalized display name. Every entry
 * is traceable to the live bridge daemon config or Paperclip agent metadata.
 */
export const CANONICAL_HOST_MAP: Record<string, HostEntry> = {
  // Box 1 — AugiAIs-Mini (Mac, Augi's machine)
  hermes:       { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  augi:         { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  brainstorm:   { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  reviewer:     { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  security:     { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  // Local sidecars on Box 1
  forge:        { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  atlas:        { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  codex:        { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  researcher:   { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  // Deterministic build gate + BailysApp agents
  builder:      { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  "coder b":    { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },
  "baily ai":   { machine: "AugiAIs-Mini", platform: "Mac", parent: "Augi" },

  // Box 2 — AugiBot2s-Mini (Mac, August's machine)
  august:         { machine: "AugiBot2s-Mini", platform: "Mac", parent: "August" },
  ares:           { machine: "AugiBot2s-Mini", platform: "Mac", parent: "August" },
  designer:       { machine: "AugiBot2s-Mini", platform: "Mac", parent: "Ares" },
  "vision coder": { machine: "AugiBot2s-Mini", platform: "Mac", parent: "Ares" },

  // Windows box — WindowsAugi (Zeus's PC)
  "zeus brainstorm": { machine: "WindowsAugi", platform: "Windows", parent: "Zeus" },
  "zeus reviewer":  { machine: "WindowsAugi", platform: "Windows", parent: "Zeus" },
  zeus:           { machine: "WindowsAugi", platform: "Windows", parent: "Zeus" },
  "zeus coding":  { machine: "WindowsAugi", platform: "Windows", parent: "Zeus" },
  "zeus vision":  { machine: "WindowsAugi", platform: "Windows", parent: "Zeus" },
};

/** Look up the host entry for an agent display name (undefined if unknown). */
export function hostFor(name: string): HostEntry | undefined {
  return CANONICAL_HOST_MAP[fleetKey(name)];
}

