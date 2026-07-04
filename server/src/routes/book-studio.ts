import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  books,
  storyBibleCharacters,
  storyBibleWorldLocations,
  storyBibleStyle,
  storyBibleOutline,
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
} from "@paperclipai/shared";
import { eq, and } from "drizzle-orm";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { execSync } from "node:child_process";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound } from "../errors.js";
import { logActivity } from "../services/index.js";

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

  router.use("/companies/:companyId/book-studio/books/:bookId", bookBibleRouter);

  return router;
}
