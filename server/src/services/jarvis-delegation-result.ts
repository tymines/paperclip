import { z } from "zod";
import { extractSingleJsonObject } from "./book-review-json.js";

export const DELEGATION_RESULT_MAX_CHARS = 64_000;
export const HADES_RAW_REVIEW_MAX_CHARS = 96_000;

/**
 * Permit the observed noisy Hades envelope to reach the authenticated
 * delegation service. That service still enforces the normal 64k cap for
 * arbitrary peers and stores only compact review JSON for a verified Hades
 * Book Studio critic delegation.
 */
export const delegationCallbackBodySchema = z.object({
  status: z.enum(["running", "completed", "failed"]),
  result: z.string().max(HADES_RAW_REVIEW_MAX_CHARS).optional(),
  error: z.string().max(4_000).optional(),
});

export type DelegationCallbackBody = z.infer<typeof delegationCallbackBodySchema>;

export type NormalizeDelegationResultOutcome =
  | { ok: true; result?: string }
  | { ok: false; error: "result_too_large" | "invalid_hades_review_result" };

export function normalizeDelegationCallbackResult(args: {
  agent: string;
  metadata: Record<string, unknown>;
  status: DelegationCallbackBody["status"];
  result?: string;
}): NormalizeDelegationResultOutcome {
  const isHadesBookReview =
    args.agent === "hades" && args.metadata.kind === "book-studio-critic";

  if (isHadesBookReview && args.status === "completed" && args.result !== undefined) {
    try {
      const compact = JSON.stringify(extractSingleJsonObject(args.result));
      if (compact.length > DELEGATION_RESULT_MAX_CHARS) {
        return { ok: false, error: "result_too_large" };
      }
      return { ok: true, result: compact };
    } catch {
      return { ok: false, error: "invalid_hades_review_result" };
    }
  }

  if ((args.result?.length ?? 0) > DELEGATION_RESULT_MAX_CHARS) {
    return { ok: false, error: "result_too_large" };
  }
  return { ok: true, result: args.result };
}
