// Book Studio — LOCK enforcement (Spec v1 §7): chapter + passage locks.
// ① locked refuses every AI write — even ?overwrite=1 (Tyler's ruling) ·
// ② directed revisions get a needs-decision card instead of burning tokens ·
// ③ only the human author locks/unlocks (agent actors → 403) ·
// ④ TOCTOU: lock set mid-draft still wins.
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("../services/chapter-generator.js", () => ({
  callLLM: vi.fn(),
  streamLLM: vi.fn(),
  generateChapterDraft: vi.fn(),
  reviseChapterContent: vi.fn(),
  callCriticLLM: vi.fn(),
  BOOK_WRITER_PRIMARY: "gemini",
  BOOK_CRITIC_PRIMARY: "deepseek",
}));

vi.mock("../services/book-context-compiler.js", () => ({
  compileChapterContext: vi.fn().mockResolvedValue({
    systemPrompt: "sys", userPrompt: "user",
    usedCharacters: [], usedLocations: [], hasStyle: false, hasBeat: true,
  }),
}));

// Real hash, fake persistence (never touch the vault filesystem).
vi.mock("../services/book-prose-writer.js", async () => {
  const { createHash } = await import("node:crypto");
  return {
    chapterContentHash: (content: string) =>
      createHash("sha256").update(content ?? "", "utf8").digest("hex").slice(0, 16),
    persistChapterProse: vi.fn(),
    writeChapterToVault: vi.fn(),
    normalizeChapterHeading: (prose: string) => prose,
  };
});

vi.mock("../services/index.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn() };
});

import { books, manuscriptChapters, storyBibleOutline, passageLocks, bookRevisions } from "@paperclipai/db";
import { callLLM } from "../services/chapter-generator.js";
import { persistChapterProse } from "../services/book-prose-writer.js";

const REL_LOCKS_ERR = () => Object.assign(new Error('relation "passage_locks" does not exist'), { code: "42P01" });

const PROSE = "The quick brown fox jumps over the lazy dog. More prose follows here.";

// ── Mock DB (table-reference routing) ─────────────────────────────────

interface MockState {
  book: any;
  chapters: any[];
  outline: any[];
  passageLocks: any[];
  revisions: any[];
  failOnLocks: boolean;
}

function mockDb(opts?: Partial<MockState>) {
  const state: MockState = {
    book: opts?.book ?? { id: "book-1", title: "The Test Novel", slug: "test-novel", metadata: {} },
    chapters: opts?.chapters ?? [
      { id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: PROSE, locked: false },
    ],
    outline: opts?.outline ?? [
      { id: "ob-1", bookId: "book-1", chapterNumber: 1, title: "One", beats: [], locked: false },
    ],
    passageLocks: opts?.passageLocks ?? [],
    revisions: opts?.revisions ?? [],
    failOnLocks: opts?.failOnLocks ?? false,
  };

  const pick = (table: unknown) =>
    table === books ? [state.book]
    : table === manuscriptChapters ? state.chapters
    : table === storyBibleOutline ? state.outline
    : table === passageLocks ? state.passageLocks
    : table === bookRevisions ? state.revisions
    : [];

  const db: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === passageLocks && state.failOnLocks) throw REL_LOCKS_ERR();
          const p: any = Promise.resolve(pick(table));
          p.limit = () => {
            if (table === passageLocks && state.failOnLocks) throw REL_LOCKS_ERR();
            return Promise.resolve(pick(table).slice(0, 1));
          };
          p.orderBy = () => Promise.resolve(pick(table));
          return p;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: any) => {
        if (table === passageLocks && state.failOnLocks) throw REL_LOCKS_ERR();
        const row = { id: `row-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), ...v };
        if (table === manuscriptChapters) state.chapters.push(row);
        if (table === passageLocks) state.passageLocks.push(row);
        if (table === bookRevisions) state.revisions.push(row);
        // drizzle inserts are awaitable with or without .returning()
        const p: any = Promise.resolve([row]);
        p.returning = () => Promise.resolve([row]);
        return p;
      },
    }),
    update: (table: unknown) => ({
      set: (v: any) => ({
        where: () => {
          if (table === books) {
            state.book = { ...state.book, ...v };
            return Promise.resolve([]);
          }
          if (table === manuscriptChapters) {
            state.chapters = state.chapters.map((c) => ({ ...c, ...v }));
            return Promise.resolve([]);
          }
          if (table === storyBibleOutline) {
            state.outline = state.outline.map((o) => ({ ...o, ...v }));
            return Promise.resolve([]);
          }
          if (table === bookRevisions) {
            state.revisions = state.revisions.map((r) => ({ ...r, ...v }));
            const p: any = Promise.resolve([]);
            p.returning = () => Promise.resolve(state.revisions.slice(-1));
            return p;
          }
          return Promise.resolve([]);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        if (table === passageLocks && state.failOnLocks) throw REL_LOCKS_ERR();
        return Promise.resolve([]);
      },
    }),
    __state: state,
  };
  return db;
}

// ── Test app builders ────────────────────────────────────────────────

type ActorKind = "board" | "agent";

function actorMiddleware(kind: ActorKind) {
  return (req: any, _res: any, next: any) => {
    req.actor = kind === "agent"
      ? { type: "agent", source: "api_key", agentId: "agent-1", runId: "run-1" }
      : { type: "board", source: "local_implicit", userId: "baily" };
    next();
  };
}

function errorHandler(err: any, _req: any, res: any, _next: any) {
  res.status(err.status || 500).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
}

async function createLocksApp(db: any, actor: ActorKind = "board") {
  const mod = await import("../routes/book-studio-locks.js");
  const router: Router = mod.bookStudioLockRoutes(db);
  const app = express();
  app.use(express.json());
  app.use(actorMiddleware(actor));
  app.use(router);
  app.use(errorHandler);
  return app;
}

async function createChapterGenApp(db: any, actor: ActorKind = "board") {
  const mod = await import("../routes/book-studio-chapter-gen.js");
  const router: Router = mod.bookStudioChapterGenRoutes(db);
  const app = express();
  app.use(express.json());
  app.use(actorMiddleware(actor));
  app.use(router);
  app.use(errorHandler);
  return app;
}

async function createReviewApp(db: any, actor: ActorKind = "board") {
  const mod = await import("../routes/book-studio-review.js");
  const router: Router = mod.bookStudioReviewRoutes(db);
  const app = express();
  app.use(express.json());
  app.use(actorMiddleware(actor));
  app.use(router);
  app.use(errorHandler);
  return app;
}

const BASE = "/companies/co-1/book-studio/books/book-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(callLLM).mockResolvedValue(JSON.stringify({ revised: "The quick brown fox leaps over the lazy dog.", rationale: "Stronger verb." }));
  vi.mocked(persistChapterProse).mockImplementation(async (db: any, args: any) => {
    const ch = db.__state.chapters.find((c: any) => c.chapterNumber === args.chapterNumber);
    if (ch) ch.content = args.prose;
    return { chapterId: ch?.id ?? "ch-1", chapterNumber: args.chapterNumber, title: ch?.title ?? "One", created: false };
  });
});

// ── PATCH /chapters/:n/lock (§7 ③ — human-only) ───────────────────────

describe("PATCH /chapters/:n/lock — chapter lock toggle", () => {
  it("human (board) can lock a chapter; manuscript + outline both get gated", async () => {
    const db = mockDb();
    const app = await createLocksApp(db, "board");
    const res = await request(app).patch(`${BASE}/chapters/1/lock`).send({ locked: true });
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(db.__state.chapters[0].locked).toBe(true);
    expect(db.__state.outline[0].locked).toBe(true); // ④ the same switch gates beats
  });

  it("locking a chapter with no manuscript row upserts one", async () => {
    const db = mockDb({ chapters: [] });
    const app = await createLocksApp(db, "board");
    const res = await request(app).patch(`${BASE}/chapters/5/lock`).send({ locked: true });
    expect(res.status).toBe(200);
    expect(db.__state.chapters).toHaveLength(1);
    expect(db.__state.chapters[0].locked).toBe(true);
  });

  it("agent actors can NEVER lock or unlock — 403", async () => {
    const db = mockDb();
    const app = await createLocksApp(db, "agent");
    const res = await request(app).patch(`${BASE}/chapters/1/lock`).send({ locked: true });
    expect(res.status).toBe(403);
    expect(db.__state.chapters[0].locked).toBe(false);
  });

  it("requires a boolean locked field", async () => {
    const app = await createLocksApp(mockDb(), "board");
    const res = await request(app).patch(`${BASE}/chapters/1/lock`).send({});
    expect(res.status).toBe(400);
  });
});

// ── passage locks CRUD ────────────────────────────────────────────────

describe("passage locks — create / list / delete", () => {
  it("human can lock a span; it is listed with stale detection", async () => {
    const db = mockDb();
    const app = await createLocksApp(db, "board");
    const res = await request(app).post(`${BASE}/chapters/1/passage-locks`).send({ spanStart: 4, spanEnd: 19, note: "Keep this sentence" });
    expect(res.status).toBe(201);
    expect(res.body.lock.spanStart).toBe(4);

    const list = await request(app).get(`${BASE}/chapters/1/locks`);
    expect(list.status).toBe(200);
    expect(list.body.passageLocks).toHaveLength(1);
    expect(list.body.passageLocks[0].note).toBe("Keep this sentence");
    expect(list.body.passageLocks[0].stale).toBe(false);

    // Content changes → the lock anchor goes stale (honestly flagged)
    db.__state.chapters[0].content = "Entirely rewritten chapter.";
    const stale = await request(app).get(`${BASE}/chapters/1/locks`);
    expect(stale.body.passageLocks[0].stale).toBe(true);
  });

  it("rejects invalid spans", async () => {
    const app = await createLocksApp(mockDb(), "board");
    const res = await request(app).post(`${BASE}/chapters/1/passage-locks`).send({ spanStart: 19, spanEnd: 4 });
    expect(res.status).toBe(400);
  });

  it("agent actors cannot create or remove passage locks — 403", async () => {
    const db = mockDb();
    const app = await createLocksApp(db, "agent");
    const post = await request(app).post(`${BASE}/chapters/1/passage-locks`).send({ spanStart: 4, spanEnd: 19 });
    expect(post.status).toBe(403);
    const del = await request(app).delete(`${BASE}/passage-locks/some-lock`);
    expect(del.status).toBe(403);
  });

  it("human can delete a passage lock", async () => {
    const db = mockDb({
      passageLocks: [{ id: "pl-1", bookId: "book-1", chapterId: "ch-1", chapterNumber: 1, spanStart: 4, spanEnd: 19, contentHash: "x", note: "", createdBy: "baily" }],
    });
    const app = await createLocksApp(db, "board");
    const res = await request(app).delete(`${BASE}/passage-locks/pl-1`);
    expect(res.status).toBe(204);
  });

  it("answers honestly when migration 0158 is not applied", async () => {
    const db = mockDb({ failOnLocks: true });
    const app = await createLocksApp(db, "board");
    const list = await request(app).get(`${BASE}/chapters/1/locks`);
    expect(list.status).toBe(200);
    expect(list.body.available).toBe(false);
    expect(list.body.pendingMigration).toBe("0158");
    const post = await request(app).post(`${BASE}/chapters/1/passage-locks`).send({ spanStart: 4, spanEnd: 19 });
    expect(post.status).toBe(503);
  });
});

// ── write-prose: locked refuses every AI write (§7 ①) ─────────────────

describe("write-prose — LOCKED chapters refuse AI writes", () => {
  it("409 LOCKED even with ?overwrite=1 — overwrite never bypasses a lock", async () => {
    const db = mockDb({ chapters: [{ id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: PROSE, locked: true }] });
    const app = await createChapterGenApp(db, "board");
    const res = await request(app).post(`${BASE}/chapters/1/write-prose?overwrite=1`).send({});
    expect(res.status).toBe(409);
    expect(res.body.details?.code).toBe("LOCKED");
    expect(callLLM).not.toHaveBeenCalled(); // refused BEFORE generating
    expect(persistChapterProse).not.toHaveBeenCalled();
  });

  it("TOCTOU: a lock set WHILE drafting still wins — the draft is not saved", async () => {
    const db = mockDb();
    const app = await createChapterGenApp(db, "board");
    vi.mocked(callLLM).mockImplementation(async () => {
      db.__state.chapters[0].locked = true; // locked mid-draft
      return "Freshly drafted prose.";
    });
    const res = await request(app).post(`${BASE}/chapters/1/write-prose?overwrite=1`).send({});
    expect(res.status).toBe(409);
    expect(res.body.details?.code).toBe("LOCKED");
    expect(persistChapterProse).not.toHaveBeenCalled();
    expect(db.__state.chapters[0].content).toBe(PROSE); // untouched
  });

  it("unlocked chapters draft normally (control)", async () => {
    const db = mockDb();
    const app = await createChapterGenApp(db, "board");
    vi.mocked(callLLM).mockResolvedValue("Freshly drafted prose.");
    const res = await request(app).post(`${BASE}/chapters/1/write-prose?overwrite=1`).send({});
    expect(res.status).toBe(200);
    expect(persistChapterProse).toHaveBeenCalledTimes(1);
  });
});

// ── revisions: needs-decision on locked content (§7 ②) ────────────────

describe("directed revisions — locked content gets a decision card, not a token burn", () => {
  it("chapter-locked revision → 200 needs-decision, writer never called", async () => {
    const db = mockDb({ chapters: [{ id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "One", content: PROSE, locked: true }] });
    const app = await createReviewApp(db, "board");
    const res = await request(app).post(`${BASE}/revisions`).send({ chapterNumber: 1, instruction: "Make it punchier." });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("needs-decision");
    expect(res.body.decisionCard.type).toBe("locked-content");
    expect(res.body.decisionCard.options).toContain("one-time-unlock-apply-relock");
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("passage-scope revision overlapping a passage lock → needs-decision", async () => {
    const db = mockDb({
      passageLocks: [{ id: "pl-1", bookId: "book-1", chapterId: "ch-1", chapterNumber: 1, spanStart: 0, spanEnd: 25, contentHash: "x", note: "keep", createdBy: "baily" }],
    });
    const app = await createReviewApp(db, "board");
    const res = await request(app).post(`${BASE}/revisions`).send({
      chapterNumber: 1, spanStart: 4, spanEnd: 19, instruction: "Stronger verb.",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("needs-decision");
    expect(res.body.decisionCard.passageLocks).toHaveLength(1);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("passage-scope revision NOT overlapping any lock → proposes normally", async () => {
    const db = mockDb({
      passageLocks: [{ id: "pl-1", bookId: "book-1", chapterId: "ch-1", chapterNumber: 1, spanStart: 30, spanEnd: 40, contentHash: "x", note: "", createdBy: "baily" }],
    });
    const app = await createReviewApp(db, "board");
    const res = await request(app).post(`${BASE}/revisions`).send({
      chapterNumber: 1, spanStart: 4, spanEnd: 19, instruction: "Stronger verb.",
    });
    expect(res.status).toBe(201);
    expect(res.body.revision.status).toBe("pending");
  });

  it("accept re-checks the chapter lock at COMMIT time — 409", async () => {
    const db = mockDb();
    const app = await createReviewApp(db, "board");
    const propose = await request(app).post(`${BASE}/revisions`).send({
      chapterNumber: 1, spanStart: 4, spanEnd: 19, instruction: "Stronger verb.",
    });
    const rev = propose.body.revision;
    db.__state.chapters[0].locked = true; // locked after the proposal
    const res = await request(app).post(`${BASE}/revisions/${rev.id}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.details?.code).toBe("LOCKED");
    expect(persistChapterProse).not.toHaveBeenCalled();
  });

  it("accept re-checks passage locks at COMMIT time — 409 on overlap", async () => {
    const db = mockDb();
    const app = await createReviewApp(db, "board");
    const propose = await request(app).post(`${BASE}/revisions`).send({
      chapterNumber: 1, spanStart: 4, spanEnd: 19, instruction: "Stronger verb.",
    });
    const rev = propose.body.revision;
    // Passage locked after the proposal was computed
    db.__state.passageLocks.push({ id: "pl-9", bookId: "book-1", chapterId: "ch-1", chapterNumber: 1, spanStart: 0, spanEnd: 25, contentHash: "x", note: "", createdBy: "baily" });
    const res = await request(app).post(`${BASE}/revisions/${rev.id}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.details?.code).toBe("LOCKED");
    expect(persistChapterProse).not.toHaveBeenCalled();
  });
});
