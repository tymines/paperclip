import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn() };
});
vi.mock("../services/provider-api-keys/index.js", () => ({ getRawKey: vi.fn() }));
vi.mock("../services/chapter-generator.js", () => ({
  generateChapterDraft: vi.fn(),
  reviseChapterContent: vi.fn(),
}));

import { generateChapterDraft, reviseChapterContent } from "../services/chapter-generator.js";

// ── Helper: thenable chain for Drizzle queries ────────────────────────

function q<T>(val: T): any {
  const p = Promise.resolve(val);
  const chain: Record<string, any> = Object.assign(
    (resolve: any, _reject?: any) => p.then(resolve),
    {
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
    },
  );
  for (const method of [
    "select", "from", "where", "orderBy", "limit",
    "values", "set", "returning", "insert", "update", "delete",
    "onConflictDoUpdate",
  ]) {
    chain[method] = () => chain;
  }
  return chain;
}

function mockDb(bookOverride?: any, chaptersOverride?: any, insertOverride?: any) {
  let selectCallCount = 0;
  const bookVal = bookOverride ?? [{ id: "book-1", title: "The Test Novel", slug: "test-novel" }];
  const chaptersVal = chaptersOverride ?? [
    { chapterNumber: 1, title: "The Beginning", beats: [{ description: "Story opens." }] },
  ];
  const insertVal = insertOverride ?? [{
    id: "ch-draft-1",
    bookId: "book-1",
    chapterNumber: 2,
    title: "The New Chapter",
    beats: [{ description: "A new chapter begins." }],
    source: "ai-draft",
    locked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }];
  return {
    select: () => ({
      from: () => ({
        where: () => {
          selectCallCount++;
          if (selectCallCount === 1) return q(bookVal);
          if (selectCallCount === 2) return q(chaptersVal);
          return q([]);
        },
        then: (fn: any) => Promise.resolve([]).then(fn),
      }),
      then: (fn: any) => Promise.resolve([]).then(fn),
    }),
    insert: () => ({ values: () => ({ returning: () => q(insertVal), onConflictDoUpdate: () => q(insertVal) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => q(insertVal) }) }) }),
  };
}

// ── Test app builder ─────────────────────────────────────────────────

async function createTestApp(mockDbInstance?: any) {
  const mod = await import("../routes/book-studio-chapter-gen.js");
  const router: Router = mod.bookStudioChapterGenRoutes(mockDbInstance ?? mockDb());
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
  return { app };
}

// ── Tests ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST .../chapters/draft", () => {
  it("returns 201 with drafted chapter", async () => {
    vi.mocked(generateChapterDraft).mockResolvedValue({
      title: "The New Chapter",
      beats: [{ description: "A new chapter begins." }],
    });

    const { app } = await createTestApp();

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/chapters/draft")
      .send({ prompt: "Write a chapter about discovery" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("chapter");
    expect(res.body.chapter.title).toBe("The New Chapter");
    expect(res.body.chapter.source).toBe("ai-draft");
  });

  it("returns 404 when book not found", async () => {
    const emptyDb = mockDb([]);
    const { app } = await createTestApp(emptyDb);

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-nonexistent/chapters/draft")
      .send({});

    expect(res.status).toBe(404);
  });

  it("accepts a specific chapterNumber override", async () => {
    vi.mocked(generateChapterDraft).mockResolvedValue({
      title: "Chapter 10",
      beats: [{ description: "Custom chapter." }],
    });

    const customInsert = [{
      id: "ch-10",
      bookId: "book-1",
      chapterNumber: 10,
      title: "Chapter 10",
      beats: [{ description: "Custom chapter." }],
      source: "ai-draft",
      locked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }];
    const { app } = await createTestApp(mockDb(undefined, undefined, customInsert));

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/chapters/draft")
      .send({ chapterNumber: 10 });

    expect(res.status).toBe(201);
    expect(res.body.chapter.chapterNumber).toBe(10);
  });
});

describe("POST .../chapters/:chapterNumber/revise", () => {
  it("returns 200 with revised chapter", async () => {
    vi.mocked(reviseChapterContent).mockResolvedValue({
      title: "The Beginning (Revised)",
      beats: [{ description: "A stronger opening." }],
    });

    // chaptersOverride with the chapter to revise
    const chaptersWithTarget = [
      { id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "The Beginning", beats: [{ description: "Story opens." }], locked: false },
    ];
    const customInsert = [{
      id: "ch-1",
      bookId: "book-1",
      chapterNumber: 1,
      title: "The Beginning (Revised)",
      beats: [{ description: "A stronger opening." }],
      source: "ai-revise",
      locked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }];

    const db = mockDb(undefined, chaptersWithTarget, customInsert);
    const { app } = await createTestApp(db);

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/chapters/1/revise")
      .send({ instruction: "Make the opening stronger" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("chapter");
    expect(res.body.chapter.source).toBe("ai-revise");
  });

  it("returns 400 when instruction is missing", async () => {
    const { app } = await createTestApp();

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/chapters/1/revise")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 when instruction is empty", async () => {
    const { app } = await createTestApp();

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/chapters/1/revise")
      .send({ instruction: "" });

    expect(res.status).toBe(400);
  });

  it("returns 404 when chapter not found", async () => {
    // Mock where book exists but no matching chapter exists
    let dbCallCount = 0;
    const notFoundDb = {
      select: () => ({
        from: () => ({
          where: () => {
            dbCallCount++;
            if (dbCallCount === 1) return q([{ id: "book-1", title: "The Test Novel", slug: "test-novel" }]);
            // Return empty for chapter query — no match
            return q([]);
          },
          then: (fn: any) => Promise.resolve([]).then(fn),
        }),
        then: (fn: any) => Promise.resolve([]).then(fn),
      }),
      insert: () => ({ values: () => ({ returning: () => q([]), onConflictDoUpdate: () => q([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => q([]) }) }) }),
    };
    const { app } = await createTestApp(notFoundDb);

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/chapters/99/revise")
      .send({ instruction: "Revise this chapter" });

    expect(res.status).toBe(404);
  });

  it("returns 400 when chapter is locked", async () => {
    const lockedChapter = {
      id: "ch-1", bookId: "book-1", chapterNumber: 1, title: "Locked Chapter",
      beats: [{ description: "Cannot touch." }], source: "authored", locked: true,
      createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01"),
    };
    let dbCallCount = 0;
    const lockedDb = {
      select: () => ({
        from: () => ({
          where: () => {
            dbCallCount++;
            if (dbCallCount === 1) return q([{ id: "book-1", title: "The Test Novel", slug: "test-novel" }]);
            // Return locked chapter on the chapter query
            return q([lockedChapter]);
          },
          then: (fn: any) => Promise.resolve([]).then(fn),
        }),
        then: (fn: any) => Promise.resolve([]).then(fn),
      }),
      insert: () => ({ values: () => ({ returning: () => q([]), onConflictDoUpdate: () => q([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => q([]) }) }) }),
    };
    const { app } = await createTestApp(lockedDb);

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/chapters/1/revise")
      .send({ instruction: "Revise this" });

    expect(res.status).toBe(400);
  });
});

describe("Company access enforcement", () => {
  it("returns 401 when no actor is set", async () => {
    const mod = await import("../routes/book-studio-chapter-gen.js");
    const simpleDb = {
      select: () => ({ from: () => ({ where: () => q([]), then: (fn: any) => Promise.resolve([]).then(fn) }), then: (fn: any) => Promise.resolve([]).then(fn) }),
      insert: () => ({ values: () => ({ returning: () => q([]), onConflictDoUpdate: () => q([]) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => q([]) }) }) }),
    };
    const router = mod.bookStudioChapterGenRoutes(simpleDb as any);
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.actor = { type: "none" as const };
      next();
    });
    app.use(router);
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const res = await request(app)
      .post("/companies/c1/book-studio/books/book-1/chapters/draft")
      .send({});

    expect(res.status).toBe(401);
  });
});
