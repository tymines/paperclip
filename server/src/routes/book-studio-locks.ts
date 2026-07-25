// Book Studio — LOCK routes (Spec v1 §7).
//   PATCH .../chapters/:n/lock          — human-only lock/unlock (logged)
//   GET    .../chapters/:n/locks        — chapter lock + passage locks (stale-flagged)
//   POST   .../chapters/:n/passage-locks — human-only span lock
//   DELETE .../passage-locks/:lockId     — human-only unlock
// AI write paths do NOT live here — they get 409 LOCKED from book-locks.ts
// enforcement (the AI skips or asks, never clobbers).
import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { books, manuscriptChapters, passageLocks, storyBibleOutline } from "@paperclipai/db";
import { eq, and } from "drizzle-orm";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { chapterContentHash, writeChapterToVault } from "../services/book-prose-writer.js";
import { assertHumanActor, isMissingLocksTable, getPassageLocks } from "../services/book-locks.js";

const PENDING_0159 =
  "passage_locks table pending migration 0159 — passage locks unavailable until it is applied.";

export function bookStudioLockRoutes(db: Db) {
  const router = Router();
  const BASE = "/companies/:companyId/book-studio/books/:bookId";

  // ── PATCH .../chapters/:n/lock — ③ human-only, every change activity-logged.
  // One switch also gates the chapter's outline/beats row (④ locks compose).
  router.patch(`${BASE}/chapters/:chapterNumber/lock`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params;
      assertCompanyAccess(req, companyId);
      const actor = assertHumanActor(req);
      const chapterNumber = Number(req.params.chapterNumber);
      if (!Number.isFinite(chapterNumber) || chapterNumber < 1) throw badRequest("Invalid chapter number");
      const { locked } = (req.body ?? {}) as { locked?: boolean };
      if (typeof locked !== "boolean") throw badRequest("locked (boolean) is required");

      const [book] = await db.select().from(books).where(eq(books.id, bookId));
      if (!book) throw notFound("Book not found");

      // Upsert the manuscript row (a chapter can be locked before it has prose).
      const [existing] = await db
        .select()
        .from(manuscriptChapters)
        .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));
      if (existing) {
        await db
          .update(manuscriptChapters)
          .set({ locked, updatedAt: new Date() })
          .where(eq(manuscriptChapters.id, existing.id));
      } else {
        await db.insert(manuscriptChapters).values({
          id: randomUUID(), bookId, chapterNumber, title: `Chapter ${chapterNumber}`, content: "", locked,
        });
      }

      // ④ The same switch gates the outline/beats row for this chapter.
      await db
        .update(storyBibleOutline)
        .set({ locked, updatedAt: new Date() })
        .where(and(eq(storyBibleOutline.bookId, bookId), eq(storyBibleOutline.chapterNumber, chapterNumber)))
        .catch(() => { /* outline row may not exist */ });

      // Vault frontmatter reflects the lock (best-effort; DB is authoritative).
      // This is the human author's explicit lock/unlock — it MAY clear
      // human_locked (preserveVaultLock: false); every AI write-through can't.
      if (existing && (existing.content ?? "").trim()) {
        writeChapterToVault(book.slug, chapterNumber, existing.title, existing.content, locked, { preserveVaultLock: false });
      }

      await logActivity(db, {
        companyId, actorType: actor.actorType, actorId: actor.actorId,
        agentId: actor.agentId, runId: actor.runId,
        action: locked ? "chapter.locked" : "chapter.unlocked",
        entityType: "book", entityId: bookId,
        details: { bookId, chapterNumber, locked },
      }).catch(() => {});

      res.json({ chapterNumber, locked });
    } catch (err) { next(err); }
  });

  // ── GET .../chapters/:n/locks — lock state for the editor (stale-flagged). ──
  router.get(`${BASE}/chapters/:chapterNumber/locks`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params;
      assertCompanyAccess(req, companyId);
      const chapterNumber = Number(req.params.chapterNumber);
      if (!Number.isFinite(chapterNumber) || chapterNumber < 1) throw badRequest("Invalid chapter number");

      const [chapter] = await db
        .select()
        .from(manuscriptChapters)
        .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));
      const { available, locks } = await getPassageLocks(db, bookId, chapterNumber, chapter?.content ?? "");
      res.json({
        chapterNumber,
        locked: chapter?.locked ?? false,
        passageLocks: locks,
        available,
        ...(available ? {} : { pendingMigration: "0159" }),
      });
    } catch (err) { next(err); }
  });

  // ── POST .../chapters/:n/passage-locks — human-only span lock. ─────────────
  router.post(`${BASE}/chapters/:chapterNumber/passage-locks`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params;
      assertCompanyAccess(req, companyId);
      const actor = assertHumanActor(req);
      const chapterNumber = Number(req.params.chapterNumber);
      if (!Number.isFinite(chapterNumber) || chapterNumber < 1) throw badRequest("Invalid chapter number");
      const { spanStart, spanEnd, note } = (req.body ?? {}) as { spanStart?: number; spanEnd?: number; note?: string };

      const [chapter] = await db
        .select()
        .from(manuscriptChapters)
        .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));
      if (!chapter || !(chapter.content ?? "").trim()) {
        throw badRequest(`Chapter ${chapterNumber} has no prose yet — nothing to lock.`);
      }
      const content = chapter.content ?? "";
      if (typeof spanStart !== "number" || typeof spanEnd !== "number"
        || spanStart < 0 || spanEnd <= spanStart || spanEnd > content.length) {
        throw badRequest(`Invalid span [${spanStart}, ${spanEnd}] for chapter of length ${content.length}`);
      }

      try {
        const [lock] = await db
          .insert(passageLocks)
          .values({
            bookId, companyId,
            chapterId: chapter.id, chapterNumber,
            spanStart, spanEnd,
            contentHash: chapterContentHash(content),
            note: typeof note === "string" ? note.slice(0, 500) : "",
            createdBy: actor.actorId,
          })
          .returning();

        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId,
          agentId: actor.agentId, runId: actor.runId,
          action: "chapter.passage_locked",
          entityType: "book", entityId: bookId,
          details: { bookId, chapterNumber, lockId: lock.id, spanStart, spanEnd },
        }).catch(() => {});

        res.status(201).json({ available: true, lock });
      } catch (err) {
        if (!isMissingLocksTable(err)) throw err;
        throw serviceUnavailable(PENDING_0159);
      }
    } catch (err) { next(err); }
  });

  // ── DELETE .../passage-locks/:lockId — human-only unlock. ──────────────────
  router.delete(`${BASE}/passage-locks/:lockId`, async (req, res, next) => {
    try {
      const { companyId, bookId, lockId } = req.params;
      assertCompanyAccess(req, companyId);
      const actor = assertHumanActor(req);

      try {
        const [existing] = await db
          .select()
          .from(passageLocks)
          .where(and(eq(passageLocks.id, lockId), eq(passageLocks.bookId, bookId)));
        if (!existing) throw notFound("Passage lock not found");
        await db.delete(passageLocks).where(eq(passageLocks.id, lockId));

        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId,
          agentId: actor.agentId, runId: actor.runId,
          action: "chapter.passage_unlocked",
          entityType: "book", entityId: bookId,
          details: { bookId, chapterNumber: existing.chapterNumber, lockId },
        }).catch(() => {});

        res.status(204).send();
      } catch (err) {
        if (!isMissingLocksTable(err)) throw err;
        throw serviceUnavailable(PENDING_0159);
      }
    } catch (err) { next(err); }
  });

  return router;
}
