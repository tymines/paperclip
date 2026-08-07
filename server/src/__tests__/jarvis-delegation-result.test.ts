import { describe, expect, it } from "vitest";
import {
  DELEGATION_RESULT_MAX_CHARS,
  delegationCallbackBodySchema,
  normalizeDelegationCallbackResult,
} from "../services/jarvis-delegation-result.js";

const hadesContext = {
  agent: "hades",
  metadata: { kind: "book-studio-critic" },
  status: "completed" as const,
};

describe("Hades delegation callback result normalization", () => {
  it("accepts an over-64k noisy callback and compacts its single final review object", () => {
    const review = {
      scores: { pacing: 8, characterVoice: 9 },
      summary: "A valid review.",
      findings: [{ note: "Literal braces {and} remain text." }],
    };
    const noisyResult = `${"reasoning diagnostic line\n".repeat(3_300)}${JSON.stringify(review)}`;
    expect(noisyResult.length).toBeGreaterThan(84_375);

    const body = delegationCallbackBodySchema.parse({ status: "completed", result: noisyResult });
    const normalized = normalizeDelegationCallbackResult({
      ...hadesContext,
      result: body.result,
    });

    expect(normalized).toEqual({ ok: true, result: JSON.stringify(review) });
    expect(normalized.ok && normalized.result!.length).toBeLessThan(DELEGATION_RESULT_MAX_CHARS);
  });

  it.each([
    ["malformed", `${"reasoning\n".repeat(7_000)}{not JSON}`],
    ["ambiguous", `${"reasoning\n".repeat(7_000)}{"first":true}\n{"second":true}`],
  ])("fails closed for %s over-64k Hades output", (_label, result) => {
    expect(result.length).toBeGreaterThan(DELEGATION_RESULT_MAX_CHARS);
    const body = delegationCallbackBodySchema.parse({ status: "completed", result });
    expect(normalizeDelegationCallbackResult({ ...hadesContext, result: body.result })).toEqual({
      ok: false,
      error: "invalid_hades_review_result",
    });
  });

  it("preserves the 64k result cap for arbitrary peers", () => {
    const result = "x".repeat(DELEGATION_RESULT_MAX_CHARS + 1);
    const body = delegationCallbackBodySchema.parse({ status: "completed", result });
    expect(
      normalizeDelegationCallbackResult({
        agent: "hermes",
        metadata: {},
        status: body.status,
        result: body.result,
      }),
    ).toEqual({ ok: false, error: "result_too_large" });
  });

  it("does not grant the Hades exception without Book Studio critic metadata", () => {
    const result = `${"reasoning\n".repeat(7_000)}{"scores":{}}`;
    expect(
      normalizeDelegationCallbackResult({
        agent: "hades",
        metadata: { kind: "unrelated" },
        status: "completed",
        result,
      }),
    ).toEqual({ ok: false, error: "result_too_large" });
  });
});
