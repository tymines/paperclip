// Book Studio — review workflow routes (Spec v1 §5).
//   POST .../books/:bookId/review              — baseline pass, any mode (§5.A)
//   GET  .../books/:bookId/revisions           — list diff proposals
//   POST .../books/:bookId/revisions           — directed revision job (§5.D/E)
//   POST .../books/:bookId/revisions/:id/accept — Baily commits (the ONLY write)
//   POST .../books/:bookId/revisions/:id/reject — Baily rejects
// The AI writes and checks; Baily critiques, directs, and commits — no AI path
// writes manuscript prose outside an accepted proposal (§5.D invariant).
import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { books, manuscriptChapters, bookRevisions } from "@paperclipai/db";
import { eq, and, desc } from "drizzle-orm";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { callLLM } from "../services/chapter-generator.js";
import { persistChapterProse, chapterContentHash } from "../services/book-prose-writer.js";
import { lockedError, findOverlappingLocks, isMissingLocksTable } from "../services/book-locks.js";
import { runBaselineReview, persistBaselineReport, type BaselineReport } from "../services/book-review.js";

// Gated-migration pattern (same as book_annotations/0151): if 0157 isn't
// applied yet, every revisions endpoint answers honestly instead of crashing.
function isMissingRevisionsTable(err: unknown): boolean {
  const anyErr = err as { code?: string; cause?: { code?: string }; message?: string };
  if (anyErr?.code === "42P01" || anyErr?.cause?.code === "42P01") return true;
  return /relation "book_revisions" does not exist/i.test(String(anyErr?.message ?? ""));
}

const PENDING_0157 =
  "book_revisions table pending migration 0157 — directed revisions unavailable until it is applied.";

type ReviewNote = {
  id: string;
  chapterNumber?: number;
  category: string;
  text: string;
  startOffset?: number;
  endOffset?: number;
  provenance?: string; // baily | ai-critic
  status?: string; // open | resolved
  linkedRevisionId?: string;
  createdAt: string;
  updatedAt: string;
};

const REVISION_SCOPES = ["chapter", "passage", "canon-fix"] as const;

export function bookStudioReviewRoutes(db: Db) {
  const router = Router();
  const BASE = "/companies/:companyId/book-studio/books/:bookId";

  async function loadBook(bookId: string) {
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw notFound("Book not found");
    return book;
  }

  async function loadChapter(bookId: string, chapterNumber: number) {
    const [chapter] = await db
      .select()
      .from(manuscriptChapters)
      .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)));
    return chapter ?? null;
  }

  /** Persist a baseline report, falling back to JSONB notes when 0151/0153 isn't applied. */
  async function persistReport(args: {
    bookId: string; companyId: string; bookSlug: string;
    report: BaselineReport; chapterId: string; content: string;
  }): Promise<{ stored: "annotations" | "review-notes" }> {
    const { bookId, companyId, report, chapterId, content } = args;
    try {
      await persistBaselineReport(db, { bookId, companyId, report, chapterId, content });
      return { stored: "annotations" };
    } catch (err) {
      if (!/relation "(book_annotations|book_review_runs)" does not exist/i.test(String((err as Error)?.message ?? ""))
        && (err as { code?: string })?.code !== "42P01"
        && (err as { cause?: { code?: string } })?.cause?.code !== "42P01") {
        throw err;
      }
      // Fallback: first-class JSONB notes with provenance ai-critic (§5.C).
      const book = await loadBook(bookId);
      const meta = (book.metadata ?? {}) as Record<string, unknown>;
      const notes = (meta.reviewNotes as ReviewNote[]) ?? [];
      const now = new Date().toISOString();
      const newNotes: ReviewNote[] = report.findings.map((f) => {
        const idx = f.excerpt ? content.indexOf(f.excerpt) : -1;
        return {
          id: randomUUID(),
          chapterNumber: report.chapterNumber,
          category: f.category ?? "prose",
          text: f.excerpt && idx < 0
            ? `[unanchored] "${f.excerpt.slice(0, 120)}" — ${f.note}`
            : f.note,
          startOffset: idx >= 0 ? idx : undefined,
          endOffset: idx >= 0 ? idx + (f.excerpt?.length ?? 0) : undefined,
          provenance: "ai-critic",
          status: "open",
          createdAt: now,
          updatedAt: now,
        };
      });
      // A run-level summary note so the verdict is visible in the fallback too.
      newNotes.unshift({
        id: randomUUID(),
        chapterNumber: report.chapterNumber,
        category: "consistency",
        text: `[Baseline ${report.verdict}] ${report.summary}`.slice(0, 500),
        provenance: "ai-critic",
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
      await db
        .update(books)
        .set({ metadata: { ...meta, reviewNotes: [...notes, ...newNotes] }, updatedAt: new Date() })
        .where(eq(books.id, bookId));
      return { stored: "review-notes" };
    }
  }

  /** Record the verdict in books.metadata.chapterStatus (§5.B: pass queues silently, fail = exception). */
  async function recordChapterStatus(bookId: string, chapterNumber: number, verdict: BaselineReport["verdict"]) {
    const book = await loadBook(bookId);
    const meta = (book.metadata ?? {}) as Record<string, unknown>;
    const chapterStatus = { ...((meta.chapterStatus as Record<string, string>) ?? {}) };
    chapterStatus[String(chapterNumber)] = verdict === "PASS" ? "queued" : "exception";
    await db
      .update(books)
      .set({ metadata: { ...meta, chapterStatus }, updatedAt: new Date() })
      .where(eq(books.id, bookId));
  }

  // ── POST .../review — baseline pass, ALWAYS available (§5.A — the old
  // autopilotMode gate is deleted). Scope: this chapter (default) · pick a
  // chapter · whole book (per-chapter passes, one report).
  router.post(`${BASE}/review`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params;
      assertCompanyAccess(req, companyId);
      const { scope, chapterNumber } = (req.body ?? {}) as { scope?: string; chapterNumber?: number };
      const resolvedScope = scope === "book" ? "book" : "chapter";
      if (resolvedScope === "chapter" && (typeof chapterNumber !== "number" || !Number.isFinite(chapterNumber))) {
        throw badRequest("chapterNumber (number) is required for chapter scope");
      }

      const book = await loadBook(bookId);
      const chapters = resolvedScope === "book"
        ? await db.select().from(manuscriptChapters).where(eq(manuscriptChapters.bookId, bookId))
        : [await loadChapter(bookId, chapterNumber!)].filter(Boolean);

      const targets = chapters.filter((c) => (c.content ?? "").trim().length > 0);
      if (targets.length === 0) throw badRequest("No prose to review yet.");

      const reports = [];
      for (const ch of targets) {
        const report = await runBaselineReview(db, { bookId, chapterNumber: ch.chapterNumber });
        const { stored } = await persistReport({
          bookId, companyId, bookSlug: book.slug,
          report, chapterId: ch.id, content: ch.content ?? "",
        });
        await recordChapterStatus(bookId, ch.chapterNumber, report.verdict);
        reports.push({ ...report, stored });
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId, actorType: actor.actorType, actorId: actor.actorId,
        agentId: actor.agentId, runId: actor.runId,
        action: "book.baseline_review",
        entityType: "book", entityId: bookId,
        details: {
          bookId, scope: resolvedScope,
          verdicts: reports.map((r) => ({ chapter: r.chapterNumber, verdict: r.verdict, failures: r.failures })),
        },
      }).catch(() => {});

      res.status(201).json({
        scope: resolvedScope,
        reports,
        exceptions: reports.filter((r) => r.verdict !== "PASS").map((r) => r.chapterNumber),
      });
    } catch (err) { next(err); }
  });

  // ── GET .../revisions?status=pending|accepted|rejected|all ─────────────
  router.get(`${BASE}/revisions`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params;
      assertCompanyAccess(req, companyId);
      const status = typeof req.query.status === "string" ? req.query.status : "pending";
      try {
        const where = status === "all"
          ? eq(bookRevisions.bookId, bookId)
          : and(eq(bookRevisions.bookId, bookId), eq(bookRevisions.status, status));
        const revisions = await db
          .select()
          .from(bookRevisions)
          .where(where)
          .orderBy(desc(bookRevisions.createdAt));
        res.json({ available: true, revisions });
      } catch (err) {
        if (!isMissingRevisionsTable(err)) throw err;
        res.json({ available: false, pendingMigration: "0157", reason: PENDING_0157, revisions: [] });
      }
    } catch (err) { next(err); }
  });

  // ── POST .../revisions — Baily directs; the AI proposes a diff (§5.D/E).
  // Scopes: chapter · passage (offsets) · canon-fix. NEVER writes prose —
  // the proposal parks at status "pending" until Baily accepts.
  router.post(`${BASE}/revisions`, async (req, res, next) => {
    try {
      const { companyId, bookId } = req.params;
      assertCompanyAccess(req, companyId);
      const { chapterNumber, spanStart, spanEnd, instruction, noteId, scope } = (req.body ?? {}) as {
        chapterNumber?: number; spanStart?: number; spanEnd?: number;
        instruction?: string; noteId?: string; scope?: string;
      };
      if (typeof chapterNumber !== "number" || !Number.isFinite(chapterNumber) || chapterNumber < 1) {
        throw badRequest("chapterNumber (number ≥ 1) is required");
      }
      const resolvedScope = REVISION_SCOPES.includes(scope as (typeof REVISION_SCOPES)[number])
        ? (scope as string)
        : (typeof spanStart === "number" && typeof spanEnd === "number" ? "passage" : "chapter");
      if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
        throw badRequest("instruction is required — Baily directs every revision.");
      }

      // Probe table availability BEFORE burning writer tokens.
      try {
        await db.select({ id: bookRevisions.id }).from(bookRevisions).where(eq(bookRevisions.bookId, bookId)).limit(1);
      } catch (err) {
        if (isMissingRevisionsTable(err)) {
          res.status(503).json({ available: false, pendingMigration: "0157", reason: PENDING_0157 });
          return;
        }
        throw err;
      }

      const book = await loadBook(bookId);
      const chapter = await loadChapter(bookId, chapterNumber);
      if (!chapter || !(chapter.content ?? "").trim()) {
        throw badRequest(`Chapter ${chapterNumber} has no prose to revise yet.`);
      }
      const content = chapter.content ?? "";

      const isPassage = resolvedScope === "passage";
      if (isPassage) {
        if (typeof spanStart !== "number" || typeof spanEnd !== "number"
          || spanStart < 0 || spanEnd <= spanStart || spanEnd > content.length) {
          throw badRequest(`Invalid span [${spanStart}, ${spanEnd}] for chapter of length ${content.length}`);
        }
      }

      // Spec v1 §7 ③: a revision aimed at LOCKED content must NOT burn writer
      // tokens — answer with a decision card so Baily chooses how to proceed.
      if (chapter.locked) {
        res.status(200).json({
          status: "needs-decision",
          decisionCard: {
            type: "locked-content",
            chapterNumber,
            message: `Chapter ${chapterNumber} is locked. Unlock it before revising, or apply a one-time unlock.`,
            options: ["keep-locked", "unlock", "one-time-unlock-apply-relock"],
          },
        });
        return;
      }
      if (isPassage) {
        try {
          const overlapping = await findOverlappingLocks(db, bookId, chapterNumber, spanStart!, spanEnd!);
          if (overlapping.length > 0) {
            res.status(200).json({
              status: "needs-decision",
              decisionCard: {
                type: "locked-content",
                chapterNumber,
                passageLocks: overlapping.map((l) => ({ id: l.id, spanStart: l.spanStart, spanEnd: l.spanEnd, note: l.note })),
                message: `This passage overlaps ${overlapping.length} locked passage${overlapping.length > 1 ? "s" : ""}. Remove the lock(s) before revising.`,
                options: ["keep-locked", "unlock"],
              },
            });
            return;
          }
        } catch (err) {
          if (!isMissingLocksTable(err)) throw err; // 0158 pending → no passage locks exist; proceed
        }
      }
      const originalText = isPassage ? content.slice(spanStart!, spanEnd!) : "";

      const canonNote = resolvedScope === "canon-fix"
        ? "This is a CANON-FIX: the revision MUST conform to the story bible — resolve the cited contradiction without introducing new ones."
        : "";
      const systemPrompt = [
        "You are the writer lane for a book studio performing a DIRECTED revision.",
        "The author (Baily) has directed this specific change — follow her instruction exactly and change nothing else.",
        canonNote,
        "Return ONLY valid JSON: { \"revised\": \"the revised text\", \"rationale\": \"one sentence on what changed and why\" }",
        isPassage
          ? "Revise ONLY the quoted passage — your \"revised\" field replaces it verbatim."
          : "Return the FULL revised chapter in \"revised\" — preserve the chapter heading format (## Chapter N: Title).",
      ].filter(Boolean).join("\n");
      const userPrompt = isPassage
        ? `BOOK: ${book.title}\nCHAPTER ${chapterNumber} — PASSAGE TO REVISE:\n«${originalText}»\n\nDIRECTION FROM THE AUTHOR:\n${instruction.trim()}`
        : `BOOK: ${book.title}\nCHAPTER ${chapterNumber} — FULL TEXT:\n${content.slice(0, 24000)}\n\nDIRECTION FROM THE AUTHOR:\n${instruction.trim()}`;

      let revised = "";
      let rationale = "";
      try {
        const raw = await callLLM(systemPrompt, userPrompt, "Book Studio directed revision");
        const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        const parsed = JSON.parse(fence ? fence[1].trim() : raw) as { revised?: string; rationale?: string };
        revised = typeof parsed.revised === "string" ? parsed.revised : "";
        rationale = typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 1000) : "";
      } catch (err) {
        throw serviceUnavailable(`Writer lane could not produce a revision: ${(err as Error).message}`);
      }
      if (!revised.trim()) throw serviceUnavailable("Writer returned an empty revision.");
      if (isPassage && revised.trim() === originalText.trim()) {
        throw badRequest("Writer returned the passage unchanged — nothing to propose.");
      }

      const [revision] = await db
        .insert(bookRevisions)
        .values({
          bookId,
          companyId,
          chapterId: chapter.id,
          chapterNumber,
          scope: resolvedScope,
          spanStart: isPassage ? spanStart! : null,
          spanEnd: isPassage ? spanEnd! : null,
          instruction: instruction.trim(),
          sourceNoteId: typeof noteId === "string" && noteId.trim() ? noteId.trim() : null,
          originalText,
          proposedText: revised,
          rationale,
          contentHash: chapterContentHash(content),
          model: "auto (gemini→deepseek→anthropic)",
          status: "pending",
        })
        .returning();

      // Send-to-revision (§5.E): link the originating note to this job.
      if (revision.sourceNoteId) {
        const meta = (book.metadata ?? {}) as Record<string, unknown>;
        const notes = (meta.reviewNotes as ReviewNote[]) ?? [];
        const idx = notes.findIndex((n) => n.id === revision.sourceNoteId);
        if (idx >= 0) {
          notes[idx] = { ...notes[idx], linkedRevisionId: revision.id, updatedAt: new Date().toISOString() };
          await db.update(books).set({ metadata: { ...meta, reviewNotes: notes }, updatedAt: new Date() }).where(eq(books.id, bookId));
        }
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId, actorType: actor.actorType, actorId: actor.actorId,
        agentId: actor.agentId, runId: actor.runId,
        action: "book.revision_proposed",
        entityType: "book", entityId: bookId,
        details: { bookId, chapterNumber, revisionId: revision.id, scope: resolvedScope, sourceNoteId: revision.sourceNoteId },
      }).catch(() => {});

      res.status(201).json({ available: true, revision });
    } catch (err) { next(err); }
  });

  // ── POST .../revisions/:revisionId/accept — Baily commits. The ONLY path
  // that turns a proposal into manuscript prose: re-checks the content hash
  // (TOCTOU — a stale proposal can never clobber newer edits), writes through
  // persistChapterProse (the shared prose path), and activity-logs the commit.
  router.post(`${BASE}/revisions/:revisionId/accept`, async (req, res, next) => {
    try {
      const { companyId, bookId, revisionId } = req.params;
      assertCompanyAccess(req, companyId);

      let revision: typeof bookRevisions.$inferSelect | undefined;
      try {
        [revision] = await db
          .select()
          .from(bookRevisions)
          .where(and(eq(bookRevisions.id, revisionId), eq(bookRevisions.bookId, bookId)));
      } catch (err) {
        if (isMissingRevisionsTable(err)) throw serviceUnavailable(PENDING_0157);
        throw err;
      }
      if (!revision) throw notFound("Revision not found");
      if (revision.status !== "pending") throw conflict(`Revision is already ${revision.status}.`);

      const book = await loadBook(bookId);
      const chapter = await loadChapter(bookId, revision.chapterNumber);
      const content = chapter?.content ?? "";

      // Spec v1 §7: locks are re-checked at COMMIT time, not just proposal
      // time — content locked after the proposal was computed still wins.
      if (chapter?.locked) {
        throw lockedError("chapter", `Chapter ${revision.chapterNumber} is locked — unlock it before accepting a revision.`);
      }
      if (revision.scope === "passage" && chapter) {
        try {
          const overlapping = await findOverlappingLocks(db, bookId, revision.chapterNumber, revision.spanStart ?? -1, revision.spanEnd ?? -1);
          if (overlapping.length > 0) {
            throw lockedError("passage", `This revision overlaps ${overlapping.length} locked passage${overlapping.length > 1 ? "s" : ""} — remove the lock(s) first.`);
          }
        } catch (err) {
          if (!isMissingLocksTable(err)) throw err;
        }
      }

      if (chapterContentHash(content) !== revision.contentHash) {
        throw conflict("Chapter changed since this proposal was computed — re-run the revision.", { code: "STALE_PROPOSAL" });
      }

      let newContent: string;
      if (revision.scope === "passage") {
        const s = revision.spanStart ?? -1;
        const e = revision.spanEnd ?? -1;
        if (s < 0 || e <= s || e > content.length || content.slice(s, e) !== revision.originalText) {
          throw conflict("Passage no longer matches the proposal — re-run the revision.", { code: "STALE_PROPOSAL" });
        }
        newContent = content.slice(0, s) + revision.proposedText + content.slice(e);
      } else {
        newContent = revision.proposedText;
      }

      const { title } = await persistChapterProse(db, {
        bookId, bookSlug: book.slug, chapterNumber: revision.chapterNumber, prose: newContent,
      });

      const [updated] = await db
        .update(bookRevisions)
        .set({ status: "accepted", resolvedAt: new Date() })
        .where(eq(bookRevisions.id, revision.id))
        .returning();

      // Resolve the originating critique note (§5.C status lifecycle).
      if (revision.sourceNoteId) {
        const meta = (book.metadata ?? {}) as Record<string, unknown>;
        const notes = (meta.reviewNotes as ReviewNote[]) ?? [];
        const idx = notes.findIndex((n) => n.id === revision!.sourceNoteId);
        if (idx >= 0) {
          notes[idx] = { ...notes[idx], status: "resolved", updatedAt: new Date().toISOString() };
          await db.update(books).set({ metadata: { ...meta, reviewNotes: notes }, updatedAt: new Date() }).where(eq(books.id, bookId));
        }
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId, actorType: actor.actorType, actorId: actor.actorId,
        agentId: actor.agentId, runId: actor.runId,
        action: "book.revision_accepted",
        entityType: "book", entityId: bookId,
        details: { bookId, chapterNumber: revision.chapterNumber, revisionId: revision.id, scope: revision.scope, title },
      }).catch(() => {});

      res.json({ available: true, revision: updated, chapterNumber: revision.chapterNumber, title, content: newContent });
    } catch (err) { next(err); }
  });

  // ── POST .../revisions/:revisionId/reject — Baily rejects; the chapter
  // holds, nothing is written, ever.
  router.post(`${BASE}/revisions/:revisionId/reject`, async (req, res, next) => {
    try {
      const { companyId, bookId, revisionId } = req.params;
      assertCompanyAccess(req, companyId);

      let updated: typeof bookRevisions.$inferSelect | undefined;
      try {
        const [existing] = await db
          .select()
          .from(bookRevisions)
          .where(and(eq(bookRevisions.id, revisionId), eq(bookRevisions.bookId, bookId)));
        if (!existing) throw notFound("Revision not found");
        if (existing.status !== "pending") throw conflict(`Revision is already ${existing.status}.`);
        [updated] = await db
          .update(bookRevisions)
          .set({ status: "rejected", resolvedAt: new Date() })
          .where(eq(bookRevisions.id, existing.id))
          .returning();
      } catch (err) {
        if (isMissingRevisionsTable(err)) throw serviceUnavailable(PENDING_0157);
        throw err;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId, actorType: actor.actorType, actorId: actor.actorId,
        agentId: actor.agentId, runId: actor.runId,
        action: "book.revision_rejected",
        entityType: "book", entityId: bookId,
        details: { bookId, chapterNumber: updated!.chapterNumber, revisionId },
      }).catch(() => {});

      res.json({ available: true, revision: updated });
    } catch (err) { next(err); }
  });

  return router;
}
