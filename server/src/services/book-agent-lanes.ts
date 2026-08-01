// Book Studio — live-agent lanes (Spec v1, amendment v1.4; PR #30, 2026-07-31).
//
// The brainstorm/write chat window IS Calliope (the SOL creative-Muse agent)
// and the review/critic lane IS Hades (the Kimi K3 reviewer agent) — a
// genuine two-agent loop: writer ≠ critic, builder ≠ reviewer. Both run
// through the EXISTING peer-delegation contract (dispatchDelegation →
// jarvis_delegations row → bridge POST → /jarvis/delegations/:id/result
// callback). No machine addresses, tokens, or credentials live here: peers
// resolve through JARVIS_PEER_<NAME>_URL/TOKEN with the shared
// OPENCLAW_BRIDGE_URL fallback, exactly like every other peer.
//
// TYLER'S LAW — ZERO raw-model fallback: a raw-model answer is NEVER passed
// off as a named agent, and an unreachable/slow/failed peer is NEVER
// silently substituted. When the lane cannot deliver a live peer result this
// module throws AgentLaneUnavailableError and the CALLER returns a visible
// degraded failure carrying provenance ({ agent, model, status: "degraded",
// detail }) — the UI shows the degradation, nobody gets a fake agent reply.
//
// The `fallbackSafe` flag on AgentLaneUnavailableError is retained as a
// machine-checkable indeterminacy signal: fallbackSafe === false means the
// peer may still hold (or have delivered) the work, so even a RETRY must be
// treated with care (never dual-execute). It no longer gates a model
// fallback — there is none.
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { jarvisDelegations } from "@paperclipai/db";
import {
  checkPeerReachable,
  dispatchDelegation,
  abandonDelegation,
  type PeerAgentId,
} from "./jarvis-delegation.js";

export type BookAgentLane = "calliope" | "hades";

/**
 * Single failure type for the lane. `fallbackSafe` is the machine-checkable
 * indeterminacy signal — true means durable state PROVES no peer result can
 * still arrive (a clean failure); false means the peer may still win and
 * even a caller-side retry risks dual execution:
 *
 *   fallbackSafe = true  (proven no dual-execution risk)
 *     · peer unreachable / dispatch failed (nothing was ever launched)
 *     · timeout with a CONFIRMED guarded abandon (affected row = 1)
 *     · terminal FAILED delegation (peer finished, unsuccessfully)
 *     · already ABANDONED delegation
 *     · invalid timeoutMs/pollIntervalMs (rejected before any dispatch)
 *   fallbackSafe = false (indeterminate or terminal-no-second-lane)
 *     · timeout whose abandon lost the race AND the refetch shows the row
 *       still active / missing / unreadable (the peer may still win)
 *     · abandonment DB error (a failed write is NOT proof of abandonment)
 *     · COMPLETED with an empty result (terminal peer outcome)
 *     · any unexpected post-dispatch error (durable state unproven)
 *
 * Special non-error outcome: if the abandon loses the race because the peer
 * COMPLETED with a nonempty result, callAgentLane RETURNS that peer result —
 * the caller never learns a timeout happened.
 */
export class AgentLaneUnavailableError extends Error {
  readonly lane: BookAgentLane;
  readonly reason: string;
  readonly fallbackSafe: boolean;
  constructor(lane: BookAgentLane, reason: string, opts?: { fallbackSafe?: boolean }) {
    super(`Book Studio ${lane} lane unavailable: ${reason}`);
    this.name = "AgentLaneUnavailableError";
    this.lane = lane;
    this.reason = reason;
    this.fallbackSafe = opts?.fallbackSafe ?? true;
  }
}

export interface AgentLaneResult {
  text: string;
  delegationId: string;
  lane: BookAgentLane;
}

export interface AgentLaneCall {
  lane: BookAgentLane;
  companyId: string;
  /** The full brief the agent receives (system context + payload, one text). */
  task: string;
  /** Extra metadata stamped on the delegation row (kind/bookId/chapterNumber…). */
  metadata?: Record<string, unknown>;
  requestedByActorId?: string | null;
  /** Defaults: BOOK_CALLIOPE_TIMEOUT_MS (45s) / BOOK_HADES_TIMEOUT_MS (120s). */
  timeoutMs?: number;
  /** Result-row poll interval. Default BOOK_AGENT_LANE_POLL_MS (2s). */
  pollIntervalMs?: number;
}

function defaultTimeoutMs(lane: BookAgentLane): number {
  const raw =
    lane === "calliope"
      ? process.env.BOOK_CALLIOPE_TIMEOUT_MS
      : process.env.BOOK_HADES_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return lane === "calliope" ? 45_000 : 120_000;
}

function defaultPollMs(): number {
  const raw = process.env.BOOK_AGENT_LANE_POLL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dispatch one task to a live Book Studio agent (Calliope or Hades) through
 * the peer-delegation contract and await its result callback. Throws
 * AgentLaneUnavailableError on unreachable/timeout/failed/empty — the caller
 * surfaces a visible degraded failure with provenance (never a raw-model
 * substitute, never a fabricated reply).
 */
export async function callAgentLane(
  db: Db,
  args: AgentLaneCall,
): Promise<AgentLaneResult> {
  const { lane, companyId } = args;
  const peer = lane as PeerAgentId;

  // Input validation (P2): timeout and poll values must be finite positive
  // numbers. Rejected BEFORE anything is dispatched — pre-dispatch failures
  // launch no peer work, so they are fallback-safe.
  const timeoutMs = args.timeoutMs ?? defaultTimeoutMs(lane);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AgentLaneUnavailableError(
      lane,
      `invalid timeoutMs (${String(args.timeoutMs)}) — must be a finite positive number of milliseconds`,
    );
  }
  const everyMs = args.pollIntervalMs ?? defaultPollMs();
  if (!Number.isFinite(everyMs) || everyMs <= 0) {
    throw new AgentLaneUnavailableError(
      lane,
      `invalid pollIntervalMs (${String(args.pollIntervalMs)}) — must be a finite positive number of milliseconds`,
    );
  }

  // Tracks whether live peer work exists; a post-dispatch surprise is
  // indeterminate (the peer may hold the work) ⇒ NOT fallback-safe.
  let dispatchedId: string | null = null;
  try {
    const reach = await checkPeerReachable(peer);
    if (!reach.reachable) {
      throw new AgentLaneUnavailableError(
        lane,
        `peer unreachable (${reach.error ?? "no response"})`,
      );
    }

    const dispatch = await dispatchDelegation(db, {
      companyId,
      agent: peer,
      task: args.task,
      metadata: {
        kind: lane === "calliope" ? "book-studio-brainstorm" : "book-studio-critic",
        ...(args.metadata ?? {}),
      },
      requestedByActorId: args.requestedByActorId ?? null,
    });
    if (dispatch.status === "failed" || !dispatch.id) {
      throw new AgentLaneUnavailableError(
        lane,
        dispatch.error ?? "delegation dispatch failed",
      );
    }
    dispatchedId = dispatch.id;

    // Await the peer's result callback (POST /jarvis/delegations/:id/result),
    // which flips this row to completed/failed. The delegation row is the
    // audit trail either way. On local timeout the row's durable state is
    // classified (see the indeterminacy table above) so the caller surfaces
    // an honest degraded failure — never faked, never dual-executed.
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const [row] = await db
        .select()
        .from(jarvisDelegations)
        .where(
          and(
            eq(jarvisDelegations.id, dispatch.id),
            eq(jarvisDelegations.companyId, companyId),
          ),
        )
        .limit(1);
      if (row?.status === "completed") {
        const text = (row.result ?? "").trim();
        if (text) return { text, delegationId: dispatch.id, lane };
        // Completed with an EMPTY result is a terminal peer outcome. The
        // product contract does NOT permit silently buying a second paid
        // lane for it — surface, never fall back.
        throw new AgentLaneUnavailableError(
          lane,
          "agent returned an empty result (terminal completed state — no fallback)",
          { fallbackSafe: false },
        );
      }
      if (row?.status === "failed") {
        throw new AgentLaneUnavailableError(
          lane,
          `delegation failed: ${(row.result ?? "").slice(0, 200) || "unknown error"}`,
          { fallbackSafe: true },
        );
      }
      if (row?.status === "abandoned") {
        // Already terminally abandoned (e.g. by a prior timeout) — never
        // present a late/arrested row as a live-agent result.
        throw new AgentLaneUnavailableError(
          lane,
          `delegation ${dispatch.id} was abandoned (timed out) — its result was given up on before the caller degraded`,
          { fallbackSafe: true },
        );
      }
      if (Date.now() >= deadline) {
        // Terminal timeout semantics, with the race CLOSED (Chronos
        // rereview-v2 P1A): the guarded abandon (company + id + active-source
        // WHERE) either wins, loses, or errors — and only a WIN is proof
        // that no peer result can still arrive.
        let abandoned: boolean;
        try {
          abandoned = await abandonDelegation(db, {
            delegationId: dispatch.id,
            companyId,
            reason: `timed out after ${timeoutMs}ms awaiting the result callback — abandoned before the caller degrades to a visible failure`,
          });
        } catch (abandonErr) {
          // A DB error is NOT proof of abandonment. Preserve it as a
          // distinct NON-fallback-safe error; the outer normalization below
          // deliberately never touches AgentLaneUnavailableError.
          throw new AgentLaneUnavailableError(
            lane,
            `timed out after ${timeoutMs}ms, but the abandonment write failed (${
              abandonErr instanceof Error ? abandonErr.message : String(abandonErr)
            }) — durable state unproven; NOT fallback-safe`,
            { fallbackSafe: false },
          );
        }
        if (abandoned) {
          // Confirmed guarded abandonment: no callback can still win.
          throw new AgentLaneUnavailableError(
            lane,
            `timed out after ${timeoutMs}ms awaiting the result callback — delegation ${dispatch.id} marked abandoned before the caller degrades`,
            { fallbackSafe: true },
          );
        }
        // Zero affected rows: between the final poll and the abandon, the
        // row went terminal (or vanished). Re-fetch company/id and classify
        // the CURRENT durable state — never guess, never claim abandonment.
        const [current] = await db
          .select()
          .from(jarvisDelegations)
          .where(
            and(
              eq(jarvisDelegations.id, dispatch.id),
              eq(jarvisDelegations.companyId, companyId),
            ),
          )
          .limit(1);
        if (!current) {
          throw new AgentLaneUnavailableError(
            lane,
            `timed out after ${timeoutMs}ms and delegation ${dispatch.id} is missing after a zero-row abandonment — indeterminate; NOT fallback-safe`,
            { fallbackSafe: false },
          );
        }
        if (current.status === "completed") {
          const text = (current.result ?? "").trim();
          // The peer WON the race: return its result. A caller retry
          // must never dual-execute with a successful peer.
          if (text) return { text, delegationId: dispatch.id, lane };
          throw new AgentLaneUnavailableError(
            lane,
            "agent completed with an empty result (terminal completed state — no fallback)",
            { fallbackSafe: false },
          );
        }
        if (current.status === "failed") {
          throw new AgentLaneUnavailableError(
            lane,
            `delegation failed: ${(current.result ?? "").slice(0, 200) || "unknown error"}`,
            { fallbackSafe: true },
          );
        }
        if (current.status === "abandoned") {
          throw new AgentLaneUnavailableError(
            lane,
            `delegation ${dispatch.id} was abandoned (timed out) — its result was given up on before the caller degraded`,
            { fallbackSafe: true },
          );
        }
        // Still active (or an unknown status): do NOT claim abandonment —
        // the peer may still win; indeterminate, NOT fallback-safe.
        throw new AgentLaneUnavailableError(
          lane,
          `timed out after ${timeoutMs}ms but delegation ${dispatch.id} is still ${current.status ?? "unknown"} after a zero-row abandonment — indeterminate; NOT fallback-safe`,
          { fallbackSafe: false },
        );
      }
      // Cap each sleep to the remaining deadline so the elapsed wait can
      // never exceed the declared timeout by a full poll interval (P2).
      await sleep(Math.min(everyMs, Math.max(0, deadline - Date.now())));
    }
  } catch (err) {
    if (err instanceof AgentLaneUnavailableError) throw err;
    // Normalize unexpected transport/DB errors into the single lane failure
    // type so callers have exactly one catch path. Pre-dispatch surprises
    // launched no peer work (fallback-safe); post-dispatch surprises leave
    // the peer's durable state unproven (NOT fallback-safe).
    throw new AgentLaneUnavailableError(
      lane,
      err instanceof Error ? err.message : String(err),
      { fallbackSafe: dispatchedId === null },
    );
  }
}
