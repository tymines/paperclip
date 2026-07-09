// WO-6: Gate Checker — validates stage evidence against gate_policy requirements
// SHADOW mode: evaluates gates, logs pass/fail, never blocks.
// When live: returns {passed, missing} that the orchestrator enforces.

import type { Db } from "@paperclipai/db";

// ── Gate policy lookup (mirrors migration 0144 seed) ──
export const PIPELINE_GATES: Record<
  string,
  { requiredEvidence: string[]; minReviewers: number; description: string }
> = {
  plan: {
    requiredEvidence: ["plan_document"],
    minReviewers: 1,
    description: "Gate 1: Plan approval — requires written plan document",
  },
  critique: {
    requiredEvidence: ["critique_verdict"],
    minReviewers: 1,
    description: "Gate 2: Critique pass — requires critic verdict",
  },
  code: {
    requiredEvidence: ["code_diff", "test_output"],
    minReviewers: 1,
    description: "Gate 3: Code complete — requires diff + passing tests",
  },
  review: {
    requiredEvidence: ["review_verdict"],
    minReviewers: 1,
    description: "Gate 4: Review pass — requires independent review verdict",
  },
  merge: {
    requiredEvidence: ["merge_sha"],
    minReviewers: 1,
    description: "Gate 5: Merge gate — requires merge commit SHA",
  },
};

export interface GateResult {
  stage: string;
  passed: boolean;
  missing: string[];
  provided: string[];
  shadow: boolean; // always true in current mode
}

/**
 * Check if a stage's provided evidence meets gate_policy requirements.
 * SHADOW: always returns passed=true with informative missing list.
 */
export function checkGate(
  stage: string,
  providedEvidence: string[],
): GateResult {
  const gate = PIPELINE_GATES[stage];
  if (!gate) {
    return {
      stage,
      passed: false,
      missing: ["unknown_stage"],
      provided: providedEvidence,
      shadow: true,
    };
  }

  const missing = gate.requiredEvidence.filter(
    (req) => !providedEvidence.includes(req),
  );

  // ponytail: SHADOW — log the gap but don't block
  return {
    stage,
    passed: true, // shadow: always passes
    missing,
    provided: providedEvidence,
    shadow: true,
  };
}

/**
 * Validate all 5 pipeline stages in sequence.
 * Returns per-stage results + overall shadow status.
 */
export function validatePipeline(
  stageEvidence: Record<string, string[]>,
): { stages: GateResult[]; allPassed: boolean } {
  const stageOrder = ["plan", "critique", "code", "review", "merge"];
  const stages = stageOrder.map((stage) =>
    checkGate(stage, stageEvidence[stage] ?? []),
  );

  return {
    stages,
    allPassed: stages.every((s) => s.passed),
  };
}
