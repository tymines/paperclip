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
import { eq, and, desc } from "drizzle-orm";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { execSync } from "node:child_process";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";
import { logActivity } from "../services/index.js";
import { callBrainstormChat } from "../services/brainstorm-chat.js";
import { callLLM } from "../services/chapter-generator.js";
import { chapterContentHash } from "../services/book-prose-writer.js";

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

    const existing = await db
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.bookId, bookId)))
      .then((r) => r[0]);

    if (!existing) {
      throw notFound(`${entityLabel} not found`);
    }

    await db.delete(table).where(eq(table.id, id));

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

    const { title, metadata } = req.body ?? {};
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof title === "string" && title.trim()) updates.title = title.trim();
    if (typeof metadata === "object" && metadata !== null) {
      // ponytail: shallow-merge metadata to preserve reviewNotes etc.
      const [existing] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
      if (!existing) throw notFound("Book not found");
      updates.metadata = { ...(existing.metadata as Record<string, unknown>), ...(metadata as Record<string, unknown>) };
    }

    if (!updates.title && !updates.metadata) throw badRequest("title or metadata required");

    const [updated] = await db
      .update(books)
      .set(updates)
      .where(eq(books.id, bookId))
      .returning();

    if (!updated) throw notFound("Book not found");

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

    const existing = await db
      .select()
      .from(manuscriptChapters)
      .where(and(
        eq(manuscriptChapters.bookId, bookId),
        eq(manuscriptChapters.chapterNumber, chNum),
      ))
      .then((r) => r[0]);

    if (existing) {
      const [updated] = await db
        .update(manuscriptChapters)
        .set({ title: title ?? existing.title, content: content ?? existing.content, updatedAt: new Date() })
        .where(eq(manuscriptChapters.id, existing.id))
        .returning();
      res.json({ chapter: updated });
    } else {
      const id = randomUUID();
      const [inserted] = await db
        .insert(manuscriptChapters)
        .values({ id, bookId, chapterNumber: chNum, title: title || "", content: content || "" })
        .returning();
      res.status(201).json({ chapter: inserted });
    }
  });

  // ── Suggest Next (Assisted Mode) ──────────────────────────────────────

// ponytail: inline Gemini call — same pattern as story-bible-generate.ts
async function callGeminiSimple(prompt: string): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw Object.assign(new Error("Gemini API key not configured"), { status: 503 });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "You are a creative writing coach. Return ONLY valid JSON, no markdown fences." }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 1024 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error(`Gemini API error (${res.status}): ${body.slice(0, 300)}`), { status: 502 });
  }
  const data = await res.json() as any;
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
}

bookBibleRouter.post("/suggest-next", async (req, res) => {
  try {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);

    const book = await db.select().from(books).where(eq(books.id, bookId)).then(r => r[0]);
    if (!book) throw notFound("Book not found");

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

    const raw = await callGeminiSimple(prompt);
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

  const { category, text, chapterNumber, startOffset, endOffset } = req.body ?? {};
  if (category !== undefined && !VALID_CATEGORIES.includes(category)) throw badRequest("Invalid category");

  notes[idx] = {
    ...notes[idx],
    ...(category !== undefined && { category }),
    ...(text !== undefined && { text: String(text).trim() }),
    ...(chapterNumber !== undefined && { chapterNumber: typeof chapterNumber === "number" ? chapterNumber : undefined }),
    ...(startOffset !== undefined && { startOffset: typeof startOffset === "number" ? startOffset : undefined }),
    ...(endOffset !== undefined && { endOffset: typeof endOffset === "number" ? endOffset : undefined }),
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

  let raw: string;
  try {
    raw = await callLLM(systemPrompt, userPrompt);
  } catch (err) {
    throw serviceUnavailable(`Reviewer lane unavailable: ${(err as Error).message}`);
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
        reviewer: "reviewer-lane",
        // Honest about the provider chain — callLLM does not report which
        // provider answered, only the fixed fallback order.
        model: "auto (gemini→deepseek→anthropic)",
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
          author: "reviewer-lane",
        })
        .returning();
      inserted.push({ ...anno, stale: false });
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "book.review_run",
      entityType: "book",
      entityId: bookId,
      details: { bookId, chapterNumber, lens: resolvedLens, findings: inserted.length },
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

    // Load full bible
    const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
    if (!book) throw notFound("Book not found");

    const characters = await db.select().from(storyBibleCharacters).where(eq(storyBibleCharacters.bookId, bookId));
    const locations = await db.select().from(storyBibleWorldLocations).where(eq(storyBibleWorldLocations.bookId, bookId));
    const styles = await db.select().from(storyBibleStyle).where(eq(storyBibleStyle.bookId, bookId));
    const outlines = await db.select().from(storyBibleOutline).where(eq(storyBibleOutline.bookId, bookId));

    // Load prior history (last 50 messages)
    const history = await db.select()
      .from(storyBibleChatMessages)
      .where(eq(storyBibleChatMessages.bookId, bookId))
      .orderBy(desc(storyBibleChatMessages.createdAt))
      .limit(50);

    // Persist user message
    const [userMsg] = await db.insert(storyBibleChatMessages).values({
      bookId, role: "user", content: message,
    }).returning();

    // Call Gemini
    const bibleContext = {
      bookTitle: book.title,
      characters: characters.map(c => ({ name: c.name, role: c.role, description: c.description })),
      locations: locations.map(l => ({ name: l.name, description: l.description })),
      styles: styles.map(s => ({ pov: s.pov, tense: s.tense, comps: s.comps, sampleParagraph: s.sampleParagraph, tropes: s.tropes })),
      outlines: outlines.map(o => ({ chapterNumber: o.chapterNumber, title: o.title, beats: o.beats as Record<string, unknown>[] })),
    };
    const historyEntries = history.reverse().map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    historyEntries.push({ role: "user", content: message });

    let reply: string;
    try {
      const result = await callBrainstormChat(bibleContext, historyEntries, message);
      if (!result) throw new Error("Empty reply from LLM");
      reply = result;
    } catch (err) {
      // Still persist user message so history isn't lost
      res.status(503).json({ error: "AI service temporarily unavailable", messageId: userMsg.id });
      return;
    }

    // Persist assistant reply
    const [assistantMsg] = await db.insert(storyBibleChatMessages).values({
      bookId, role: "assistant", content: reply,
    }).returning();

    res.json({
      reply,
      messageId: assistantMsg.id,
      userMessageId: userMsg.id,
    });
  });

  // GET /chat — fetch chat messages for a book
  bookBibleRouter.get("/chat", async (req, res) => {
    const { companyId, bookId } = req.params as { companyId: string; bookId: string };
    assertCompanyAccess(req, companyId);

    const messages = await db.select()
      .from(storyBibleChatMessages)
      .where(eq(storyBibleChatMessages.bookId, bookId))
      .orderBy(desc(storyBibleChatMessages.createdAt))
      .limit(200);

    res.json({ messages });
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
