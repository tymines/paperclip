// Bible auto-extraction + review queue routes (Spec v1 §4.1③, §6.4).
//   POST .../bible-extract                  — critic lane proposes canon from a
//                                             landed chapter into the queue
//   GET  .../bible-review-queue             — list (pending first)
//   POST .../bible-review-queue/:itemId/approve — human-only: the ONLY path
//                                             from extraction into canon
//   POST .../bible-review-queue/:itemId/reject  — human-only
// Nothing is ever silently written or overwritten — extraction only proposes.
import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { books } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { assertHumanActor } from "../services/book-locks.js";
import {
  extractBibleCandidates,
  listBibleQueue,
  approveBibleQueueItem,
  rejectBibleQueueItem,
} from "../services/book-bible-extraction.js";

export function bookStudioBibleExtractionRoutes(db: Db) {
  const router = Router();
  const BASE = "/companies/:companyId/book-studio/books/:bookId";

  router.post(`${BASE}/bible-extract`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      const chapterNumber = Number((req.body ?? {}).chapterNumber);
      if (!Number.isFinite(chapterNumber) || chapterNumber < 1) throw badRequest("chapterNumber is required");
      try {
        const result = await extractBibleCandidates(db, bookId, chapterNumber);
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId, runId: actor.runId,
          action: "bible.extraction_queued", entityType: "book", entityId: bookId,
          details: { bookId, chapterNumber, queued: result.queued, provider: result.provider },
        }).catch(() => {});
        res.status(201).json({ status: "queued", ...result });
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e.status === 404) throw notFound(e.message);
        if (e.status === 400) throw badRequest(e.message ?? "Bad request");
        throw serviceUnavailable(`Critic lane could not extract: ${e.message ?? err}`);
      }
    } catch (err) { next(err); }
  });

  router.get(`${BASE}/bible-review-queue`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      const [book] = await db.select().from(books).where(eq(books.id, bookId));
      if (!book) throw notFound("Book not found");
      const items = listBibleQueue(book);
      res.json({
        items: [...items].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)),
        pendingCount: items.filter((i) => i.status === "pending").length,
      });
    } catch (err) { next(err); }
  });

  router.post(`${BASE}/bible-review-queue/:itemId/approve`, async (req, res, next) => {
    try {
      const { companyId, bookId, itemId } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      const actor = assertHumanActor(req); // §6.2 — only Baily approves canon
      try {
        const item = await approveBibleQueueItem(db, bookId, itemId);
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId,
          action: "bible.extraction_approved", entityType: "book", entityId: bookId,
          details: { bookId, itemId, kind: item.kind, entityType: item.entityType, sourceChapter: item.sourceChapter },
        }).catch(() => {});
        res.json({ item });
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e.status === 404) throw notFound(e.message);
        throw err;
      }
    } catch (err) { next(err); }
  });

  router.post(`${BASE}/bible-review-queue/:itemId/reject`, async (req, res, next) => {
    try {
      const { companyId, bookId, itemId } = req.params as Record<string, string>;
      assertCompanyAccess(req, companyId);
      const actor = assertHumanActor(req);
      try {
        const item = await rejectBibleQueueItem(db, bookId, itemId);
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId,
          action: "bible.extraction_rejected", entityType: "book", entityId: bookId,
          details: { bookId, itemId, kind: item.kind },
        }).catch(() => {});
        res.json({ item });
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e.status === 404) throw notFound(e.message);
        throw err;
      }
    } catch (err) { next(err); }
  });

  return router;
}
