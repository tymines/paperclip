// WO-5: Review Router — dispatches review tasks to Ares Reviewers (R1/R2/EV)
// 3-model-family diversity per fleet.yaml v2: Gemini / DeepSeek / OpenAI
// SHADOW mode: executes reviews but verdicts are logged, not enforced.

import type { Db } from "@paperclipai/db";

// ── Reviewer model bindings (from fleet.yaml v2) ──
export const REVIEWER_MODELS: Record<string, string> = {
  r1: "gemini-2.5-flash",   // Gemini family
  r2: "deepseek-v4-flash",  // DeepSeek family
  ev: "gpt-4o-mini",        // OpenAI family — cross-model independent verifier
};

export interface ReviewVerdict {
  reviewer: "r1" | "r2" | "ev";
  passed: boolean;
  concerns: string[];
  evidenceGaps: string[];
  timestamp: string;
}

export interface ReviewResult {
  stageId: string;
  verdicts: ReviewVerdict[];
  consensus: boolean;          // true when R1 + R2 agree AND EV confirms
  shadow: boolean;             // always true in current mode
}

// ── Review dispatch ──

/**
 * Route a review task to the appropriate reviewer slot.
 * In SHADOW mode, returns a placeholder verdict — no real model call.
 * When live, this would invoke Hermes profiles on Box 2 via Paperclip adapter.
 */
export async function routeReview(
  slot: "r1" | "r2" | "ev",
  evidence: string,
): Promise<ReviewVerdict> {
  // ponytail: SHADOW — placeholder verdict. Replace with real adapter call when live.
  const model = REVIEWER_MODELS[slot];
  return {
    reviewer: slot,
    passed: true, // shadow: always passes
    concerns: [],
    evidenceGaps: [],
    timestamp: new Date().toISOString(),
  };
}

/**
 * Run full 3-reviewer cycle: R1 → R2 → EV cross-check.
 * Consensus = R1.passed && R2.passed && EV.passed.
 */
export async function runReviewCycle(
  evidence: string,
): Promise<ReviewResult> {
  const [r1, r2] = await Promise.all([
    routeReview("r1", evidence),
    routeReview("r2", evidence),
  ]);

  // EV cross-checks R1 and R2 verdicts (different model family)
  const ev = await routeReview("ev", JSON.stringify({ r1, r2, evidence }));

  const consensus = r1.passed && r2.passed && ev.passed;

  return {
    stageId: "", // filled by caller
    verdicts: [r1, r2, ev],
    consensus,
    shadow: true,
  };
}

/**
 * Check if a review stage has sufficient evidence per gate_policy.
 * SHADOW: always returns true (gates not enforced).
 */
export async function checkReviewGate(
  db: Db,
  _stageId: string,
): Promise<{ passed: boolean; missing: string[] }> {
  // ponytail: SHADOW — return true. Wire to gate_policy table when live.
  return { passed: true, missing: [] };
}
