import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  reels,
  reelScenes,
  reelTemplates,
  reelSeries,
  reelSeriesEntries,
  personaGroups,
} from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, notFound } from "../errors.js";
import { enqueueReel } from "../services/reels/orchestrator.js";

/**
 * Reels routes — Short Film module.
 *
 * Lifecycle:
 *   POST /reels                          create + enqueue
 *   GET  /reels                          list
 *   GET  /reels/:reelId                  detail + scenes + cost breakdown
 *   PATCH /reels/:reelId                 edit title / scene prompts pre-gen
 *   POST /reels/:reelId/regenerate/:idx  regen single scene
 *   POST /reels/:reelId/post             post to platforms
 *
 *   GET/POST /reel-templates
 *   GET/POST /reel-series + episodes
 *
 * See spec at docs/short-film-module-spec.md for the full architecture.
 */
export function reelsRoutes(db: Db) {
  const router = Router();

  // POST /api/companies/:companyId/reels — create a new reel + enqueue
  router.post("/companies/:companyId/reels", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(db, req, companyId);

    const {
      personaId,
      prompt,
      stylePreset = "cinematic",
      durationSeconds = 15,
      aspectRatio = "9:16",
      title,
    } = req.body ?? {};

    if (!personaId || typeof personaId !== "string") {
      throw badRequest("personaId is required");
    }
    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      throw badRequest("prompt is required");
    }
    if (
      typeof durationSeconds !== "number" ||
      durationSeconds < 5 ||
      durationSeconds > 90
    ) {
      throw badRequest("durationSeconds must be 5-90");
    }
    if (!["9:16", "16:9", "1:1"].includes(aspectRatio)) {
      throw badRequest("aspectRatio must be one of 9:16, 16:9, 1:1");
    }

    // Verify persona belongs to this company
    const [persona] = await db
      .select({ id: personaGroups.id })
      .from(personaGroups)
      .where(
        and(
          eq(personaGroups.id, personaId),
          eq(personaGroups.companyId, companyId),
        ),
      )
      .limit(1);
    if (!persona) throw notFound("persona not found in this company");

    const [row] = await db
      .insert(reels)
      .values({
        companyId,
        personaId,
        prompt: prompt.trim(),
        title: title ?? null,
        stylePreset,
        durationSeconds,
        aspectRatio,
        status: "queued",
      })
      .returning();

    // Kick the orchestrator queue (analogous to kickGenerationQueue for image gen)
    enqueueReel(db, row.id).catch((err) => {
      console.error("[reels] enqueue kick failed", err);
    });

    res.status(201).json({ reelId: row.id, status: row.status });
  });

  // GET /api/companies/:companyId/reels — list
  router.get("/companies/:companyId/reels", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(db, req, companyId);

    const personaId = (req.query.personaId as string | undefined) ?? null;
    const status = (req.query.status as string | undefined) ?? null;
    const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);

    const conditions = [eq(reels.companyId, companyId)];
    if (personaId) conditions.push(eq(reels.personaId, personaId));
    if (status) conditions.push(eq(reels.status, status));

    const rows = await db
      .select()
      .from(reels)
      .where(and(...conditions))
      .orderBy(desc(reels.createdAt))
      .limit(limit);

    res.json({ reels: rows });
  });

  // GET /api/companies/:companyId/reels/:reelId — detail + scenes
  router.get("/companies/:companyId/reels/:reelId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const reelId = req.params.reelId as string;
    await assertCompanyAccess(db, req, companyId);

    const [reel] = await db
      .select()
      .from(reels)
      .where(and(eq(reels.id, reelId), eq(reels.companyId, companyId)))
      .limit(1);
    if (!reel) throw notFound("reel not found");

    const scenes = await db
      .select()
      .from(reelScenes)
      .where(eq(reelScenes.reelId, reelId))
      .orderBy(reelScenes.sceneIndex);

    res.json({ reel, scenes });
  });

  // PATCH /api/companies/:companyId/reels/:reelId — edit title / scene prompts before video gen
  router.patch("/companies/:companyId/reels/:reelId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const reelId = req.params.reelId as string;
    await assertCompanyAccess(db, req, companyId);

    const { title, sceneEdits } = req.body ?? {};

    const [reel] = await db
      .select()
      .from(reels)
      .where(and(eq(reels.id, reelId), eq(reels.companyId, companyId)))
      .limit(1);
    if (!reel) throw notFound("reel not found");

    if (typeof title === "string") {
      await db
        .update(reels)
        .set({ title: title.trim() })
        .where(eq(reels.id, reelId));
    }

    // sceneEdits = [{ sceneIndex, keyframePrompt?, motionHint? }]
    if (Array.isArray(sceneEdits)) {
      // Only allow scene edits before video gen has started
      if (
        ["generating_video", "stitching", "complete"].includes(reel.status)
      ) {
        throw badRequest(
          `cannot edit scenes after status reaches generating_video (current: ${reel.status})`,
        );
      }
      for (const edit of sceneEdits) {
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (typeof edit.keyframePrompt === "string")
          patch.keyframePrompt = edit.keyframePrompt;
        if (typeof edit.motionHint === "string")
          patch.motionHint = edit.motionHint;
        if (Object.keys(patch).length > 1) {
          await db
            .update(reelScenes)
            .set(patch)
            .where(
              and(
                eq(reelScenes.reelId, reelId),
                eq(reelScenes.sceneIndex, edit.sceneIndex),
              ),
            );
        }
      }
    }

    res.json({ ok: true });
  });

  // POST /api/companies/:companyId/reels/:reelId/regenerate/:sceneIndex
  router.post(
    "/companies/:companyId/reels/:reelId/regenerate/:sceneIndex",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const reelId = req.params.reelId as string;
      const sceneIndex = parseInt(req.params.sceneIndex, 10);
      await assertCompanyAccess(db, req, companyId);

      // TODO: implement single-scene regen by clearing keyframe + video URLs
      // and resetting scene status to 'pending', then kicking orchestrator
      res.status(501).json({ error: "not implemented yet" });
    },
  );

  // POST /api/companies/:companyId/reels/:reelId/post
  router.post(
    "/companies/:companyId/reels/:reelId/post",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const reelId = req.params.reelId as string;
      await assertCompanyAccess(db, req, companyId);

      const { platforms, caption, scheduleAt } = req.body ?? {};
      if (!Array.isArray(platforms) || platforms.length === 0) {
        throw badRequest("platforms[] is required");
      }

      // TODO: hook into existing Paperclip distribution layer
      // For each platform, format the caption appropriately and submit
      res.status(501).json({ error: "not implemented yet — wire to distribution layer" });
    },
  );

  // GET /api/companies/:companyId/reel-templates — list global + company presets
  router.get("/companies/:companyId/reel-templates", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(db, req, companyId);

    // sql tag for "company-or-null"
    const rows = await db
      .select()
      .from(reelTemplates)
      .where(
        sql`${reelTemplates.companyId} = ${companyId} OR ${reelTemplates.companyId} IS NULL`,
      )
      .orderBy(reelTemplates.name);

    res.json({ templates: rows });
  });

  // POST /api/companies/:companyId/reel-templates
  router.post("/companies/:companyId/reel-templates", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(db, req, companyId);

    const {
      name,
      stylePreset,
      promptScaffold,
      durationSeconds = 15,
      aspectRatio = "9:16",
      defaultMusicMood,
      description,
    } = req.body ?? {};

    if (!name || !stylePreset || !promptScaffold) {
      throw badRequest("name, stylePreset, promptScaffold are required");
    }

    const [row] = await db
      .insert(reelTemplates)
      .values({
        companyId,
        name,
        description,
        stylePreset,
        promptScaffold,
        durationSeconds,
        aspectRatio,
        defaultMusicMood,
      })
      .returning();

    res.status(201).json({ template: row });
  });

  // GET /api/companies/:companyId/reel-series
  router.get("/companies/:companyId/reel-series", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(db, req, companyId);

    const rows = await db
      .select()
      .from(reelSeries)
      .where(eq(reelSeries.companyId, companyId))
      .orderBy(desc(reelSeries.createdAt));

    res.json({ series: rows });
  });

  // POST /api/companies/:companyId/reel-series
  router.post("/companies/:companyId/reel-series", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCompanyAccess(db, req, companyId);

    const { personaId, title, narrativeArc } = req.body ?? {};
    if (!personaId || !title) {
      throw badRequest("personaId and title are required");
    }

    const [row] = await db
      .insert(reelSeries)
      .values({ companyId, personaId, title, narrativeArc })
      .returning();

    res.status(201).json({ series: row });
  });

  // POST /api/companies/:companyId/reel-series/:seriesId/episodes
  router.post(
    "/companies/:companyId/reel-series/:seriesId/episodes",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const seriesId = req.params.seriesId as string;
      await assertCompanyAccess(db, req, companyId);

      const { reelId, episodeIndex } = req.body ?? {};
      if (!reelId || typeof episodeIndex !== "number") {
        throw badRequest("reelId and episodeIndex are required");
      }

      // Verify series belongs to company
      const [series] = await db
        .select()
        .from(reelSeries)
        .where(
          and(
            eq(reelSeries.id, seriesId),
            eq(reelSeries.companyId, companyId),
          ),
        )
        .limit(1);
      if (!series) throw notFound("series not found");

      await db
        .insert(reelSeriesEntries)
        .values({ seriesId, reelId, episodeIndex })
        .onConflictDoNothing();

      res.json({ ok: true });
    },
  );

  return router;
}
