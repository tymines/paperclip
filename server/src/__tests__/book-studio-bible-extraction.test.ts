// Bible auto-extraction + review queue (Spec v1 §4.1③, §6.4): the critic lane
// only PROPOSES canon into a queue; Baily approves/rejects; nothing is ever
// silently written. Approve is human-only (AI → 403).
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import type { Router } from "express";

vi.mock("../services/chapter-generator.js", () => ({
  callCriticLLM: vi.fn(),
}));
vi.mock("../services/index.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { books, manuscriptChapters, bibleFacts, bibleLore } from "@paperclipai/db";
import { callCriticLLM } from "../services/chapter-generator.js";

interface MockState {
  book: any;
  chapters: any[];
  facts: any[];
  lore: any[];
}

function mockDb(opts?: Partial<MockState>) {
  const state: MockState = {
    book: opts?.book ?? { id: "book-1", title: "T", slug: "t", metadata: {} },
    chapters: opts?.chapters ?? [{ id: "ch-1", bookId: "book-1", chapterNumber: 3, title: "Three", content: "Chapter three prose.", locked: false }],
    facts: opts?.facts ?? [],
    lore: opts?.lore ?? [],
  };
  const pick = (table: unknown): any[] =>
    table === books ? [state.book]
    : table === manuscriptChapters ? state.chapters
    : table === bibleFacts ? state.facts
    : table === bibleLore ? state.lore
    : [];
  const db: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const p: any = Promise.resolve(pick(table));
          p.limit = () => Promise.resolve(pick(table).slice(0, 1));
          p.orderBy = () => Promise.resolve(pick(table));
          return p;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: any) => {
        const row = { createdAt: new Date(), ...v };
        if (table === bibleFacts) state.facts.push(row);
        if (table === bibleLore) state.lore.push(row);
        const p: any = Promise.resolve([row]);
        p.returning = () => Promise.resolve([row]);
        return p;
      },
    }),
    update: (table: unknown) => ({
      set: (v: any) => ({
        where: () => {
          if (table === books) state.book = { ...state.book, ...v };
          return Promise.resolve([]);
        },
      }),
    }),
    __state: state,
  };
  return db;
}

async function createTestApp(db: any, actor: any = { type: "board", source: "local_implicit" }) {
  const mod = await import("../routes/book-studio-bible-extraction.js");
  const router: Router = mod.bookStudioBibleExtractionRoutes(db);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.actor = actor; next(); });
  app.use(router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

const BASE = "/companies/co-1/book-studio/books/book-1";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(callCriticLLM).mockResolvedValue({
    text: JSON.stringify({
      facts: [{ statement: "The academy floats above the clouds", knownAsOf: 3 }],
      entities: [{ entityType: "lore", name: "The Sundering", summary: "The world broke." }],
    }),
    provider: "deepseek",
    criticDegraded: false,
  } as never);
});

describe("POST /bible-extract — proposals only, never silent writes", () => {
  it("queues critic-extracted candidates; writes NOTHING to the bible", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const res = await request(app).post(`${BASE}/bible-extract`).send({ chapterNumber: 3 });
    expect(res.status).toBe(201);
    expect(res.body.queued).toBe(2);
    const queue = db.__state.book.metadata.bibleReviewQueue;
    expect(queue).toHaveLength(2);
    expect(queue.every((i: any) => i.status === "pending")).toBe(true);
    expect(db.__state.facts).toHaveLength(0);
    expect(db.__state.lore).toHaveLength(0);
  });

  it("knownAsOf is clamped to the source chapter (no future-dated facts)", async () => {
    vi.mocked(callCriticLLM).mockResolvedValue({
      text: JSON.stringify({ facts: [{ statement: "x", knownAsOf: 99 }], entities: [] }),
      provider: "deepseek", criticDegraded: false,
    } as never);
    const db = mockDb();
    const app = await createTestApp(db);
    await request(app).post(`${BASE}/bible-extract`).send({ chapterNumber: 3 });
    expect(db.__state.book.metadata.bibleReviewQueue[0].knownAsOf).toBe(3);
  });
});

describe("approve / reject — Baily is the only gate into canon", () => {
  async function seedQueue(db: any, app: any) {
    await request(app).post(`${BASE}/bible-extract`).send({ chapterNumber: 3 });
    return db.__state.book.metadata.bibleReviewQueue as any[];
  }

  it("approve lands a fact with provenance auto-extracted", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const [fact] = await seedQueue(db, app);
    const res = await request(app).post(`${BASE}/bible-review-queue/${fact.id}/approve`);
    expect(res.status).toBe(200);
    expect(db.__state.facts).toHaveLength(1);
    expect(db.__state.facts[0].provenance).toBe("auto-extracted");
    expect(db.__state.facts[0].knownAsOf).toBe(3);
  });

  it("approve lands an entity in its codex table", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const [, entity] = await seedQueue(db, app);
    const res = await request(app).post(`${BASE}/bible-review-queue/${entity.id}/approve`);
    expect(res.status).toBe(200);
    expect(db.__state.lore).toHaveLength(1);
    expect(db.__state.lore[0].name).toBe("The Sundering");
  });

  it("reject resolves without writing; a resolved item can never be re-approved", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    const [fact] = await seedQueue(db, app);
    expect((await request(app).post(`${BASE}/bible-review-queue/${fact.id}/reject`)).status).toBe(200);
    expect(db.__state.facts).toHaveLength(0);
    expect((await request(app).post(`${BASE}/bible-review-queue/${fact.id}/approve`)).status).toBe(409);
  });

  it("an AI actor can NEVER approve or reject (403)", async () => {
    const db = mockDb();
    const app = await createTestApp(db, { type: "agent", agentId: "agent-1", companyId: "co-1" });
    // Seed via human app first
    const humanApp = await createTestApp(db);
    const [fact] = await seedQueue(db, humanApp);
    expect((await request(app).post(`${BASE}/bible-review-queue/${fact.id}/approve`)).status).toBe(403);
    expect((await request(app).post(`${BASE}/bible-review-queue/${fact.id}/reject`)).status).toBe(403);
    expect(db.__state.facts).toHaveLength(0);
  });

  it("GET lists pending first with a pending count", async () => {
    const db = mockDb();
    const app = await createTestApp(db);
    await seedQueue(db, app);
    const res = await request(app).get(`${BASE}/bible-review-queue`);
    expect(res.status).toBe(200);
    expect(res.body.pendingCount).toBe(2);
  });
});
