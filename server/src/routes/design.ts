import { Router } from "express";
import path from "node:path";
import { createReadStream, stat } from "node:fs";
import fs from "node:fs/promises";
import type { Db } from "@paperclipai/db";
import { createDesignRunsService } from "../services/design-runs.js";
import {
  createPresetRunsService,
  lookupPreset,
  PRESET_DEFINITIONS,
} from "../services/design-presets.js";
import {
  odHealth,
  odListAgents,
  odListSkills,
  type OdSkill,
} from "../services/opendesign-client.js";
import { assertAuthenticated, assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound } from "../errors.js";

export function designRoutes(db: Db) {
  const router = Router();
  const service = createDesignRunsService(db);
  const presets = createPresetRunsService(db, service);

  router.get("/design/health", async (_req, res, next) => {
    try {
      const h = await odHealth();
      res.json(h);
    } catch (err) {
      next(err);
    }
  });

  router.get("/design/skills", async (req, res, next) => {
    try {
      const skills = await odListSkills();
      const mode = typeof req.query.mode === "string" ? req.query.mode : undefined;
      const filtered = mode ? skills.filter((s) => s.mode === mode) : skills;
      // Tight shape — drop heavy fields the picker doesn't need.
      const slim = filtered.map((s: OdSkill) => ({
        id: s.id,
        name: s.name ?? s.id,
        description: s.description ?? "",
        mode: s.mode,
        surface: s.surface ?? null,
        scenario: s.scenario ?? null,
        platform: s.platform ?? null,
        category: s.category ?? null,
        previewType: s.previewType ?? null,
        designSystemRequired: s.designSystemRequired ?? false,
        examplePrompt: s.examplePrompt ?? null,
      }));
      res.json({ skills: slim, total: slim.length });
    } catch (err) {
      next(err);
    }
  });

  router.get("/design/agents", async (_req, res, next) => {
    try {
      const agents = await odListAgents();
      res.json({ agents });
    } catch (err) {
      next(err);
    }
  });

  router.post("/companies/:companyId/design/run", async (req, res, next) => {
    try {
      const companyId = req.params.companyId;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const body = req.body ?? {};
      const skill = typeof body.skill === "string" ? body.skill.trim() : "";
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!skill) throw badRequest("skill required");
      if (!prompt) throw badRequest("prompt required");
      const run = await service.start({
        companyId,
        skill,
        prompt,
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        designSystemId: typeof body.designSystemId === "string" ? body.designSystemId : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        params: typeof body.params === "object" && body.params ? body.params : {},
        outputType: body.outputType === "png" || body.outputType === "mp4" ? body.outputType : "html",
        createdBy: actor.actorId ?? null,
      });
      res.status(202).json({ run });
    } catch (err) {
      next(err);
    }
  });

  // Convenience un-scoped route — sets companyId=null. Used by Jarvis / Knowledge
  // Graph / anywhere we don't have a company in scope yet.
  router.post("/design/run", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const skill = typeof body.skill === "string" ? body.skill.trim() : "";
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!skill) throw badRequest("skill required");
      if (!prompt) throw badRequest("prompt required");
      const actor = getActorInfo(req);
      const companyId =
        typeof body.companyId === "string"
          ? body.companyId
          : req.actor.type === "agent"
            ? req.actor.companyId
            : null;
      if (companyId) assertCompanyAccess(req, companyId);
      const run = await service.start({
        companyId,
        skill,
        prompt,
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        designSystemId: typeof body.designSystemId === "string" ? body.designSystemId : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        params: typeof body.params === "object" && body.params ? body.params : {},
        createdBy: actor.actorId ?? null,
      });
      res.status(202).json({ run });
    } catch (err) {
      next(err);
    }
  });

  router.get("/design/runs", async (req, res, next) => {
    try {
      const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
      const limit = Math.min(200, Number(req.query.limit) || 50);
      if (companyId) assertCompanyAccess(req, companyId);
      const runs = await service.list(companyId, limit);
      res.json({ runs });
    } catch (err) {
      next(err);
    }
  });

  router.get("/design/runs/:id", async (req, res, next) => {
    try {
      const run = await service.get(req.params.id);
      if (!run) throw notFound("design run not found");
      if (run.companyId) assertCompanyAccess(req, run.companyId);
      res.json({ run });
    } catch (err) {
      next(err);
    }
  });

  router.get("/design/runs/:id/asset", async (req, res, next) => {
    try {
      const run = await service.get(req.params.id);
      if (!run || !run.assetPath) throw notFound("asset not ready");
      if (run.companyId) assertCompanyAccess(req, run.companyId);
      const html = await fs.readFile(run.assetPath, "utf8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.send(html);
    } catch (err) {
      next(err);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Range-aware file stream helper
  // ─────────────────────────────────────────────────────────────────────────
  function sendFileWithRange(filePath: string, mimeType: string, req: import("express").Request, res: import("express").Response) {
    return new Promise<void>((resolve, reject) => {
      stat(filePath, (err, stats) => {
        if (err) return reject(notFound("file not found"));
        const fileSize = stats.size;
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Type", mimeType);
        res.setHeader("Cache-Control", "private, max-age=60");

        const rangeHeader = req.headers.range;
        if (!rangeHeader) {
          // Full content
          res.status(200);
          const stream = createReadStream(filePath);
          stream.pipe(res);
          stream.on("end", resolve);
          stream.on("error", reject);
          return;
        }

        // Parse Range: bytes=start-end
        const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
        if (!match) {
          res.status(416);
          res.setHeader("Content-Range", `bytes */${fileSize}`);
          res.end();
          resolve();
          return;
        }

        const start = parseInt(match[1], 10);
        const endStr = match[2];
        const end = endStr ? Math.min(parseInt(endStr, 10), fileSize - 1) : fileSize - 1;

        if (start >= fileSize || start > end) {
          res.status(416);
          res.setHeader("Content-Range", `bytes */${fileSize}`);
          res.end();
          resolve();
          return;
        }

        const chunkSize = end - start + 1;
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
        res.setHeader("Content-Length", chunkSize);

        const stream = createReadStream(filePath, { start, end });
        stream.pipe(res);
        stream.on("end", resolve);
        stream.on("error", reject);
      });
    });
  }

  // Rasterized PNG. ?slide=N (1-based) for carousel skills; defaults to slide 1
  // (or the single full-page PNG for non-carousel kinds).
  router.get("/design/runs/:id/asset.png", async (req, res, next) => {
    try {
      const run = await service.get(req.params.id);
      if (!run) throw notFound("design run not found");
      if (run.companyId) assertCompanyAccess(req, run.companyId);
      const paths = Array.isArray(run.pngPaths) ? (run.pngPaths as string[]) : [];
      if (paths.length === 0) throw notFound("png not ready");
      const slideParam = typeof req.query.slide === "string" ? parseInt(req.query.slide, 10) : 1;
      const slideIdx = Math.max(1, Math.min(paths.length, isNaN(slideParam) ? 1 : slideParam)) - 1;
      await sendFileWithRange(paths[slideIdx], "image/png", req, res);
    } catch (err) {
      next(err);
    }
  });

  // MP4 for motion artifacts.
  router.get("/design/runs/:id/asset.mp4", async (req, res, next) => {
    try {
      const run = await service.get(req.params.id);
      if (!run) throw notFound("design run not found");
      if (run.companyId) assertCompanyAccess(req, run.companyId);
      if (!run.mp4Path) throw notFound("mp4 not ready");
      await sendFileWithRange(run.mp4Path, "video/mp4", req, res);
    } catch (err) {
      next(err);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Preset macros — Marketing kit / Landing page / Influencer post pack /
  // Brand kit / Email blast. Each invokes 1–N skills under the hood and
  // returns a parent design_preset_runs row + child design_runs rows.
  // ─────────────────────────────────────────────────────────────────────────

  router.get("/design/presets", (_req, res) => {
    res.json({
      presets: PRESET_DEFINITIONS.map((p) => ({
        slug: p.slug,
        name: p.name,
        description: p.description,
        estimateMin: p.estimateMin,
        cardEmoji: p.cardEmoji,
        steps: p.steps.map((s) => ({ label: s.label, skill: s.skill })),
        stepCount: p.steps.length,
      })),
    });
  });

  router.post("/design/presets/:slug/run", async (req, res, next) => {
    try {
      assertAuthenticated(req);
      const slug = req.params.slug;
      if (!lookupPreset(slug)) throw notFound(`preset ${slug} not found`);
      const body = req.body ?? {};
      const brief = typeof body.brief === "string" ? body.brief.trim() : "";
      if (!brief) throw badRequest("brief required");
      const companyId = typeof body.companyId === "string" ? body.companyId : null;
      if (companyId) assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const result = await presets.start({
        companyId,
        presetSlug: slug,
        brief,
        voice: typeof body.voice === "string" ? body.voice : undefined,
        persona: typeof body.persona === "string" ? body.persona : undefined,
        createdBy: actor.actorId ?? null,
        idempotencySeed:
          typeof req.header("idempotency-key") === "string"
            ? req.header("idempotency-key")?.trim() || undefined
            : undefined,
      });
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/design/preset-runs/:id", async (req, res, next) => {
    try {
      const result = await presets.get(req.params.id);
      if (!result) throw notFound("preset run not found");
      if (result.preset.companyId) assertCompanyAccess(req, result.preset.companyId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get("/design/preset-runs", async (req, res, next) => {
    try {
      const companyId = typeof req.query.companyId === "string" ? req.query.companyId : null;
      if (companyId) assertCompanyAccess(req, companyId);
      const limit = Math.min(200, Number(req.query.limit) || 50);
      const rows = await presets.list(companyId, limit);
      res.json({ presetRuns: rows });
    } catch (err) {
      next(err);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Agent-friendly bearer-token surface. The auth middleware already routes
  // an `Authorization: Bearer <agent-key>` header to req.actor.type=="agent",
  // so we just need an unscoped endpoint with idempotency that returns shape
  // friendly to non-browser callers (no session cookie required).
  //
  // Idempotency: pass `Idempotency-Key: <stable-string>` header — repeated
  // calls with the same key + same companyId return the existing run row
  // instead of starting a new one.
  // ─────────────────────────────────────────────────────────────────────────

  router.post("/agent/design/run", async (req, res, next) => {
    try {
      assertAuthenticated(req);
      const body = req.body ?? {};
      const skill = typeof body.skill === "string" ? body.skill.trim() : "";
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!skill) throw badRequest("skill required");
      if (!prompt) throw badRequest("prompt required");
      const companyId = typeof body.companyId === "string" ? body.companyId : null;
      if (companyId) assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const idemKey =
        req.header("idempotency-key")?.trim() ||
        (typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined);
      const run = await service.start({
        companyId,
        skill,
        prompt,
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        designSystemId:
          typeof body.designSystemId === "string" ? body.designSystemId : undefined,
        model: typeof body.model === "string" ? body.model : undefined,
        params: typeof body.params === "object" && body.params ? body.params : {},
        outputType:
          body.outputType === "png" || body.outputType === "mp4" ? body.outputType : "html",
        createdBy: actor.actorId ?? null,
        idempotencyKey: idemKey ?? null,
      });
      res.status(202).json({
        run,
        urls: {
          status: `/api/design/runs/${run.id}`,
          html: `/api/design/runs/${run.id}/asset`,
          png: `/api/design/runs/${run.id}/asset.png`,
          mp4: `/api/design/runs/${run.id}/asset.mp4`,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/agent/design/presets/:slug/run", async (req, res, next) => {
    try {
      assertAuthenticated(req);
      const slug = req.params.slug;
      if (!lookupPreset(slug)) throw notFound(`preset ${slug} not found`);
      const body = req.body ?? {};
      const brief = typeof body.brief === "string" ? body.brief.trim() : "";
      if (!brief) throw badRequest("brief required");
      const companyId = typeof body.companyId === "string" ? body.companyId : null;
      if (companyId) assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const result = await presets.start({
        companyId,
        presetSlug: slug,
        brief,
        voice: typeof body.voice === "string" ? body.voice : undefined,
        persona: typeof body.persona === "string" ? body.persona : undefined,
        createdBy: actor.actorId ?? null,
        idempotencySeed: req.header("idempotency-key")?.trim() || undefined,
      });
      res.status(202).json({
        ...result,
        urls: {
          status: `/api/design/preset-runs/${result.preset.id}`,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
