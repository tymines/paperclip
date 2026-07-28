// Contract tests for the Ares critic lane in runBaselineReview (Spec v1.4):
// Ares (live agent, via the peer-delegation contract) answers first; the
// configured model lanes are the documented pre-co-location fallback. All
// transport is mocked — these prove lane selection, provenance, and verdict
// behavior, not a live cross-box run (deferred until co-location).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";

vi.mock("../services/chapter-generator.js", () => ({
  callCriticLLM: vi.fn(),
}));

vi.mock("../services/book-agent-lanes.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/book-agent-lanes.js")>();
  return { ...mod, callAgentLane: vi.fn() };
});

import {
  runBaselineReview,
  ARES_CRITIC_PROVIDER,
  RUBRIC_DIMENSIONS,
} from "../services/book-review.js";
import { callCriticLLM } from "../services/chapter-generator.js";
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

describe("runBaselineReview — Ares critic lane (Spec v1.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the Ares agent lane when it answers, with agent provenance", async () => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: criticJson(),
      delegationId: "del-7",
      lane: "ares",
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
      requestedByActorId: "user-1",
    });

    expect(report.verdict).toBe("PASS");
    expect(report.criticProvider).toBe(ARES_CRITIC_PROVIDER);
    expect(report.criticDegraded).toBe(false);
    expect(callCriticLLM).not.toHaveBeenCalled();
    const laneCall = vi.mocked(callAgentLane).mock.calls[0][1];
    expect(laneCall.lane).toBe("ares");
    expect(laneCall.companyId).toBe("co-1");
    expect(laneCall.metadata).toMatchObject({ bookId: "book-1", chapterNumber: 2 });
    expect(laneCall.requestedByActorId).toBe("user-1");
    // Ares receives the same rubric/fact-check brief the model lane would.
    expect(laneCall.task).toContain("rubric dimensions");
    expect(laneCall.task).toContain("Some prose with enough words to review.");
  });

  it("falls back to the configured model lanes when Ares is unavailable", async () => {
    vi.mocked(callAgentLane).mockRejectedValue(
      new AgentLaneUnavailableError("ares", "peer unreachable (timeout)"),
    );
    vi.mocked(callCriticLLM).mockResolvedValue({
      text: criticJson(),
      provider: "deepseek",
      criticDegraded: false,
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });

    expect(report.verdict).toBe("PASS");
    expect(report.criticProvider).toBe("deepseek");
    expect(callCriticLLM).toHaveBeenCalledTimes(1);
  });

  it("keeps the model-lane-only behavior when no companyId is provided", async () => {
    vi.mocked(callCriticLLM).mockResolvedValue({
      text: criticJson(),
      provider: "deepseek",
      criticDegraded: false,
    });

    const report = await runBaselineReview(dbForReview(), { bookId: "book-1", chapterNumber: 2 });

    expect(report.criticProvider).toBe("deepseek");
    expect(callAgentLane).not.toHaveBeenCalled();
  });

  it("turns unparseable Ares output into NO_VERDICT with agent provenance — never a silent pass", async () => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: "sorry, I cannot review this",
      delegationId: "del-9",
      lane: "ares",
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });

    expect(report.verdict).toBe("NO_VERDICT");
    expect(report.noVerdictReason).toBe("unparseable-critic-output");
    expect(report.criticProvider).toBe(ARES_CRITIC_PROVIDER);
    expect(report.criticDegraded).toBe(false);
  });

  it("marks a FAIL verdict from Ares findings the same as a model-lane FAIL", async () => {
    vi.mocked(callAgentLane).mockResolvedValue({
      text: criticJson({ scores: { ...FULL_SCORES, pacing: 4 }, summary: "Pacing sags badly." }),
      delegationId: "del-11",
      lane: "ares",
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });

    expect(report.verdict).toBe("FAIL");
    expect(report.failures).toContain("pacing");
    expect(report.criticProvider).toBe(ARES_CRITIC_PROVIDER);
  });

  it("rejects a companyId that does not match the book's company BEFORE loading content or invoking any lane (P1)", async () => {
    const db = dbForReview();

    await expect(
      runBaselineReview(db, { bookId: "book-1", chapterNumber: 2, companyId: "co-OTHER" }),
    ).rejects.toThrow("Book not found");

    expect(callAgentLane).not.toHaveBeenCalled();
    expect(callCriticLLM).not.toHaveBeenCalled();
    // Only the book lookup ran — no chapter or bible content was read.
    expect((db as unknown as { select: ReturnType<typeof vi.fn> }).select).toHaveBeenCalledTimes(1);
  });

  it("rethrows unexpected lane errors (only AgentLaneUnavailableError triggers fallback)", async () => {
    vi.mocked(callAgentLane).mockRejectedValue(new TypeError("db on fire"));

    await expect(
      runBaselineReview(dbForReview(), { bookId: "book-1", chapterNumber: 2, companyId: "co-1" }),
    ).rejects.toThrow("db on fire");
    expect(callCriticLLM).not.toHaveBeenCalled();
  });

  it("forces criticDegraded:true when Ares safely degrades to the model fallback — regardless of the model helper's own flag (parseable output)", async () => {
    vi.mocked(callAgentLane).mockRejectedValue(
      new AgentLaneUnavailableError("ares", "timed out — delegation marked abandoned before fallback", { fallbackSafe: true }),
    );
    // The raw model helper defaults to NOT degraded; the requested-Ares
    // degradation must still be reported honestly.
    vi.mocked(callCriticLLM).mockResolvedValue({
      text: criticJson(),
      provider: "deepseek",
      criticDegraded: false,
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });

    expect(report.verdict).toBe("PASS");
    expect(report.criticProvider).toBe("deepseek");
    expect(report.criticDegraded).toBe(true);
    expect(report.agentLaneError).toContain("ares");
  });

  it("keeps forced degraded provenance when the fallback output is UNPARSEABLE (NO_VERDICT path)", async () => {
    vi.mocked(callAgentLane).mockRejectedValue(
      new AgentLaneUnavailableError("ares", "peer unreachable (timeout)", { fallbackSafe: true }),
    );
    vi.mocked(callCriticLLM).mockResolvedValue({
      text: "sorry, no JSON here",
      provider: "deepseek",
      criticDegraded: false,
    });

    const report = await runBaselineReview(dbForReview(), {
      bookId: "book-1",
      chapterNumber: 2,
      companyId: "co-1",
    });

    expect(report.verdict).toBe("NO_VERDICT");
    expect(report.noVerdictReason).toBe("unparseable-critic-output");
    expect(report.criticProvider).toBe("deepseek");
    expect(report.criticDegraded).toBe(true);
  });

  it("a NON-fallback-safe lane failure propagates — the paid model fallback is never invoked", async () => {
    vi.mocked(callAgentLane).mockRejectedValue(
      new AgentLaneUnavailableError("ares", "lane outcome indeterminate — durable state unproven", { fallbackSafe: false }),
    );

    await expect(
      runBaselineReview(dbForReview(), { bookId: "book-1", chapterNumber: 2, companyId: "co-1" }),
    ).rejects.toMatchObject({ name: "AgentLaneUnavailableError", fallbackSafe: false });
    expect(callCriticLLM).not.toHaveBeenCalled();
  });
});
