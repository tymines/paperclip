// WO-5: Review Router tests
// Mocks @paperclipai/db to avoid module resolution issues (same pattern as WO-2)
// Verifies: 3-reviewer routing, verdict shape, consensus logic, shadow pass

import { describe, it, expect, vi } from "vitest";

// ponytail: inline mock to avoid @paperclipai/db resolution — same as WO-2 rail-engine test
vi.mock("@paperclipai/db", () => ({
  roomsRailConfig: {},
  roomTransitions: {},
}));

import { routeReview, runReviewCycle, REVIEWER_MODELS } from "../rooms-rail/review-router";

describe("Review Router (SHADOW mode)", () => {
  describe("REVIEWER_MODELS", () => {
    it("maps 3 distinct model families", () => {
      expect(REVIEWER_MODELS.r1).toBe("gemini-2.5-flash");
      expect(REVIEWER_MODELS.r2).toBe("deepseek-v4-flash");
      expect(REVIEWER_MODELS.ev).toBe("gpt-4o-mini");

      // 3 distinct families per fleet.yaml v2
      const families = new Set(Object.values(REVIEWER_MODELS));
      expect(families.size).toBe(3);
    });
  });

  describe("routeReview", () => {
    it("returns shadow-pass verdict for R1", async () => {
      const v = await routeReview("r1", "test evidence");
      expect(v.reviewer).toBe("r1");
      expect(v.passed).toBe(true); // shadow: always passes
      expect(v.concerns).toEqual([]);
      expect(v.evidenceGaps).toEqual([]);
      expect(v.timestamp).toBeTruthy();
    });

    it("returns shadow-pass verdict for R2", async () => {
      const v = await routeReview("r2", "test evidence");
      expect(v.reviewer).toBe("r2");
      expect(v.passed).toBe(true);
    });

    it("returns shadow-pass verdict for EV", async () => {
      const v = await routeReview("ev", "test evidence");
      expect(v.reviewer).toBe("ev");
      expect(v.passed).toBe(true);
    });
  });

  describe("runReviewCycle", () => {
    it("runs all 3 reviewers in parallel and returns consensus=true", async () => {
      const result = await runReviewCycle("evidence payload");
      expect(result.verdicts).toHaveLength(3);
      expect(result.verdicts.map((v) => v.reviewer).sort()).toEqual([
        "ev",
        "r1",
        "r2",
      ]);
      expect(result.consensus).toBe(true);
      expect(result.shadow).toBe(true);
    });

    it("each verdict has required fields", async () => {
      const result = await runReviewCycle("evidence");
      for (const v of result.verdicts) {
        expect(v).toHaveProperty("reviewer");
        expect(v).toHaveProperty("passed");
        expect(v).toHaveProperty("concerns");
        expect(v).toHaveProperty("evidenceGaps");
        expect(v).toHaveProperty("timestamp");
      }
    });
  });
});
