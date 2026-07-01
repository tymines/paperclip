/**
 * Model Pricing Table — canonical per-million-token rates for every model in
 * Tyler's fleet. Source of truth for the Costs tab. Rates are in USD per
 * 1,000,000 tokens (input, cached-input, output).
 *
 * SOURCES (verified 2026-06-27):
 *   DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
 *   Moonshot: https://platform.moonshot.ai/docs/pricing
 *   Google:   https://ai.google.dev/pricing
 *   Z.AI:     https://docs.z.ai/guides/overview/pricing
 *   MiniMax:  https://computeprices.com/models/minimax-m2-7
 *   Alibaba:  https://pricepertoken.com/pricing-page/model/qwen-qwen3-vl-32b-instruct
 *   Morph:    https://www.morphllm.com/llm-api (cross-reference, verified 2026-06-18)
 *
 * All rates are per 1M tokens. Cached input rates are per 1M cached tokens.
 */

export interface ModelRate {
  /** Canonical model identifier (lowercase, matches what the adapter reports). */
  id: string;
  /** Provider slug (deepseek, moonshot, google, z-ai, minimax, alibaba, openrouter). */
  provider: string;
  /** Human-readable label. */
  label: string;
  /** Price per 1M input tokens (cache miss). */
  inputPerM: number;
  /** Price per 1M cached input tokens. 0 = same as input (no discount). */
  cachedInputPerM: number;
  /** Price per 1M output tokens. */
  outputPerM: number;
  /** GLM-5.2 and others have a limited-time free tier */
  free?: boolean;
  /** Rate-limited promo flag */
  promo?: boolean;
}

const PRICING_TABLE: ModelRate[] = [
  // ── DeepSeek ────────────────────────────────────────────────────────────
  {
    id: "deepseek-v4-flash",
    provider: "deepseek",
    label: "DeepSeek V4 Flash",
    inputPerM: 0.14,
    cachedInputPerM: 0.0028,
    outputPerM: 0.28,
  },
  {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    label: "DeepSeek V4 Pro",
    inputPerM: 0.435,
    cachedInputPerM: 0.003625,
    outputPerM: 0.87,
  },
  // Legacy / alias names for DeepSeek models
  {
    id: "deepseek-chat",
    provider: "deepseek",
    label: "DeepSeek V4 Flash (non-thinking alias)",
    inputPerM: 0.14,
    cachedInputPerM: 0.0028,
    outputPerM: 0.28,
  },
  {
    id: "deepseek-reasoner",
    provider: "deepseek",
    label: "DeepSeek V4 Flash (thinking alias)",
    inputPerM: 0.14,
    cachedInputPerM: 0.0028,
    outputPerM: 0.28,
  },
  // OpenRouter / third-party refinements
  {
    id: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    label: "DeepSeek V4 Flash (OpenRouter)",
    inputPerM: 0.14,
    cachedInputPerM: 0.0028,
    outputPerM: 0.28,
  },
  {
    id: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    label: "DeepSeek V4 Pro (OpenRouter)",
    inputPerM: 0.435,
    cachedInputPerM: 0.003625,
    outputPerM: 0.87,
  },

  // ── Moonshot / Kimi ─────────────────────────────────────────────────────
  {
    id: "kimi-k2.6",
    provider: "moonshot",
    label: "Kimi K2.6",
    inputPerM: 0.95,
    cachedInputPerM: 0.16,
    outputPerM: 4.00,
  },
  {
    id: "kimi-k2.7-code",
    provider: "moonshot",
    label: "Kimi K2.7 Code",
    inputPerM: 0.95,
    cachedInputPerM: 0.16,
    outputPerM: 4.00,
  },
  // OpenRouter aliases
  {
    id: "moonshotai/kimi-k2.6",
    provider: "openrouter",
    label: "Kimi K2.6 (OpenRouter)",
    inputPerM: 0.95,
    cachedInputPerM: 0.16,
    outputPerM: 4.00,
  },
  {
    id: "moonshotai/kimi-k2.7-code",
    provider: "openrouter",
    label: "Kimi K2.7 Code (OpenRouter)",
    inputPerM: 0.95,
    cachedInputPerM: 0.16,
    outputPerM: 4.00,
  },

  // ── Google Gemini ───────────────────────────────────────────────────────
  {
    id: "gemini-2.5-flash",
    provider: "google",
    label: "Gemini 2.5 Flash",
    inputPerM: 0.30,
    cachedInputPerM: 0.15, // 50% discount via context caching
    outputPerM: 1.20,
  },
  {
    id: "gemini-3.1-pro",
    provider: "google",
    label: "Gemini 3.1 Pro",
    inputPerM: 2.00,
    cachedInputPerM: 1.00, // caching discount
    outputPerM: 12.00,
  },
  {
    id: "gemini-3-pro",
    provider: "google",
    label: "Gemini 3 Pro",
    inputPerM: 2.00,
    cachedInputPerM: 1.00,
    outputPerM: 12.00,
  },
  {
    id: "gemini-3.5-flash",
    provider: "google",
    label: "Gemini 3.5 Flash",
    inputPerM: 1.50,
    cachedInputPerM: 0.15,
    outputPerM: 9.00,
  },
  // Gemini 3.1 Flash-Lite — budget tier
  {
    id: "gemini-3.1-flash-lite",
    provider: "google",
    label: "Gemini 3.1 Flash-Lite",
    inputPerM: 0.25,
    cachedInputPerM: 0.025,
    outputPerM: 1.50,
  },
  // OpenRouter aliases for Gemini
  {
    id: "google/gemini-3.1-pro",
    provider: "openrouter",
    label: "Gemini 3.1 Pro (OpenRouter)",
    inputPerM: 2.00,
    cachedInputPerM: 1.00,
    outputPerM: 12.00,
  },

  // ── Z.AI / GLM ──────────────────────────────────────────────────────────
  {
    id: "glm-5.2",
    provider: "z-ai",
    label: "GLM 5.2",
    inputPerM: 1.40,
    cachedInputPerM: 0.26,
    outputPerM: 4.40,
  },
  {
    id: "z-ai/glm-5.2",
    provider: "openrouter",
    label: "GLM 5.2 (OpenRouter)",
    inputPerM: 1.40,
    cachedInputPerM: 0.26,
    outputPerM: 4.40,
  },
  {
    id: "glm-5.1",
    provider: "z-ai",
    label: "GLM 5.1",
    inputPerM: 1.40,
    cachedInputPerM: 0.26,
    outputPerM: 4.40,
  },
  {
    id: "glm-5",
    provider: "z-ai",
    label: "GLM 5",
    inputPerM: 1.00,
    cachedInputPerM: 0.20,
    outputPerM: 3.20,
  },

  // ── MiniMax ─────────────────────────────────────────────────────────────
  {
    id: "minimax-m2.7",
    provider: "minimax",
    label: "MiniMax M2.7",
    inputPerM: 0.30,
    cachedInputPerM: 0.06,
    outputPerM: 1.20,
  },
  {
    id: "minimax/minimax-m2.7",
    provider: "openrouter",
    label: "MiniMax M2.7 (OpenRouter)",
    inputPerM: 0.30,
    cachedInputPerM: 0.06,
    outputPerM: 1.20,
  },

  // ── Alibaba / Qwen ──────────────────────────────────────────────────────
  {
    id: "qwen3-vl-32b",
    provider: "alibaba",
    label: "Qwen3-VL 32B",
    inputPerM: 0.104,
    cachedInputPerM: 0.052, // estimated 50% discount
    outputPerM: 0.416,
  },
  {
    id: "qwen/qwen3-vl-32b-instruct",
    provider: "openrouter",
    label: "Qwen3-VL 32B (OpenRouter)",
    inputPerM: 0.104,
    cachedInputPerM: 0.052,
    outputPerM: 0.416,
  },
  {
    id: "qwen3.5-plus",
    provider: "alibaba",
    label: "Qwen 3.5 Plus",
    inputPerM: 0.40,
    cachedInputPerM: 0.20,
    outputPerM: 2.40,
  },
  {
    id: "qwen3.5-397b",
    provider: "alibaba",
    label: "Qwen 3.5 397B",
    inputPerM: 0.60,
    cachedInputPerM: 0.30,
    outputPerM: 3.60,
  },

  // ── Anthropic ───────────────────────────────────────────────────────────
  {
    id: "claude-sonnet-4.6",
    provider: "anthropic",
    label: "Claude Sonnet 4.6",
    inputPerM: 3.00,
    cachedInputPerM: 0.30, // 10% of input
    outputPerM: 15.00,
  },
  {
    id: "claude-opus-4.8",
    provider: "anthropic",
    label: "Claude Opus 4.8",
    inputPerM: 5.00,
    cachedInputPerM: 0.50,
    outputPerM: 25.00,
  },
  {
    id: "claude-haiku-4.5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    inputPerM: 1.00,
    cachedInputPerM: 0.10,
    outputPerM: 5.00,
  },

  // ── OpenAI ──────────────────────────────────────────────────────────────
  {
    id: "gpt-5.5",
    provider: "openai",
    label: "GPT 5.5",
    inputPerM: 5.00,
    cachedInputPerM: 0.50, // 10% of input
    outputPerM: 30.00,
  },
  {
    id: "gpt-5.4",
    provider: "openai",
    label: "GPT 5.4",
    inputPerM: 2.50,
    cachedInputPerM: 0.25,
    outputPerM: 15.00,
  },
  {
    id: "gpt-5.3-codex",
    provider: "openai",
    label: "GPT 5.3 Codex",
    inputPerM: 1.75,
    cachedInputPerM: 0.175,
    outputPerM: 14.00,
  },

  // ── OpenRouter model-by-model refinements ───────────────────────────────
  {
    id: "anthropic/claude-sonnet-4.6",
    provider: "openrouter",
    label: "Claude Sonnet 4.6 (OpenRouter)",
    inputPerM: 3.00,
    cachedInputPerM: 0.30,
    outputPerM: 15.00,
  },
  {
    id: "openai/gpt-5.5",
    provider: "openrouter",
    label: "GPT 5.5 (OpenRouter)",
    inputPerM: 5.00,
    cachedInputPerM: 0.50,
    outputPerM: 30.00,
  },
];

/** Aliases: a map of common short names / variant names to canonical ids. */
const ALIASES: Record<string, string> = {
  "deepseek-v4-flash": "deepseek-v4-flash",
  "deepseek-v4-pro": "deepseek-v4-pro",
  "deepseek/deepseek-v4-flash": "deepseek-v4-flash",
  "deepseek/deepseek-v4-pro": "deepseek-v4-pro",
  "deepseek-chat": "deepseek-chat",
  "deepseek-reasoner": "deepseek-reasoner",

  "kimi-k2.5": "kimi-k2.6", // K2.6 is the replacement for K2.5 (same pricing tier)
  "kimi-k2.6": "kimi-k2.6",
  "kimi-k2.7": "kimi-k2.7-code",
  "kimi-k2.7-code": "kimi-k2.7-code",
  "moonshotai/kimi-k2.6": "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.7-code": "moonshotai/kimi-k2.7-code",

  "gemini-2.5-flash": "gemini-2.5-flash",
  "gemini-2.5-pro": "gemini-2.5-flash", // treated as equivalent
  "gemini-3-pro": "gemini-3-pro",
  "gemini-3.1-pro": "gemini-3.1-pro",
  "gemini-3.1-pro-preview": "gemini-3.1-pro",
  "gemini-3.5-flash": "gemini-3.5-flash",
  "gemini-3.1-flash-lite": "gemini-3.1-flash-lite",
  "google/gemini-3.1-pro": "google/gemini-3.1-pro",
  "gemini/gemini-3.1-pro": "google/gemini-3.1-pro",

  "glm-5": "glm-5",
  "glm-5.1": "glm-5.1",
  "glm-5.2": "glm-5.2",
  "z-ai/glm-5.2": "z-ai/glm-5.2",

  "minimax-m2.7": "minimax-m2.7",
  "minimax-m3": "minimax-m2.7", // M3 uses same pricing tier
  "minimax/minimax-m2.7": "minimax/minimax-m2.7",

  "qwen3-vl": "qwen3-vl-32b",
  "qwen3-vl-32b": "qwen3-vl-32b",
  "qwen3-vl-32b-instruct": "qwen3-vl-32b",
  "qwen/qwen3-vl-32b-instruct": "qwen/qwen3-vl-32b-instruct",
  "qwen3.5-plus": "qwen3.5-plus",
  "qwen3.5-397b": "qwen3.5-397b",

  "claude-sonnet-4.6": "claude-sonnet-4.6",
  "claude-sonnet-4.7": "claude-sonnet-4.6", // same pricing
  "claude-opus-4.8": "claude-opus-4.8",
  "claude-opus-4.7": "claude-opus-4.8", // same pricing
  "claude-haiku-4.5": "claude-haiku-4.5",
  "anthropic/claude-sonnet-4.6": "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.8": "claude-opus-4.8",

  "gpt-5.5": "gpt-5.5",
  "gpt-5.4": "gpt-5.4",
  "gpt-5.3-codex": "gpt-5.3-codex",
  "gpt-5.4-nano": "gpt-5.4", // approximate
  "openai/gpt-5.5": "openai/gpt-5.5",
  "openai/gpt-5.4": "gpt-5.4",
};

const CANONICAL = new Map(PRICING_TABLE.map((r) => [r.id, r]));

/**
 * Look up a model's pricing by its id or alias.
 * Returns undefined for unknown models.
 */
export function getModelRate(modelId: string): ModelRate | undefined {
  const canonical = ALIASES[modelId.toLowerCase().trim()] ?? modelId.toLowerCase().trim();
  return CANONICAL.get(canonical);
}

/**
 * Compute the cost in cents for a given model and token counts.
 * Returns costCents (integer, rounded).
 */
export function computeCostCents(
  modelId: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
): number {
  const rate = getModelRate(modelId);
  if (!rate) return 0; // unknown model — can't compute cost

  // Per-token cost from per-million rate: rate / 1_000_000
  const inputCost = (inputTokens / 1_000_000) * rate.inputPerM;
  const cachedInputCost = (cachedInputTokens / 1_000_000) * rate.cachedInputPerM;
  const outputCost = (outputTokens / 1_000_000) * rate.outputPerM;

  const totalUsd = inputCost + cachedInputCost + outputCost;
  // Round to nearest cent (integer cents)
  return Math.max(0, Math.round(totalUsd * 100));
}

/**
 * Get all known model rates (for debugging / admin display).
 */
export function getAllModelRates(): ModelRate[] {
  return [...PRICING_TABLE];
}
