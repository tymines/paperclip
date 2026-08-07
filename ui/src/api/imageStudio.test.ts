import { describe, expect, it } from "vitest";
import { GENERATION_JOB_STATUSES } from "./imageStudio";

describe("Image Studio durable job status contract", () => {
  it("includes submission and landing recovery states from the server schema", () => {
    expect(GENERATION_JOB_STATUSES).toEqual([
      "queued",
      "submitting",
      "submitted",
      "polling",
      "landing",
      "succeeded",
      "failed",
    ]);
  });
});
