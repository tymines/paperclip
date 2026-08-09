import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Db } from "@paperclipai/db";

vi.mock("../services/index.js", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));

import { bookStudioRoutes } from "../routes/book-studio.js";
import { logActivity } from "../services/index.js";

const EXISTING = { id: "book-1", companyId: "company-1", slug: "stable-slug", title: "Old Title", metadata: { description: "premise" }, revision: 1, createdAt: new Date(), updatedAt: new Date() };

function query(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const result: any = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(rows), then: promise.then.bind(promise) };
  return result;
}

function createApp(book = EXISTING) {
  const updated = { ...book };
  const db: any = {
    select: vi.fn(() => query(book ? [book] : [])),
    update: vi.fn(() => ({ set: vi.fn((changes) => ({ where: vi.fn(() => ({ returning: vi.fn(async () => {
      const { revision: _revisionExpression, ...plainChanges } = changes;
      Object.assign(updated, plainChanges, { revision: updated.revision + 1 });
      return [updated];
    }) })) })) })),
  };
  db.transaction = vi.fn(async (callback: (tx: Db) => unknown) => callback(db as Db));
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.actor = { type: "board", userId: "board-1", source: "local_implicit" }; next(); });
  app.use("/api", bookStudioRoutes(db as Db));
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status || 500).json({ error: err.message }));
  return { app, updated, db };
}

describe("Book Studio rename", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renames only the display title, preserves slug/content metadata, and activity-logs the mutation", async () => {
    const { app, updated } = createApp();
    const response = await request(app).patch("/api/companies/company-1/book-studio/books/book-1").send({ title: "  New Title  ", expectedRevision: 1 }).expect(200);
    expect(response.body.book.title).toBe("New Title");
    expect(response.body.book.slug).toBe("stable-slug");
    expect(response.body.book.metadata).toEqual({ description: "premise" });
    expect(response.body.book.revision).toBe(2);
    expect(updated.slug).toBe("stable-slug");
    expect(logActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ companyId: "company-1", action: "book.renamed", entityId: "book-1", details: expect.objectContaining({ previousTitle: "Old Title", title: "New Title" }) }));
  });

  it("rejects empty titles without updating", async () => {
    const { app, db } = createApp();
    await request(app).patch("/api/companies/company-1/book-studio/books/book-1").send({ title: "   ", expectedRevision: 1 }).expect(400);
    expect(db.update).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("returns not found for a book outside the company and performs no mutation", async () => {
    const { app, db } = createApp({ ...EXISTING, companyId: "company-2" });
    // Drizzle enforces the company predicate; emulate its empty result for this URL.
    db.select.mockReturnValue(query([]));
    await request(app).patch("/api/companies/company-1/book-studio/books/book-1").send({ title: "Nope", expectedRevision: 1 }).expect(404);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("returns 409 when the optimistic update predicate matches no row", async () => {
    const { app, db } = createApp();
    db.update.mockReturnValue({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn(async () => []) })) })) });
    await request(app).patch("/api/companies/company-1/book-studio/books/book-1")
      .send({ title: "Stale", expectedRevision: 1 }).expect(409);
  });
});
