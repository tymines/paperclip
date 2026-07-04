import type { ApprovalStatus, ApprovalType, EvidenceType } from "../constants.js";

/** One piece of verifiable evidence for the anti-over-claiming rule. */
export interface EvidenceEntry {
  type: EvidenceType;
  /** The actual evidence content — screenshot path, test output, log, URL, before/after. */
  content: string;
  /** Optional human-readable label for the evidence item (shown on the Needs Approval card). */
  label?: string;
}

/** Payload shape required for task_completion approvals. */
export interface TaskCompletionPayload {
  summary: string;
  evidence: EvidenceEntry[];
  [key: string]: unknown;
}

export interface Approval {
  id: string;
  companyId: string;
  type: ApprovalType;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  decisionNote: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalComment {
  id: string;
  companyId: string;
  approvalId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  resolvedAuthorName: string | null;
  createdAt: Date;
  updatedAt: Date;
}
