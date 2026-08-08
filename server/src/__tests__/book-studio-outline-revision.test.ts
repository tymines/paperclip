import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Db } from "@paperclipai/db";
import { books, storyBibleOutline } from "@paperclipai/db";

vi.mock("../services/index.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { bookStudioRoutes } from "../routes/book-studio.js";

function query(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return {
    from(table: unknown) {
      const selected = table === books ? [BOOK] : table === storyBibleOutline ? rows : [];
      const selectedPromise = Promise.resolve(selected);
      return { where: () => ({ then: selectedPromise.then.bind(selectedPromise), limit: () => Promise.resolve(selected) }) };
    },
    then: promise.then.bind(promise),
  } as any;
}

const BOOK = { id: "book-1", companyId: "company-1", slug: "book", title: "Book", metadata: {}, revision: 1 };
const OUTLINE = { id: "outline-1", bookId: "book-1", chapterNumber: 1, title: "Old", beats: [], locked: false, source: "authored", revision: 1, createdAt: new Date(), updatedAt: new Date() };

function createApp(stale = false) {
  const row = { ...OUTLINE };
  const db: any = {
    select: vi.fn(() => query([row])),
    update: vi.fn((table: unknown) => ({
      set: (changes: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (stale || table !== storyBibleOutline) return [];
            const { revision: _revisionExpression, ...plain } = changes;
            Object.assign(row, plain, { revision: row.revision + 1 });
            return [row];
          },
        }),
      }),
    })),
  };
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.actor = { type: "board", userId: "board-1", source: "local_implicit" }; next(); });
  app.use("/api", bookStudioRoutes(db as Db));
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

describe("Book Studio outline revision contract", () => {
  const url = "/api/companies/company-1/book-studio/books/book-1/outline/outline-1";

  it("accepts the active integer token and returns the incremented exact row", async () => {
    const response = await request(createApp()).patch(url).send({ title: "New", expectedRevision: 1 }).expect(200);
    expect(response.body["outline-entry"]).toMatchObject({ id: "outline-1", title: "New", revision: 2 });
  });

  it("rejects stale tokens and legacy timestamp tokens", async () => {
    await request(createApp(true)).patch(url).send({ title: "Stale", expectedRevision: 1 }).expect(409);
    await request(createApp()).patch(url).send({ title: "Legacy", expectedUpdatedAt: "2026-08-08T00:00:00.000Z" }).expect(400);
  });
});
