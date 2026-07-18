import { Router } from "express";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { prompts, promptCategories } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logger } from "../middleware/logger.js";

/** Parse {{placeholder}} names out of a template body. */
function parseVariables(body: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([\w.\- ]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) set.add(m[1].trim());
  return [...set];
}

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((t) => String(t).trim()).filter(Boolean))].slice(0, 24);
}

export function promptsRoutes(db: Db) {
  const router = Router();

  // GET /companies/:companyId/prompts — global seeds + this company's prompts,
  // plus the category list and a tag facet for the filter UI.
  router.get("/companies/:companyId/prompts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const rows = await db
      .select()
      .from(prompts)
      .where(or(isNull(prompts.companyId), eq(prompts.companyId, companyId)))
      .orderBy(asc(prompts.category), asc(prompts.title));

    const categories = await db
      .select()
      .from(promptCategories)
      .where(or(isNull(promptCategories.companyId), eq(promptCategories.companyId, companyId)))
      .orderBy(asc(promptCategories.sortOrder));

    // Tag + category facet counts (computed from the visible rows).
    const tagCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    for (const r of rows) {
      categoryCounts.set(r.category, (categoryCounts.get(r.category) ?? 0) + 1);
      for (const t of r.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
    const tags = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    res.json({
      prompts: rows.map((r) => ({ ...r, editable: r.companyId === companyId })),
      categories: categories.map((c) => ({
        ...c,
        count: categoryCounts.get(c.key) ?? 0,
      })),
      tags,
    });
  });

  // POST /companies/:companyId/prompts — create a company-owned prompt.
  router.post("/companies/:companyId/prompts", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const title = String(req.body?.title ?? "").trim().slice(0, 200);
    const body = String(req.body?.body ?? "").trim();
    const category = String(req.body?.category ?? "misc").trim().slice(0, 64) || "misc";
    const tags = sanitizeTags(req.body?.tags);
    if (!title || !body) {
      res.status(400).json({ error: "title and body are required" });
      return;
    }
    const variables = parseVariables(body);
    try {
      const [row] = await db
        .insert(prompts)
        .values({
          companyId,
          title,
          body,
          category,
          tags,
          variables,
          isTemplate: variables.length > 0,
          source: null,
          createdBy: getActorInfo(req).actorId.slice(0, 120),
        })
        .returning();
      res.status(201).json({ prompt: { ...row, editable: true } });
    } catch (err) {
      logger.warn({ err }, "create prompt failed");
      res.status(500).json({ error: "Failed to create prompt" });
    }
  });

  // PUT /companies/:companyId/prompts/:id — edit a company-owned prompt only.
  router.put("/companies/:companyId/prompts/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);

    const existing = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    const current = existing[0];
    if (!current) {
      res.status(404).json({ error: "Prompt not found" });
      return;
    }
    if (current.companyId !== companyId) {
      // Global seeds and other companies' prompts are read-only here.
      res.status(403).json({ error: "This prompt is read-only" });
      return;
    }
    const title = String(req.body?.title ?? current.title).trim().slice(0, 200);
    const body = String(req.body?.body ?? current.body).trim();
    const category = String(req.body?.category ?? current.category).trim().slice(0, 64) || "misc";
    const tags = req.body?.tags !== undefined ? sanitizeTags(req.body.tags) : current.tags;
    if (!title || !body) {
      res.status(400).json({ error: "title and body are required" });
      return;
    }
    const variables = parseVariables(body);
    const [row] = await db
      .update(prompts)
      .set({
        title,
        body,
        category,
        tags,
        variables,
        isTemplate: variables.length > 0,
        updatedAt: new Date(),
      })
      .where(eq(prompts.id, id))
      .returning();
    res.json({ prompt: { ...row, editable: true } });
  });

  // DELETE /companies/:companyId/prompts/:id — delete a company-owned prompt.
  router.delete("/companies/:companyId/prompts/:id", async (req, res) => {
    const companyId = req.params.companyId as string;
    const id = req.params.id as string;
    assertCompanyAccess(req, companyId);

    const existing = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
    const current = existing[0];
    if (!current) {
      res.status(404).json({ error: "Prompt not found" });
      return;
    }
    if (current.companyId !== companyId) {
      res.status(403).json({ error: "This prompt is read-only" });
      return;
    }
    await db.delete(prompts).where(eq(prompts.id, id));
    res.status(204).end();
  });

  return router;
}
