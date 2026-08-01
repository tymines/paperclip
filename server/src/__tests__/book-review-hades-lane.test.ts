// Contract tests for the Hades critic lane in runBaselineReview (PR #30):
// Hades (live agent, via the peer-delegation contract) is the ONLY critic.
// Tyler's law — ZERO raw-model fallback: a lane failure degrades to a
// visible NO_VERDICT report with provenance, never a raw-model substitute.
// All transport is mocked — these prove lane selection, provenance, and
// verdict behavior, not a live cross-box run.
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

/** Thenable query stub — runBaselineReview awaits .where() directly (no .limit). */
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
const CHAPTER = { id: "ch-1", bookId: "book-1", chapterNumber: 2, title: "Ch 2", content: "Some prose with enough words to review." };

function dbForReview() {
  const select = vi.fn();
  // Select order inside runBaselineReview: books → manuscriptChapters →
  // storyBibleStyle → characters → locations.
  select
    .mockReturnValueOnce(mockQuery([BOOK]))
    .mockReturnValueOnce(mockQuery([CHAPTER]))
    .mockReturnValueOnce(mockQuery([]))  // no style card
    .mockReturnValueOnce(mockQuery([]))  // no characters
    .mockReturnValueOnce(mockQuery([])); // no locations
  return { select } as unknown as Db;
}

const FULL_SCORES = Object.fromEntries(RUBRIC_DIMENSIONS.map((d) => [d, 8]));

function criticJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ scores: FULL_SCORES, summary: "Solid chapter.", findings: [], ...overrides });
}

describe("runBaselineReview — Hades critic lane (PR #30)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the Hades agent lane when it answers, with agent provenance", async () => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: criticJson(),
      delegationId: "del-7",
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
    const laneCall = vi.mocked(callAgentLane).mock.calls[0][1];
    expect(laneCall.lane).toBe("hades");
    expect(laneCall.companyId).toBe("co-1");
    expect(laneCall.metadata).toMatchObject({ bookId: "book-1", chapterNumber: 2 });
    expect(laneCall.requestedByActorId).toBe("user-1");
    // Hades receives the same rubric/fact-check brief the critic lane defines.
    expect(laneCall.task).toContain("rubric dimensions");
    expect(laneCall.task).toContain("Some prose with enough words to review.");
  });

  it("degrades to a visible NO_VERDICT when Hades is unreachable — NO raw-model substitute (Tyler's law)", async () => {
    vi.mocked(callAgentLane).mockRejectedValue(
      new AgentLaneUnavailableError("hades", "peer unreachable (timeout)"),
    );

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });

    expect(report.verdict).toBe("NO_VERDICT");
    expect(report.noVerdictReason).toBe("critic-lane-unavailable");
    expect(report.criticProvider).toBe(HADES_CRITIC_PROVIDER);
    expect(report.criticDegraded).toBe(true);
    expect(report.agentLaneError).toContain("hades");
    expect(report.summary).toContain("Hades");
    expect(report.scores).toEqual({});
    expect(report.findings).toEqual([]);
  });

  it("degrades to NO_VERDICT with the indeterminate reason on a NON-fallback-safe lane failure — never thrown away, never substituted", async () => {
    vi.mocked(callAgentLane).mockRejectedValue(
      new AgentLaneUnavailableError("hades", "lane outcome indeterminate — durable state unproven", { fallbackSafe: false }),
    );

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });

    expect(report.verdict).toBe("NO_VERDICT");
    expect(report.noVerdictReason).toBe("critic-lane-indeterminate");
    expect(report.criticProvider).toBe(HADES_CRITIC_PROVIDER);
    expect(report.criticDegraded).toBe(true);
    expect(report.agentLaneError).toContain("indeterminate");
  });

  it("degrades to NO_VERDICT (critic-lane-unconfigured) when no companyId is provided — no silent model lane", async () => {
    const report = await runBaselineReview(dbForReview(), { bookId: "book-1", chapterNumber: 2 });

    expect(report.verdict).toBe("NO_VERDICT");
    expect(report.noVerdictReason).toBe("critic-lane-unconfigured");
    expect(report.criticDegraded).toBe(true);
    expect(callAgentLane).not.toHaveBeenCalled();
  });

  it("turns unparseable Hades output into NO_VERDICT with agent provenance — never a silent pass", async () => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: "sorry, I cannot review this",
      delegationId: "del-9",
      lane: "hades",
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });

    expect(report.verdict).toBe("NO_VERDICT");
    expect(report.noVerdictReason).toBe("unparseable-critic-output");
    expect(report.criticProvider).toBe(HADES_CRITIC_PROVIDER);
    expect(report.criticDegraded).toBe(false);
  });

  it("marks a FAIL verdict from Hades findings", async () => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: criticJson({ scores: { ...FULL_SCORES, pacing: 4 }, summary: "Pacing sags badly." }),
      delegationId: "del-11",
      lane: "hades",
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.failures).toContain("pacing");
    expect(report.criticProvider).toBe(HADES_CRITIC_PROVIDER);
  });

  it("rejects a companyId that does not match the book's company BEFORE loading content or invoking any lane (P1)", async () => {
    const db = dbForReview();

    await expect(
      runBaselineReview(db, { bookId: "book-1", chapterNumber: 2, companyId: "co-OTHER" }),
    ).rejects.toThrow("Book not found");

    expect(callAgentLane).not.toHaveBeenCalled();
    // Only the book lookup ran — no chapter or bible content was read.
    expect((db as unknown as { select: ReturnType<typeof vi.fn> }).select).toHaveBeenCalledTimes(1);
  });

  it("rethrows unexpected lane errors (only AgentLaneUnavailableError degrades)", async () => {
    vi.mocked(callAgentLane).mockRejectedValue(new TypeError("db on fire"));

    await expect(
      runBaselineReview(dbForReview(), { bookId: "book-1", chapterNumber: 2, companyId: "co-1" }),
    ).rejects.toThrow("db on fire");
  });
});
