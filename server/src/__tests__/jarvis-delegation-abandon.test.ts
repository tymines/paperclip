// Terminal timeout semantics for peer delegations (PR #30 Chronos rereview,
// P2): a timed-out delegation must reach a DURABLE terminal state
// ("abandoned") before the caller falls back to the model lane, and a late
// peer callback must never flip that terminal row to a successful completed
// result. The status column is free-text (queued | running | completed |
// failed | abandoned) — no migration required.
//
// NOTE (revision 2): result transitions are now ATOMIC guarded UPDATEs
// (company + id + allowed source status, affected-row count inspected).
// The race/regression behavior is proven against real embedded Postgres in
// jarvis-delegation-terminal.test.ts; this file keeps payload-level unit
// coverage of the same contract with a mocked Db.
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

/**
 * Mock Db for recordDelegationResult's atomic flow:
 *   1. select (token validation)
 *   2. update().set().where().returning() — atomic guarded transition
 *      (matches only company + id + ACTIVE source status)
 *   3. on zero affected rows: select again (classify current state), then a
 *      terminal-guarded metadata-only update issued without .returning().
 */
function dbForCallback(
  row: Record<string, unknown> | null,
  opts: { transitionRows?: Array<Record<string, unknown>> } = {},
) {
  const limit = vi.fn(async () => (row ? [row] : []));
  const selectWhere = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from }));
  const returning = vi.fn(async () => opts.transitionRows ?? []);
  // The second (metadata-audit) update is awaited directly off .where(), so
  // the where result must be awaitable AND carry .returning() for the first
  // (transition) update.
  const updateWhere = vi.fn(() =>
    Object.assign(Promise.resolve(undefined), { returning }),
  );
  const set = vi.fn((_payload: unknown) => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));
  return { db: { select, update } as unknown as Db, set, updateWhere, returning };
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

describe("recordDelegationResult — atomic terminal-safe transitions (P1)", () => {
  it("a normal timely callback still completes an active delegation (regression guard)", async () => {
    const { db, set, returning } = dbForCallback(
      {
        id: "del-1",
        companyId: "co-1",
        status: "queued",
        metadata: { callbackToken: "tok-1" },
      },
      { transitionRows: [{ id: "del-1" }] }, // atomic guard matched the active row
    );

    const out = await recordDelegationResult(db, {
      delegationId: "del-1",
      companyId: "co-1",
      callbackToken: "tok-1",
      status: "completed",
      result: "the answer",
    });

    expect(out).toEqual({ ok: true });
    expect(returning).toHaveBeenCalledTimes(1);
    const payload = set.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("completed");
    expect(payload.result).toBe("the answer");
    expect(payload.completedAt).toBeInstanceOf(Date);
  });

  it("a late callback whose atomic guard matches zero rows is rejected and never overwrites status/result/completedAt", async () => {
    const { db, set, returning } = dbForCallback({
      id: "del-1",
      companyId: "co-1",
      status: "abandoned",
      result: "timed out after 45000ms — abandoned before fallback",
      metadata: { callbackToken: "tok-1", kind: "book-studio-brainstorm" },
    }); // transitionRows defaults to [] — the atomic guard matched nothing

    const out = await recordDelegationResult(db, {
      delegationId: "del-1",
      companyId: "co-1",
      callbackToken: "tok-1",
      status: "completed",
      result: "sorry I'm late — here is the peer answer",
    });

    expect(out).toEqual({ ok: false, error: "delegation_abandoned" });
    // Two writes attempted: the atomic transition (whose WHERE guard matched
    // ZERO rows — nothing was applied) and the terminal-guarded metadata
    // audit write. The audit payload may never carry lifecycle fields.
    expect(set).toHaveBeenCalledTimes(2);
    expect(returning).toHaveBeenCalledTimes(1);
    expect(await returning.mock.results[0]!.value).toEqual([]);
    const auditPayload = set.mock.calls[1][0] as Record<string, unknown>;
    expect(auditPayload).not.toHaveProperty("status");
    expect(auditPayload).not.toHaveProperty("result");
    expect(auditPayload).not.toHaveProperty("completedAt");
    expect(auditPayload).toHaveProperty("metadata"); // jsonb merge classification
  });

  it("classifies a duplicate callback against a completed/failed row as delegation_terminal", async () => {
    const { db } = dbForCallback({
      id: "del-1",
      companyId: "co-1",
      status: "completed",
      result: "first terminal result",
      metadata: { callbackToken: "tok-1" },
    }); // zero-row atomic transition: row is terminal

    const out = await recordDelegationResult(db, {
      delegationId: "del-1",
      companyId: "co-1",
      callbackToken: "tok-1",
      status: "running",
    });

    expect(out).toEqual({ ok: false, error: "delegation_terminal" });
  });

  it("still applies a bad-token rejection before any transition or terminal handling", async () => {
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
});
