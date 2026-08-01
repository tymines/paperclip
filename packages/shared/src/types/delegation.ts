/**
 * Peer-agent delegation status contract (jarvis_delegations.status).
 *
 * This is the SINGLE shared source of truth for the delegation lifecycle.
 * Persistence (packages/db schema comment), the delegation service, the
 * list/result routes, and UI consumers must all derive from these values —
 * never re-declare the union locally.
 *
 * Lifecycle:
 *   queued    — bridge accepted the request, peer hasn't started yet (ACTIVE)
 *   running   — peer reported it picked up the work (ACTIVE)
 *   completed — result row populated (TERMINAL)
 *   failed    — bridge unreachable, peer threw, dispatch failed (TERMINAL)
 *   abandoned — TERMINAL: the caller timed out awaiting the result callback
 *               and fell back to another lane; late callbacks are classified
 *               in metadata.lateCallback and can never flip the row back.
 *
 * Terminal states may never regress. Transitions are only legal from an
 * ACTIVE source state and are enforced atomically in the database statement
 * (company + id + allowed source status) by the delegation service.
 */
export const DELEGATION_ACTIVE_STATUSES = ["queued", "running"] as const;

export const DELEGATION_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "abandoned",
] as const;

export const DELEGATION_STATUSES = [
  ...DELEGATION_ACTIVE_STATUSES,
  ...DELEGATION_TERMINAL_STATUSES,
] as const;

export type DelegationActiveStatus = (typeof DELEGATION_ACTIVE_STATUSES)[number];
export type DelegationTerminalStatus = (typeof DELEGATION_TERMINAL_STATUSES)[number];
export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];

const DELEGATION_STATUS_SET: ReadonlySet<string> = new Set(DELEGATION_STATUSES);

export function isDelegationStatus(value: unknown): value is DelegationStatus {
  return typeof value === "string" && DELEGATION_STATUS_SET.has(value);
}

export function isDelegationActiveStatus(
  value: unknown,
): value is DelegationActiveStatus {
  return value === "queued" || value === "running";
}

export function isDelegationTerminalStatus(
  value: unknown,
): value is DelegationTerminalStatus {
  return (
    value === "completed" || value === "failed" || value === "abandoned"
  );
}
