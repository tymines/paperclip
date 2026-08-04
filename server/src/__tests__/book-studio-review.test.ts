// Book Studio — review workflow routes (Spec v1 §5): baseline review, directed
// revisions, accept/reject commit path, gated-migration honesty.
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ── Mocks ─────────────────────────────────────────────────────────────

// LLM lanes: never hit a real provider.
vi.mock("../services/chapter-generator.js", () => ({
  callLLM: vi.fn(),
  callCriticLLM: vi.fn(),
  BOOK_WRITER_PRIMARY: "gemini",
  BOOK_CRITIC_PRIMARY: "deepseek",
}));

// Baseline pass: mocked per-test.
vi.mock("../services/book-review.js", () => ({
  runBaselineReview: vi.fn(),
  persistBaselineReport: vi.fn(),
  RUBRIC_DIMENSIONS: ["pacing", "characterVoice", "plotLogic", "proseQuality", "consistency", "tension", "dialogue", "worldImmersion"],
  PASS_THRESHOLD: 7,
}));

// Prose persistence: real module (chapterContentHash, frontmatter readers),
// but persistChapterProse/writeChapterToVault are mocked so tests NEVER touch
// the vault filesystem. Spread the actual module so book-locks.ts still gets
// readVaultChapterFrontmatter + BOOK_VAULT_ROOT.
vi.mock("../services/book-prose-writer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/book-prose-writer.js")>();
  return {
    ...actual,
    persistChapterProse: vi.fn(),
    writeChapterToVault: vi.fn(),
  };
});

vi.mock("../services/index.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn() };
});

import { books, manuscriptChapters, bookRevisions } from "@paperclipai/db";
import { runBaselineReview, persistBaselineReport } from "../services/book-review.js";
import { callLLM } from "../services/chapter-generator.js";
import { persistChapterProse } from "../services/book-prose-writer.js";
import { logActivity } from "../services/index.js";
import { AgentLaneUnavailableError } from "../services/book-agent-lanes.js";

const PASS_REPORT = {
  chapterNumber: 1,
  verdict: "PASS" as const,
  scores: { pacing: 8, characterVoice: 8, plotLogic: 8, proseQuality: 8, consistency: 8, tension: 8, dialogue: 8, worldImmersion: 8 },
  failures: [],
  summary: "Solid chapter.",
  findings: [],
  criticProvider: "Hades / Kimi K3",
  criticDegraded: false,
};

// ── Mock DB (table-reference routing) ─────────────────────────────────

const REL_ERR = () => Object.assign(new Error('relation "book_revisions" does not exist'), { code: "42P01" });

interface MockState {
  book: any;
  chapters: any[];
  revisions: any[];
  failOnRevisions: boolean;
}

function mockDb(opts?: Partial<MockState>) {
  const state: MockState = {
    book: opts?.book ?? { id: "book-1", companyId: "co-1", title: "The Test Novel", slug: "test-novel", metadata: {} },
    chapters: opts?.chapters ?? [
      { id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: "The quick brown fox jumps over the lazy dog. More prose follows here." },
    ],
    revisions: opts?.revisions ?? [],
    failOnRevisions: opts?.failOnRevisions ?? false,
  };

  const pick = (table: unknown) =>
    table === books ? [state.book]
    : table === manuscriptChapters ? state.chapters
    : table === bookRevisions ? state.revisions
    : [];

  const db: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === bookRevisions && state.failOnRevisions) throw REL_ERR();
          const p: any = Promise.resolve(pick(table));
          p.limit = () => {
            if (table === bookRevisions && state.failOnRevisions) throw REL_ERR();
            return Promise.resolve(pick(table).slice(0, 1));
          };
          p.orderBy = () => Promise.resolve(pick(table));
          return p;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: any) => ({
        returning: () => {
          if (table === bookRevisions && state.failOnRevisions) throw REL_ERR();
          const row = { id: `rev-${state.revisions.length + 1}`, createdAt: new Date(), resolvedAt: null, ...v };
          if (table === bookRevisions) state.revisions.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (v: any) => ({
        where: () => {
          if (table === books) {
            state.book = { ...state.book, ...v };
            return Promise.resolve([]);
          }
          if (table === bookRevisions) {
            if (state.failOnRevisions) throw REL_ERR();
            state.revisions = state.revisions.map((r) => ({ ...r, ...v }));
            const p: any = Promise.resolve([]);
            p.returning = () => Promise.resolve(state.revisions.slice(-1));
            return p;
          }
          return Promise.resolve([]);
        },
      }),
    }),
    __state: state,
  };
  return db;
}

// ── Test app builder ─────────────────────────────────────────────────

async function createTestApp(db: any) {
  const mod = await import("../routes/book-studio-review.js");
  const router: Router = mod.bookStudioReviewRoutes(db);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.actor = { type: "board", source: "local_implicit" };
    next();
  });
  app.use(router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

const BASE = "/companies/co-1/book-studio/books/book-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runBaselineReview).mockResolvedValue(PASS_REPORT as any);
  vi.mocked(persistBaselineReport).mockResolvedValue({ runId: "run-1", annotationCount: 0, unanchored: 0 } as any);
  vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ revised: "The quick brown fox leaps over the lazy dog.", rationale: "Stronger verb." }));
  vi.mocked(persistChapterProse).mockImplementation(async (db: any, args: any) => {
    const ch = db.__state.chapters.find((c: any) => c.chapterNumber === args.chapterNumber);
    if (ch) ch.content = args.prose;
    return { chapterId: ch?.id ?? "ch-1", chapterNumber: args.chapterNumber, title: ch?.title ?? "One", created: false };
  });
});

// ── POST /review (§5.A/B) ─────────────────────────────────────────────

describe("POST /review — baseline pass", () => {
  it("chapter scope: runs the critic pass, persists it, and queues a PASS silently", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/review`).send({ scope: "chapter", chapterNumber: 1 });
    expect(res.status).toBe(201);
    expect(res.body.reports).toHaveLength(1);
    expect(res.body.reports[0].verdict).toBe("PASS");
    expect(res.body.exceptions).toEqual([]);
    expect(runBaselineReview).toHaveBeenCalledWith(db, {
      bookId: "book-1", chapterNumber: 1, companyId: "co-1", requestedByActorId: "board",
    });
    expect(persistBaselineReport).toHaveBeenCalled();
    // PASS → chapter queues silently (§5.B)
    expect(db.__state.book.metadata.chapterStatus["1"]).toBe("queued");
  });

  it("book scope: reviews every chapter with prose, one report", async () => {
    const db = mockDb({
      chapters: [
        { id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: "Prose one." },
        { id: "ch-2", bookId: "book-1", chapterNumber: 2, title: "Two", content: "Prose two." },
        { id: "ch-3", bookId: "book-1", chapterNumber: 3, title: "Three", content: "" },
      ],
    });
    vi.mocked(runBaselineReview).mockImplementation(async (_db, args: any) => ({ ...PASS_REPORT, chapterNumber: args.chapterNumber }) as any);
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/review`).send({ scope: "book" });
    expect(res.status).toBe(201);
    expect(res.body.reports).toHaveLength(2); // empty-prose chapter skipped
  });

  it("FAIL verdict surfaces as an exception (§5.B)", async () => {
    const db = mockDb();
    vi.mocked(runBaselineReview).mockResolvedValue({ ...PASS_REPORT, verdict: "FAIL", failures: ["pacing"] } as any);
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/review`).send({ scope: "chapter", chapterNumber: 1 });
    expect(res.status).toBe(201);
    expect(res.body.exceptions).toEqual([1]);
    expect(db.__state.book.metadata.chapterStatus["1"]).toBe("exception");
  });

  it("returns 503 and stores nothing when Hades is unavailable", async () => {
    const db = mockDb();
    vi.mocked(runBaselineReview).mockRejectedValue(
      new AgentLaneUnavailableError("hades", "peer unreachable (peer_unconfigured)"),
    );
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/review`).send({ scope: "chapter", chapterNumber: 1 });

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      available: false,
      via: "none",
      reviewer: "Hades",
      model: "Kimi K3",
      agentLane: "unavailable",
    });
    expect(persistBaselineReport).not.toHaveBeenCalled();
    expect(db.__state.book.metadata).toEqual({});
  });

  it("returns 502 for an indeterminate Hades outcome and stores no partial whole-book review", async () => {
    const db = mockDb({
      chapters: [
        { id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: "Prose one." },
        { id: "ch-2", bookId: "book-1", chapterNumber: 2, title: "Two", content: "Prose two." },
      ],
    });
    vi.mocked(runBaselineReview)
      .mockResolvedValueOnce(PASS_REPORT as any)
      .mockRejectedValueOnce(
        new AgentLaneUnavailableError("hades", "durable state unproven", { fallbackSafe: false }),
      );
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/review`).send({ scope: "book" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ agentLane: "indeterminate", via: "none" });
    expect(persistBaselineReport).not.toHaveBeenCalled();
    expect(db.__state.book.metadata).toEqual({});
  });

  it("falls back to first-class JSONB notes when annotation tables are missing (§5.C)", async () => {
    const db = mockDb();
    vi.mocked(runBaselineReview).mockResolvedValue({
      ...PASS_REPORT,
      verdict: "FAIL",
      failures: ["consistency"],
      findings: [{ excerpt: "quick brown fox", note: "Contradicts the bible.", category: "consistency", kind: "review" }],
    } as any);
    vi.mocked(persistBaselineReport).mockRejectedValue(Object.assign(new Error('relation "book_annotations" does not exist'), { code: "42P01" }));
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/review`).send({ scope: "chapter", chapterNumber: 1 });
    expect(res.status).toBe(201);
    expect(res.body.reports[0].stored).toBe("review-notes");
    const notes = db.__state.book.metadata.reviewNotes;
    expect(notes.length).toBe(2); // run summary + one finding
    expect(notes.every((n: any) => n.provenance === "ai-critic")).toBe(true);
    expect(notes.every((n: any) => n.status === "open")).toBe(true);
    // anchored finding gets span offsets
    const finding = notes.find((n: any) => n.text.includes("Contradicts the bible"));
    expect(finding.startOffset).toBeGreaterThanOrEqual(0);
  });

  it("rejects chapter scope without a chapterNumber", async () => {
    const app = await createTestApp(mockDb());
    const res = await request(app).post(`${BASE}/review`).send({ scope: "chapter" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a book outside the authorized company — no critic, no persistence, no activity (P1)", async () => {
    // Book exists but belongs to co-2; the URL is authorized for co-1. The
    // route must treat the pair as not-found BEFORE loading chapters,
    // dispatching to Hades or persisting anything.
    const db = mockDb({
      book: { id: "book-1", companyId: "co-2", title: "Foreign Novel", slug: "foreign-novel", metadata: {} },
    });
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/review`).send({ scope: "chapter", chapterNumber: 1 });
    expect(res.status).toBe(404);
    expect(runBaselineReview).not.toHaveBeenCalled();
    expect(persistBaselineReport).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    // Nothing was written onto the foreign book either.
    expect(db.__state.book.metadata).toEqual({});
  });
});

// ── POST /revisions (§5.D/E) ──────────────────────────────────────────

describe("POST /revisions — directed revision jobs", () => {
  it("creates a pending passage proposal and writes NOTHING to the manuscript", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const originalContent = db.__state.chapters[0].content;
    const res = await request(app).post(`${BASE}/revisions`).send({
      chapterNumber: 1,
      spanStart: 4,
      spanEnd: 19,
      instruction: "Stronger verb.",
      noteId: "note-9",
    });
    expect(res.status).toBe(201);
    const rev = res.body.revision;
    expect(rev.status).toBe("pending");
    expect(rev.scope).toBe("passage");
    expect(rev.originalText).toBe("quick brown fox");
    expect(rev.proposedText).toContain("leaps");
    expect(rev.sourceNoteId).toBe("note-9");
    // §5.D invariant: the AI never writes outside an accepted proposal
    expect(db.__state.chapters[0].content).toBe(originalContent);
    expect(persistChapterProse).not.toHaveBeenCalled();
  });

  it("rejects invalid spans", async () => {
    const app = await createTestApp(mockDb());
    const res = await request(app).post(`${BASE}/revisions`).send({
      chapterNumber: 1, spanStart: 50, spanEnd: 99999, instruction: "x",
    });
    expect(res.status).toBe(400);
  });

  it("requires an instruction — Baily directs every revision", async () => {
    const app = await createTestApp(mockDb());
    const res = await request(app).post(`${BASE}/revisions`).send({ chapterNumber: 1 });
    expect(res.status).toBe(400);
  });

  it("answers honestly when migration 0157 is not applied", async () => {
    const db = mockDb({ failOnRevisions: true });
    const app = await createTestApp(db);
    const get = await request(app).get(`${BASE}/revisions`);
    expect(get.body.available).toBe(false);
    expect(get.body.pendingMigration).toBe("0157");
    const post = await request(app).post(`${BASE}/revisions`).send({ chapterNumber: 1, instruction: "x" });
    expect(post.status).toBe(503);
    expect(post.body.pendingMigration).toBe("0157");
    expect(callLLM).not.toHaveBeenCalled(); // no tokens burned on an unstorable proposal
  });
});

// ── accept / reject (§5.D — Baily is the only decider) ────────────────

async function createPendingRevision(app: any, db: any) {
  const res = await request(app).post(`${BASE}/revisions`).send({
    chapterNumber: 1, spanStart: 4, spanEnd: 19, instruction: "Stronger verb.",
  });
  expect(res.status).toBe(201);
  return res.body.revision;
}

describe("POST /revisions/:id/accept|reject", () => {
  it("accept commits through the prose path and marks the revision accepted", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const rev = await createPendingRevision(app, db);
    const res = await request(app).post(`${BASE}/revisions/${rev.id}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.revision.status).toBe("accepted");
    // Splice applied: prefix + proposal + suffix
    expect(persistChapterProse).toHaveBeenCalledTimes(1);
    const written = vi.mocked(persistChapterProse).mock.calls[0][1].prose;
    expect(written).toBe("The The quick brown fox leaps over the lazy dog. jumps over the lazy dog. More prose follows here.");
  });

  it("accept re-checks the content hash — a stale proposal can never clobber newer edits (TOCTOU)", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const rev = await createPendingRevision(app, db);
    // Chapter changed after the proposal was computed
    db.__state.chapters[0].content = "Completely different chapter text now.";
    const res = await request(app).post(`${BASE}/revisions/${rev.id}/accept`);
    expect(res.status).toBe(409);
    expect(persistChapterProse).not.toHaveBeenCalled();
  });

  it("reject parks the chapter; a resolved revision can never be re-accepted", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const rev = await createPendingRevision(app, db);
    const rej = await request(app).post(`${BASE}/revisions/${rev.id}/reject`);
    expect(rej.status).toBe(200);
    expect(rej.body.revision.status).toBe("rejected");
    const acc = await request(app).post(`${BASE}/revisions/${rev.id}/accept`);
    expect(acc.status).toBe(409);
    expect(persistChapterProse).not.toHaveBeenCalled();
  });

  it("accept resolves the originating critique note (§5.C lifecycle)", async () => {
    const db = mockDb({
      book: {
        id: "book-1", companyId: "co-1", title: "The Test Novel", slug: "test-novel",
        metadata: { reviewNotes: [{ id: "note-1", category: "prose", text: "Weak verb", chapterNumber: 1, provenance: "baily", status: "open", createdAt: "x", updatedAt: "x" }] },
      },
    });
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/revisions`).send({
      chapterNumber: 1, spanStart: 4, spanEnd: 19, instruction: "Stronger verb.", noteId: "note-1",
    });
    const rev = res.body.revision;
    // note now linked to the job
    expect(db.__state.book.metadata.reviewNotes[0].linkedRevisionId).toBe(rev.id);
    const acc = await request(app).post(`${BASE}/revisions/${rev.id}/accept`);
    expect(acc.status).toBe(200);
    expect(db.__state.book.metadata.reviewNotes[0].status).toBe("resolved");
  });
});

// ── one-time-unlock-apply-relock (§7 Locked-Content card execution) ────

describe("POST /revisions/:id/accept — one-time-unlock-apply-relock", () => {
  it("a locked chapter refuses a normal accept (409 LOCKED), nothing written", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const rev = await createPendingRevision(app, db);
    db.__state.chapters[0].locked = true;
    const res = await request(app).post(`${BASE}/revisions/${rev.id}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/locked/i);
    expect(persistChapterProse).not.toHaveBeenCalled();
  });

  it("Baily's one-time unlock: accepts through the guard (passage locks still on), then re-locks", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const rev = await createPendingRevision(app, db);
    db.__state.chapters[0].locked = true;
    const res = await request(app)
      .post(`${BASE}/revisions/${rev.id}/accept`)
      .send({ override: "one-time-unlock-apply-relock" });
    expect(res.status).toBe(200);
    expect(res.body.revision.status).toBe("accepted");
    // The sink guard was bypassed ONLY for the chapter lock (passages still guarded).
    expect(persistChapterProse).toHaveBeenCalledTimes(1);
    expect(vi.mocked(persistChapterProse).mock.calls[0][2]).toEqual({ skipChapterLock: true });
  });

  it("an AI actor can NEVER spend a one-time unlock (403)", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const rev = await createPendingRevision(app, db);
    db.__state.chapters[0].locked = true;
    const mod = await import("../routes/book-studio-review.js");
    const agentApp = express();
    agentApp.use(express.json());
    agentApp.use((req: any, _res: any, next: any) => {
      req.actor = { type: "agent", agentId: "agent-1", companyId: "co-1" };
      next();
    });
    agentApp.use(mod.bookStudioReviewRoutes(db));
    agentApp.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });
    const res = await request(agentApp)
      .post(`${BASE}/revisions/${rev.id}/accept`)
      .send({ override: "one-time-unlock-apply-relock" });
    expect(res.status).toBe(403);
    expect(persistChapterProse).not.toHaveBeenCalled();
  });
});
