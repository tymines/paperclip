/**
 * Design Assets (Library) API
 *
 * Endpoints:
 *   GET    /companies/:companyId/design/assets — list assets (paginated, filterable)
 *   PATCH  /companies/:companyId/design/assets/:id/favorite — toggle favorite
 *   GET    /companies/:companyId/design/assets/export — bulk zip download
 *   GET    /companies/:companyId/design/assets/skills — distinct skill names for filter
 *   GET    /companies/:companyId/design/assets/personas — distinct persona names for filter
 */
import { Router } from "express";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Db } from "@paperclipai/db";
import { designAssets } from "@paperclipai/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, notFound } from "../errors.js";

type QueryFilter = {
  skill?: string;
  kind?: string;
  dateRange?: "today" | "week" | "month" | "all";
  status?: "completed" | "all";
  favorited?: boolean;
  persona?: string;
};

function buildDateFilter(dateRange: string, col: any) {
  const now = new Date();
  switch (dateRange) {
    case "today":
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return sql`${col} >= ${todayStart.toISOString()}`;
    case "week":
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return sql`${col} >= ${weekStart.toISOString()}`;
    case "month":
      const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return sql`${col} >= ${monthStart.toISOString()}`;
    default:
      return sql`1=1`;
  }
}

export function designAssetsRoutes(db: Db) {
  const router = Router();

  // ── List assets ────────────────────────────────────────────────────────
  router.get("/companies/:companyId/design/assets", async (req, res, next) => {
    try {
      const companyId = req.params.companyId;
      assertCompanyAccess(req, companyId);

      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
      const offset = (page - 1) * limit;

      const filter: QueryFilter = {};
      if (typeof req.query.skill === "string" && req.query.skill.length > 0) {
        filter.skill = req.query.skill;
      }
      if (typeof req.query.kind === "string" && req.query.kind.length > 0) {
        filter.kind = req.query.kind;
      }
      if (typeof req.query.dateRange === "string" && req.query.dateRange.length > 0) {
        filter.dateRange = req.query.dateRange as QueryFilter["dateRange"];
      }
      if (typeof req.query.favorited === "string" && req.query.favorited === "true") {
        filter.favorited = true;
      }
      if (typeof req.query.persona === "string" && req.query.persona.length > 0) {
        filter.persona = req.query.persona;
      }

      const conditions: any[] = [eq(designAssets.companyId, companyId)];

      if (filter.skill) {
        conditions.push(eq(designAssets.skill, filter.skill));
      }
      if (filter.kind) {
        conditions.push(eq(designAssets.kind, filter.kind));
      }
      if (filter.favorited !== undefined) {
        conditions.push(eq(designAssets.favorited, true));
      }
      if (filter.persona) {
        conditions.push(eq(designAssets.persona, filter.persona));
      }
      if (filter.dateRange && filter.dateRange !== "all") {
        conditions.push(buildDateFilter(filter.dateRange, designAssets.createdAt));
      }

      const where = and(...conditions);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(designAssets)
        .where(where);

      const rows = await db
        .select()
        .from(designAssets)
        .where(where)
        .orderBy(desc(designAssets.createdAt))
        .limit(limit)
        .offset(offset);

      const total = Number(count);

      res.json({
        assets: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Distinct skills ────────────────────────────────────────────────────
  router.get("/companies/:companyId/design/assets/skills", async (req, res, next) => {
    try {
      const companyId = req.params.companyId;
      assertCompanyAccess(req, companyId);
      const rows = await db
        .select({ skill: designAssets.skill })
        .from(designAssets)
        .where(
          and(
            eq(designAssets.companyId, companyId),
            sql`${designAssets.skill} IS NOT NULL`,
          ),
        )
        .groupBy(designAssets.skill)
        .orderBy(designAssets.skill);
      res.json({ skills: rows.map((r) => r.skill).filter(Boolean) });
    } catch (err) {
      next(err);
    }
  });

  // ── Distinct personas ──────────────────────────────────────────────────
  router.get("/companies/:companyId/design/assets/personas", async (req, res, next) => {
    try {
      const companyId = req.params.companyId;
      assertCompanyAccess(req, companyId);
      const rows = await db
        .select({ persona: designAssets.persona })
        .from(designAssets)
        .where(
          and(
            eq(designAssets.companyId, companyId),
            sql`${designAssets.persona} IS NOT NULL`,
          ),
        )
        .groupBy(designAssets.persona)
        .orderBy(designAssets.persona);
      res.json({ personas: rows.map((r) => r.persona).filter(Boolean) });
    } catch (err) {
      next(err);
    }
  });

  // ── Toggle favorite ────────────────────────────────────────────────────
  router.patch("/companies/:companyId/design/assets/:id/favorite", async (req, res, next) => {
    try {
      const companyId = req.params.companyId;
      assertCompanyAccess(req, companyId);
      const id = req.params.id;
      const body = req.body ?? {};
      const favorited = body.favorited === true;

      const [row] = await db
        .update(designAssets)
        .set({ favorited })
        .where(and(eq(designAssets.id, id), eq(designAssets.companyId, companyId)))
        .returning();

      if (!row) throw notFound("asset not found");
      res.json({ asset: row });
    } catch (err) {
      next(err);
    }
  });

  // ── Bulk download as zip ────────────────────────────────────────────────
  router.post("/companies/:companyId/design/assets/export-zip", async (req, res, next) => {
    try {
      const companyId = req.params.companyId;
      assertCompanyAccess(req, companyId);
      const body = req.body ?? {};
      const ids = Array.isArray(body.ids) ? (body.ids as string[]).filter(Boolean) : [];

      if (ids.length === 0) {
        throw badRequest("No asset IDs provided");
      }

      const assets = await db
        .select()
        .from(designAssets)
        .where(
          and(
            eq(designAssets.companyId, companyId),
            inArray(designAssets.id, ids),
          ),
        );

      if (assets.length === 0) {
        throw notFound("No assets found for those IDs");
      }

      const tmpDir = await mkdtemp(path.join(os.tmpdir(), `design-zip-`));
      const zipPath = path.join(tmpDir, "assets.zip");

      try {
        // Copy files to temp dir with friendly names, then zip
        const fileArgs: string[] = [];
        for (const asset of assets) {
          const ext = asset.kind === "video" ? ".mp4" : ".png";
          const name = `${asset.skill ?? "unknown"}-${asset.id.slice(0, 8)}-slide${asset.slideIndex + 1}${ext}`;
          const dest = path.join(tmpDir, name);
          try {
            await readFile(asset.path); // check exists
            await import("node:fs/promises").then((m) => m.copyFile(asset.path, dest));
            fileArgs.push(name);
          } catch {
            // skip missing
          }
        }

        await new Promise<void>((resolve, reject) => {
          const child = spawn("zip", ["-j", zipPath, ...fileArgs], {
            cwd: tmpDir,
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stderr = "";
          child.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });
          child.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`zip exit ${code}: ${stderr.slice(0, 200)}`));
          });
          child.on("error", reject);
        });

        const zipBuf = await readFile(zipPath);
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="design-assets-${Date.now()}.zip"`,
        );
        res.setHeader("Content-Length", String(zipBuf.length));
        res.send(zipBuf);
      } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch (err) {
      next(err);
    }
  });

  // ── Serve asset file by ID ──────────────────────────────────────────────
  router.get("/companies/:companyId/design/assets/file/:id", async (req, res, next) => {
    try {
      const companyId = req.params.companyId;
      assertCompanyAccess(req, companyId);
      const id = req.params.id;

      const [asset] = await db
        .select()
        .from(designAssets)
        .where(and(eq(designAssets.id, id), eq(designAssets.companyId, companyId)))
        .limit(1);

      if (!asset) throw notFound("asset not found");

      const { readFile } = await import("node:fs/promises");
      const bytes = await readFile(asset.path);
      const ext = path.extname(asset.path).toLowerCase();
      const mime: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
      };
      res.setHeader("Content-Type", mime[ext] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(bytes);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
