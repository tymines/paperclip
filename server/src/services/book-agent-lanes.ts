// Book Studio — live-agent lanes (Spec v1, amendment v1.4, 2026-07-26).
//
// The brainstorm/write chat window IS Calliope (the SOL creative-Muse agent)
// and the review/critic lane routes to Ares (reviewer under Ares, Kimi K3) —
// a genuine two-model loop: writer ≠ critic, builder ≠ reviewer. Both run
// through the EXISTING peer-delegation contract (dispatchDelegation →
// jarvis_delegations row → bridge POST → /jarvis/delegations/:id/result
// callback) — the same contract the War Room "Approve & send to team" gate
// uses for Ares. No machine addresses, tokens, or credentials live here:
// peers resolve through JARVIS_PEER_<NAME>_URL/TOKEN with the shared
// OPENCLAW_BRIDGE_URL fallback, exactly like every other peer.
//
// DEFERRED BOUNDARY (do not fake): live cross-box E2E is deferred until
// post-migration co-location. When the peer is unreachable, times out, or
// fails, this module throws AgentLaneUnavailableError and the CALLER falls
// back to the configured model lane — reporting the degradation honestly
// (via / criticProvider / criticDegraded), never a fabricated agent success.
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { jarvisDelegations } from "@paperclipai/db";
import {
  checkPeerReachable,
  dispatchDelegation,
  abandonDelegation,
  type PeerAgentId,
} from "./jarvis-delegation.js";

export type BookAgentLane = "calliope" | "ares";

/** Single failure type for the lane — callers fall back on this, rethrow anything else. */
export class AgentLaneUnavailableError extends Error {
  readonly lane: BookAgentLane;
  readonly reason: string;
  constructor(lane: BookAgentLane, reason: string) {
    super(`Book Studio ${lane} lane unavailable: ${reason}`);
    this.name = "AgentLaneUnavailableError";
    this.lane = lane;
    this.reason = reason;
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
  /** Defaults: BOOK_CALLIOPE_TIMEOUT_MS (45s) / BOOK_ARES_TIMEOUT_MS (120s). */
  timeoutMs?: number;
  /** Result-row poll interval. Default BOOK_AGENT_LANE_POLL_MS (2s). */
  pollIntervalMs?: number;
}

function defaultTimeoutMs(lane: BookAgentLane): number {
  const raw =
    lane === "calliope"
      ? process.env.BOOK_CALLIOPE_TIMEOUT_MS
      : process.env.BOOK_ARES_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return lane === "calliope" ? 45_000 : 120_000;
}

function pollMs(explicit?: number): number {
  if (explicit && explicit > 0) return explicit;
  const raw = process.env.BOOK_AGENT_LANE_POLL_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dispatch one task to a live Book Studio agent (Calliope or Ares) through
 * the peer-delegation contract and await its result callback. Throws
 * AgentLaneUnavailableError on unreachable/timeout/failed/empty — the caller
 * decides whether to fall back; this function never fabricates a reply.
 */
export async function callAgentLane(
  db: Db,
  args: AgentLaneCall,
): Promise<AgentLaneResult> {
  const { lane, companyId } = args;
  const peer = lane as PeerAgentId;
  const timeoutMs = args.timeoutMs ?? defaultTimeoutMs(lane);
  const everyMs = pollMs(args.pollIntervalMs);

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

    // Await the peer's result callback (POST /jarvis/delegations/:id/result),
    // which flips this row to completed/failed. The delegation row is the
    // audit trail either way. On local timeout the row is terminally
    // ABANDONED (see below) before the caller falls back — never faked, and
    // a late callback can no longer flip it to completed.
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
        throw new AgentLaneUnavailableError(lane, "agent returned an empty result");
      }
      if (row?.status === "failed") {
        throw new AgentLaneUnavailableError(
          lane,
          `delegation failed: ${(row.result ?? "").slice(0, 200) || "unknown error"}`,
        );
      }
      if (row?.status === "abandoned") {
        // Already terminally abandoned (e.g. by a prior timeout) — never
        // present a late/arrested row as a live-agent result.
        throw new AgentLaneUnavailableError(
          lane,
          `delegation ${dispatch.id} was abandoned (timed out) — its result was given up on before fallback`,
        );
      }
      if (Date.now() >= deadline) {
        // Terminal timeout semantics: atomically abandon ONLY the
        // still-active, matching-company delegation BEFORE throwing, so the
        // caller's model-lane fallback can never dual-execute with the peer
        // and a late callback cannot flip the row to completed
        // (recordDelegationResult rejects/classifies callbacks on abandoned
        // rows). A failed abandon (DB hiccup) must not mask the timeout.
        await abandonDelegation(db, {
          delegationId: dispatch.id,
          companyId,
          reason: `timed out after ${timeoutMs}ms awaiting the result callback — abandoned before model-lane fallback`,
        }).catch(() => false);
        throw new AgentLaneUnavailableError(
          lane,
          `timed out after ${timeoutMs}ms awaiting the result callback — delegation ${dispatch.id} marked abandoned before fallback`,
        );
      }
      await sleep(everyMs);
    }
  } catch (err) {
    if (err instanceof AgentLaneUnavailableError) throw err;
    // Normalize unexpected transport/DB errors into the single lane failure
    // type so callers have exactly one catch path.
    throw new AgentLaneUnavailableError(
      lane,
      err instanceof Error ? err.message : String(err),
    );
  }
}
