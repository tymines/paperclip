// Real concurrent Postgres lock/write race coverage (Zeus train review r2).
// Exercises the ACTUAL race against a real database (embedded Postgres with
// all migrations applied) — not a synthesized 40001:
//   ① a chapter lock committed mid-write defeats the sink's conditional write
//   ② a passage lock committed mid-write defeats a clobbering sink write
// Both must surface as 409 LOCKED (predicate failure or serialization abort).
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq, and, sql } from "drizzle-orm";
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

    // Racer: lock the chapter from a separate connection, holding the write
    // open while the sink runs, then commit mid-flight.
    const lockRace = dbRacer.transaction(async (tx) => {
      await tx.update(manuscriptChapters).set({ locked: true }).where(eq(manuscriptChapters.id, chapterId));
      await new Promise((r) => setTimeout(r, 300));
    });

    const { persistChapterProse } = await import("../services/book-prose-writer.js");
    const sink = persistChapterProse(db, {
      bookId, bookSlug: "race-novel", chapterNumber: 1, prose: "AI overwrite in flight.",
    }).then(
      () => ({ ok: true as const }),
      (err) => ({ ok: false as const, err }),
    );

    await lockRace;
    const outcome = await sink;

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.err).toMatchObject({ status: 409, details: { code: "LOCKED" } });
    }
    // The lock won: DB says locked, and the prose was NOT overwritten.
    const [row] = await db.select().from(manuscriptChapters).where(eq(manuscriptChapters.id, chapterId));
    expect(row.locked).toBe(true);
    expect(row.content).toBe(PROSE);
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
});
