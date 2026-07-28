// PR #30 Chronos rereview-v2 — blocking P1B: the autopilot loop must enforce
// the HARD budget BEFORE the Ares critic / model-fallback review action is
// dispatched, charge that review action exactly once, and activity-log +
// checkpoint any hard stop. These tests drive the real runAutopilotLoop via
// startAutopilot with every writer/critic seam mocked.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Never let synthetic autopilot state touch ~/.paperclip (resolved at module
// initialization of the orchestrator).
const checkpointDir = mkdtempSync(path.join(os.tmpdir(), "paperclip-autopilot-budget-test-"));
process.env.AUTOPILOT_CHECKPOINT_DIR = checkpointDir;

vi.mock("../services/chapter-generator.js", () => ({ callLLM: vi.fn() }));
vi.mock("../services/book-context-compiler.js", () => ({ compileChapterContext: vi.fn() }));
vi.mock("../services/book-prose-writer.js", () => ({ persistChapterProse: vi.fn() }));
vi.mock("../services/book-locks.js", () => ({ resolveChapterLocked: vi.fn(async () => false) }));
vi.mock("../services/index.js", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("../services/book-review.js", () => ({ runBaselineReview: vi.fn() }));

import { callLLM } from "../services/chapter-generator.js";
import { compileChapterContext } from "../services/book-context-compiler.js";
import { persistChapterProse } from "../services/book-prose-writer.js";
import { logActivity } from "../services/index.js";
import { runBaselineReview } from "../services/book-review.js";

// The orchestrator resolves AUTOPILOT_CHECKPOINT_DIR at module load, so it
// must be imported dynamically AFTER the env override above takes effect.
type Orchestrator = typeof import("../services/autopilot-orchestrator.js");
let orchestrator: Orchestrator;

/** Thenable Drizzle-chain stub (terminal await resolves `val`). */
function q<T>(val: T): any {
  const p = Promise.resolve(val);
  const chain: any = {
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
  };
  for (const method of ["select", "from", "where", "orderBy", "limit", "set", "values", "returning"]) {
    chain[method] = () => chain;
  }
  return chain;
}

/**
 * Mock Db whose successive select() calls resolve the scripted row sets in
 * order. Loop select order (one pending chapter): books(id/slug) → outline →
 * manuscripts → existingNow → [books full row after a review that runs].
 */
function dbWithSelectScript(script: unknown[][]) {
  let i = 0;
  const db: any = {
    select: vi.fn(() => {
      const val = script[Math.min(i, script.length - 1)];
      i++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => q(val)),
          orderBy: vi.fn(() => q(val)),
        })),
      };
    }),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => q([])) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(() => q([{ id: "x" }])) })) })),
  };
  return db;
}

const ACTOR = { actorType: "board", actorId: "user-1", agentId: null, runId: null };
const PROSE = `${"word ".repeat(400)}end`; // ≥350 words: no suspiciously-short redraft
const OUTLINE = [{ chapterNumber: 1, title: "One" }];
const BOOK_ID_SLUG = [{ id: "book-1", slug: "my-book" }];
const BOOK_FULL = [{ id: "book-1", slug: "my-book", metadata: {} }];

const PASS_REPORT = {
  chapterNumber: 1,
  verdict: "PASS" as const,
  scores: {},
  failures: [],
  summary: "Solid.",
  findings: [],
  criticProvider: "ares (agent lane)",
  criticDegraded: false,
};

async function waitForSettled(bookId: string, timeoutMs = 5_000) {
  const start = Date.now();
  for (;;) {
    const s = orchestrator.getAutopilotState(bookId);
    if (s && s.status !== "running") return s;
    if (Date.now() - start > timeoutMs) throw new Error(`loop for ${bookId} did not settle`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function checkpointFor(bookId: string) {
  return JSON.parse(readFileSync(path.join(checkpointDir, `${bookId}.json`), "utf-8"));
}

function activityCalls(action: string) {
  return vi
    .mocked(logActivity)
    .mock.calls.filter((c) => (c[1] as { action: string }).action === action)
    .map((c) => c[1] as { action: string; details: Record<string, unknown> });
}

describe("autopilot budget hard-stop before the critic review action (P1B)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    orchestrator = await import("../services/autopilot-orchestrator.js");
    orchestrator.initAutopilotOrchestrator();
    vi.mocked(compileChapterContext).mockResolvedValue({
      systemPrompt: "s",
      userPrompt: "u",
      usedCharacters: [],
      hasStyle: false,
      hasBeat: true,
    } as never);
    vi.mocked(callLLM).mockResolvedValue(PROSE);
    vi.mocked(persistChapterProse).mockResolvedValue({ title: "One" } as never);
    vi.mocked(runBaselineReview).mockResolvedValue(PASS_REPORT as never);
  });

  it("already AT the hard budget ⇒ pauses + checkpoints + activity-logs the hard stop, and dispatches NO critic lane (neither Ares nor model fallback)", async () => {
    // Draft estimate is 5¢; budget 5¢ ⇒ spend already equals the budget when
    // the review action would start.
    const db = dbWithSelectScript([BOOK_ID_SLUG, OUTLINE, [], []]);
    orchestrator.startAutopilot("budget-at", "co-1", "My Book", { budgetCents: 5 }, db, ACTOR);
    const settled = await waitForSettled("budget-at");

    expect(settled.status).toBe("paused");
    expect(runBaselineReview).not.toHaveBeenCalled();

    // Checkpoint carries the durable hard-stop state.
    const cp = checkpointFor("budget-at");
    expect(cp.status).toBe("paused");
    expect(cp.spendCents).toBe(5);

    // Activity log: a hard-budget stop with chapter/spend/budget/reservation.
    const stops = activityCalls("autopilot.hard_budget_stop");
    expect(stops).toHaveLength(1);
    expect(stops[0]!.details).toMatchObject({
      reason: "budget_hard_stop",
      chapterNumber: 1,
      spendCents: 5,
      budgetCents: 5,
      reservationCents: 2,
    });
    // No soft-cap pause entry — this was the hard stop, not the soft cap.
    expect(activityCalls("autopilot.paused")).toHaveLength(0);
  });

  it("reservation would EXCEED the remaining budget ⇒ same hard stop before any critic dispatch", async () => {
    // spend 5¢, reservation 2¢, budget 6¢ ⇒ 5 + 2 > 6.
    const db = dbWithSelectScript([BOOK_ID_SLUG, OUTLINE, [], []]);
    orchestrator.startAutopilot("budget-exceed", "co-1", "My Book", { budgetCents: 6 }, db, ACTOR);
    const settled = await waitForSettled("budget-exceed");

    expect(settled.status).toBe("paused");
    expect(runBaselineReview).not.toHaveBeenCalled();
    const stops = activityCalls("autopilot.hard_budget_stop");
    expect(stops).toHaveLength(1);
    expect(stops[0]!.details).toMatchObject({ spendCents: 5, budgetCents: 6, reservationCents: 2 });
  });

  it("exact remaining budget ⇒ the review runs ONCE and is charged exactly once (draft 5 + reservation 2 = 7)", async () => {
    const db = dbWithSelectScript([BOOK_ID_SLUG, OUTLINE, [], [], BOOK_FULL]);
    orchestrator.startAutopilot("budget-exact", "co-1", "My Book", { budgetCents: 7 }, db, ACTOR);
    const settled = await waitForSettled("budget-exact");

    expect(runBaselineReview).toHaveBeenCalledTimes(1);
    expect(settled.spendCents).toBe(7);
    // The hard stop did NOT fire; the post-chapter soft-cap pause did.
    expect(activityCalls("autopilot.hard_budget_stop")).toHaveLength(0);
    expect(settled.status).toBe("paused");
    // Review ran with company + actor context (the live Ares lane inside it).
    const reviewArgs = vi.mocked(runBaselineReview).mock.calls[0]![1] as Record<string, unknown>;
    expect(reviewArgs).toMatchObject({ bookId: "budget-exact", chapterNumber: 1, companyId: "co-1" });
    // Review outcome is activity-logged with its provenance.
    const reviews = activityCalls("book.baseline_review");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.details).toMatchObject({ verdict: "PASS", criticProvider: "ares (agent lane)" });
  });

  it("a degraded model-fallback critic report is still a SINGLE charge — no double charge when one lane falls back to the other", async () => {
    vi.mocked(runBaselineReview).mockResolvedValue({
      ...PASS_REPORT,
      criticProvider: "deepseek",
      criticDegraded: true,
    } as never);
    const db = dbWithSelectScript([BOOK_ID_SLUG, OUTLINE, [], [], BOOK_FULL]);
    orchestrator.startAutopilot("budget-fallback", "co-1", "My Book", { budgetCents: 7 }, db, ACTOR);
    const settled = await waitForSettled("budget-fallback");

    expect(runBaselineReview).toHaveBeenCalledTimes(1);
    expect(settled.spendCents).toBe(7);
    const reviews = activityCalls("book.baseline_review");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.details).toMatchObject({ criticProvider: "deepseek", criticDegraded: true });
  });

  it("an indeterminate lane error from the review action is charged once, non-fatal, and never retried", async () => {
    vi.mocked(runBaselineReview).mockRejectedValue(new Error("lane outcome indeterminate — not fallback-safe"));
    const db = dbWithSelectScript([BOOK_ID_SLUG, OUTLINE, [], [], BOOK_FULL]);
    orchestrator.startAutopilot("budget-indeterminate", "co-1", "My Book", { budgetCents: 7 }, db, ACTOR);
    const settled = await waitForSettled("budget-indeterminate");

    expect(runBaselineReview).toHaveBeenCalledTimes(1);
    expect(settled.spendCents).toBe(7);
    // Critic failure never blocks the chain — the chapter still completes and
    // the loop pauses on the soft cap, not on a hard stop or a failure.
    expect(settled.status).toBe("paused");
    expect(activityCalls("autopilot.hard_budget_stop")).toHaveLength(0);
  });

  it("no model/critic invocation happens past the hard stop, while the draft itself remains intact", async () => {
    const db = dbWithSelectScript([BOOK_ID_SLUG, OUTLINE, [], []]);
    orchestrator.startAutopilot("budget-nopast", "co-1", "My Book", { budgetCents: 5 }, db, ACTOR);
    await waitForSettled("budget-nopast");

    // The writer drafted (one call — prose was long enough, no redraft) and
    // the prose persisted; NOTHING critic-side ran past the hard stop.
    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(persistChapterProse).toHaveBeenCalledTimes(1);
    expect(runBaselineReview).not.toHaveBeenCalled();
  });
});

afterAll(() => {
  rmSync(checkpointDir, { recursive: true, force: true });
});
