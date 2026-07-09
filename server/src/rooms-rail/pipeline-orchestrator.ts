// WO-6: Pipeline Orchestrator — drives E2E stage progression through all 5 gates
// plan → critique → code → review → merge
// SHADOW mode: full pipeline executes, gates evaluated, zero real transitions.

import type { Db } from "@paperclipai/db";
import { checkGate, type GateResult } from "./gate-checker";

// ── Pipeline stage order ──
export const STAGE_ORDER = ["plan", "critique", "code", "review", "merge"] as const;
export type StageName = (typeof STAGE_ORDER)[number];

export interface StageProgress {
  stage: StageName;
  status: "pending" | "running" | "completed";
  gateResult: GateResult | null;
  artifactIds: string[];
}

export interface PipelineRun {
  runId: string;
  roomId: string;
  stages: StageProgress[];
  currentStage: number; // index into STAGE_ORDER
  completed: boolean;
  shadow: boolean;
}

/**
 * Create a new shadow pipeline run for a room.
 * All stages start as pending. Boss assignment happens at pipeline creation.
 */
export function createPipelineRun(
  runId: string,
  roomId: string,
): PipelineRun {
  return {
    runId,
    roomId,
    stages: STAGE_ORDER.map((stage) => ({
      stage,
      status: "pending" as const,
      gateResult: null,
      artifactIds: [],
    })),
    currentStage: 0,
    completed: false,
    shadow: true,
  };
}

/**
 * Advance the pipeline to the next stage.
 * Gate checks run at stage completion. SHADOW: always passes.
 */
export function advanceStage(
  run: PipelineRun,
  evidence: string[],
): PipelineRun {
  if (run.completed) return run;

  const stage = run.stages[run.currentStage];
  if (!stage) return run;

  // Gate check for the CURRENT stage before advancing
  const gateResult = checkGate(stage.stage, evidence);
  stage.gateResult = gateResult;
  stage.status = "completed";

  // Advance to next stage
  run.currentStage++;

  // Check if we're done
  if (run.currentStage >= STAGE_ORDER.length) {
    run.completed = true;
    return run;
  }

  // Mark next stage as running
  run.stages[run.currentStage].status = "running";

  return run;
}

/**
 * Run the full pipeline end-to-end — all 5 stages with mock evidence.
 * Returns the completed pipeline run for verification.
 */
export function runFullPipeline(
  runId: string,
  roomId: string,
  evidenceMap: Record<string, string[]>,
): PipelineRun {
  const run = createPipelineRun(runId, roomId);

  // Mark first stage as running
  run.stages[0].status = "running";

  for (const stage of STAGE_ORDER) {
    const evidence = evidenceMap[stage] ?? [];
    advanceStage(run, evidence);
  }

  return run;
}

/**
 * Verify that a completed pipeline run satisfies all gate requirements.
 * Returns per-stage gate results and overall shadow status.
 */
export function verifyPipeline(run: PipelineRun): {
  allGatesEvaluated: boolean;
  allStagesCompleted: boolean;
  gateCount: number;
} {
  return {
    allGatesEvaluated: run.stages.every((s) => s.gateResult !== null),
    allStagesCompleted: run.stages.every((s) => s.status === "completed"),
    gateCount: run.stages.filter((s) => s.gateResult !== null).length,
  };
}
