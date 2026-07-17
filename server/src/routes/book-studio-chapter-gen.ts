import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { books, storyBibleOutline, manuscriptChapters } from "@paperclipai/db";
import { eq, and, desc } from "drizzle-orm";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { generateChapterDraft, reviseChapterContent, callLLM, streamLLM, BOOK_WRITER_PRIMARY } from "../services/chapter-generator.js";
import { compileChapterContext } from "../services/book-context-compiler.js";
import { persistChapterProse } from "../services/book-prose-writer.js";

export function bookStudioChapterGenRoutes(db: Db) {
  const router = Router();

  // ── POST .../chapters/:chapterNumber/write-prose ─────────────────────
  // The real writer lane: compile the approved bible into a context packet
  // (spec §5) and draft actual chapter PROSE into manuscript_chapters — not
  // outline beats. This is what makes "write a whole book end-to-end" work.
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/chapters/:chapterNumber/write-prose",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params;
        assertCompanyAccess(req, companyId);
        const chapterNumber = Number(req.params.chapterNumber);
        if (!Number.isFinite(chapterNumber) || chapterNumber < 1) throw badRequest("Invalid chapter number");
        const { guidance } = (req.body ?? {}) as { guidance?: string };

        const [book] = await db
          .select({ id: books.id, title: books.title, slug: books.slug })
          .from(books).where(eq(books.id, bookId));
        if (!book) throw notFound("Book not found");

        // Refuse to overwrite a human-locked chapter (invariant §2.2): only a
        // diff proposal may change her text. Here we simply refuse the write.
        const [existing] = await db
          .select().from(manuscriptChapters)
          .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));
        // (human_locked lives in vault frontmatter; DB has no column yet — treat
        // any existing non-empty content as protected unless ?overwrite=1.)
        const overwrite = req.query.overwrite === "1";
        if (existing && existing.content && existing.content.trim().length > 0 && !overwrite) {
          throw badRequest("Chapter already has prose. Pass ?overwrite=1 to redraft (a diff-proposal flow is the safe path for edited text).");
        }

        const ctx = await compileChapterContext(db, bookId, chapterNumber, guidance);

        let prose: string;
        try {
          // Writer lane pinned to Gemini (BOOK_WRITER_PRIMARY); callLLM tries it
          // first and only falls back to DeepSeek/Anthropic if it is unavailable.
          void BOOK_WRITER_PRIMARY;
          prose = await callLLM(ctx.systemPrompt, ctx.userPrompt);
        } catch (err) {
          throw serviceUnavailable(`Writer lane unavailable: ${(err as Error).message}`);
        }
        if (!prose || !prose.trim()) throw serviceUnavailable("Writer returned empty prose — check provider keys (GOOGLE/DeepSeek/Anthropic).");

        // Single source of truth: same persistence as the SSE streaming path.
        const { title } = await persistChapterProse(db, {
          bookId, bookSlug: book.slug, chapterNumber, prose,
        });

        await logActivity(db, {
          companyId, actorType: getActorInfo(req).actorType, actorId: getActorInfo(req).actorId,
          action: "chapter.prose_written",
          entityType: "book", entityId: bookId,
          details: { bookId, chapterNumber, chars: prose.length, usedCharacters: ctx.usedCharacters, hadStyle: ctx.hasStyle, hadBeat: ctx.hasBeat },
        }).catch(() => {});

        res.json({
          chapterNumber, title, content: prose,
          context: { usedCharacters: ctx.usedCharacters, usedLocations: ctx.usedLocations, hadStyle: ctx.hasStyle, hadBeat: ctx.hasBeat },
        });
      } catch (err) { next(err); }
    },
  );

  // ── POST .../chapters/:chapterNumber/write-prose/stream ─────────────
  // SSE token streaming for the writer lane (same conventions as the App Dev
  // design-chat stream in routes/app-dev.ts). Events:
  //   meta  { chapterNumber, providerChain, context }
  //   delta { text }
  //   done  { chapterNumber, title, content, context }   ← persisted result
  //   error { message }                                   ← failures are loud
  // On completion the prose lands via persistChapterProse — the exact same
  // persistence as the non-streaming endpoint (single source of truth). A
  // client disconnect aborts generation and persists NOTHING (no silent
  // partial saves).
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/chapters/:chapterNumber/write-prose/stream",
    async (req, res, next) => {
      const { companyId, bookId } = req.params;
      let headersSent = false;
      try {
        assertCompanyAccess(req, companyId);
        const chapterNumber = Number(req.params.chapterNumber);
        if (!Number.isFinite(chapterNumber) || chapterNumber < 1) throw badRequest("Invalid chapter number");
        const { guidance } = (req.body ?? {}) as { guidance?: string };

        const [book] = await db
          .select({ id: books.id, title: books.title, slug: books.slug })
          .from(books).where(eq(books.id, bookId));
        if (!book) throw notFound("Book not found");

        // Same overwrite guard as the non-streaming path (invariant §2.2).
        const [existing] = await db
          .select().from(manuscriptChapters)
          .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));
        const overwrite = req.query.overwrite === "1";
        if (existing && existing.content && existing.content.trim().length > 0 && !overwrite) {
          throw badRequest("Chapter already has prose. Pass ?overwrite=1 to redraft (a diff-proposal flow is the safe path for edited text).");
        }

        const ctx = await compileChapterContext(db, bookId, chapterNumber, guidance);

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders?.();
        headersSent = true;
        const send = (event: string, data: unknown) => {
          if (!res.writable) return;
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        res.write(":ok\n\n");

        const controller = new AbortController();
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });

        send("meta", {
          chapterNumber,
          providerChain: [BOOK_WRITER_PRIMARY, "deepseek", "anthropic"],
          context: { usedCharacters: ctx.usedCharacters, usedLocations: ctx.usedLocations, hadStyle: ctx.hasStyle, hadBeat: ctx.hasBeat },
        });

        let prose = "";
        try {
          for await (const delta of streamLLM(ctx.systemPrompt, ctx.userPrompt, controller.signal)) {
            prose += delta;
            send("delta", { text: delta });
          }
        } catch (err) {
          if (controller.signal.aborted) {
            // Client cancelled — do NOT persist a partial draft.
            try { res.end(); } catch { /* ignore */ }
            return;
          }
          send("error", { message: String((err as Error)?.message || err).slice(0, 300) });
          res.end();
          return;
        }

        if (controller.signal.aborted) { try { res.end(); } catch { /* ignore */ } return; }
        if (!prose.trim()) {
          send("error", { message: "Writer returned empty prose — check provider keys (GOOGLE/DeepSeek/Anthropic)." });
          res.end();
          return;
        }

        // Persist via the exact same path as the non-streaming endpoint.
        const { title } = await persistChapterProse(db, {
          bookId, bookSlug: book.slug, chapterNumber, prose,
        });

        await logActivity(db, {
          companyId, actorType: getActorInfo(req).actorType, actorId: getActorInfo(req).actorId,
          action: "chapter.prose_written",
          entityType: "book", entityId: bookId,
          details: { bookId, chapterNumber, chars: prose.length, usedCharacters: ctx.usedCharacters, hadStyle: ctx.hasStyle, hadBeat: ctx.hasBeat, streamed: true },
        }).catch(() => {});

        send("done", {
          chapterNumber, title, content: prose,
          context: { usedCharacters: ctx.usedCharacters, usedLocations: ctx.usedLocations, hadStyle: ctx.hasStyle, hadBeat: ctx.hasBeat },
        });
        res.end();
      } catch (err) {
        if (!headersSent) return next(err);
        try {
          res.write(`event: error\n`);
          res.write(`data: ${JSON.stringify({ message: String((err as Error)?.message || err).slice(0, 300) })}\n\n`);
          res.end();
        } catch { /* ignore */ }
      }
    },
  );

  // ── POST .../chapters/:chapterNumber/mark-done ───────────────────────
  // Autonomy dial, Assisted state: marking a chapter done triggers ONE draft
  // for the next outlined chapter, parked for review — it never chains and
  // never advances on its own. Manual: just records the status. Autopilot has
  // its own loop (autopilot-orchestrator). Statuses persist in books.metadata
  // (chapterStatus map) — no new migration needed for the dial.
  router.post(
    "/companies/:companyId/book-studio/books/:bookId/chapters/:chapterNumber/mark-done",
    async (req, res, next) => {
      try {
        const { companyId, bookId } = req.params;
        assertCompanyAccess(req, companyId);
        const chapterNumber = Number(req.params.chapterNumber);
        if (!Number.isFinite(chapterNumber) || chapterNumber < 1) throw badRequest("Invalid chapter number");

        const [book] = await db.select().from(books).where(eq(books.id, bookId));
        if (!book) throw notFound("Book not found");

        const meta = (book.metadata ?? {}) as Record<string, unknown>;
        const autonomyMode = meta.autonomyMode === "assisted" || meta.autonomyMode === "autopilot"
          ? (meta.autonomyMode as string)
          : "manual";
        const chapterStatus = { ...((meta.chapterStatus as Record<string, string>) ?? {}) };
        chapterStatus[String(chapterNumber)] = "done";

        let nextDraft: { chapterNumber: number; title: string; chars: number } | null = null;
        let nextDraftSkipped: string | null = null;
        let nextDraftError: string | null = null;

        if (autonomyMode === "assisted") {
          const nextNumber = chapterNumber + 1;
          const [nextBeat] = await db
            .select({ id: storyBibleOutline.id, title: storyBibleOutline.title })
            .from(storyBibleOutline)
            .where(and(eq(storyBibleOutline.bookId, bookId), eq(storyBibleOutline.chapterNumber, nextNumber)));
          const [nextChapter] = await db
            .select({ id: manuscriptChapters.id, content: manuscriptChapters.content })
            .from(manuscriptChapters)
            .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, nextNumber)));

          if (!nextBeat) {
            nextDraftSkipped = `No outline beat for chapter ${nextNumber} — nothing to draft.`;
          } else if (nextChapter && nextChapter.content && nextChapter.content.trim().length > 0) {
            nextDraftSkipped = `Chapter ${nextNumber} already has prose — assisted mode never overwrites.`;
          } else {
            try {
              const ctx = await compileChapterContext(db, bookId, nextNumber);
              const prose = await callLLM(ctx.systemPrompt, ctx.userPrompt);
              if (!prose || !prose.trim()) throw new Error("Writer returned empty prose");
              const persisted = await persistChapterProse(db, {
                bookId, bookSlug: book.slug, chapterNumber: nextNumber, prose,
              });
              chapterStatus[String(nextNumber)] = "draft-pending-review";
              nextDraft = { chapterNumber: nextNumber, title: persisted.title, chars: prose.length };
            } catch (err) {
              nextDraftError = String((err as Error)?.message || err).slice(0, 300);
            }
          }
        }

        await db
          .update(books)
          .set({ metadata: { ...meta, chapterStatus }, updatedAt: new Date() })
          .where(eq(books.id, bookId));

        const actor = getActorInfo(req);
        await logActivity(db, {
          companyId, actorType: actor.actorType, actorId: actor.actorId,
          agentId: actor.agentId, runId: actor.runId,
          action: "chapter.marked_done",
          entityType: "book", entityId: bookId,
          details: { bookId, chapterNumber, autonomyMode, nextDraft, nextDraftSkipped, nextDraftError },
        }).catch(() => {});

        res.json({
          chapterNumber,
          status: "done",
          autonomyMode,
          chapterStatus,
          nextDraft,
          nextDraftSkipped,
          nextDraftError,
        });
      } catch (err) { next(err); }
    },
  );

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
