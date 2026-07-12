// Creative Studio P0 routes (Fable spec 2026-07-12).
// UI surface: /creative-studio (Create + Library + Credits in P0).
// Providers per D1 ruling: server-side MCP clients (Higgsfield, OpenArt).
// Data honesty: unconfigured providers return 503 provider_not_configured — never mock output.

import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { creativeJobs } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { logActivity } from "../services/index.js";
import { creativeProviders, providerStatus, type CreativeMode, type ProviderId } from "../services/creative-studio/providers.js";

const MODES: CreativeMode[] = ["image", "video", "audio", "3d"];
const TERMINAL = new Set(["completed", "failed"]);

function isProviderId(v: unknown): v is ProviderId {
  return v === "higgsfield" || v === "openart";
}

export function creativeStudioRoutes(db: Db) {
  const router = Router();

  // GET /companies/:companyId/creative-studio/status — provider config + defaults (amber states)
  router.get("/companies/:companyId/creative-studio/status", async (req, res, next) => {
    try {
      assertCompanyAccess(req, req.params.companyId as string);
      res.json(providerStatus());
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/creative-studio/models — merged catalog, provider-badged
  router.get("/companies/:companyId/creative-studio/models", async (req, res, next) => {
    try {
      assertCompanyAccess(req, req.params.companyId as string);
      const providers = creativeProviders();
      const results = await Promise.allSettled(
        (Object.keys(providers) as ProviderId[])
          .filter((id) => providers[id].configured)
          .map((id) => providers[id].listModels()),
      );
      const models = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      const errors = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => String(r.reason?.message ?? r.reason).slice(0, 300));
      res.json({ models, errors });
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/creative-studio/credits
  router.get("/companies/:companyId/creative-studio/credits", async (req, res, next) => {
    try {
      assertCompanyAccess(req, req.params.companyId as string);
      const providers = creativeProviders();
      const out: Record<string, { balance: number | null; error?: string }> = {};
      for (const id of Object.keys(providers) as ProviderId[]) {
        if (!providers[id].configured) { out[id] = { balance: null, error: "provider_not_configured" }; continue; }
        try { out[id] = { balance: (await providers[id].credits()).balance }; }
        catch (e: any) { out[id] = { balance: null, error: String(e?.message ?? e).slice(0, 200) }; }
      }
      res.json({ credits: out });
    } catch (err) { next(err); }
  });

  // POST /companies/:companyId/creative-studio/generate
  router.post("/companies/:companyId/creative-studio/generate", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { provider, mode, model, prompt, params, refs, folder } = req.body ?? {};
      if (!isProviderId(provider)) return res.status(422).json({ error: "provider must be 'higgsfield' | 'openart'" });
      if (!MODES.includes(mode)) return res.status(422).json({ error: `mode must be one of ${MODES.join(", ")}` });
      if (!model || typeof model !== "string") return res.status(422).json({ error: "model is required" });
      if (typeof prompt !== "string" || prompt.trim() === "") return res.status(422).json({ error: "prompt is required" });
      const p = creativeProviders()[provider];
      if (!p.configured) {
        return res.status(503).json({ error: "provider_not_configured", provider, hint: (providerStatus() as any)[provider]?.keyedOffHint });
      }
      const actor = (req as any).actor;
      const safeParams = params && typeof params === "object" ? params : {};
      const safeRefs = Array.isArray(refs)
        ? refs.filter((r: any) => r && typeof r.role === "string" && typeof r.url === "string")
        : [];

      // persist first (Recreate loop needs the request even if dispatch fails)
      const [row] = await db.insert(creativeJobs).values({
        companyId, provider, mode, model,
        prompt: prompt.trim(), params: safeParams, refs: safeRefs,
        status: "pending", folder: typeof folder === "string" ? folder : null,
        createdBy: actor?.actorId ?? "unknown",
      }).returning();

      try {
        const state = await p.generate({ mode, model, prompt: prompt.trim(), params: safeParams, refs: safeRefs });
        const [updated] = await db.update(creativeJobs).set({
          providerJobId: state.providerJobId,
          status: state.status,
          outputs: state.outputs,
          costCredits: state.costCredits ?? null,
          error: state.error ?? null,
          updatedAt: new Date(),
        }).where(eq(creativeJobs.id, row.id)).returning();
        await logActivity(db, {
          companyId,
          actorType: actor?.type === "agent" ? "agent" : "user",
          actorId: actor?.actorId ?? "unknown",
          action: "creative_studio_generate",
          entityType: "creative_job",
          entityId: row.id,
        });
        res.status(201).json({ job: updated });
      } catch (e: any) {
        const [failed] = await db.update(creativeJobs).set({
          status: "failed", error: String(e?.message ?? e).slice(0, 500), updatedAt: new Date(),
        }).where(eq(creativeJobs.id, row.id)).returning();
        // dispatch failure is still a 201-created job with honest failed state? No —
        // surface it as 502 so the UI shows the real error; the row remains for Recreate.
        res.status(502).json({ error: "provider_dispatch_failed", detail: failed.error, job: failed });
      }
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/creative-studio/jobs?status=&mode=&limit=
  router.get("/companies/:companyId/creative-studio/jobs", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const limit = Math.min(Number(req.query.limit) || 60, 200);
      const conds = [eq(creativeJobs.companyId, companyId)];
      if (typeof req.query.status === "string" && req.query.status) conds.push(eq(creativeJobs.status, req.query.status));
      if (typeof req.query.mode === "string" && req.query.mode) conds.push(eq(creativeJobs.mode, req.query.mode));
      const rows = await db.select().from(creativeJobs)
        .where(and(...conds))
        .orderBy(desc(creativeJobs.createdAt))
        .limit(limit);
      res.json({ jobs: rows });
    } catch (err) { next(err); }
  });

  // GET /companies/:companyId/creative-studio/jobs/:jobId — refresh from provider when non-terminal
  router.get("/companies/:companyId/creative-studio/jobs/:jobId", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [row] = await db.select().from(creativeJobs)
        .where(and(eq(creativeJobs.id, req.params.jobId as string), eq(creativeJobs.companyId, companyId)))
        .limit(1);
      if (!row) return res.status(404).json({ error: "job not found" });
      if (TERMINAL.has(row.status) || !row.providerJobId) return res.json({ job: row });
      const p = creativeProviders()[row.provider as ProviderId];
      if (!p?.configured) return res.json({ job: row, warning: "provider_not_configured" });
      try {
        const state = await p.getJob(row.providerJobId, row.mode as CreativeMode);
        const [updated] = await db.update(creativeJobs).set({
          status: state.status,
          outputs: state.outputs.length > 0 ? state.outputs : row.outputs,
          costCredits: state.costCredits ?? row.costCredits,
          error: state.error ?? row.error,
          updatedAt: new Date(),
        }).where(eq(creativeJobs.id, row.id)).returning();
        res.json({ job: updated });
      } catch (e: any) {
        // polling failure is transient — return the stored row with an honest warning
        res.json({ job: row, warning: String(e?.message ?? e).slice(0, 300) });
      }
    } catch (err) { next(err); }
  });

  // PATCH /companies/:companyId/creative-studio/jobs/:jobId — favorite/folder only (P0)
  router.patch("/companies/:companyId/creative-studio/jobs/:jobId", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof req.body?.favorite === "boolean") patch.favorite = req.body.favorite ? 1 : 0;
      if (typeof req.body?.folder === "string" || req.body?.folder === null) patch.folder = req.body.folder;
      const [updated] = await db.update(creativeJobs).set(patch as any)
        .where(and(eq(creativeJobs.id, req.params.jobId as string), eq(creativeJobs.companyId, companyId)))
        .returning();
      if (!updated) return res.status(404).json({ error: "job not found" });
      res.json({ job: updated });
    } catch (err) { next(err); }
  });

  return router;
}
