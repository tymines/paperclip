/**
 * Typed worker-status contract — Team Mode (War Room).
 *
 * STUB / FORWARD-COMPAT NOTE
 * --------------------------
 * The canonical four-state worker contract is being introduced by the in-flight
 * deer-flow `deerflow-port/subagent-isolation` task. As of this slice it is
 * DOCUMENTED but NOT yet landed as shared, importable TypeScript — it lives only
 * as prose in `~/.openclaw/agent-rooms-v1/orchestration.md` (commit 18f111b,
 * "superpowers-activation-box1: orchestration contract"):
 *
 *   - DONE                → test written, failed first, now passes; raw output attached.
 *   - DONE_WITH_CONCERNS  → green but flaky / thin coverage — said so.
 *   - NEEDS_CONTEXT       → cannot proceed without missing info — asking.
 *   - BLOCKED / FAILED    → cannot reach green within caps — stopped, reported, no fake.
 *
 * This module mirrors that shape so the board renders a REAL typed status instead
 * of parsing prose. When the deer-flow task publishes the contract as a shared
 * export (e.g. `@paperclipai/shared`), replace this file's body with a re-export
 * and delete the local literal — the rest of the board is already coded to it.
 *
 * Source of a row's value: `jarvis_delegations.worker_status` (additive column
 * added in migration 0131) OR `metadata.workerStatus`. NULL/absent = "the worker
 * has not reported a typed verdict yet" → the board falls back to the transport
 * lifecycle status and labels the verdict as pending (never invented).
 */

export const WORKER_STATUS_VALUES = [
  "DONE",
  "DONE_WITH_CONCERNS",
  "NEEDS_CONTEXT",
  "BLOCKED",
  "FAILED",
] as const;

export type WorkerStatus = (typeof WORKER_STATUS_VALUES)[number];

export interface WorkerStatusPresentation {
  label: string;
  /** Semantic tone the board maps to a DS color. */
  tone: "success" | "warning" | "info" | "critical";
  /** One-line meaning, surfaced as a tooltip. */
  hint: string;
}

const PRESENTATION: Record<WorkerStatus, WorkerStatusPresentation> = {
  DONE: {
    label: "Done",
    tone: "success",
    hint: "Test written, failed first, now passes; raw output attached.",
  },
  DONE_WITH_CONCERNS: {
    label: "Done · concerns",
    tone: "warning",
    hint: "Green, but the worker flagged flakiness or thin coverage.",
  },
  NEEDS_CONTEXT: {
    label: "Needs context",
    tone: "info",
    hint: "Worker cannot proceed without missing information.",
  },
  BLOCKED: {
    label: "Blocked",
    tone: "critical",
    hint: "Could not reach green within caps — stopped and reported.",
  },
  FAILED: {
    label: "Failed",
    tone: "critical",
    hint: "Reported failure — not faked as success.",
  },
};

/** Narrows an unknown value to a WorkerStatus, or null if it is not one. */
export function parseWorkerStatus(value: unknown): WorkerStatus | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (WORKER_STATUS_VALUES as readonly string[]).includes(upper)
    ? (upper as WorkerStatus)
    : null;
}

/** Reads the typed verdict off a delegation row (column first, metadata fallback). */
export function workerStatusOf(row: {
  workerStatus?: string | null;
  metadata?: Record<string, unknown> | null;
}): WorkerStatus | null {
  return (
    parseWorkerStatus(row.workerStatus) ??
    parseWorkerStatus(row.metadata?.workerStatus) ??
    null
  );
}

export function presentWorkerStatus(
  status: WorkerStatus,
): WorkerStatusPresentation {
  return PRESENTATION[status];
}
