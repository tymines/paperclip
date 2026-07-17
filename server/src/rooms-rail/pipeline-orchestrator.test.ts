// WO-6: E2E Shadow Pipeline test
// Verifies full 5-stage pipeline: plan → critique → code → review → merge
// Gate enforcement in shadow, boss/worker topology, review protocol wired

import { describe, it, expect } from "vitest";
import {
  createPipelineRun,
  advanceStage,
  runFullPipeline,
  verifyPipeline,
  STAGE_ORDER,
} from "../rooms-rail/pipeline-orchestrator";

// ── Mock evidence map for all 5 stages ──
const FULL_EVIDENCE: Record<string, string[]> = {
  plan: ["plan_document"],
  critique: ["critique_verdict"],
  code: ["code_diff", "test_output"],
  review: ["review_verdict"],
  merge: ["merge_sha"],
};

describe("Pipeline Orchestrator (E2E Shadow)", () => {
  describe("createPipelineRun", () => {
    it("initializes with 5 pending stages", () => {
      const run = createPipelineRun("run-1", "room-1");
      expect(run.stages).toHaveLength(5);
      expect(run.currentStage).toBe(0);
      expect(run.completed).toBe(false);
      expect(run.shadow).toBe(true);
      expect(run.stages[0].stage).toBe("plan");
      expect(run.stages[4].stage).toBe("merge");
    });
  });

  describe("advanceStage", () => {
    it("completes current stage and advances to next", () => {
      const run = createPipelineRun("run-2", "room-2");
      run.stages[0].status = "running";

      const advanced = advanceStage(run, ["plan_document"]);

      expect(advanced.stages[0].status).toBe("completed");
      expect(advanced.stages[0].gateResult).not.toBeNull();
      expect(advanced.stages[0].gateResult!.passed).toBe(true);
      expect(advanced.currentStage).toBe(1);
      expect(advanced.stages[1].status).toBe("running");
    });

    it("sets gate result with missing evidence recorded (shadow: still passes)", () => {
      const run = createPipelineRun("run-3", "room-3");
      run.stages[0].status = "running";

      // Submit NO evidence for plan stage
      const advanced = advanceStage(run, []);

      expect(advanced.stages[0].gateResult!.passed).toBe(true); // shadow: passes
      expect(advanced.stages[0].gateResult!.missing).toContain(
        "plan_document",
      );
    });
  });

  describe("runFullPipeline — E2E", () => {
    it("completes all 5 stages in order", () => {
      const run = runFullPipeline("e2e-1", "room-e2e", FULL_EVIDENCE);

      expect(run.completed).toBe(true);
      expect(run.currentStage).toBe(5);

      // Every stage is completed
      for (const s of run.stages) {
        expect(s.status).toBe("completed");
      }
    });

    it("all 5 gates evaluated with correct stage names", () => {
      const run = runFullPipeline("e2e-2", "room-e2e", FULL_EVIDENCE);

      for (let i = 0; i < STAGE_ORDER.length; i++) {
        const stage = run.stages[i];
        expect(stage.stage).toBe(STAGE_ORDER[i]);
        expect(stage.gateResult).not.toBeNull();
        expect(stage.gateResult!.stage).toBe(STAGE_ORDER[i]);
        expect(stage.gateResult!.passed).toBe(true);
        expect(stage.gateResult!.shadow).toBe(true);
      }
    });

    it("verifyPipeline confirms all gates evaluated", () => {
      const run = runFullPipeline("e2e-3", "room-e2e", FULL_EVIDENCE);
      const v = verifyPipeline(run);

      expect(v.allGatesEvaluated).toBe(true);
      expect(v.allStagesCompleted).toBe(true);
      expect(v.gateCount).toBe(5);
    });
  });

  describe("missing evidence — shadow tolerance", () => {
    it("completes pipeline even with zero evidence (shadow mode)", () => {
      const run = runFullPipeline("e2e-4", "room-e2e", {});
      expect(run.completed).toBe(true);

      // All gates should report missing evidence but still pass
      for (const s of run.stages) {
        expect(s.gateResult!.passed).toBe(true);
        expect(s.gateResult!.missing.length).toBeGreaterThan(0);
      }
    });
  });

  describe("stage order integrity", () => {
    it("STAGE_ORDER is immutable and correct", () => {
      expect(STAGE_ORDER).toEqual([
        "plan",
        "critique",
        "code",
        "review",
        "merge",
      ]);
      expect(STAGE_ORDER).toHaveLength(5);
    });
  });
});
