/**
 * compliance-gate.ts — LLM-based content moderation for reel scripts.
 *
 * Runs BEFORE any media spend (keyframe/video gen) in the orchestrator
 * pipeline. For risky niches (finance/legal/medical/real_estate), the
 * template's metadata.complianceCheckPrompt + bannedWords list is fed
 * through a small fast model (Kimi K2.5) to verify the script doesn't
 * cross into advisory territory.
 *
 * Per Augi's research synthesis:
 *   - Kimi K2.5 ($0.0003/call) is the right pick — content moderation
 *     is classification not reasoning, heavy models add no meaningful
 *     accuracy gain.
 *   - Hybrid second-pass on FAIL: re-run through Claude Sonnet (~$0.015)
 *     only when Kimi flags. Blended cost ~$0.001/call. Catches edge
 *     cases without 50x cost on every script.
 *
 * For "safe" niches (tech, fashion, food, etc) the template's
 * complianceCheckPrompt is null and this function auto-passes after
 * just running the banned-word check.
 */
import type { Db } from "@paperclipai/db";
import { reelTemplates, type Reel, type ReelScene } from "@paperclipai/db";
import { eq } from "drizzle-orm";

export interface ComplianceResult {
  verdict: "PASS" | "FAIL";
  reason: string | null;
  bannedWordHits: string[];
  /** Disclaimers to append to caption (from template + any LLM-added). */
  disclaimers: string[];
  /** Which model was used; null if no LLM check (safe niche). */
  modelUsed: string | null;
  /** Approximate cost in USD for this gate check. */
  costUsd: number;
}

interface TemplateMetadata {
  hookPatterns?: string[];
  sceneCount?: number;
  targetCutDurationSeconds?: number;
  bannedWords?: string[];
  requiredDisclaimer?: string | null;
  recommendedClips?: Record<string, string>;
  compatiblePersonas?: string[];
  defaultHashtagPack?: string[];
  complianceCheckPrompt?: string | null;
}

/**
 * Run the gate. Loads the template metadata associated with the reel's
 * style preset (or null if no template found — treats as safe niche).
 */
export async function runComplianceGate(
  db: Db,
  reel: Reel,
  scenes: ReelScene[],
): Promise<ComplianceResult> {
  // === 1. Load template metadata ===
  // If reel.stylePreset matches a template name, use its metadata. If not,
  // skip the LLM check entirely (defensive default = pass).
  const tmpl = reel.stylePreset
    ? await db
        .select()
        .from(reelTemplates)
        .where(eq(reelTemplates.stylePreset, reel.stylePreset))
        .limit(1)
        .then((rows) => rows[0])
    : null;

  const meta = (tmpl?.metadata as TemplateMetadata | null) ?? {};
  const bannedWords = meta.bannedWords ?? [];
  const requiredDisclaimer = meta.requiredDisclaimer ?? null;
  const checkPrompt = meta.complianceCheckPrompt ?? null;
  const disclaimers: string[] = [];
  if (requiredDisclaimer) disclaimers.push(requiredDisclaimer);

  // Concatenate all scene descriptions + dialogue for the gate check.
  const fullScript = scenes
    .map(
      (s, i) =>
        `Scene ${i + 1} (${s.sceneDurationSeconds}s, ${s.cameraFraming ?? "any"}):\n  ${s.description}\n  motion: ${s.motionHint ?? "—"}`,
    )
    .join("\n\n");

  // === 2. Banned-word check (cheap, sync) ===
  const lower = fullScript.toLowerCase();
  const bannedWordHits = bannedWords.filter((w) =>
    lower.includes(w.toLowerCase()),
  );
  if (bannedWordHits.length > 0) {
    return {
      verdict: "FAIL",
      reason: `Banned word(s) detected: ${bannedWordHits.join(", ")}`,
      bannedWordHits,
      disclaimers,
      modelUsed: null,
      costUsd: 0,
    };
  }

  // === 3. LLM check — only if template has a complianceCheckPrompt ===
  if (!checkPrompt) {
    return {
      verdict: "PASS",
      reason: null,
      bannedWordHits: [],
      disclaimers,
      modelUsed: null,
      costUsd: 0,
    };
  }

  // Primary: Kimi K2.5 (fast, cheap, classification-suitable)
  const kimiResult = await callKimiK25Gate(checkPrompt, fullScript);
  if (kimiResult.verdict === "PASS") {
    return {
      verdict: "PASS",
      reason: null,
      bannedWordHits: [],
      disclaimers,
      modelUsed: "moonshot/kimi-k2.5",
      costUsd: kimiResult.costUsd,
    };
  }

  // FAIL on Kimi → second-pass via Claude Sonnet for confirmation.
  // This is the hybrid pattern from Augi's synthesis: ~5% of calls go
  // through the expensive model, blended cost stays under $0.001/call.
  const sonnetResult = await callSonnetGate(checkPrompt, fullScript);
  return {
    verdict: sonnetResult.verdict,
    reason: sonnetResult.reason,
    bannedWordHits: [],
    disclaimers,
    modelUsed: "anthropic/claude-sonnet-4.6+kimi-k2.5",
    costUsd: kimiResult.costUsd + sonnetResult.costUsd,
  };
}

/**
 * Kimi K2.5 gate call via Moonshot API. Cheap, fast (~400-800ms).
 *
 * NOTE: This is a stub — wire to the real Moonshot client. The pattern
 * follows social-caption.ts in this repo. Replace the placeholder with
 * the actual API call when the LLM client module is finalized.
 */
async function callKimiK25Gate(
  prompt: string,
  script: string,
): Promise<{ verdict: "PASS" | "FAIL"; reason: string | null; costUsd: number }> {
  // TODO(reels): wire to existing Moonshot client used by social-caption.ts.
  // The expected response shape per the template's complianceCheckPrompt:
  //   "PASS" or "REJECT <reason> <educational rewrite>"
  const fullPrompt = `${prompt}\n\n--- SCRIPT TO REVIEW ---\n${script}\n\n--- END SCRIPT ---\n\nReturn ONLY one of: "PASS" or "REJECT <reason>".`;

  // Placeholder behavior — defaults to PASS until wired. Log a warning
  // so we notice it's not actually running.
  console.warn(
    "[compliance-gate] Kimi K2.5 stub returning PASS — wire to Moonshot client",
    { promptLength: prompt.length, scriptLength: script.length, fullPromptLength: fullPrompt.length },
  );
  return { verdict: "PASS", reason: null, costUsd: 0.0003 };
}

/**
 * Claude Sonnet 4.6 second-pass gate. Only invoked when Kimi flags FAIL.
 * Expensive (~$0.015/call) but high accuracy — used as the appeal layer.
 */
async function callSonnetGate(
  prompt: string,
  script: string,
): Promise<{ verdict: "PASS" | "FAIL"; reason: string | null; costUsd: number }> {
  // TODO(reels): wire to Anthropic client.
  const fullPrompt = `${prompt}\n\n--- SCRIPT TO REVIEW ---\n${script}\n\n--- END SCRIPT ---\n\nReturn ONLY one of: "PASS" or "REJECT <specific reason>".`;

  console.warn(
    "[compliance-gate] Sonnet stub returning FAIL (conservative default — wire to Anthropic client)",
    { promptLength: prompt.length, scriptLength: script.length, fullPromptLength: fullPrompt.length },
  );
  // Conservative default: when stubbed, assume Kimi's FAIL was correct.
  return {
    verdict: "FAIL",
    reason: "Sonnet second-pass not yet wired; defaulting to FAIL on Kimi flag.",
    costUsd: 0.015,
  };
}
