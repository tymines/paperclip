// Contract tests for the Book Studio live-agent lanes (Spec v1.4).
// All transport is mocked — the seam under test is: peer reachability →
// dispatchDelegation (the existing delegation contract) → result-callback
// polling → text or AgentLaneUnavailableError. Live cross-box E2E is deferred
// until post-migration co-location; these tests prove request/response/error
// behavior against the contract, not against a live box.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";

vi.mock("../services/jarvis-delegation.js", () => ({
  checkPeerReachable: vi.fn(),
  dispatchDelegation: vi.fn(),
  abandonDelegation: vi.fn(),
}));

import {
  callAgentLane,
  AgentLaneUnavailableError,
} from "../services/book-agent-lanes.js";
import {
  checkPeerReachable,
  dispatchDelegation,
  abandonDelegation,
} from "../services/jarvis-delegation.js";

/** Fake Db whose delegation-row polls return the given sequence (last row repeats). */
function dbWithRows(sequence: Array<Record<string, unknown> | null>) {
  let i = 0;
  const limit = vi.fn(async () => {
    const row = sequence[Math.min(i, sequence.length - 1)];
    i++;
    return row ? [row] : [];
  });
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select } as unknown as Db;
}

const DISPATCH_OK = {
  id: "del-1",
  status: "queued" as const,
  reachable: true,
  remainingQuotaThisMinute: 2,
};

describe("book-agent-lanes.callAgentLane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkPeerReachable).mockResolvedValue({ reachable: true });
    vi.mocked(dispatchDelegation).mockResolvedValue(DISPATCH_OK);
    vi.mocked(abandonDelegation).mockResolvedValue(true);
  });

  it("dispatches to the calliope peer through the delegation contract and returns her reply", async () => {
    const db = dbWithRows([
      { id: "del-1", companyId: "co-1", agent: "calliope", status: "queued" },
      { id: "del-1", companyId: "co-1", agent: "calliope", status: "completed", result: "  What if the mentor is the villain?  " },
    ]);

    const out = await callAgentLane(db, {
      lane: "calliope",
      companyId: "co-1",
      task: "SYSTEM…\nUSER: hello",
      metadata: { bookId: "book-1" },
      requestedByActorId: "user-1",
      timeoutMs: 500,
      pollIntervalMs: 1,
    });

    expect(out).toEqual({
      text: "What if the mentor is the villain?",
      delegationId: "del-1",
      lane: "calliope",
    });
    expect(dispatchDelegation).toHaveBeenCalledTimes(1);
    const call = vi.mocked(dispatchDelegation).mock.calls[0][1];
    expect(call.agent).toBe("calliope");
    expect(call.companyId).toBe("co-1");
    expect(call.task).toContain("USER: hello");
    expect(call.metadata).toMatchObject({ kind: "book-studio-brainstorm", bookId: "book-1" });
    expect(call.requestedByActorId).toBe("user-1");
  });

  it("dispatches critic work to the hades peer with book-studio-critic metadata", async () => {
    const db = dbWithRows([
      { id: "del-1", companyId: "co-1", agent: "hades", status: "completed", result: "{\"scores\":{}}" },
    ]);

    const out = await callAgentLane(db, {
      lane: "hades",
      companyId: "co-1",
      task: "critic brief",
      metadata: { bookId: "book-1", chapterNumber: 3 },
      timeoutMs: 500,
      pollIntervalMs: 1,
    });

    expect(out.lane).toBe("hades");
    const call = vi.mocked(dispatchDelegation).mock.calls[0][1];
    expect(call.agent).toBe("hades");
    expect(call.metadata).toMatchObject({
      kind: "book-studio-critic",
      bookId: "book-1",
      chapterNumber: 3,
    });
  });

  it("throws AgentLaneUnavailableError and never dispatches when the peer is unreachable", async () => {
    vi.mocked(checkPeerReachable).mockResolvedValue({ reachable: false, error: "timeout" });
    const db = dbWithRows([]);

    await expect(
      callAgentLane(db, { lane: "calliope", companyId: "co-1", task: "t", timeoutMs: 100, pollIntervalMs: 1 }),
    ).rejects.toMatchObject({ name: "AgentLaneUnavailableError", lane: "calliope" });
    expect(dispatchDelegation).not.toHaveBeenCalled();
  });

  it("throws when the dispatch itself fails (e.g. rate limited)", async () => {
    vi.mocked(dispatchDelegation).mockResolvedValue({
      id: "",
      status: "failed",
      reachable: true,
      remainingQuotaThisMinute: 0,
      error: "rate_limited: max 3 delegations per minute per user",
    });
    const db = dbWithRows([]);

    await expect(
      callAgentLane(db, { lane: "hades", companyId: "co-1", task: "t", timeoutMs: 100, pollIntervalMs: 1 }),
    ).rejects.toMatchObject({ name: "AgentLaneUnavailableError", reason: expect.stringContaining("rate_limited") });
  });

  it("throws when the peer reports the delegation failed", async () => {
    const db = dbWithRows([
      { id: "del-1", companyId: "co-1", status: "failed", result: "bridge_500" },
    ]);

    await expect(
      callAgentLane(db, { lane: "calliope", companyId: "co-1", task: "t", timeoutMs: 500, pollIntervalMs: 1 }),
    ).rejects.toMatchObject({ reason: expect.stringContaining("bridge_500") });
  });

  it("timeout atomically marks the delegation terminally abandoned BEFORE the caller can fall back (P2)", async () => {
    const db = dbWithRows([{ id: "del-1", companyId: "co-1", status: "queued" }]);

    const err = await callAgentLane(db, {
      lane: "calliope",
      companyId: "co-1",
      task: "t",
      timeoutMs: 25,
      pollIntervalMs: 5,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.reason).toContain("del-1");
    expect(err.reason).toContain("abandoned");
    // The durable terminal transition happens for exactly the still-active,
    // matching-company delegation — before the error propagates to the caller.
    expect(abandonDelegation).toHaveBeenCalledTimes(1);
    const abandonArgs = vi.mocked(abandonDelegation).mock.calls[0][1];
    expect(abandonArgs).toMatchObject({ delegationId: "del-1", companyId: "co-1" });
    expect(abandonArgs.reason).toContain("timed out");
  });

  it("treats an already-abandoned delegation row as terminal — never a fabricated reply (P2)", async () => {
    const db = dbWithRows([
      { id: "del-1", companyId: "co-1", status: "abandoned", result: "timed out — abandoned before fallback" },
    ]);

    const err = await callAgentLane(db, {
      lane: "hades",
      companyId: "co-1",
      task: "t",
      timeoutMs: 500,
      pollIntervalMs: 1,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.reason).toContain("abandoned");
  });

  it("throws on an empty completed result rather than passing silence upstream", async () => {
    const db = dbWithRows([
      { id: "del-1", companyId: "co-1", agent: "hades", status: "completed", result: "   " },
    ]);

    await expect(
      callAgentLane(db, { lane: "hades", companyId: "co-1", task: "t", timeoutMs: 500, pollIntervalMs: 1 }),
    ).rejects.toMatchObject({ reason: expect.stringContaining("empty result") });
  });

  it("rejects a completed row whose agent identity does NOT match the requested lane — a non-empty body alone is never proof of lane success (PR #30 r7)", async () => {
    const db = dbWithRows([
      { id: "del-1", companyId: "co-1", agent: "hades", status: "completed", result: "an answer — but not from calliope" },
    ]);

    const err = await callAgentLane(db, {
      lane: "calliope",
      companyId: "co-1",
      task: "t",
      timeoutMs: 500,
      pollIntervalMs: 1,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.reason).toContain("identity mismatch");
    // The durable state contradicts the dispatch — indeterminate, so even a
    // retry must be treated with care: NOT fallback-safe.
    expect(err.fallbackSafe).toBe(false);
  });

  it("normalizes unexpected transport errors into AgentLaneUnavailableError", async () => {
    vi.mocked(checkPeerReachable).mockRejectedValue(new TypeError("socket hangup"));
    const db = dbWithRows([]);

    await expect(
      callAgentLane(db, { lane: "calliope", companyId: "co-1", task: "t", timeoutMs: 100, pollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(AgentLaneUnavailableError);
  });
});

/**
 * Fake Db for the timeout race matrix: every poll sees `pollRow`; once the
 * (mocked) abandonDelegation has been attempted, the NEXT select — the
 * post-abandon classification refetch — sees `refetchRow`.
 */
function dbTimeoutRace(
  pollRow: Record<string, unknown> | null,
  refetchRow: Record<string, unknown> | null,
) {
  let abandonAttempted = false;
  vi.mocked(abandonDelegation).mockImplementation(async () => {
    abandonAttempted = true;
    return false; // zero-row guarded update — the race was lost
  });
  const limit = vi.fn(async () => {
    const row = abandonAttempted ? refetchRow : pollRow;
    return row ? [row] : [];
  });
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select } as unknown as Db;
}

const ACTIVE_ROW = { id: "del-1", companyId: "co-1", status: "queued" };

describe("callAgentLane — timeout fallback safety (Chronos PR #30 rereview-v2 P1A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkPeerReachable).mockResolvedValue({ reachable: true });
    vi.mocked(dispatchDelegation).mockResolvedValue(DISPATCH_OK);
  });

  const call = (db: Db) =>
    callAgentLane(db, {
      lane: "calliope",
      companyId: "co-1",
      task: "t",
      timeoutMs: 25,
      pollIntervalMs: 5,
    }).catch((e) => e);

  it("a CONFIRMED abandon (true) is the only timeout path that is fallback-safe", async () => {
    vi.mocked(abandonDelegation).mockResolvedValue(true);
    const db = dbWithRows([ACTIVE_ROW]);

    const err = await call(db);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(true);
    expect(err.reason).toContain("abandoned");
    expect(abandonDelegation).toHaveBeenCalledTimes(1);
  });

  it("callback wins between the final poll and the abandon (zero-row) ⇒ the PEER result is returned, never a fallback", async () => {
    const db = dbTimeoutRace(ACTIVE_ROW, {
      id: "del-1",
      companyId: "co-1",
      agent: "calliope",
      status: "completed",
      result: "the peer's real answer",
    });

    const out = await callAgentLane(db, {
      lane: "calliope",
      companyId: "co-1",
      task: "t",
      timeoutMs: 25,
      pollIntervalMs: 5,
    });

    expect(out).toEqual({
      text: "the peer's real answer",
      delegationId: "del-1",
      lane: "calliope",
    });
    expect(abandonDelegation).toHaveBeenCalledTimes(1);
  });

  it("zero-row abandon + completed with EMPTY result ⇒ explicit terminal error, NOT fallback-safe", async () => {
    const db = dbTimeoutRace(ACTIVE_ROW, {
      id: "del-1",
      companyId: "co-1",
      agent: "calliope",
      status: "completed",
      result: "   ",
    });

    const err = await call(db);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(false);
    expect(err.reason).toContain("empty result");
  });

  it("zero-row abandon + completed under the WRONG agent identity ⇒ rejected, NOT fallback-safe (PR #30 r7)", async () => {
    const db = dbTimeoutRace(ACTIVE_ROW, {
      id: "del-1",
      companyId: "co-1",
      agent: "hades", // the race-winner row is not the calliope lane's agent
      status: "completed",
      result: "wrong agent's answer",
    });

    const err = await call(db);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(false);
    expect(err.reason).toContain("identity mismatch");
  });

  it("zero-row abandon + terminal FAILED ⇒ the fallback-safe failure error", async () => {
    const db = dbTimeoutRace(ACTIVE_ROW, {
      id: "del-1",
      companyId: "co-1",
      status: "failed",
      result: "bridge exploded",
    });

    const err = await call(db);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(true);
    expect(err.reason).toContain("bridge exploded");
  });

  it("zero-row abandon + already ABANDONED ⇒ the fallback-safe abandoned error", async () => {
    const db = dbTimeoutRace(ACTIVE_ROW, {
      id: "del-1",
      companyId: "co-1",
      status: "abandoned",
      result: "prior timeout",
    });

    const err = await call(db);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(true);
    expect(err.reason).toContain("abandoned");
  });

  it("zero-row abandon + row STILL ACTIVE ⇒ indeterminate safety error, NOT fallback-safe", async () => {
    const db = dbTimeoutRace(ACTIVE_ROW, ACTIVE_ROW);

    const err = await call(db);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(false);
    expect(err.reason).toContain("del-1");
    // Must NOT claim the row was abandoned — it wasn't.
    expect(err.reason).not.toContain("marked abandoned");
  });

  it("zero-row abandon + row MISSING ⇒ indeterminate safety error, NOT fallback-safe", async () => {
    const db = dbTimeoutRace(ACTIVE_ROW, null);

    const err = await call(db);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(false);
    expect(err.reason).not.toContain("marked abandoned");
  });

  it("an abandonment DB error is NOT proof of abandonment — distinct non-fallback-safe error, never normalized into the fallback-triggering kind", async () => {
    vi.mocked(abandonDelegation).mockRejectedValue(new Error("connection reset by peer"));
    const db = dbWithRows([ACTIVE_ROW]);

    const err = await call(db);

    expect(err).toBeInstanceOf(AgentLaneUnavailableError);
    expect(err.fallbackSafe).toBe(false);
    expect(err.reason).toContain("connection reset by peer");
    expect(err.reason).not.toContain("marked abandoned");
  });
});

describe("callAgentLane — timeout/poll input validation and deadline-bound sleeps (P2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkPeerReachable).mockResolvedValue({ reachable: true });
    vi.mocked(dispatchDelegation).mockResolvedValue(DISPATCH_OK);
    vi.mocked(abandonDelegation).mockResolvedValue(true);
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid timeoutMs=%s BEFORE any peer work is dispatched",
    async (timeoutMs) => {
      const db = dbWithRows([ACTIVE_ROW]);

      const err = await callAgentLane(db, {
        lane: "calliope",
        companyId: "co-1",
        task: "t",
        timeoutMs,
        pollIntervalMs: 5,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AgentLaneUnavailableError);
      expect(err.reason).toContain("timeoutMs");
      // Pre-dispatch validation failure: nothing was launched.
      expect(dispatchDelegation).not.toHaveBeenCalled();
      expect(abandonDelegation).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid pollIntervalMs=%s BEFORE any peer work is dispatched",
    async (pollIntervalMs) => {
      const db = dbWithRows([ACTIVE_ROW]);

      const err = await callAgentLane(db, {
        lane: "calliope",
        companyId: "co-1",
        task: "t",
        timeoutMs: 100,
        pollIntervalMs,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(AgentLaneUnavailableError);
      expect(err.reason).toContain("pollIntervalMs");
      expect(dispatchDelegation).not.toHaveBeenCalled();
    },
  );

  it("caps every poll sleep to the remaining deadline — elapsed wait never exceeds the declared timeout by a full poll interval", async () => {
    vi.useFakeTimers();
    try {
      const sleepSpy = vi.spyOn(globalThis, "setTimeout");
      const db = dbWithRows([ACTIVE_ROW]);

      const errPromise = callAgentLane(db, {
        lane: "calliope",
        companyId: "co-1",
        task: "t",
        timeoutMs: 100,
        pollIntervalMs: 60,
      }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1_000);
      const err = await errPromise;

      expect(err).toBeInstanceOf(AgentLaneUnavailableError);
      // 60ms poll, then the remainder CAPPED to 40ms — never a second full
      // 60ms sleep that would overshoot the declared 100ms timeout.
      const delays = sleepSpy.mock.calls.map((c) => c[1]);
      expect(delays).toEqual([60, 40]);
      expect(abandonDelegation).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
