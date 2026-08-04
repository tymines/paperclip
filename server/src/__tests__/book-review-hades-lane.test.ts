// Contract tests for the Hades-only baseline review lane. Hades is the
// reviewer profile in the Hermes Harness on Box 2; no generic model fallback
// is permitted when that named peer is unavailable.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";

vi.mock("../services/book-agent-lanes.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/book-agent-lanes.js")>();
  return { ...mod, callAgentLane: vi.fn() };
});

import {
  runBaselineReview,
  HADES_CRITIC_PROVIDER,
  RUBRIC_DIMENSIONS,
} from "../services/book-review.js";
import { callAgentLane, AgentLaneUnavailableError } from "../services/book-agent-lanes.js";

function mockQuery<T>(resolveData: T) {
  const promise = Promise.resolve(resolveData);
  const q = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  q.where.mockReturnValue(q);
  q.orderBy.mockReturnValue(q);
  q.limit.mockResolvedValue(resolveData);
  return q;
}

const BOOK = { id: "book-1", companyId: "co-1", slug: "my-book", title: "My Book", metadata: {} };
const CHAPTER = {
  id: "ch-1",
  bookId: "book-1",
  chapterNumber: 2,
  title: "Ch 2",
  content: "Some prose with enough words to review.",
};

function dbForReview() {
  const select = vi.fn();
  select
    .mockReturnValueOnce(mockQuery([BOOK]))
    .mockReturnValueOnce(mockQuery([CHAPTER]))
    .mockReturnValueOnce(mockQuery([]))
    .mockReturnValueOnce(mockQuery([]))
    .mockReturnValueOnce(mockQuery([]));
  return { select } as unknown as Db;
}

const FULL_SCORES = Object.fromEntries(RUBRIC_DIMENSIONS.map((dimension) => [dimension, 8]));
const criticJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ scores: FULL_SCORES, summary: "Solid chapter.", findings: [], ...overrides });

describe("runBaselineReview — Hades reviewer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes only to Hades and records Hades / Kimi K3 provenance", async () => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: criticJson(),
      delegationId: "del-hades-7",
      lane: "hades",
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
      requestedByActorId: "user-1",
    });

    expect(report.verdict).toBe("PASS");
    expect(report.criticProvider).toBe(HADES_CRITIC_PROVIDER);
    expect(report.criticDegraded).toBe(false);
    expect(callAgentLane).toHaveBeenCalledTimes(1);
    expect(vi.mocked(callAgentLane).mock.calls[0][1]).toMatchObject({
      lane: "hades",
      companyId: "co-1",
      metadata: { bookId: "book-1", chapterNumber: 2, operation: "baseline-review" },
      requestedByActorId: "user-1",
    });
  });

  it("fails closed when Hades is unavailable", async () => {
    const unavailable = new AgentLaneUnavailableError(
      "hades",
      "peer unreachable (peer_unconfigured)",
    );
    vi.mocked(callAgentLane).mockRejectedValue(unavailable);

    await expect(
      runBaselineReview(dbForReview(), {
        bookId: "book-1",
        chapterNumber: 2,
        companyId: "co-1",
      }),
    ).rejects.toBe(unavailable);
    expect(callAgentLane).toHaveBeenCalledTimes(1);
  });

  it("turns unparseable Hades output into NO_VERDICT, never a silent pass", async () => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: "not JSON",
      delegationId: "del-hades-9",
      lane: "hades",
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });

    expect(report).toMatchObject({
      verdict: "NO_VERDICT",
      noVerdictReason: "unparseable-critic-output",
      criticProvider: HADES_CRITIC_PROVIDER,
      criticDegraded: false,
    });
  });

  it("preserves normal rubric failures from Hades", async () => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: criticJson({ scores: { ...FULL_SCORES, pacing: 4 } }),
      delegationId: "del-hades-11",
      lane: "hades",
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });
    expect(report.verdict).toBe("FAIL");
    expect(report.failures).toContain("pacing");
  });

  it("rejects cross-company books before content or Hades is reached", async () => {
    const db = dbForReview();
    await expect(
      runBaselineReview(db, {
        bookId: "book-1",
        chapterNumber: 2,
        companyId: "co-other",
      }),
    ).rejects.toThrow("Book not found");
    expect(callAgentLane).not.toHaveBeenCalled();
    expect((db as unknown as { select: ReturnType<typeof vi.fn> }).select).toHaveBeenCalledTimes(1);
  });
});
