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
      { id: "del-1", companyId: "co-1", status: "queued" },
      { id: "del-1", companyId: "co-1", status: "completed", result: "  What if the mentor is the villain?  " },
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

  it("dispatches critic work to the ares peer with book-studio-critic metadata", async () => {
    const db = dbWithRows([
      { id: "del-1", companyId: "co-1", status: "completed", result: "{\"scores\":{}}" },
    ]);

    const out = await callAgentLane(db, {
      lane: "ares",
      companyId: "co-1",
      task: "critic brief",
      metadata: { bookId: "book-1", chapterNumber: 3 },
      timeoutMs: 500,
      pollIntervalMs: 1,
    });

    expect(out.lane).toBe("ares");
    const call = vi.mocked(dispatchDelegation).mock.calls[0][1];
    expect(call.agent).toBe("ares");
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
      callAgentLane(db, { lane: "ares", companyId: "co-1", task: "t", timeoutMs: 100, pollIntervalMs: 1 }),
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
      lane: "ares",
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
      { id: "del-1", companyId: "co-1", status: "completed", result: "   " },
    ]);

    await expect(
      callAgentLane(db, { lane: "ares", companyId: "co-1", task: "t", timeoutMs: 500, pollIntervalMs: 1 }),
    ).rejects.toMatchObject({ reason: expect.stringContaining("empty result") });
  });

  it("normalizes unexpected transport errors into AgentLaneUnavailableError", async () => {
    vi.mocked(checkPeerReachable).mockRejectedValue(new TypeError("socket hangup"));
    const db = dbWithRows([]);

    await expect(
      callAgentLane(db, { lane: "calliope", companyId: "co-1", task: "t", timeoutMs: 100, pollIntervalMs: 1 }),
    ).rejects.toBeInstanceOf(AgentLaneUnavailableError);
  });
});
