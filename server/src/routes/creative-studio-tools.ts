// Creative Studio P1/P2 tools routes (Fable spec §3.2/3.4/3.5, 2026-07-12).
// Presets browser, one-click edit tools, characters/elements (read-only), virality
// panel, and the Explainer/Shorts/Clipper launchers — all over the Higgsfield MCP
// via the constrained provider.tool() surface (allowlisted here; never client-named).
// Every dispatched operation lands in creative_jobs so Library/Recreate work.
// Data honesty: unconfigured provider → 503; tool results parsed defensively, raw kept.

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { creativeJobs } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { logActivity } from "../services/index.js";
import { creativeProviders, providerStatus, type CreativeMode } from "../services/creative-studio/providers.js";

// ── allowlists — the ONLY HF tools this router will call ─────────────────────
const EDIT_TOOLS: Record<string, { mode: CreativeMode; urlArg: string }> = {
  upscale_image: { mode: "image", urlArg: "image_url" },
  upscale_video: { mode: "video", urlArg: "video_url" },
  outpaint_image: { mode: "image", urlArg: "image_url" },
  reframe: { mode: "video", urlArg: "video_url" },
  remove_background: { mode: "image", urlArg: "image_url" },
  motion_control: { mode: "video", urlArg: "video_url" },
};
const BROWSE_TOOLS = new Set(["presets_show", "show_characters", "show_reference_elements", "get_youtube_explainer_presets"]);

function hf() {
  const p = creativeProviders().higgsfield;
  if (!p.configured || !p.tool) {
    const err: any = new Error("provider_not_configured");
    err.status = 503;
    err.hint = providerStatus().higgsfield.keyedOffHint;
    throw err;
  }
  return p;
}

function firstArray(json: any, keys: string[]): any[] {
  for (const k of keys) if (Array.isArray(json?.[k])) return json[k];
  return Array.isArray(json) ? json : [];
}

function pickUrl(o: any): string | null {
  const u = o?.url ?? o?.video_url ?? o?.image_url ?? o?.preview_url ?? o?.thumbnail_url ?? null;
  return typeof u === "string" ? u : null;
}

export function creativeStudioToolsRoutes(db: Db) {
  const router = Router();

  const browse = (path: string, tool: string, listKeys: string[]) => {
    if (!BROWSE_TOOLS.has(tool)) throw new Error(`tool ${tool} not allowlisted`);
    router.get(`/companies/:companyId/creative-tools/${path}`, async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId as string);
        const args: Record<string, unknown> = {};
        if (typeof req.query.category === "string") args.category = req.query.category;
        if (typeof req.query.query === "string") args.query = req.query.query;
        const json = await hf().tool!(tool, args);
        const items = firstArray(json, listKeys).map((it: any) => ({
          id: String(it.id ?? it.preset_id ?? it.name ?? ""),
          name: String(it.name ?? it.display_name ?? it.title ?? it.id ?? ""),
          description: it.description ? String(it.description) : "",
          category: it.category ? String(it.category) : (it.type ? String(it.type) : ""),
          previewUrl: pickUrl(it),
          raw: it,
        }));
        res.json({ items });
      } catch (err) { next(err); }
    });
  };

  // ── P1: presets browser (camera controls / viral / VFX / looks) ────────────
  browse("presets", "presets_show", ["presets", "items", "results"]);
  // ── P2: characters + reference elements (read-only) ────────────────────────
  browse("characters", "show_characters", ["characters", "items"]);
  browse("elements", "show_reference_elements", ["elements", "items", "references"]);
  // ── P2: explainer presets ───────────────────────────────────────────────────
  browse("explainer-presets", "get_youtube_explainer_presets", ["presets", "items"]);

  // ── P1: one-click edit tools → creative_jobs (purpose='edit:<tool>') ───────
  router.post("/companies/:companyId/creative-tools/edit/:tool", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const toolName = req.params.tool as string;
      const spec = EDIT_TOOLS[toolName];
      if (!spec) return res.status(422).json({ error: `unknown edit tool; allowed: ${Object.keys(EDIT_TOOLS).join(", ")}` });
      const sourceUrl = req.body?.sourceUrl;
      if (typeof sourceUrl !== "string" || !/^https?:\/\//.test(sourceUrl)) {
        return res.status(422).json({ error: "sourceUrl (http/https) is required" });
      }
      const p = hf();
      const params = req.body?.params && typeof req.body.params === "object" ? req.body.params : {};
      const actor = (req as any).actor;
      const [row] = await db.insert(creativeJobs).values({
        companyId, provider: "higgsfield", mode: spec.mode, model: toolName,
        prompt: typeof req.body?.prompt === "string" ? req.body.prompt : "",
        params: { ...params, sourceUrl }, refs: [{ role: spec.urlArg, url: sourceUrl }],
        status: "pending", purpose: `edit:${toolName}`,
        createdBy: actor?.actorId ?? "unknown",
      }).returning();
      try {
        const json = await p.tool!(toolName, { [spec.urlArg]: sourceUrl, ...(typeof req.body?.prompt === "string" && req.body.prompt ? { prompt: req.body.prompt } : {}), ...params }, 300_000);
        const jobId = json?.job_id ?? json?.id ?? null;
        const outUrl = pickUrl(json) ?? pickUrl(json?.result ?? {});
        const done = !!outUrl;
        const [updated] = await db.update(creativeJobs).set({
          providerJobId: jobId != null ? String(jobId) : null,
          status: done ? "completed" : "running",
          outputs: outUrl ? [{ url: outUrl, kind: spec.mode }] : [],
          updatedAt: new Date(),
        }).where(eq(creativeJobs.id, row.id)).returning();
        res.status(201).json({ job: updated });
      } catch (e: any) {
        const [failed] = await db.update(creativeJobs).set({
          status: "failed", error: String(e?.message ?? e).slice(0, 500), updatedAt: new Date(),
        }).where(eq(creativeJobs.id, row.id)).returning();
        res.status(502).json({ error: "provider_dispatch_failed", detail: failed.error, job: failed });
      }
    } catch (err) { next(err); }
  });

  // ── P2: virality panel — score a completed video job ───────────────────────
  router.post("/companies/:companyId/creative-tools/virality/:jobId", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [job] = await db.select().from(creativeJobs)
        .where(and(eq(creativeJobs.id, req.params.jobId as string), eq(creativeJobs.companyId, companyId))).limit(1);
      if (!job) return res.status(404).json({ error: "job not found" });
      const videoUrl = job.outputs.find((o) => o.url)?.url;
      if (job.mode !== "video" || job.status !== "completed" || !videoUrl) {
        return res.status(422).json({ error: "virality needs a completed video job with output" });
      }
      const json = await hf().tool!("virality_predictor", { video_url: videoUrl }, 300_000);
      const virality = {
        score: json?.score ?? json?.virality_score ?? null,
        summary: json?.summary ?? json?.analysis ?? null,
        raw: json,
        scoredAt: new Date().toISOString(),
      };
      const [updated] = await db.update(creativeJobs).set({
        params: { ...(job.params as Record<string, unknown>), virality },
        updatedAt: new Date(),
      }).where(eq(creativeJobs.id, job.id)).returning();
      const actor = (req as any).actor;
      await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "creative_virality_scored", entityType: "creative_job", entityId: job.id });
      res.json({ job: updated, virality });
    } catch (err) { next(err); }
  });

  // ── P2 launchers: explainer / shorts / clipper ──────────────────────────────
  // Each dispatch lands in creative_jobs; session-style tools carry their status
  // tool in params.poll and refresh via POST .../launcher-status/:jobId.

  router.post("/companies/:companyId/creative-tools/explainer", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const prompt = req.body?.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) return res.status(422).json({ error: "prompt is required" });
      const p = hf();
      const args: Record<string, unknown> = { prompt: prompt.trim() };
      if (typeof req.body?.preset === "string" && req.body.preset) args.preset = req.body.preset;
      if (typeof req.body?.voiceId === "string" && req.body.voiceId) args.voice_id = req.body.voiceId;
      const actor = (req as any).actor;
      const [row] = await db.insert(creativeJobs).values({
        companyId, provider: "higgsfield", mode: "video", model: "explainer_video",
        prompt: prompt.trim(), params: { ...(args.preset ? { preset: args.preset } : {}) },
        refs: [], status: "pending", purpose: "explainer", createdBy: actor?.actorId ?? "unknown",
      }).returning();
      try {
        const json = await p.tool!("explainer_video", args, 300_000);
        const jobId = json?.job_id ?? json?.id ?? json?.session_id ?? null;
        const outUrl = pickUrl(json);
        const [updated] = await db.update(creativeJobs).set({
          providerJobId: jobId != null ? String(jobId) : null,
          status: outUrl ? "completed" : "running",
          outputs: outUrl ? [{ url: outUrl, kind: "video" }] : [],
          updatedAt: new Date(),
        }).where(eq(creativeJobs.id, row.id)).returning();
        res.status(201).json({ job: updated });
      } catch (e: any) {
        const [failed] = await db.update(creativeJobs).set({ status: "failed", error: String(e?.message ?? e).slice(0, 500), updatedAt: new Date() }).where(eq(creativeJobs.id, row.id)).returning();
        res.status(502).json({ error: "provider_dispatch_failed", detail: failed.error, job: failed });
      }
    } catch (err) { next(err); }
  });

  router.post("/companies/:companyId/creative-tools/shorts", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
      if (!prompt) return res.status(422).json({ error: "prompt is required" });
      const p = hf();
      const args: Record<string, unknown> = { prompt };
      if (typeof req.body?.presetId === "string" && req.body.presetId) args.preset_id = req.body.presetId;
      if (typeof req.body?.sourceUrl === "string" && req.body.sourceUrl) args.video_url = req.body.sourceUrl;
      const actor = (req as any).actor;
      const [row] = await db.insert(creativeJobs).values({
        companyId, provider: "higgsfield", mode: "video", model: "shorts_studio",
        prompt, params: { poll: { tool: "shorts_studio_status" } }, refs: [],
        status: "pending", purpose: "shorts", createdBy: actor?.actorId ?? "unknown",
      }).returning();
      try {
        const json = await p.tool!("shorts_studio_create", args, 300_000);
        const sessionId = json?.session_id ?? json?.id ?? json?.job_id ?? null;
        const [updated] = await db.update(creativeJobs).set({
          providerJobId: sessionId != null ? String(sessionId) : null,
          status: "running",
          params: { poll: { tool: "shorts_studio_status", args: { session_id: sessionId } } },
          updatedAt: new Date(),
        }).where(eq(creativeJobs.id, row.id)).returning();
        res.status(201).json({ job: updated });
      } catch (e: any) {
        const [failed] = await db.update(creativeJobs).set({ status: "failed", error: String(e?.message ?? e).slice(0, 500), updatedAt: new Date() }).where(eq(creativeJobs.id, row.id)).returning();
        res.status(502).json({ error: "provider_dispatch_failed", detail: failed.error, job: failed });
      }
    } catch (err) { next(err); }
  });

  router.post("/companies/:companyId/creative-tools/clipper", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const youtubeUrl = req.body?.youtubeUrl;
      if (typeof youtubeUrl !== "string" || !/^https?:\/\//.test(youtubeUrl)) {
        return res.status(422).json({ error: "youtubeUrl is required" });
      }
      const p = hf();
      const actor = (req as any).actor;
      const [row] = await db.insert(creativeJobs).values({
        companyId, provider: "higgsfield", mode: "video", model: "personal_clipper",
        prompt: youtubeUrl, params: { poll: { tool: "personal_clipper_status" } }, refs: [],
        status: "pending", purpose: "clipper", createdBy: actor?.actorId ?? "unknown",
      }).returning();
      try {
        const json = await p.tool!("personal_clipper_create", { video_url: youtubeUrl, ...(req.body?.params ?? {}) }, 300_000);
        const jobId = json?.job_id ?? json?.id ?? null;
        const [updated] = await db.update(creativeJobs).set({
          providerJobId: jobId != null ? String(jobId) : null,
          status: "running",
          params: { poll: { tool: "personal_clipper_status", args: { job_id: jobId } } },
          updatedAt: new Date(),
        }).where(eq(creativeJobs.id, row.id)).returning();
        res.status(201).json({ job: updated });
      } catch (e: any) {
        const [failed] = await db.update(creativeJobs).set({ status: "failed", error: String(e?.message ?? e).slice(0, 500), updatedAt: new Date() }).where(eq(creativeJobs.id, row.id)).returning();
        res.status(502).json({ error: "provider_dispatch_failed", detail: failed.error, job: failed });
      }
    } catch (err) { next(err); }
  });

  // status refresh for session-style launcher jobs (poll tool recorded on the row)
  const LAUNCHER_POLL_TOOLS = new Set(["shorts_studio_status", "personal_clipper_status"]);
  router.post("/companies/:companyId/creative-tools/launcher-status/:jobId", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [job] = await db.select().from(creativeJobs)
        .where(and(eq(creativeJobs.id, req.params.jobId as string), eq(creativeJobs.companyId, companyId))).limit(1);
      if (!job) return res.status(404).json({ error: "job not found" });
      const poll = (job.params as any)?.poll;
      if (!poll?.tool || !LAUNCHER_POLL_TOOLS.has(poll.tool)) return res.json({ job });
      if (job.status === "completed" || job.status === "failed") return res.json({ job });
      try {
        const json = await hf().tool!(poll.tool, poll.args ?? {});
        const s = String(json?.status ?? json?.state ?? "").toLowerCase();
        const outputs: Array<{ url: string; kind: string }> = [];
        for (const c of firstArray(json, ["clips", "outputs", "results", "videos"])) {
          const u = pickUrl(c);
          if (u) outputs.push({ url: u, kind: "video" });
        }
        const single = pickUrl(json);
        if (outputs.length === 0 && single) outputs.push({ url: single, kind: "video" });
        const done = ["completed", "succeeded", "done", "finished"].includes(s) || outputs.length > 0;
        const failed = ["failed", "error", "cancelled"].includes(s);
        const [updated] = await db.update(creativeJobs).set({
          status: failed ? "failed" : done ? "completed" : "running",
          outputs: outputs.length > 0 ? outputs : job.outputs,
          error: failed ? String(json?.error ?? "provider reported failure").slice(0, 300) : job.error,
          updatedAt: new Date(),
        }).where(eq(creativeJobs.id, job.id)).returning();
        res.json({ job: updated });
      } catch (e: any) {
        res.json({ job, warning: String(e?.message ?? e).slice(0, 300) });
      }
    } catch (err) { next(err); }
  });

  return router;
}
