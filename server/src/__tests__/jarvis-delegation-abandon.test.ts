// Terminal timeout semantics for peer delegations (PR #30 Chronos rereview,
// P2): a timed-out delegation must reach a DURABLE terminal state
// ("abandoned") before the caller falls back to the model lane, and a late
// peer callback must never flip that terminal row to a successful completed
// result. The status column is free-text (queued | running | completed |
// failed | abandoned) — no migration required.
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import {
  abandonDelegation,
  recordDelegationResult,
} from "../services/jarvis-delegation.js";

/** Mock Db for abandonDelegation: update().set().where().returning(). */
function dbForAbandon(returningRows: Array<Record<string, unknown>>) {
  const returning = vi.fn(async () => returningRows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn((_payload: unknown) => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { db: { update } as unknown as Db, set, where, returning };
}

/** Mock Db for recordDelegationResult: one select row + update().set().where(). */
function dbForCallback(row: Record<string, unknown> | null) {
  const limit = vi.fn(async () => (row ? [row] : []));
  const selectWhere = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));
  const updateWhere = vi.fn(async () => undefined);
  const set = vi.fn((_payload: unknown) => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  return { db: { select, update } as unknown as Db, set, updateWhere };
}

describe("abandonDelegation — durable terminal timeout state (P2)", () => {
  it("atomically flips the still-active, matching-company row to the terminal abandoned state", async () => {
    const { db, set, where, returning } = dbForAbandon([{ id: "del-1" }]);

    const ok = await abandonDelegation(db, {
      delegationId: "del-1",
      companyId: "co-1",
      reason: "timed out after 45000ms awaiting the result callback — abandoned before fallback",
    });

    expect(ok).toBe(true);
    expect(set).toHaveBeenCalledTimes(1);
    const payload = set.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("abandoned");
    expect(payload.result).toContain("timed out");
    expect(payload.completedAt).toBeInstanceOf(Date);
    // The WHERE clause carries the atomic guard (id + companyId + still-active
    // status) — the update is issued exactly once, scoped by the query itself.
    expect(where).toHaveBeenCalledTimes(1);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it("reports false when the row already reached a terminal state (no overwrite of a completed result)", async () => {
    const { db } = dbForAbandon([]); // guard matched nothing — row was no longer active

    const ok = await abandonDelegation(db, {
      delegationId: "del-1",
      companyId: "co-1",
      reason: "timed out after 45000ms",
    });

    expect(ok).toBe(false);
  });
});

describe("recordDelegationResult — late callback on an abandoned delegation (P2)", () => {
  it("rejects the late callback and classifies it in metadata WITHOUT overwriting the terminal audit state", async () => {
    const { db, set } = dbForCallback({
      id: "del-1",
      companyId: "co-1",
      status: "abandoned",
      result: "timed out after 45000ms — abandoned before fallback",
      metadata: { callbackToken: "tok-1", kind: "book-studio-brainstorm" },
    });

    const out = await recordDelegationResult(db, {
      delegationId: "del-1",
      companyId: "co-1",
      callbackToken: "tok-1",
      status: "completed",
      result: "sorry I'm late — here is the peer answer",
    });

    expect(out).toEqual({ ok: false, error: "delegation_abandoned" });
    expect(set).toHaveBeenCalledTimes(1);
    const payload = set.mock.calls[0][0] as Record<string, unknown>;
    // Terminal audit state is never overwritten by the late callback.
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("result");
    expect(payload).not.toHaveProperty("completedAt");
    // The late result is explicitly classified for audit instead.
    const meta = payload.metadata as Record<string, unknown>;
    expect(meta.callbackToken).toBe("tok-1"); // existing metadata preserved
    expect(meta.lateCallback).toMatchObject({
      status: "completed",
      result: "sorry I'm late — here is the peer answer",
    });
    expect(typeof (meta.lateCallback as Record<string, unknown>).receivedAt).toBe("string");
  });

  it("still applies a bad-token rejection before any abandoned-state handling", async () => {
    const { db, set } = dbForCallback({
      id: "del-1",
      companyId: "co-1",
      status: "abandoned",
      metadata: { callbackToken: "tok-1" },
    });

    const out = await recordDelegationResult(db, {
      delegationId: "del-1",
      companyId: "co-1",
      callbackToken: "wrong",
      status: "completed",
      result: "x",
    });

    expect(out).toEqual({ ok: false, error: "callback_token_mismatch" });
    expect(set).not.toHaveBeenCalled();
  });

  it("a normal timely callback still completes a queued delegation (regression guard)", async () => {
    const { db, set } = dbForCallback({
      id: "del-1",
      companyId: "co-1",
      status: "queued",
      metadata: { callbackToken: "tok-1" },
    });

    const out = await recordDelegationResult(db, {
      delegationId: "del-1",
      companyId: "co-1",
      callbackToken: "tok-1",
      status: "completed",
      result: "the answer",
    });

    expect(out).toEqual({ ok: true });
    const payload = set.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("completed");
    expect(payload.result).toBe("the answer");
    expect(payload.completedAt).toBeInstanceOf(Date);
  });
});
