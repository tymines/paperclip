import { z } from "zod";
import { APPROVAL_TYPES, EVIDENCE_TYPES } from "../constants.js";
import { multilineTextSchema } from "./text.js";

/**
 * ── Anti-over-claiming evidence schema ──────────────────────────────────
 * A task_completion approval MUST carry proof of work before it can reach
 * "Needs Approval".  The evidence items are verified by the reviewer agent
 * (Zeus Reviewer) and surfaced on the Needs Approval card for Tyler.
 */
export const evidenceEntrySchema = z.object({
  type: z.enum(EVIDENCE_TYPES),
  content: z.string().min(1, "Evidence content is required"),
  label: z.string().optional(),
});
export type EvidenceEntry = z.infer<typeof evidenceEntrySchema>;

const MIN_SUMMARY_LENGTH = 10;

/** Base schema for approval creation (without anti-over-claiming refinement). */
export const createApprovalInputSchema = z.object({
  type: z.enum(APPROVAL_TYPES),
  requestedByAgentId: z.string().uuid().optional().nullable(),
  payload: z.record(z.string(), z.unknown()),
  issueIds: z.array(z.string().uuid()).optional(),
});

export const createApprovalSchema = createApprovalInputSchema.superRefine((data, ctx) => {
  // ── Anti-over-claiming gate ──
  // Every task_completion approval must carry verifiable proof of work.
  // Without it the issue can never reach "Needs Approval".
  if (data.type === "task_completion") {
    const payload = data.payload;

    // 1. Written summary of what was done
    if (
      !payload.summary
      || typeof payload.summary !== "string"
      || payload.summary.trim().length < MIN_SUMMARY_LENGTH
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `task_completion requires payload.summary (≥${MIN_SUMMARY_LENGTH} chars) describing what was done`,
        path: ["payload", "summary"],
      });
    }

    // 2. Verifiable evidence
    if (
      !payload.evidence
      || !Array.isArray(payload.evidence)
      || payload.evidence.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "task_completion requires payload.evidence array with ≥1 verifiable evidence item",
        path: ["payload", "evidence"],
      });
    }

    // 3. Validate each evidence item
    if (Array.isArray(payload.evidence)) {
      for (let i = 0; i < payload.evidence.length; i++) {
        const ev: unknown = payload.evidence[i];
        if (!ev || typeof ev !== "object") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `evidence[${i}] must be an object with type and content`,
            path: ["payload", "evidence", String(i)],
          });
          continue;
        }
        const item = ev as Record<string, unknown>;
        if (
          !item.type
          || typeof item.type !== "string"
          || !(EVIDENCE_TYPES as readonly string[]).includes(item.type)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `evidence[${i}].type must be one of: ${EVIDENCE_TYPES.join(", ")}`,
            path: ["payload", "evidence", String(i), "type"],
          });
        }
        if (!item.content || typeof item.content !== "string" || item.content.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `evidence[${i}].content must be non-empty (screenshot path, test output, URL, log, etc.)`,
            path: ["payload", "evidence", String(i), "content"],
          });
        }
      }
    }
  }
});

export type CreateApproval = z.infer<typeof createApprovalSchema>;

export const resolveApprovalSchema = z.object({
  decisionNote: multilineTextSchema.optional().nullable(),
});

export type ResolveApproval = z.infer<typeof resolveApprovalSchema>;

export const requestApprovalRevisionSchema = z.object({
  decisionNote: multilineTextSchema.optional().nullable(),
});

export type RequestApprovalRevision = z.infer<typeof requestApprovalRevisionSchema>;

export const resubmitApprovalSchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
}).superRefine((data, ctx) => {
  // If a payload is provided for a task_completion resubmit, it must carry evidence
  if (data.payload && data.payload.type === "task_completion") {
    const pl = data.payload;
    if (!pl.summary || typeof pl.summary !== "string" || pl.summary.trim().length < MIN_SUMMARY_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `task_completion resubmit requires payload.summary (≥${MIN_SUMMARY_LENGTH} chars)`,
        path: ["payload", "summary"],
      });
    }
    if (!pl.evidence || !Array.isArray(pl.evidence) || pl.evidence.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "task_completion resubmit requires payload.evidence array with ≥1 item",
        path: ["payload", "evidence"],
      });
    }
  }
});

export type ResubmitApproval = z.infer<typeof resubmitApprovalSchema>;

export const addApprovalCommentSchema = z.object({
  body: multilineTextSchema.pipe(z.string().min(1)),
});

export type AddApprovalComment = z.infer<typeof addApprovalCommentSchema>;
