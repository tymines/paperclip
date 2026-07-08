import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { books, storyBibleOutline } from "@paperclipai/db";
import { eq, and, desc } from "drizzle-orm";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { generateChapterDraft, reviseChapterContent } from "../services/chapter-generator.js";

export function bookStudioChapterGenRoutes(db: Db) {
  const router = Router();

  // ── POST .../chapters/draft ──────────────────────────────────────────
  // Draft a new chapter with AI-generated content.
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/chapters/draft",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params;
        assertCompanyAccess(req, companyId);

        const { prompt: userPrompt, chapterNumber } = req.body ?? {};

        // Load the book
        const book = await db
          .select({ id: books.id, title: books.title, slug: books.slug })
          .from(books)
          .where(eq(books.id, bookId))
          .then((r) => r[0]);

        if (!book) throw notFound("Book not found");

        // Determine the next chapter number
        const existingChapters = await db
          .select({ chapterNumber: storyBibleOutline.chapterNumber, title: storyBibleOutline.title, beats: storyBibleOutline.beats })
          .from(storyBibleOutline)
          .where(eq(storyBibleOutline.bookId, bookId))
          .orderBy(storyBibleOutline.chapterNumber);

        const nextChapterNumber = chapterNumber && typeof chapterNumber === "number"
          ? chapterNumber
          : (existingChapters.length > 0
            ? Math.max(...existingChapters.map(c => c.chapterNumber)) + 1
            : 1);

        // Get summary of the previous chapter for continuity
        const previousChapter = existingChapters.length > 0
          ? existingChapters[existingChapters.length - 1]
          : null;

        const previousChapterSummary = previousChapter
          ? `"${previousChapter.title}" — ${Array.isArray(previousChapter.beats)
            ? previousChapter.beats.map((b: any) => b.description ?? "").filter(Boolean).join("; ")
            : ""
          }`
          : undefined;

        // Generate chapter content via LLM
        const generated = await generateChapterDraft({
          bookTitle: book.title,
          chapterNumber: nextChapterNumber,
          previousChapterSummary,
          userPrompt,
        });

        // Create the outline entry
        const [inserted] = await db
          .insert(storyBibleOutline)
          .values({
            bookId: book.id,
            chapterNumber: nextChapterNumber,
            title: generated.title,
            beats: generated.beats,
            source: "ai-draft",
            locked: false,
          })
          .returning();

        // Log activity
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "chapter.drafted",
          entityType: "story_bible_chapter",
          entityId: inserted.id,
          details: { bookId, chapterNumber: nextChapterNumber, source: "ai-draft" },
        });

        res.status(201).json({ chapter: inserted });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST .../chapters/:chapterNumber/revise ──────────────────────────
  // Revise an existing chapter's content using AI.
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/chapters/:chapterNumber/revise",
    async (req, res, next) => {
      try {
        const { companyId, bookId, chapterNumber: chapterNumberParam } = req.params;
        assertCompanyAccess(req, companyId);

        const { instruction } = req.body ?? {};
        if (!instruction || typeof instruction !== "string" || instruction.trim().length === 0) {
          throw badRequest("instruction is required");
        }

        const chNum = parseInt(chapterNumberParam, 10);
        if (isNaN(chNum)) throw badRequest("chapterNumber must be a valid integer");

        // Load the book
        const book = await db
          .select({ id: books.id, title: books.title, slug: books.slug })
          .from(books)
          .where(eq(books.id, bookId))
          .then((r) => r[0]);

        if (!book) throw notFound("Book not found");

        // Find the existing chapter by bookId + chapterNumber
        const existing = await db
          .select()
          .from(storyBibleOutline)
          .where(
            and(
              eq(storyBibleOutline.bookId, bookId),
              eq(storyBibleOutline.chapterNumber, chNum),
            ),
          )
          .then((r) => r[0]);

        if (!existing) throw notFound(`Chapter ${chNum} not found`);

        // If chapter is locked, refuse revision
        if (existing.locked) {
          throw badRequest("Chapter is locked and cannot be revised");
        }

        // Generate revised content
        const revised = await reviseChapterContent({
          bookTitle: book.title,
          chapterTitle: existing.title,
          existingBeats: (existing.beats as Record<string, unknown>[]) ?? [],
          revisionInstruction: instruction,
        });

        // Update the outline entry
        const [updated] = await db
          .update(storyBibleOutline)
          .set({
            title: revised.title,
            beats: revised.beats,
            source: "ai-revise",
            updatedAt: new Date(),
          })
          .where(eq(storyBibleOutline.id, existing.id))
          .returning();

        // Log activity
        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "chapter.revised",
          entityType: "story_bible_chapter",
          entityId: updated.id,
          details: { bookId, chapterNumber: chNum, source: "ai-revise" },
        });

        res.json({ chapter: updated });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
