import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import type { Db } from "@paperclipai/db";
import { createDesignRunsService } from "../services/design-runs.js";
import {
  odHealth,
  odListAgents,
  odListSkills,
  type OdSkill,
} from "../services/opendesign-client.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound } from "../errors.js";

export function designRoutes(db: Db) {
  const router = Router();
  const service = createDesignRunsService(db);

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
      const run = await service.start({
        companyId: typeof body.companyId === "string" ? body.companyId : null,
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

  return router;
}
