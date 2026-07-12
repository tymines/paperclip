import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { books, storyBibleOutline, manuscriptChapters } from "@paperclipai/db";
import { eq, and, desc } from "drizzle-orm";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { generateChapterDraft, reviseChapterContent, callLLM, BOOK_WRITER_PRIMARY } from "../services/chapter-generator.js";
import { compileChapterContext } from "../services/book-context-compiler.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const BOOK_VAULT_ROOT =
  process.env.BOOK_STUDIO_VAULT_ROOT || "F:\\Augi Vault\\09 - Book Studio\\Books";

function writeChapterToVault(slug: string, chapterNumber: number, title: string, prose: string) {
  try {
    const dir = path.join(BOOK_VAULT_ROOT, slug, "chapters");
    fs.mkdirSync(dir, { recursive: true });
    const pad = String(chapterNumber).padStart(2, "0");
    const fm = `---\nnumber: ${chapterNumber}\ntitle: ${JSON.stringify(title)}\nhuman_locked: false\nupdated: ${new Date().toISOString()}\n---\n\n`;
    fs.writeFileSync(path.join(dir, `ch${pad}.md`), fm + prose, "utf8");
    const vaultDir = path.join(BOOK_VAULT_ROOT, slug);
    try {
      execSync("git add .", { cwd: vaultDir, stdio: "ignore", timeout: 5000 });
      execSync(`git commit -m "draft: ch${pad}"`, { cwd: vaultDir, stdio: "ignore", timeout: 5000 });
    } catch { /* best-effort: skip if not a git repo */ }
  } catch { /* vault write is best-effort; DB is authoritative */ }
}

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

        // Derive a title: first heading line, else keep existing / default.
        const firstLine = prose.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
        const derivedTitle = firstLine.replace(/^#+\s*/, "").slice(0, 120).trim();
        const title = existing?.title?.trim() || derivedTitle || `Chapter ${chapterNumber}`;

        if (existing) {
          await db.update(manuscriptChapters)
            .set({ content: prose, title, updatedAt: new Date() })
            .where(eq(manuscriptChapters.id, existing.id));
        } else {
          await db.insert(manuscriptChapters).values({
            id: randomUUID(), bookId, chapterNumber, title, content: prose,
          });
        }

        writeChapterToVault(book.slug, chapterNumber, title, prose);

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
