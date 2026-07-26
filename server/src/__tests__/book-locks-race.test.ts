// Real concurrent Postgres lock/write race coverage (Zeus train review r2).
// Exercises the ACTUAL race against a real database (embedded Postgres with
// all migrations applied) — not a synthesized 40001:
//   ① a chapter lock committed mid-write defeats the sink's conditional write
//   ② legacy controlled SSI behavior remains understood
//   ③ a committed passage lock blocks a clobbering sink write
//   ④ the production passage-lock endpoint and production sink share one lock
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDb,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  companies,
  books,
  manuscriptChapters,
  passageLocks,
  type Db,
} from "@paperclipai/db";
import { bookStudioLockRoutes } from "../routes/book-studio-locks.js";

const support = await getEmbeddedPostgresTestSupport();
const PROSE = "The quick brown fox jumps over the lazy dog. More prose follows here.";

describe.skipIf(!support.supported)("book lock races (real embedded Postgres)", { timeout: 180_000 }, () => {
  let pg: { connectionString: string; cleanup(): Promise<void> };
  let db: Db;
  let dbRacer: Db;
  let companyId: string;
  let bookId: string;
  let chapterId: string;

  beforeAll(async () => {
    pg = await startEmbeddedPostgresTestDatabase("book-locks-race-");
    process.env.BOOK_STUDIO_VAULT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "book-race-vault-"));
    db = createDb(pg.connectionString);
    dbRacer = createDb(pg.connectionString);

    const [company] = await db.insert(companies).values({ name: "Race Co" }).returning();
    companyId = company.id;
    const [book] = await db.insert(books).values({ companyId, slug: `race-${Date.now()}`, title: "Race Novel" }).returning();
    bookId = book.id;
    chapterId = "race-ch-1";
    await db.insert(manuscriptChapters).values({ id: chapterId, bookId, chapterNumber: 1, title: "One", content: PROSE, locked: false });
  }, 120_000);

  afterAll(async () => {
    await pg.cleanup().catch(() => {});
  });

  it("① chapter lock committed mid-write → sink 409 LOCKED, nothing written", async () => {
    // Reset state.
    await db.update(manuscriptChapters).set({ locked: false, content: PROSE }).where(eq(manuscriptChapters.id, chapterId));

    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION book_test_sleep_on_chapter_lock() RETURNS trigger AS $$
      BEGIN
        IF NEW.locked AND NOT OLD.locked THEN PERFORM pg_sleep(0.5); END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER book_test_sleep_on_chapter_lock_trigger
        BEFORE UPDATE ON manuscript_chapters
        FOR EACH ROW EXECUTE FUNCTION book_test_sleep_on_chapter_lock();
    `));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.actor = { type: "board", source: "local_implicit", userId: "baily" };
      next();
    });
    app.use(bookStudioLockRoutes(dbRacer));
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message, details: err.details });
    });

    try {
      const lockRace = request(app)
        .patch(`/companies/${companyId}/book-studio/books/${bookId}/chapters/1/lock`)
        .send({ locked: true })
        .then((response) => response);
      const deadline = Date.now() + 5_000;
      let advisoryHeld = false;
      while (Date.now() < deadline) {
        const raw: any = await db.execute(sql`
          SELECT count(*)::int AS count FROM pg_locks
          WHERE locktype = 'advisory' AND granted
        `);
        const rows = Array.isArray(raw) ? raw : (raw?.rows ?? []);
        if (Number(rows[0]?.count ?? 0) > 0) { advisoryHeld = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(advisoryHeld).toBe(true);

      const { persistChapterProse } = await import("../services/book-prose-writer.js");
      const sink = persistChapterProse(db, {
        bookId, bookSlug: "race-novel", chapterNumber: 1, prose: "AI overwrite in flight.",
      }).then(
        () => ({ ok: true as const }),
        (err) => ({ ok: false as const, err }),
      );

      const [lockResponse, outcome] = await Promise.all([lockRace, sink]);
      expect(lockResponse.status).toBe(200);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.err).toMatchObject({ status: 409, details: { code: "LOCKED" } });
      }
      // The lock won: DB says locked, and the prose was NOT overwritten.
      const [row] = await db.select().from(manuscriptChapters).where(eq(manuscriptChapters.id, chapterId));
      expect(row.locked).toBe(true);
      expect(row.content).toBe(PROSE);
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS book_test_sleep_on_chapter_lock_trigger ON manuscript_chapters"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS book_test_sleep_on_chapter_lock()"));
    }
  });

  it("② passage-lock INSERT committed first aborts a concurrent serializable writer (SSI, controlled commit order)", async () => {
    // Reset state.
    await db.update(manuscriptChapters).set({ locked: false, content: PROSE }).where(eq(manuscriptChapters.id, chapterId));
    await db.delete(passageLocks).where(and(eq(passageLocks.bookId, bookId), eq(passageLocks.chapterNumber, 1)));

    // Connection A (the writer): serializable. Reads passage_locks (guard),
    // then writes manuscript_chapters (the clobbering write).
    const connA = createDb(pg.connectionString);
    let aborted = false;
    let commitError: unknown = null;
    await connA.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
      await tx.select().from(passageLocks).where(eq(passageLocks.bookId, bookId));
      await tx.update(manuscriptChapters).set({ content: "Clobbered." }).where(eq(manuscriptChapters.id, chapterId));

      // Connection B (the locker): reads manuscript_chapters (A's write
      // target) AND commits a passage lock into A's read range — completing
      // the rw-antidependency cycle (A read PL ← B wrote PL · A wrote MC ←
      // B read MC). B commits first; A's commit must then abort (40001).
      await dbRacer.transaction(async (txB) => {
        await txB.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
        await txB.select().from(manuscriptChapters).where(eq(manuscriptChapters.id, chapterId));
        await txB.insert(passageLocks).values({
          bookId, companyId, chapterId, chapterNumber: 1,
          spanStart: 0, spanEnd: 19, note: "keep",
        });
      });
      // A commits here (callback return).
    }).then(() => { aborted = false; }, (err) => { aborted = true; commitError = err; });

    expect(aborted).toBe(true);
    const { isSerializationError } = await import("../services/book-locks.js");
    expect(isSerializationError(commitError)).toBe(true);
    // Cleanup for the next test.
    await db.delete(passageLocks).where(and(eq(passageLocks.bookId, bookId), eq(passageLocks.chapterNumber, 1)));
    await db.update(manuscriptChapters).set({ content: PROSE }).where(eq(manuscriptChapters.id, chapterId));
  });

  it("③ committed passage lock → clobbering sink write 409 LOCKED (real DB)", async () => {
    await db.update(manuscriptChapters).set({ locked: false, content: PROSE }).where(eq(manuscriptChapters.id, chapterId));
    await db.delete(passageLocks).where(and(eq(passageLocks.bookId, bookId), eq(passageLocks.chapterNumber, 1)));
    await db.insert(passageLocks).values({
      bookId, companyId, chapterId, chapterNumber: 1, spanStart: 0, spanEnd: 19, note: "keep",
    });

    const { persistChapterProse } = await import("../services/book-prose-writer.js");
    const outcome = await persistChapterProse(db, {
      bookId, bookSlug: "race-novel", chapterNumber: 1,
      prose: "Completely different chapter text — drops the locked span.",
    }).then(() => ({ ok: true as const }), (err) => ({ ok: false as const, err }));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.err).toMatchObject({ status: 409, details: { code: "LOCKED", scope: "passage" } });
    }
    const [row] = await db.select().from(manuscriptChapters).where(eq(manuscriptChapters.id, chapterId));
    expect(row.content).toBe(PROSE);
    const locks = await db.select().from(passageLocks).where(eq(passageLocks.bookId, bookId));
    expect(locks).toHaveLength(1);
    await db.delete(passageLocks).where(eq(passageLocks.bookId, bookId));
  });

  it("④ production passage-lock endpoint serializes with the production prose sink", async () => {
    await db.update(manuscriptChapters).set({ locked: false, content: PROSE }).where(eq(manuscriptChapters.id, chapterId));
    await db.delete(passageLocks).where(and(eq(passageLocks.bookId, bookId), eq(passageLocks.chapterNumber, 1)));

    // Hold the production passage-lock INSERT open after its transaction has
    // acquired the chapter protocol lock. Without the shared protocol the sink
    // reads an empty passage_locks range and commits a clobbering write while
    // this trigger sleeps; with it, the sink waits and then refuses the write.
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION book_test_sleep_on_passage_lock() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_sleep(0.5);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER book_test_sleep_on_passage_lock_trigger
        BEFORE INSERT ON passage_locks
        FOR EACH ROW EXECUTE FUNCTION book_test_sleep_on_passage_lock();
    `));

    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.actor = { type: "board", source: "local_implicit", userId: "baily" };
      next();
    });
    app.use(bookStudioLockRoutes(db));
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status || 500).json({ error: err.message, details: err.details });
    });

    try {
      // Calling `.then` starts Supertest immediately; merely constructing the
      // Test is lazy and would let the sink win before the endpoint begins.
      const lockRequest = request(app)
        .post(`/companies/${companyId}/book-studio/books/${bookId}/chapters/1/passage-locks`)
        .send({ spanStart: 0, spanEnd: 19, note: "keep" })
        .then((response) => response);
      // Do not use a timing guess: wait until PostgreSQL proves the production
      // endpoint owns the transaction-scoped advisory lock.
      const deadline = Date.now() + 5_000;
      let advisoryHeld = false;
      while (Date.now() < deadline) {
        const raw: any = await dbRacer.execute(sql`
          SELECT count(*)::int AS count
          FROM pg_locks
          WHERE locktype = 'advisory' AND granted
        `);
        const rows = Array.isArray(raw) ? raw : (raw?.rows ?? []);
        if (Number(rows[0]?.count ?? 0) > 0) {
          advisoryHeld = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(advisoryHeld).toBe(true);

      const { persistChapterProse } = await import("../services/book-prose-writer.js");
      const sink = persistChapterProse(dbRacer, {
        bookId,
        bookSlug: "race-novel",
        chapterNumber: 1,
        prose: "Completely different chapter text — drops the locked span.",
      }).then(() => ({ ok: true as const }), (err) => ({ ok: false as const, err }));

      const [lockResponse, outcome] = await Promise.all([lockRequest, sink]);
      expect(lockResponse.status).toBe(201);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.err).toMatchObject({ status: 409, details: { code: "LOCKED", scope: "passage" } });
      }
      const [row] = await db.select().from(manuscriptChapters).where(eq(manuscriptChapters.id, chapterId));
      expect(row.content).toBe(PROSE);
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS book_test_sleep_on_passage_lock_trigger ON passage_locks"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS book_test_sleep_on_passage_lock()"));
      await db.delete(passageLocks).where(eq(passageLocks.bookId, bookId));
    }
  });
});
