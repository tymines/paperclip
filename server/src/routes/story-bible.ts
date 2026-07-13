import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { storyBibleCharacters, storyBibleWorldLocations } from "@paperclipai/db";
import { eq, and, desc } from "drizzle-orm";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound } from "../errors.js";
import { logActivity } from "../services/index.js";

export function storyBibleRoutes(db: Db) {
  const router = Router();

  // ── Characters CRUD ──
  router.get("/companies/:companyId/book-studio/books/:bookId/characters", async (req, res) => {
    const rows = await db.select().from(storyBibleCharacters)
      .where(eq(storyBibleCharacters.bookId, req.params.bookId))
      .orderBy(desc(storyBibleCharacters.createdAt));
    res.json(rows);
  });

  router.post("/companies/:companyId/book-studio/books/:bookId/characters", async (req, res) => {
    const { name, role, description, voiceCard, source } = req.body ?? {};
    if (!name?.trim()) throw badRequest("name is required");
    const [row] = await db.insert(storyBibleCharacters).values({
      bookId: req.params.bookId, name: name.trim(),
      role: role ?? "", description: description ?? "",
      voiceCard: voiceCard ?? {}, source: source ?? "authored",
    }).returning();
    res.status(201).json(row);
  });

  router.patch("/companies/:companyId/book-studio/books/:bookId/characters/:id", async (req, res) => {
    const row = await db.select().from(storyBibleCharacters)
      .where(and(eq(storyBibleCharacters.id, req.params.id), eq(storyBibleCharacters.bookId, req.params.bookId))).limit(1);
    if (!row.length) throw notFound("character");
    const { name, role, description, voiceCard, locked, metadata } = req.body ?? {};
    const [updated] = await db.update(storyBibleCharacters).set({
      ...(name !== undefined && { name }),
      ...(role !== undefined && { role }),
      ...(description !== undefined && { description }),
      ...(voiceCard !== undefined && { voiceCard }),
      ...(locked !== undefined && { locked }),
      // shallow-merge (same as books PATCH) — a partial metadata update must
      // never wipe sibling keys like iconLocked/imageUrl
      ...(metadata !== undefined && typeof metadata === "object" && metadata !== null && {
        metadata: { ...((row[0]!.metadata ?? {}) as Record<string, unknown>), ...(metadata as Record<string, unknown>) },
      }),
      updatedAt: new Date(),
    }).where(eq(storyBibleCharacters.id, req.params.id)).returning();
    res.json(updated);
  });

  router.delete("/companies/:companyId/book-studio/books/:bookId/characters/:id", async (req, res) => {
    const row = await db.select().from(storyBibleCharacters)
      .where(and(eq(storyBibleCharacters.id, req.params.id), eq(storyBibleCharacters.bookId, req.params.bookId))).limit(1);
    if (!row.length) throw notFound("character");
    await db.delete(storyBibleCharacters).where(eq(storyBibleCharacters.id, req.params.id));
    res.json({ deleted: true });
  });

  // ── Locations CRUD ── (ponytail: same pattern)
  router.get("/companies/:companyId/book-studio/books/:bookId/locations", async (req, res) => {
    const rows = await db.select().from(storyBibleWorldLocations)
      .where(eq(storyBibleWorldLocations.bookId, req.params.bookId))
      .orderBy(desc(storyBibleWorldLocations.createdAt));
    res.json(rows);
  });

  router.patch("/companies/:companyId/book-studio/books/:bookId/locations/:id", async (req, res) => {
    const row = await db.select().from(storyBibleWorldLocations)
      .where(and(eq(storyBibleWorldLocations.id, req.params.id), eq(storyBibleWorldLocations.bookId, req.params.bookId))).limit(1);
    if (!row.length) throw notFound("location");
    const { name, description, metadata, locked } = req.body ?? {};
    const [updated] = await db.update(storyBibleWorldLocations).set({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      // NOTE: story_bible_world_locations has no metadata column yet — this key
      // is silently dropped by drizzle (kept for API-shape compat; a future
      // migration can add jsonb like 0154 did for characters).
      ...(metadata !== undefined && { metadata }),
      ...(locked !== undefined && { locked }),
      updatedAt: new Date(),
    }).where(eq(storyBibleWorldLocations.id, req.params.id)).returning();
    res.json(updated);
  });

  return router;
}
