import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  books,
  storyBibleCharacters,
  storyBibleWorldLocations,
  storyBibleStyle,
  storyBibleOutline,
  storyBibleChatMessages,
  manuscriptChapters,
  bookAnnotations,
  bookReviewRuns,
  creativeJobs,
} from "@paperclipai/db";
import {
  createStoryBibleCharacterSchema,
  updateStoryBibleCharacterSchema,
  createStoryBibleWorldLocationSchema,
  updateStoryBibleWorldLocationSchema,
  createStoryBibleStyleSchema,
  updateStoryBibleStyleSchema,
  createStoryBibleOutlineSchema,
  updateStoryBibleOutlineSchema,
  sendChatMessageSchema,
  toDraftQuerySchema,
} from "@paperclipai/shared";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { execSync } from "node:child_process";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { buildSystemPrompt, normalizeBrainstormTurns } from "../services/brainstorm-chat.js";
import {
  applyBookChatAuthorizationInTransaction,
  deriveBookChatAuthorization,
  resolveBookChatAuthorization,
  type BookChatActionResult,
  type BookChatAuthorization,
} from "../services/book-chat-actions.js";
import { callAgentLane, AgentLaneUnavailableError } from "../services/book-agent-lanes.js";
import { callLLM } from "../services/chapter-generator.js";
import { chapterContentHash } from "../services/book-prose-writer.js";
import {
  acquireChapterMutationLock,
  assertHumanActor,
  lockedError,
  assertProsePersistAllowed,
  isSerializationError,
} from "../services/book-locks.js";

const VAULT_ROOT =
  process.env.BOOK_STUDIO_VAULT_ROOT ||
  "F:\\Augi Vault\\09 - Book Studio\\Books";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function gitCommitVault(bookSlug: string, message: string) {
  try {
    const vaultDir = path.join(VAULT_ROOT, bookSlug);
    execSync("git add .", { cwd: vaultDir, stdio: "ignore", timeout: 5000 });
    execSync(`git commit -m "${message.replace(/"/g, "\\\"")}"`, {
      cwd: vaultDir,
      stdio: "ignore",
      timeout: 5000,
    });
  } catch {
    // Git operations are best-effort — if the vault isn't a git repo, skip
  }
}

function vaultEntityDir(bookSlug: string, entityType: string): string {
  return path.join(VAULT_ROOT, bookSlug, "bible", entityType);
}

function buildFrontmatter(data: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      lines.push(`${k}: "${v.replace(/"/g, '\\"')}"`);
    } else if (typeof v === "boolean" || typeof v === "number") {
      lines.push(`${k}: ${v}`);
    } else if (Array.isArray(v) || typeof v === "object") {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function writeVaultFile(
  bookSlug: string,
  entityType: string,
  entityName: string,
  frontmatter: Record<string, unknown>,
  body = "",
) {
  const dir = vaultEntityDir(bookSlug, entityType);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const safeName = slugify(entityName) || "untitled";
  const content = buildFrontmatter(frontmatter) + "\n" + body;
  writeFileSync(path.join(dir, `${safeName}.md`), content, "utf-8");
}

function deleteVaultFile(bookSlug: string, entityType: string, entityName: string) {
  const dir = vaultEntityDir(bookSlug, entityType);
  const safeName = slugify(entityName) || "untitled";
  const filePath = path.join(dir, `${safeName}.md`);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
}

async function requireCompanyBook(db: Db, companyId: string, bookId: string) {
  const [book] = await db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.companyId, companyId)))
    .limit(1);
  if (!book) throw notFound("Book not found");
  return book;
}

export async function persistBrainstormCompletion(db: Db, args: {
  companyId: string;
  bookId: string;
  turnId: string;
  userMessageId: string;
  actor: ReturnType<typeof getActorInfo>;
  authorization: BookChatAuthorization | null;
  reply: string;
  conversationId: string;
  delegationId?: string;
}): Promise<{ reply: string; actionResult?: BookChatActionResult; assistantMessageId: string }> {
  const persistRows = async (tx: Db, reply: string, actionResult?: BookChatActionResult) => {
    const [assistantMsg] = await tx.insert(storyBibleChatMessages).values({
      bookId: args.bookId,
      turnId: args.turnId,
      role: "assistant",
      content: reply,
      status: "completed",
      via: "calliope",
      delegationId: args.delegationId ?? null,
      conversationId: args.conversationId,
      actionResult: actionResult ?? null,
    }).returning({ id: storyBibleChatMessages.id });
    const completed = await tx.update(storyBibleChatMessages).set({
      status: "completed",
      via: "calliope",
      delegationId: args.delegationId ?? null,
      error: null,
      actionResult: actionResult ?? null,
    }).where(and(
      eq(storyBibleChatMessages.id, args.userMessageId),
      eq(storyBibleChatMessages.bookId, args.bookId),
      eq(storyBibleChatMessages.status, "pending"),
    )).returning({ id: storyBibleChatMessages.id });
    if (completed.length !== 1) throw new Error("Chat turn is no longer pending; no duplicate completion was stored.");
    return { reply, actionResult, assistantMessageId: assistantMsg.id };
  };

  if (!args.authorization) {
    return db.transaction(async (tx) => persistRows(tx as unknown as Db, args.reply));
  }

  try {
    return await db.transaction(async (tx) => {
      const scopedTx = tx as unknown as Db;
      const actionResult = await applyBookChatAuthorizationInTransaction(scopedTx, {
        companyId: args.companyId,
        bookId: args.bookId,
        turnId: args.turnId,
        actor: args.actor,
        authorization: args.authorization!,
      });
      const reply = `${args.reply}\n\nSaved to ${actionResult.destination}.`;
      return persistRows(scopedTx, reply, actionResult);
    });
  } catch (err) {
    const actionResult: BookChatActionResult = {
      operation: args.authorization.operation,
      section: args.authorization.destination,
      destination: args.authorization.destination,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
    const reply = `${args.reply}\n\nNothing changed. ${actionResult.error}`;
    return db.transaction(async (tx) => persistRows(tx as unknown as Db, reply, actionResult));
  }
}

// ── Helper: create entity routes ─────────────────────────────────────────────

interface EntityRouteConfig {
  table: any;
  entityType: string;       // plural path segment (e.g. "characters", "style")
  entityLabel: string;      // human label (e.g. "Character", "Style Entry")
  responseKey: string;      // singular response key (e.g. "character", "style-entry")
  createSchema: any;
  updateSchema: any;
}

function entityRoutes(
  db: Db,
  cfg: EntityRouteConfig,
) {
  const { table, entityType, entityLabel, responseKey, createSchema, updateSchema } = cfg;
  const router = Router({ mergeParams: true });

  // GET list
  router.get("/", async (req, res) => {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);
    await requireCompanyBook(db, companyId, bookId);

    const rows = await db
      .select()
      .from(table)
      .where(eq(table.bookId, bookId));

    res.json({ [entityType]: rows });
  });

  // POST create
  router.post("/", async (req, res) => {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);
    await requireCompanyBook(db, companyId, bookId);

    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest(parsed.error.message);
    }

    const data = parsed.data;
    const [inserted] = await db
      .insert(table)
      .values({
        ...data,
        bookId,
      })
      .returning();

    // Vault write-through
    try {
      const book = await db
        .select()
        .from(books)
        .where(eq(books.id, bookId))
        .then((r) => r[0]);

      if (book) {
        const frontmatter = {
          id: inserted.id,
          book_id: bookId,
          ...data,
          created_at: inserted.createdAt?.toISOString?.() ?? new Date().toISOString(),
          updated_at: inserted.updatedAt?.toISOString?.() ?? new Date().toISOString(),
        };
        writeVaultFile(book.slug, entityType, data.name || data.title || entityLabel, frontmatter);
        gitCommitVault(book.slug, `Add ${entityLabel}: ${data.name || data.title || entityLabel}`);
      }
    } catch (err) {
      console.error(`${entityLabel} vault write-through failed:`, err);
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: `bible.${entityType}.created`,
      entityType: `bible_${entityType}`,
      entityId: inserted.id,
      details: { bookId },
    });

    res.status(201).json({ [responseKey]: inserted });
  });

  // PATCH update
  router.patch("/:id", async (req, res) => {
    const { companyId, bookId, id } = req.params as { companyId: string; bookId: string; id: string };
    assertCompanyAccess(req, companyId);
    await requireCompanyBook(db, companyId, bookId);

    const parsed = updateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest(parsed.error.message);
    }

    const existing = await db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.bookId, bookId)))
      .then((r) => r[0]);

    if (!existing) {
      throw notFound(`${entityLabel} not found`);
    }

    // Spec v1 §7 ④: bible-entry locks are human-only. Toggling `locked`
    // requires a human actor, and a locked entry refuses AI edits outright.
    const patchData = parsed.data as Record<string, unknown>;
    if ("locked" in patchData) {
      assertHumanActor(req);
    }
    const actorInfo = getActorInfo(req);
    if ((existing as Record<string, unknown>).locked === true && actorInfo.actorType !== "user" && !("locked" in patchData)) {
      throw lockedError("bible-entry", `${entityLabel} is locked — AI edits refused. A human must unlock it first.`);
    }

    const [updated] = await db
      .update(table)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(table.id, id))
      .returning();

    // Vault write-through
    try {
      const book = await db
        .select()
        .from(books)
        .where(eq(books.id, bookId))
        .then((r) => r[0]);

      if (book) {
        const merged = { ...existing, ...parsed.data };
        const frontmatter = {
          id: updated.id,
          book_id: bookId,
          ...merged,
          created_at: existing.createdAt?.toISOString?.() ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        writeVaultFile(book.slug, entityType, merged.name || merged.title || entityLabel, frontmatter);
        gitCommitVault(book.slug, `Update ${entityLabel}: ${merged.name || merged.title || entityLabel}`);
      }
    } catch (err) {
      console.error(`${entityLabel} vault write-through failed:`, err);
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: `bible.${entityType}.updated`,
      entityType: `bible_${entityType}`,
      entityId: updated.id,
      details: { bookId },
    });

    res.json({ [responseKey]: updated });
  });

  // DELETE
  router.delete("/:id", async (req, res) => {
    const { companyId, bookId, id } = req.params as { companyId: string; bookId: string; id: string };
    assertCompanyAccess(req, companyId);
    await requireCompanyBook(db, companyId, bookId);

    const existing = await db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.bookId, bookId)))
      .then((r) => r[0]);

    if (!existing) {
      throw notFound(`${entityLabel} not found`);
    }

    // Spec v1 §7 ④: a LOCKED bible entry refuses AI deletion — only the human
    // author may delete locked canon (and her delete is activity-logged below).
    const deleteActor = getActorInfo(req);
    if ((existing as Record<string, unknown>).locked === true && deleteActor.actorType !== "user") {
      throw lockedError("bible-entry", `${entityLabel} is locked — AI deletion refused. A human must unlock it first.`);
    }

    // Atomic for AI actors: the lock predicate rides on the DELETE itself —
    // a lock set between the read above and this statement yields 0 rows → 409.
    if (deleteActor.actorType !== "user") {
      const deleted = await db.delete(table).where(and(eq(table.id, id), eq(table.locked, false))).returning({ id: table.id });
      if (deleted.length === 0) {
        throw lockedError("bible-entry", `${entityLabel} was locked while deleting — nothing was removed.`);
      }
    } else {
      await db.delete(table).where(eq(table.id, id));
    }

    // Vault delete
    try {
      const book = await db
        .select()
        .from(books)
        .where(eq(books.id, bookId))
        .then((r) => r[0]);

      if (book) {
        deleteVaultFile(book.slug, entityType, existing.name || existing.title || entityLabel);
        gitCommitVault(book.slug, `Delete ${entityLabel}: ${existing.name || existing.title || entityLabel}`);
      }
    } catch (err) {
      console.error(`${entityLabel} vault delete failed:`, err);
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: `bible.${entityType}.deleted`,
      entityType: `bible_${entityType}`,
      entityId: id,
      details: { bookId },
    });

    res.status(204).send();
  });

  return router;
}

// ── Main route builder ───────────────────────────────────────────────────────

export function bookStudioRoutes(db: Db) {
  const router = Router();

  // ── Books (existing) ──────────────────────────────────────────────────

  // GET /api/companies/:cid/book-studio/books
  router.get("/companies/:companyId/book-studio/books", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const rows = await db
      .select()
      .from(books)
      .where(eq(books.companyId, companyId))
      .orderBy(books.createdAt);

    res.json({ books: rows });
  });

  // POST /api/companies/:cid/book-studio/books
  router.post("/companies/:companyId/book-studio/books", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);

    const { title, slug: explicitSlug, metadata } = req.body ?? {};

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      throw badRequest("title is required");
    }

    const slug = explicitSlug && typeof explicitSlug === "string"
      ? slugify(explicitSlug)
      : slugify(title);

    if (!slug) {
      throw badRequest("Could not generate a valid slug from the title");
    }

    const [inserted] = await db
      .insert(books)
      .values({
        companyId,
        slug,
        title: title.trim(),
        metadata: (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>,
      })
      .returning();

    // Vault write-through
    try {
      const dir = path.join(VAULT_ROOT, inserted.slug);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const frontmatter = [
        "---",
        `id: "${inserted.id}"`,
        `title: "${inserted.title}"`,
        `slug: "${inserted.slug}"`,
        `company_id: "${inserted.companyId}"`,
        `created_at: "${inserted.createdAt.toISOString()}"`,
        `updated_at: "${inserted.updatedAt.toISOString()}"`,
        ...Object.entries(inserted.metadata).map(
          ([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`,
        ),
        "---",
      ].join("\n");

      const body = `\n# ${inserted.title}\n\n<!-- Start writing your book here -->\n\n`;
      writeFileSync(path.join(dir, "book.md"), frontmatter + body, "utf-8");
    } catch (err) {
      console.error("Book vault write-through failed:", err);
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "book.created",
      entityType: "book",
      entityId: inserted.id,
      details: { title: inserted.title, slug: inserted.slug },
    });

    res.status(201).json({ book: inserted });
  });

  // PATCH /api/companies/:cid/book-studio/books/:bookId — update book metadata
  router.patch("/companies/:companyId/book-studio/books/:bookId", async (req, res) => {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);

    const existing = await requireCompanyBook(db, companyId, bookId);
    const { title, metadata } = req.body ?? {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title !== undefined) {
      if (typeof title !== "string" || !title.trim()) throw badRequest("title cannot be empty");
      updates.title = title.trim();
    }
    if (typeof metadata === "object" && metadata !== null) {
      // ponytail: shallow-merge metadata to preserve reviewNotes etc.
      updates.metadata = { ...(existing.metadata as Record<string, unknown>), ...(metadata as Record<string, unknown>) };
    }

    if (!updates.title && !updates.metadata) throw badRequest("title or metadata required");

    const [updated] = await db
      .update(books)
      .set(updates)
      .where(and(eq(books.id, bookId), eq(books.companyId, companyId)))
      .returning();

    if (!updated) throw notFound("Book not found");

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: updates.title ? "book.renamed" : "book.updated",
      entityType: "book",
      entityId: updated.id,
      details: {
        ...(updates.title ? { previousTitle: existing.title, title: updated.title } : {}),
        metadataKeys: metadata && typeof metadata === "object" ? Object.keys(metadata) : [],
      },
    });

    res.json({ book: updated });
  });

  // DELETE /api/companies/:cid/book-studio/books/:bookId — delete a book and
  // ALL its DB children (Tyler, 2026-07-12: "need to be able to delete books").
  // bible entities / chapters / annotations / exports / chat cascade via FK
  // (onDelete: cascade); creative_jobs.book_id has NO cascade, so its rows are
  // deleted explicitly first. Vault markdown files are NEVER touched — they
  // remain on disk as an archive.
  router.delete("/companies/:companyId/book-studio/books/:bookId", async (req, res) => {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);

    const [book] = await db
      .select()
      .from(books)
      .where(and(eq(books.id, bookId), eq(books.companyId, companyId)))
      .limit(1);
    if (!book) throw notFound("Book not found");

    // creative_jobs.book_id has no ON DELETE — clear the book's media jobs first.
    await db.delete(creativeJobs).where(eq(creativeJobs.bookId, bookId));
    // Everything else (bible, chapters, annotations, exports, chat) cascades.
    await db.delete(books).where(eq(books.id, bookId));

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId, actorType: actor.actorType, actorId: actor.actorId,
      action: "book.deleted",
      entityType: "book", entityId: bookId,
      details: { title: book.title, slug: book.slug },
    }).catch(() => {});

    res.json({
      deleted: true, id: bookId, title: book.title,
      note: "Database records removed. Vault markdown files remain on disk as archive.",
    });
  });

  // ── Story Bible Entity CRUD (nested under /companies/:cid/book-studio/books/:bookId) ──

  const bookBibleRouter = Router({ mergeParams: true });

  bookBibleRouter.use(
    "/characters",
    entityRoutes(db, {
      table: storyBibleCharacters,
      entityType: "characters",
      entityLabel: "Character",
      responseKey: "character",
      createSchema: createStoryBibleCharacterSchema,
      updateSchema: updateStoryBibleCharacterSchema,
    }),
  );
  bookBibleRouter.use(
    "/world-locations",
    entityRoutes(db, {
      table: storyBibleWorldLocations,
      entityType: "world-locations",
      entityLabel: "World Location",
      responseKey: "world-location",
      createSchema: createStoryBibleWorldLocationSchema,
      updateSchema: updateStoryBibleWorldLocationSchema,
    }),
  );
  bookBibleRouter.use(
    "/style",
    entityRoutes(db, {
      table: storyBibleStyle,
      entityType: "style",
      entityLabel: "Style Entry",
      responseKey: "style-entry",
      createSchema: createStoryBibleStyleSchema,
      updateSchema: updateStoryBibleStyleSchema,
    }),
  );
  bookBibleRouter.use(
    "/outline",
    entityRoutes(db, {
      table: storyBibleOutline,
      entityType: "outline",
      entityLabel: "Outline Entry",
      responseKey: "outline-entry",
      createSchema: createStoryBibleOutlineSchema,
      updateSchema: updateStoryBibleOutlineSchema,
    }),
  );

  // ── Manuscript Chapters (upsert by chapterNumber) ────────────────────

  bookBibleRouter.get("/chapters", async (req, res) => {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);

    const rows = await db
      .select()
      .from(manuscriptChapters)
      .where(eq(manuscriptChapters.bookId, bookId))
      .orderBy(desc(manuscriptChapters.chapterNumber));

    res.json({ chapters: rows });
  });

  // ponytail: upsert by (bookId, chapterNumber) — no separate create endpoint needed
  bookBibleRouter.patch("/chapters/:chapterNumber", async (req, res) => {
    const { companyId, bookId, chapterNumber } = req.params as { companyId: string; bookId: string; chapterNumber: string };
    assertCompanyAccess(req, companyId);

    const chNum = parseInt(chapterNumber, 10);
    if (isNaN(chNum)) throw badRequest("chapterNumber must be an integer");

    const { title, content } = (req.body ?? {}) as { title?: string; content?: string };
    const patchActor = getActorInfo(req);

    // Spec v1 §7, ATOMIC (Zeus train r2): the guard (chapter DB lock + vault
    // human_locked + passage locks) and the mutation run under the shared
    // chapter advisory-lock protocol — for BOTH update and insert paths. A
    // lock setter that starts first commits before this writer reads state; a
    // chapter lock then fails the guard/predicate (409). The human
    // author's own edits always land (she owns the text).
    let result: { chapter: Record<string, unknown>; created: boolean };
    try {
      result = await db.transaction(async (tx) => {
        await acquireChapterMutationLock(tx as unknown as Db, bookId, chNum);
        const [existing] = await tx
          .select()
          .from(manuscriptChapters)
          .where(and(
            eq(manuscriptChapters.bookId, bookId),
            eq(manuscriptChapters.chapterNumber, chNum),
          ));

        if (patchActor.actorType !== "user") {
          const [bookRow] = await tx.select({ slug: books.slug }).from(books).where(eq(books.id, bookId));
          await assertProsePersistAllowed(tx as unknown as typeof db, {
            bookId,
            bookSlug: bookRow?.slug ?? "",
            chapterNumber: chNum,
            prose: content ?? existing?.content ?? "",
            existingContent: existing?.content ?? "",
            existingLocked: existing?.locked ?? false,
          });
        }

        if (existing) {
          const setValues = { title: title ?? existing.title, content: content ?? existing.content, updatedAt: new Date() };
          const [updated] = patchActor.actorType !== "user"
            ? await tx
                .update(manuscriptChapters)
                .set(setValues)
                .where(and(eq(manuscriptChapters.id, existing.id), eq(manuscriptChapters.locked, false)))
                .returning()
            : await tx
                .update(manuscriptChapters)
                .set(setValues)
                .where(eq(manuscriptChapters.id, existing.id))
                .returning();
          if (!updated) throw lockedError("chapter", `Chapter ${chNum} was locked while writing — nothing was saved.`);
          return { chapter: updated, created: false };
        }

        const id = randomUUID();
        const [inserted] = await tx
          .insert(manuscriptChapters)
          .values({ id, bookId, chapterNumber: chNum, title: title || "", content: content || "" })
          .returning();
        return { chapter: inserted, created: true };
      });
    } catch (err) {
      if (isSerializationError(err)) {
        throw lockedError("chapter", `Chapter ${chNum}'s locks changed while writing — nothing was saved.`);
      }
      throw err;
    }

    if (result.created) {
      res.status(201).json({ chapter: result.chapter });
    } else {
      res.json({ chapter: result.chapter });
    }
  });

  // ── Suggest Next (Assisted Mode) ──────────────────────────────────────

bookBibleRouter.post("/suggest-next", async (req, res) => {
  try {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);

    const book = await db.select().from(books).where(eq(books.id, bookId)).then(r => r[0]);
    if (!book || book.companyId !== companyId) throw notFound("Book not found");

    const [chars, locs, styles, outlines, chapters] = await Promise.all([
      db.select().from(storyBibleCharacters).where(eq(storyBibleCharacters.bookId, bookId)),
      db.select().from(storyBibleWorldLocations).where(eq(storyBibleWorldLocations.bookId, bookId)),
      db.select().from(storyBibleStyle).where(eq(storyBibleStyle.bookId, bookId)),
      db.select().from(storyBibleOutline).where(eq(storyBibleOutline.bookId, bookId)),
      db.select().from(manuscriptChapters).where(eq(manuscriptChapters.bookId, bookId)),
    ]);

    const summary = {
      title: book.title,
      characters: chars.map(c => `${c.name} (${c.role})`),
      locations: locs.map(l => l.name),
      styleEntries: styles.length,
      outlineChapters: outlines.map(o => `Ch.${o.chapterNumber}: ${o.title}`),
      manuscriptChapters: chapters.map(c => `Ch.${c.chapterNumber}: ${c.title}`),
    };

    const prompt = [
      `You are a creative writing assistant helping with the book "${summary.title}".`,
      "",
      "CURRENT BIBLE STATE:",
      `Characters (${chars.length}): ${summary.characters.join(", ") || "(none)"}`,
      `Locations (${locs.length}): ${summary.locations.join(", ") || "(none)"}`,
      `Style entries: ${styles.length}`,
      `Outline chapters: ${summary.outlineChapters.join(", ") || "(none)"}`,
      `Manuscript chapters: ${summary.manuscriptChapters.join(", ") || "(none)"}`,
      "",
      "Analyze the bible state and suggest the SINGLE most impactful next action. Return JSON:",
      "{",
      '  "action": "add_character" | "add_location" | "expand_chapter" | "add_style" | "add_outline",',
      '  "entityType": "character" | "world-location" | "style" | "outline",',
      '  "reason": "one-sentence explanation of why this is the best next move",',
      '  "suggestedData": {',
      '    "name": "suggested name if adding entity",',
      '    "role": "suggested role if character",',
      '    "description": "suggested description",',
      '    "chapterNumber": 0,',
      '    "title": "chapter title if outline"',
      '  }',
      "}",
    ].join("\n");

    const actor = getActorInfo(req);
    const lane = await callAgentLane(db, {
      lane: "calliope",
      companyId,
      task: [
        "You are Calliope, the Book Studio creative writing agent.",
        "Return ONLY valid JSON with no markdown fences.",
        "",
        prompt,
      ].join("\n"),
      metadata: { bookId, operation: "suggest-next" },
      requestedByActorId: actor.actorId,
    });
    const raw = lane.text;
    let parsed: any;
    try {
      // Handle markdown fences and extract JSON
      const jsonMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      const source = jsonMatch ? jsonMatch[1] : raw;
      const start = source.indexOf("{");
      const end = source.lastIndexOf("}");
      parsed = start !== -1 && end !== -1 ? JSON.parse(source.slice(start, end + 1)) : JSON.parse(raw);
    } catch {
      parsed = { action: "add_character", entityType: "character", reason: raw.slice(0, 200) };
    }

    res.json({
      action: parsed.action || "add_character",
      entityType: parsed.entityType || "character",
      reason: parsed.reason || "No reason provided",
      suggestedData: parsed.suggestedData || undefined,
    });
  } catch (err: any) {
    if (err instanceof AgentLaneUnavailableError) {
      res.status(err.fallbackSafe ? 503 : 502).json({
        error: "Calliope is unavailable. No suggestion was generated.",
        via: "none",
        agentLane: err.fallbackSafe ? "unavailable" : "indeterminate",
        agentLaneError: err.message,
      });
      return;
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Review Notes (ponytail: jsonb on books.metadata.reviewNotes) ──────

type ReviewNote = {
  id: string;
  chapterNumber?: number;
  category: string;
  text: string;
  startOffset?: number;
  endOffset?: number;
  // Spec v1 §5.C: notes are first-class — provenance (baily = the author's own /
  // ai-critic = the pipeline's) + status lifecycle (open/resolved) + optional
  // link to the directed revision this note spawned (Send-to-revision, §5.E).
  provenance?: "baily" | "ai-critic";
  status?: "open" | "resolved";
  linkedRevisionId?: string;
  createdAt: string;
  updatedAt: string;
};

const VALID_CATEGORIES = ["pacing", "character", "plot", "prose", "consistency"];

// GET /review-notes
bookBibleRouter.get("/review-notes", async (req, res) => {
  const { companyId, bookId } = req.params as { companyId: string; bookId: string };
  assertCompanyAccess(req, companyId);
  const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  if (!book) throw notFound("Book not found");
  const notes = (book.metadata?.reviewNotes as ReviewNote[]) ?? [];
  res.json({ notes });
});

// POST /review-notes
bookBibleRouter.post("/review-notes", async (req, res) => {
  const { companyId, bookId } = req.params as { companyId: string; bookId: string };
  assertCompanyAccess(req, companyId);
  const { chapterNumber, category, text, startOffset, endOffset } = req.body ?? {};
  if (!category || !VALID_CATEGORIES.includes(category)) throw badRequest("Invalid category. Must be one of: " + VALID_CATEGORIES.join(", "));
  if (!text || typeof text !== "string" || text.trim().length === 0) throw badRequest("text is required");

  const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  if (!book) throw notFound("Book not found");

  const note: ReviewNote = {
    id: randomUUID(),
    chapterNumber: typeof chapterNumber === "number" ? chapterNumber : undefined,
    category,
    text: text.trim(),
    startOffset: typeof startOffset === "number" ? startOffset : undefined,
    endOffset: typeof endOffset === "number" ? endOffset : undefined,
    // Human-added notes are the author's own (§5.C) — the pipeline writes
    // provenance "ai-critic" via the baseline-review path, never through here.
    provenance: "baily",
    status: "open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const existing = (book.metadata?.reviewNotes as ReviewNote[]) ?? [];
  await db
    .update(books)
    .set({ metadata: { ...(book.metadata as Record<string, unknown>), reviewNotes: [...existing, note] } })
    .where(eq(books.id, bookId));

  res.status(201).json({ note });
});

// PATCH /review-notes/:noteId
bookBibleRouter.patch("/review-notes/:noteId", async (req, res) => {
  const { companyId, bookId, noteId } = req.params as { companyId: string; bookId: string; noteId: string };
  assertCompanyAccess(req, companyId);

  const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  if (!book) throw notFound("Book not found");

  const notes = (book.metadata?.reviewNotes as ReviewNote[]) ?? [];
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) throw notFound("Note not found");

  const { category, text, chapterNumber, startOffset, endOffset, status } = req.body ?? {};
  if (category !== undefined && !VALID_CATEGORIES.includes(category)) throw badRequest("Invalid category");
  if (status !== undefined && !["open", "resolved"].includes(status)) throw badRequest("Invalid status — open | resolved");

  notes[idx] = {
    ...notes[idx],
    ...(category !== undefined && { category }),
    ...(text !== undefined && { text: String(text).trim() }),
    ...(chapterNumber !== undefined && { chapterNumber: typeof chapterNumber === "number" ? chapterNumber : undefined }),
    ...(startOffset !== undefined && { startOffset: typeof startOffset === "number" ? startOffset : undefined }),
    ...(endOffset !== undefined && { endOffset: typeof endOffset === "number" ? endOffset : undefined }),
    ...(status !== undefined && { status }),
    updatedAt: new Date().toISOString(),
  };

  await db
    .update(books)
    .set({ metadata: { ...(book.metadata as Record<string, unknown>), reviewNotes: notes } })
    .where(eq(books.id, bookId));

  res.json({ note: notes[idx] });
});

// DELETE /review-notes/:noteId
bookBibleRouter.delete("/review-notes/:noteId", async (req, res) => {
  const { companyId, bookId, noteId } = req.params as { companyId: string; bookId: string; noteId: string };
  assertCompanyAccess(req, companyId);

  const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  if (!book) throw notFound("Book not found");

  const notes = (book.metadata?.reviewNotes as ReviewNote[]) ?? [];
  const filtered = notes.filter((n) => n.id !== noteId);
  if (filtered.length === notes.length) throw notFound("Note not found");

  await db
    .update(books)
    .set({ metadata: { ...(book.metadata as Record<string, unknown>), reviewNotes: filtered } })
    .where(eq(books.id, bookId));

  res.status(204).send();
});

// ── Span-anchored annotations (book_annotations — migration 0151, GATED) ──
//
// The tables are defined + migration 0151 is written, but NOT applied yet.
// Every endpoint here catches relation-does-not-exist (42P01) and degrades to
// the books.metadata.reviewNotes jsonb path, reporting `available: false` +
// `pendingMigration: "0151"` so the UI can say so instead of pretending.

function isMissingTableError(err: unknown): boolean {
  const anyErr = err as { code?: string; cause?: { code?: string }; message?: string };
  if (anyErr?.code === "42P01" || anyErr?.cause?.code === "42P01") return true;
  const msg = String(anyErr?.message ?? "");
  return /relation "(book_annotations|book_review_runs)" does not exist/i.test(msg);
}

const ANNOTATION_KINDS = ["note", "review", "suggestion"];
const REVIEW_LENSES = ["canon", "voice", "continuity", "structure", "prose"];
const PENDING_0151 =
  "book_annotations table pending migration 0151 — notes currently fall back to books.metadata review notes.";

// GET /annotations?chapterNumber=N — list annotations (+review runs), with
// per-annotation `stale` computed from the current chapter content hash.
bookBibleRouter.get("/annotations", async (req, res) => {
  const { companyId, bookId } = req.params as { companyId: string; bookId: string };
  assertCompanyAccess(req, companyId);
  const chapterQ = req.query.chapterNumber != null ? parseInt(String(req.query.chapterNumber), 10) : null;
  if (req.query.chapterNumber != null && Number.isNaN(chapterQ)) throw badRequest("chapterNumber must be an integer");

  const chapters = await db
    .select({ chapterNumber: manuscriptChapters.chapterNumber, content: manuscriptChapters.content })
    .from(manuscriptChapters)
    .where(eq(manuscriptChapters.bookId, bookId));
  const hashByChapter = new Map(chapters.map((c) => [c.chapterNumber, chapterContentHash(c.content ?? "")]));

  try {
    const annoWhere = chapterQ != null
      ? and(eq(bookAnnotations.bookId, bookId), eq(bookAnnotations.chapterNumber, chapterQ))
      : eq(bookAnnotations.bookId, bookId);
    const annos = await db.select().from(bookAnnotations).where(annoWhere).orderBy(desc(bookAnnotations.createdAt));
    const runs = await db.select().from(bookReviewRuns).where(eq(bookReviewRuns.bookId, bookId)).orderBy(desc(bookReviewRuns.createdAt));
    res.json({
      available: true,
      annotations: annos.map((a) => ({
        ...a,
        stale: hashByChapter.get(a.chapterNumber) !== a.contentHash,
      })),
      reviewRuns: runs,
    });
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    res.json({
      available: false,
      pendingMigration: "0151",
      reason: PENDING_0151,
      annotations: [],
      reviewRuns: [],
    });
  }
});

// POST /annotations — create a span-anchored annotation. Fallback: writes a
// review note into books.metadata.reviewNotes (the pre-migration path).
bookBibleRouter.post("/annotations", async (req, res) => {
  const { companyId, bookId } = req.params as { companyId: string; bookId: string };
  assertCompanyAccess(req, companyId);
  const { chapterNumber, spanStart, spanEnd, kind, body, author } = (req.body ?? {}) as {
    chapterNumber?: number; spanStart?: number; spanEnd?: number; kind?: string; body?: string; author?: string;
  };
  if (typeof chapterNumber !== "number" || !Number.isFinite(chapterNumber)) throw badRequest("chapterNumber (number) is required");
  if (!body || typeof body !== "string" || !body.trim()) throw badRequest("body is required");
  const resolvedKind = kind && ANNOTATION_KINDS.includes(kind) ? kind : "note";

  const chapter = await db
    .select()
    .from(manuscriptChapters)
    .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)))
    .then((r) => r[0]);
  if (!chapter) throw notFound(`Chapter ${chapterNumber} has no manuscript row yet — save or draft it first.`);

  const content = chapter.content ?? "";
  const hasSpan = typeof spanStart === "number" && typeof spanEnd === "number";
  if (hasSpan && (spanStart! < 0 || spanEnd! < spanStart! || spanEnd! > content.length)) {
    throw badRequest(`Invalid span [${spanStart}, ${spanEnd}] for chapter of length ${content.length}`);
  }

  try {
    const [inserted] = await db
      .insert(bookAnnotations)
      .values({
        bookId,
        chapterId: chapter.id,
        chapterNumber,
        spanStart: hasSpan ? spanStart! : null,
        spanEnd: hasSpan ? spanEnd! : null,
        contentHash: chapterContentHash(content),
        kind: resolvedKind,
        body: body.trim(),
        author: typeof author === "string" && author.trim() ? author.trim() : "user",
      })
      .returning();
    res.status(201).json({ available: true, annotation: { ...inserted, stale: false } });
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    // Fallback: books.metadata.reviewNotes (same shape as /review-notes).
    const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
    if (!book) throw notFound("Book not found");
    const note: ReviewNote = {
      id: randomUUID(),
      chapterNumber,
      category: resolvedKind === "review" ? "consistency" : "prose",
      text: body.trim(),
      startOffset: hasSpan ? spanStart : undefined,
      endOffset: hasSpan ? spanEnd : undefined,
      provenance: "baily",
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const existingNotes = (book.metadata?.reviewNotes as ReviewNote[]) ?? [];
    await db
      .update(books)
      .set({ metadata: { ...(book.metadata as Record<string, unknown>), reviewNotes: [...existingNotes, note] } })
      .where(eq(books.id, bookId));
    res.status(201).json({
      available: false,
      pendingMigration: "0151",
      reason: PENDING_0151,
      fallback: "review-note",
      note,
    });
  }
});

// PATCH /annotations/:annotationId — resolve/unresolve or edit body.
bookBibleRouter.patch("/annotations/:annotationId", async (req, res) => {
  const { companyId, bookId, annotationId } = req.params as { companyId: string; bookId: string; annotationId: string };
  assertCompanyAccess(req, companyId);
  const { resolved, body } = (req.body ?? {}) as { resolved?: boolean; body?: string };
  if (resolved === undefined && body === undefined) throw badRequest("resolved or body required");

  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof resolved === "boolean") updates.resolved = resolved;
    if (typeof body === "string" && body.trim()) updates.body = body.trim();
    const [updated] = await db
      .update(bookAnnotations)
      .set(updates)
      .where(and(eq(bookAnnotations.id, annotationId), eq(bookAnnotations.bookId, bookId)))
      .returning();
    if (!updated) throw notFound("Annotation not found");
    res.json({ available: true, annotation: updated });
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    throw serviceUnavailable(PENDING_0151);
  }
});

// DELETE /annotations/:annotationId
bookBibleRouter.delete("/annotations/:annotationId", async (req, res) => {
  const { companyId, bookId, annotationId } = req.params as { companyId: string; bookId: string; annotationId: string };
  assertCompanyAccess(req, companyId);
  try {
    const existing = await db
      .select({ id: bookAnnotations.id })
      .from(bookAnnotations)
      .where(and(eq(bookAnnotations.id, annotationId), eq(bookAnnotations.bookId, bookId)))
      .then((r) => r[0]);
    if (!existing) throw notFound("Annotation not found");
    await db.delete(bookAnnotations).where(eq(bookAnnotations.id, annotationId));
    res.status(204).send();
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    throw serviceUnavailable(PENDING_0151);
  }
});

// POST /review-runs — run one AI review pass (lens) over a chapter's prose and
// store the run + its span-anchored annotations. Availability is probed BEFORE
// spending tokens: if 0151 isn't applied there is nowhere to store the pass.
bookBibleRouter.post("/review-runs", async (req, res) => {
  const { companyId, bookId } = req.params as { companyId: string; bookId: string };
  assertCompanyAccess(req, companyId);
  const { chapterNumber, lens } = (req.body ?? {}) as { chapterNumber?: number; lens?: string };
  if (typeof chapterNumber !== "number" || !Number.isFinite(chapterNumber)) throw badRequest("chapterNumber (number) is required");
  const resolvedLens = lens && REVIEW_LENSES.includes(lens) ? lens : "prose";

  const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  if (!book || book.companyId !== companyId) throw notFound("Book not found");

  // Probe table availability first — do not burn LLM tokens on a pass whose
  // results cannot be stored.
  try {
    await db.select({ id: bookReviewRuns.id }).from(bookReviewRuns).where(eq(bookReviewRuns.bookId, bookId)).limit(1);
  } catch (err) {
    if (isMissingTableError(err)) {
      res.status(503).json({ available: false, pendingMigration: "0151", reason: PENDING_0151 });
      return;
    }
    throw err;
  }

  const chapter = await db
    .select()
    .from(manuscriptChapters)
    .where(and(eq(manuscriptChapters.bookId, bookId), eq(manuscriptChapters.chapterNumber, chapterNumber)))
    .then((r) => r[0]);
  if (!chapter || !(chapter.content ?? "").trim()) {
    throw badRequest(`Chapter ${chapterNumber} has no prose to review yet.`);
  }
  const content = chapter.content ?? "";

  const lensGuide: Record<string, string> = {
    canon: "violations of established facts, character traits, or world rules",
    voice: "dialogue or narration that breaks a character's established voice",
    continuity: "timeline errors, who-knows-what-when problems, contradictions with earlier text",
    structure: "pacing problems and whether the chapter delivers its beat",
    prose: "clichés, repetition, echoes, weak or overwritten prose",
  };
  const systemPrompt = [
    "You are the reviewer lane for a book studio. You highlight, cite, and propose — you never edit and never block.",
    "Under-flag: only report findings you are confident about (max 8).",
    'Return ONLY valid JSON: { "summary": "one-paragraph pass summary", "findings": [{ "excerpt": "EXACT verbatim quote from the chapter (10-40 words)", "note": "why this is a problem + a concrete suggestion", "kind": "review" | "suggestion" }] }',
    "The excerpt MUST be copied character-for-character from the chapter so it can be anchored.",
  ].join("\n");
  const userPrompt = `Review lens: ${resolvedLens} — look for ${lensGuide[resolvedLens]}.\n\nCHAPTER ${chapterNumber} PROSE:\n${content.slice(0, 24000)}\n\nRespond with the JSON object only.`;

  const actor = getActorInfo(req);
  let raw: string;
  let reviewerDelegationId: string;
  try {
    const lane = await callAgentLane(db, {
      lane: "hades",
      companyId,
      task: `${systemPrompt}\n\n${userPrompt}`,
      metadata: { bookId, chapterNumber, lens: resolvedLens, operation: "review-run" },
      requestedByActorId: actor.actorId,
    });
    raw = lane.text;
    reviewerDelegationId = lane.delegationId;
  } catch (laneErr) {
    if (!(laneErr instanceof AgentLaneUnavailableError)) throw laneErr;
    res.status(laneErr.fallbackSafe ? 503 : 502).json({
      available: false,
      error: "Hades is unavailable. No review or annotations were generated.",
      via: "none",
      reviewer: "Hades",
      model: "Kimi K3",
      agentLane: laneErr.fallbackSafe ? "unavailable" : "indeterminate",
      agentLaneError: laneErr.message,
    });
    return;
  }

  let parsed: { summary?: string; findings?: Array<{ excerpt?: string; note?: string; kind?: string }> };
  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[1].trim() : raw);
  } catch {
    throw serviceUnavailable("Reviewer returned unparseable output — no annotations were stored.");
  }
  const findings = Array.isArray(parsed.findings) ? parsed.findings.slice(0, 8) : [];

  try {
    const [run] = await db
      .insert(bookReviewRuns)
      .values({
        bookId,
        companyId,
        lens: resolvedLens,
        reviewer: "Hades",
        // Explicit Hades provenance; this route has no generic model fallback.
        model: "Kimi K3 (kimi-coding/kimi-k3)",
        scope: `chapter:${chapterNumber}`,
        summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : "",
      })
      .returning();

    const hash = chapterContentHash(content);
    const inserted = [];
    for (const f of findings) {
      if (!f?.note || typeof f.note !== "string") continue;
      const excerpt = typeof f.excerpt === "string" ? f.excerpt : "";
      const idx = excerpt ? content.indexOf(excerpt) : -1;
      const [anno] = await db
        .insert(bookAnnotations)
        .values({
          bookId,
          chapterId: chapter.id,
          chapterNumber,
          reviewRunId: run.id,
          spanStart: idx >= 0 ? idx : null,
          spanEnd: idx >= 0 ? idx + excerpt.length : null,
          contentHash: hash,
          kind: f.kind === "suggestion" ? "suggestion" : "review",
          body: excerpt && idx < 0 ? `[unanchored — excerpt not found verbatim] "${excerpt.slice(0, 120)}" — ${f.note.trim()}` : f.note.trim(),
          author: "Hades / Kimi K3",
        })
        .returning();
      inserted.push({ ...anno, stale: false });
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "book.review_run",
      entityType: "book",
      entityId: bookId,
      details: {
        bookId,
        chapterNumber,
        lens: resolvedLens,
        findings: inserted.length,
        reviewer: "Hades",
        model: "Kimi K3",
        delegationId: reviewerDelegationId,
      },
    }).catch(() => {});

    res.status(201).json({
      available: true,
      run,
      annotations: inserted,
      unanchored: inserted.filter((a) => a.spanStart === null).length,
    });
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    res.status(503).json({ available: false, pendingMigration: "0151", reason: PENDING_0151 });
  }
});

// ── Brainstorm Chat ────────────────────────────────────────────────────

// POST /chat — send a message to the brainstorming AI
  bookBibleRouter.post("/chat", async (req, res) => {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);

    // Validate body
    const parsed = sendChatMessageSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.message);
    const { message } = parsed.data;

    // Load full bible — bound to BOTH the URL company and the book id: a
    // book that belongs to another company is not-found here, before any
    // dependent content is read, persisted, or delegated (company-boundary
    // rule; Chronos PR #30 finding 1).
    const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
    if (!book || book.companyId !== companyId) throw notFound("Book not found");

    const characters = await db.select().from(storyBibleCharacters).where(eq(storyBibleCharacters.bookId, bookId));
    const locations = await db.select().from(storyBibleWorldLocations).where(eq(storyBibleWorldLocations.bookId, bookId));
    const styles = await db.select().from(storyBibleStyle).where(eq(storyBibleStyle.bookId, bookId));
    const outlines = await db.select().from(storyBibleOutline).where(eq(storyBibleOutline.bookId, bookId));

    // Load only the active transcript (latest bounded rows, then chronological).
    const history = await db.select()
      .from(storyBibleChatMessages)
      .where(and(
        eq(storyBibleChatMessages.bookId, bookId),
        isNull(storyBibleChatMessages.archivedAt),
      ))
      .orderBy(desc(storyBibleChatMessages.createdAt))
      .limit(50);

    const turnId = randomUUID();
    const conversationId = `book-studio:${companyId}:${bookId}`;
    const actor = getActorInfo(req);
    const authorization = actor.actorType === "user" ? resolveBookChatAuthorization(deriveBookChatAuthorization(message), {
      book: { id: book.id, locked: false, updatedAt: book.updatedAt.toISOString() },
      characters: characters.map((item) => ({ id: item.id, name: item.name, locked: item.locked, updatedAt: item.updatedAt.toISOString() })),
      locations: locations.map((item) => ({ id: item.id, name: item.name, locked: item.locked, updatedAt: item.updatedAt.toISOString() })),
      styles: styles.map((item) => ({ id: item.id, pov: item.pov, tense: item.tense, locked: item.locked, updatedAt: item.updatedAt.toISOString() })),
      outlines: outlines.map((item) => ({ id: item.id, chapterNumber: item.chapterNumber, locked: item.locked, updatedAt: item.updatedAt.toISOString() })),
    }) : null;

    // Persist pending user state before dispatch so an interrupted turn remains visible.
    const userMsg = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`book-chat:${bookId}`}))`);
      const [inserted] = await tx.insert(storyBibleChatMessages).values({ bookId, turnId, role: "user", content: message, status: "pending", conversationId, authorization }).returning();
      return inserted;
    });

    // Build the complete book brief for Calliope.
    const bibleContext = {
      bookTitle: book.title,
      characters: characters.map(c => ({ name: c.name, role: c.role, description: c.description })),
      locations: locations.map(l => ({ name: l.name, description: l.description })),
      styles: styles.map(s => ({ pov: s.pov, tense: s.tense, comps: s.comps, sampleParagraph: s.sampleParagraph, tropes: s.tropes })),
      outlines: outlines.map(o => ({ chapterNumber: o.chapterNumber, title: o.title, beats: o.beats as Record<string, unknown>[] })),
    };
    const historyEntries = history.reverse().map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    historyEntries.push({ role: "user", content: message });

    // This window is Calliope. The live agent lane is the only execution path;
    // failures are surfaced honestly and never fabricate an assistant reply.
    let reply: string;
    let delegationId: string | undefined;
    try {
      const lane = await callAgentLane(db, {
        lane: "calliope",
        companyId,
        task: [
          buildSystemPrompt(bibleContext),
          "",
          "--- CONVERSATION (oldest first) ---",
          ...historyEntries.map((h) => `${h.role.toUpperCase()}: ${h.content}`),
          "",
          "Reply as Calliope to Baily's latest message.",
          authorization
            ? `Paperclip has independently authorized exactly one operation from Baily's latest message: ${authorization.operation} at ${authorization.destination}. Discuss it naturally; do not add, widen, or substitute any action.`
            : "Paperclip found no unambiguous direct Book Studio mutation authorization in the latest human message. If Baily appears to want a change, ask for the missing operation, destination, or content. Do not claim anything was changed.",
        ].join("\n"),
        metadata: {
          bookId,
          turnId,
          conversationId,
          operation: "brainstorm-chat",
        },
        conversationId,
        requestedByActorId: actor.actorId,
      });
      reply = lane.text;
      delegationId = lane.delegationId;
    } catch (laneErr) {
      if (!(laneErr instanceof AgentLaneUnavailableError)) throw laneErr;
      await db
        .update(storyBibleChatMessages)
        .set({ status: "failed", via: "none", error: laneErr.message.slice(0, 2000), retryable: laneErr.fallbackSafe, delegationId: laneErr.delegationId ?? null })
        .where(eq(storyBibleChatMessages.id, userMsg.id));
      res.status(laneErr.fallbackSafe ? 503 : 502).json({
        error: "Calliope is unavailable. Your message was saved, but no reply was generated.",
        turnId,
        messageId: userMsg.id,
        via: "none",
        status: "failed",
        retryable: laneErr.fallbackSafe,
        agentLane: laneErr.fallbackSafe ? "unavailable" : "indeterminate",
        agentLaneError: laneErr.message,
      });
      return;
    }

    const completion = await persistBrainstormCompletion(db, {
      companyId,
      bookId,
      turnId,
      userMessageId: userMsg.id,
      actor,
      authorization,
      reply,
      conversationId,
      delegationId,
    });
    reply = completion.reply;
    const actionResult = completion.actionResult;

    res.json({
      reply,
      turnId,
      messageId: completion.assistantMessageId,
      userMessageId: userMsg.id,
      via: "calliope",
      status: "completed",
      ...(delegationId ? { delegationId } : {}),
      ...(actionResult ? { action: actionResult } : {}),
    });
  });

  // GET /chat — fetch chat messages for a book
  bookBibleRouter.get("/chat", async (req, res) => {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);

    const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
    if (!book || book.companyId !== companyId) throw notFound("Book not found");

    const rows = await db.select()
      .from(storyBibleChatMessages)
      .where(and(
        eq(storyBibleChatMessages.bookId, bookId),
        isNull(storyBibleChatMessages.archivedAt),
      ))
      .orderBy(desc(storyBibleChatMessages.createdAt))
      .limit(200);

    res.json({ messages: normalizeBrainstormTurns([...rows].reverse()) });
  });

  // GET /chat/archives — book-scoped, read-only transcript groups.
  bookBibleRouter.get("/chat/archives", async (req, res) => {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);
    await requireCompanyBook(db, companyId, bookId);

    const rows = await db.select()
      .from(storyBibleChatMessages)
      .where(and(eq(storyBibleChatMessages.bookId, bookId), sql`${storyBibleChatMessages.archivedAt} is not null`))
      .orderBy(desc(storyBibleChatMessages.createdAt))
      .limit(1000);
    const grouped = new Map<string, typeof rows>();
    for (const row of [...rows].reverse()) {
      if (!row.archivedAt) continue;
      const key = row.archivedAt.toISOString();
      const group = grouped.get(key) ?? [];
      group.push(row);
      grouped.set(key, group);
    }
    const archives = [...grouped.entries()]
      .map(([archivedAt, group]) => ({ archivedAt, messages: normalizeBrainstormTurns(group) }))
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
    res.json({ archives });
  });

  // POST /chat/reset — archive the active transcript; never delete history.
  bookBibleRouter.post("/chat/reset", async (req, res) => {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);

    const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
    if (!book || book.companyId !== companyId) throw notFound("Book not found");

    const actor = getActorInfo(req);
    const { archived, archivedAt } = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`book-chat:${bookId}`}))`);
      const [pending] = await tx.select({ id: storyBibleChatMessages.id }).from(storyBibleChatMessages).where(and(eq(storyBibleChatMessages.bookId, bookId), isNull(storyBibleChatMessages.archivedAt), eq(storyBibleChatMessages.status, "pending"))).limit(1);
      if (pending) throw conflict("Wait for the active Calliope turn to finish before starting a new conversation.");
      const archivedAt = new Date();
      const archived = await tx.update(storyBibleChatMessages).set({ archivedAt }).where(and(eq(storyBibleChatMessages.bookId, bookId), isNull(storyBibleChatMessages.archivedAt))).returning({ id: storyBibleChatMessages.id });
      await logActivity(tx as unknown as Db, { companyId, actorType: actor.actorType, actorId: actor.actorId, agentId: actor.agentId, runId: actor.runId, action: "book.brainstorm_chat_reset", entityType: "book", entityId: bookId, details: { bookId, archivedCount: archived.length, archivedAt: archivedAt.toISOString() } });
      return { archived, archivedAt };
    });

    res.json({ messages: [], archivedCount: archived.length, activeCount: 0 });
  });

  // POST /chat/:turnId/retry — conditionally claim one failed durable turn.
  bookBibleRouter.post("/chat/:turnId/retry", async (req, res) => {
    const { companyId, bookId, turnId } = req.params as { companyId: string; bookId: string; turnId: string };
    assertCompanyAccess(req, companyId);
    const book = await requireCompanyBook(db, companyId, bookId);

    const activeRows = await db.select().from(storyBibleChatMessages)
      .where(and(eq(storyBibleChatMessages.bookId, bookId), isNull(storyBibleChatMessages.archivedAt)))
      .orderBy(desc(storyBibleChatMessages.createdAt))
      .limit(200);
    const userMsg = activeRows.find((row) => row.turnId === turnId && row.role === "user");
    if (!userMsg) throw notFound("Failed turn not found");
    const existingAssistant = activeRows.find((row) => row.turnId === turnId && row.role === "assistant");
    if (existingAssistant) {
      res.json(normalizeBrainstormTurns(activeRows.filter((row) => row.turnId === turnId).reverse())[0]);
      return;
    }
    if (userMsg.status === "pending") throw conflict("This Calliope turn is still working; it will reconcile without another dispatch.");
    if (userMsg.status !== "failed") throw conflict("Only a failed Calliope turn can be retried.");
    if (!userMsg.retryable) throw conflict("This turn has an indeterminate delegation and cannot be safely retried; no duplicate work was launched.");
    const laterHuman = activeRows.find((row) => row.role === "user" && row.createdAt > userMsg.createdAt);
    if (laterHuman) throw conflict("This is no longer the latest human instruction; retry would be ambiguous. Send a new explicit instruction instead.");

    // Real conditional transition: only one concurrent caller can claim failed -> pending.
    const [claimed] = await db.update(storyBibleChatMessages)
      .set({ status: "pending", error: null, retryCount: sql`${storyBibleChatMessages.retryCount} + 1` })
      .where(and(
        eq(storyBibleChatMessages.id, userMsg.id),
        eq(storyBibleChatMessages.bookId, bookId),
        eq(storyBibleChatMessages.status, "failed"),
        isNull(storyBibleChatMessages.archivedAt),
      ))
      .returning();
    if (!claimed) throw conflict("This turn was already claimed for retry; no duplicate work was launched.");

    const characters = await db.select().from(storyBibleCharacters).where(eq(storyBibleCharacters.bookId, bookId));
    const locations = await db.select().from(storyBibleWorldLocations).where(eq(storyBibleWorldLocations.bookId, bookId));
    const styles = await db.select().from(storyBibleStyle).where(eq(storyBibleStyle.bookId, bookId));
    const outlines = await db.select().from(storyBibleOutline).where(eq(storyBibleOutline.bookId, bookId));
    const bibleContext = {
      bookTitle: book.title,
      characters: characters.map((item) => ({ name: item.name, role: item.role, description: item.description })),
      locations: locations.map((item) => ({ name: item.name, description: item.description })),
      styles: styles.map((item) => ({ pov: item.pov, tense: item.tense, comps: item.comps, sampleParagraph: item.sampleParagraph })),
      outlines: outlines.map((item) => ({ chapterNumber: item.chapterNumber, title: item.title, beats: item.beats as Record<string, unknown>[] })),
    };
    const chronological = [...activeRows].reverse()
      .filter((row) => row.turnId !== turnId && (row.role === "user" || row.role === "assistant"))
      .map((row) => ({ role: row.role, content: row.content }));
    chronological.push({ role: "user", content: userMsg.content });
    const conversationId = userMsg.conversationId ?? `book-studio:${companyId}:${bookId}`;
    const authorization = (userMsg.authorization ?? null) as BookChatAuthorization | null;
    const actor = getActorInfo(req);

    let reply: string;
    let delegationId: string | undefined;
    try {
      const lane = await callAgentLane(db, {
        lane: "calliope", companyId, conversationId, requestedByActorId: actor.actorId,
        task: [buildSystemPrompt(bibleContext), "", "--- CONVERSATION (oldest first) ---", ...chronological.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`), "", "Reply as Calliope to Baily's latest message. This is an idempotent retry of the same durable turn.", authorization ? `Paperclip authorized exactly ${authorization.operation} at ${authorization.destination}; do not broaden it.` : "No Book Studio mutation is authorized; do not claim a change."].join("\n"),
        metadata: { bookId, turnId, conversationId, operation: "brainstorm-chat-retry", retryCount: claimed.retryCount },
      });
      reply = lane.text; delegationId = lane.delegationId;
    } catch (laneErr) {
      const reason = laneErr instanceof Error ? laneErr.message : String(laneErr);
      const retryable = laneErr instanceof AgentLaneUnavailableError ? laneErr.fallbackSafe : false;
      const failedDelegationId = laneErr instanceof AgentLaneUnavailableError ? laneErr.delegationId ?? null : null;
      await db.update(storyBibleChatMessages).set({ status: "failed", via: "none", error: reason.slice(0, 2000), retryable, delegationId: failedDelegationId }).where(and(eq(storyBibleChatMessages.id, claimed.id), eq(storyBibleChatMessages.status, "pending")));
      if (laneErr instanceof AgentLaneUnavailableError) {
        res.status(laneErr.fallbackSafe ? 503 : 502).json({ error: "Calliope is unavailable. The same turn remains saved and failed.", turnId, status: "failed", via: "none", retryable: laneErr.fallbackSafe });
        return;
      }
      throw laneErr;
    }

    const completion = await persistBrainstormCompletion(db, {
      companyId,
      bookId,
      turnId,
      userMessageId: claimed.id,
      actor,
      authorization,
      reply,
      conversationId,
      delegationId,
    });
    reply = completion.reply;
    const actionResult = completion.actionResult;
    res.json({ reply, turnId, messageId: completion.assistantMessageId, userMessageId: claimed.id, via: "calliope", status: "completed", ...(delegationId ? { delegationId } : {}), ...(actionResult ? { action: actionResult } : {}) });
  });

  // POST /chat/:messageId/to-draft — convert an assistant message into a draft entity
  bookBibleRouter.post("/chat/:messageId/to-draft", async (req, res) => {
    const { companyId, bookId, messageId } = req.params as { companyId: string; bookId: string; messageId: string };
    assertCompanyAccess(req, companyId);

    // Parse query target
    const parsed = toDraftQuerySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.message);
    const { target } = parsed.data;

    // Load the message
    const [msg] = await db.select()
      .from(storyBibleChatMessages)
      .where(and(
        eq(storyBibleChatMessages.id, messageId),
        eq(storyBibleChatMessages.bookId, bookId),
      ))
      .limit(1);
    if (!msg) throw notFound("Message not found");
    if (msg.role !== "assistant") throw badRequest("Can only draft from assistant messages");

    // Build draft shape matching the create-input for the target entity type
    const draft: Record<string, unknown> = (() => {
      switch (target) {
        case "character":
          return { name: "", role: "", description: msg.content.slice(0, 500), voiceCard: {}, source: "co_created" } as Record<string, unknown>;
        case "world-location":
          return { name: "", description: msg.content.slice(0, 500), rules: {}, sensoryNotes: {}, source: "co_created" } as Record<string, unknown>;
        case "style":
          return { pov: "", tense: "", comps: "", sampleParagraph: msg.content.slice(0, 500), bannedCliches: [], tropes: [], source: "co_created" } as Record<string, unknown>;
        case "outline":
          return { chapterNumber: 1, title: "", beats: [{ description: msg.content.slice(0, 2000) }], source: "co_created" } as Record<string, unknown>;
      }
    })();

    res.json({ entityType: target, draft, sourceMessageId: messageId });
  });

  router.use("/companies/:companyId/book-studio/books/:bookId", bookBibleRouter);

  return router;
}
