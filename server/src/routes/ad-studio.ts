// Creative Studio P2 — Ad Studio routes (Fable spec §3.3, 2026-07-12).
// Product URL + brand kit → ad-format × hook × setting matrix → batch variant jobs,
// with the D6 spend-confirm threshold (estimate first, confirm to dispatch — the
// same requiresConfirm pattern as book-studio narration). Ad-reference: analyze an
// existing ad via HF video_analysis_*, then feed its structure into a batch.
// Data honesty: 503 when Higgsfield is keyed off; estimates labeled estimates.

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { creativeJobs, creativeBrandKits } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { logActivity } from "../services/index.js";
import { creativeProviders, providerStatus } from "../services/creative-studio/providers.js";

const BATCH_CONFIRM_THRESHOLD_CREDITS = 50; // D6 default (Tyler can override)
const EST_CREDITS_PER_VIDEO_VARIANT = 25;   // labeled estimate; real cost lands on job rows
const MAX_VARIANTS_PER_BATCH = 12;

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

export function adStudioRoutes(db: Db) {
  const router = Router();

  // ── brand kits ──────────────────────────────────────────────────────────────
  router.get("/companies/:companyId/ad-studio/brand-kits", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db.select().from(creativeBrandKits)
        .where(eq(creativeBrandKits.companyId, companyId))
        .orderBy(desc(creativeBrandKits.createdAt));
      res.json({ brandKits: rows });
    } catch (err) { next(err); }
  });

  router.post("/companies/:companyId/ad-studio/brand-kits", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { name, productUrl, logoUrl, colors, tone, description } = req.body ?? {};
      if (!name || typeof name !== "string") return res.status(422).json({ error: "name is required" });
      const actor = (req as any).actor;
      const [kit] = await db.insert(creativeBrandKits).values({
        companyId, name: name.trim(),
        productUrl: typeof productUrl === "string" ? productUrl : null,
        logoUrl: typeof logoUrl === "string" ? logoUrl : null,
        colors: Array.isArray(colors) ? colors.filter((c: unknown) => typeof c === "string") : [],
        tone: typeof tone === "string" ? tone : null,
        description: typeof description === "string" ? description : null,
        createdBy: actor?.actorId ?? "unknown",
      }).returning();
      res.status(201).json({ brandKit: kit });
    } catch (err) { next(err); }
  });

  // ── ad-reference: analyze an existing ad video ─────────────────────────────
  router.post("/companies/:companyId/ad-studio/ad-reference", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const videoUrl = req.body?.videoUrl;
      if (typeof videoUrl !== "string" || !/^https?:\/\//.test(videoUrl)) {
        return res.status(422).json({ error: "videoUrl is required" });
      }
      const json = await hf().tool!("video_analysis_create", { video_url: videoUrl }, 300_000);
      const analysisId = json?.job_id ?? json?.id ?? null;
      const actor = (req as any).actor;
      const [row] = await db.insert(creativeJobs).values({
        companyId, provider: "higgsfield", mode: "video", model: "video_analysis",
        prompt: videoUrl,
        params: { poll: { tool: "video_analysis_status", args: { job_id: analysisId } } },
        refs: [{ role: "video_references", url: videoUrl }],
        status: "running", providerJobId: analysisId != null ? String(analysisId) : null,
        purpose: "ad-reference", createdBy: actor?.actorId ?? "unknown",
      }).returning();
      res.status(201).json({ job: row });
    } catch (err) { next(err); }
  });

  router.post("/companies/:companyId/ad-studio/ad-reference/:jobId/refresh", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const [job] = await db.select().from(creativeJobs)
        .where(and(eq(creativeJobs.id, req.params.jobId as string), eq(creativeJobs.companyId, companyId), eq(creativeJobs.purpose, "ad-reference"))).limit(1);
      if (!job) return res.status(404).json({ error: "ad-reference job not found" });
      if (job.status === "completed" || job.status === "failed") return res.json({ job });
      try {
        const poll = (job.params as any)?.poll;
        const json = await hf().tool!("video_analysis_status", poll?.args ?? { job_id: job.providerJobId });
        const s = String(json?.status ?? "").toLowerCase();
        const analysis = json?.analysis ?? json?.result ?? null;
        const done = ["completed", "succeeded", "done"].includes(s) || !!analysis;
        const failed = ["failed", "error"].includes(s);
        const [updated] = await db.update(creativeJobs).set({
          status: failed ? "failed" : done ? "completed" : "running",
          params: { ...(job.params as Record<string, unknown>), analysis },
          error: failed ? String(json?.error ?? "analysis failed").slice(0, 300) : null,
          updatedAt: new Date(),
        }).where(eq(creativeJobs.id, job.id)).returning();
        res.json({ job: updated });
      } catch (e: any) {
        res.json({ job, warning: String(e?.message ?? e).slice(0, 300) });
      }
    } catch (err) { next(err); }
  });

  // ── batch: estimate → confirm → dispatch matrix ─────────────────────────────
  router.post("/companies/:companyId/ad-studio/batches", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { brandKitId, productUrl, model, formats, hooks, settings, characterId, adReferenceJobId, confirm } = req.body ?? {};
      if (!model || typeof model !== "string") return res.status(422).json({ error: "model (video) is required" });
      const fmtList: string[] = Array.isArray(formats) ? formats.filter((f: unknown) => typeof f === "string") : [];
      const hookList: string[] = Array.isArray(hooks) && hooks.length > 0 ? hooks.filter((h: unknown) => typeof h === "string") : [""];
      const settingList: string[] = Array.isArray(settings) && settings.length > 0 ? settings.filter((s: unknown) => typeof s === "string") : [""];
      if (fmtList.length === 0) return res.status(422).json({ error: "at least one format is required" });

      const variants: Array<{ format: string; hook: string; setting: string }> = [];
      for (const format of fmtList) for (const hook of hookList) for (const setting of settingList) {
        variants.push({ format, hook, setting });
      }
      if (variants.length > MAX_VARIANTS_PER_BATCH) {
        return res.status(422).json({ error: `matrix too large: ${variants.length} variants (max ${MAX_VARIANTS_PER_BATCH})` });
      }

      const estimatedCredits = variants.length * EST_CREDITS_PER_VIDEO_VARIANT;
      if (confirm !== true && estimatedCredits > BATCH_CONFIRM_THRESHOLD_CREDITS) {
        return res.json({
          requiresConfirm: true,
          estimate: { variants: variants.length, estimatedCredits, note: "estimate only — real credit costs land on each job row", thresholdCredits: BATCH_CONFIRM_THRESHOLD_CREDITS },
          batch: null,
        });
      }

      hf(); // keyed check before persisting anything
      let kit = null;
      if (typeof brandKitId === "string" && brandKitId) {
        [kit] = await db.select().from(creativeBrandKits)
          .where(and(eq(creativeBrandKits.id, brandKitId), eq(creativeBrandKits.companyId, companyId))).limit(1);
        if (!kit) return res.status(404).json({ error: "brand kit not found" });
      }
      const url = typeof productUrl === "string" && productUrl ? productUrl : kit?.productUrl ?? null;

      // optional analyzed ad-reference structure
      let referenceAnalysis: unknown = null;
      if (typeof adReferenceJobId === "string" && adReferenceJobId) {
        const [ref] = await db.select().from(creativeJobs)
          .where(and(eq(creativeJobs.id, adReferenceJobId), eq(creativeJobs.companyId, companyId), eq(creativeJobs.purpose, "ad-reference"))).limit(1);
        referenceAnalysis = (ref?.params as any)?.analysis ?? null;
      }

      const batchId = randomUUID();
      const actor = (req as any).actor;
      const [batchRow] = await db.insert(creativeJobs).values({
        companyId, provider: "higgsfield", mode: "video", model,
        prompt: `Ad batch: ${fmtList.join(", ")} × ${hookList.filter(Boolean).length || 1} hooks × ${settingList.filter(Boolean).length || 1} settings`,
        params: { config: { brandKitId: kit?.id ?? null, productUrl: url, formats: fmtList, hooks: hookList, settings: settingList, characterId: characterId ?? null, estimatedCredits } },
        refs: [], status: "running", purpose: "ad-batch", batchId, createdBy: actor?.actorId ?? "unknown",
      }).returning();

      const jobs = [];
      for (const v of variants) {
        const brandBits = kit
          ? ` Brand: ${kit.name}${kit.tone ? `, tone: ${kit.tone}` : ""}${kit.colors.length ? `, colors: ${kit.colors.join("/")}` : ""}${kit.description ? `. ${kit.description}` : ""}.`
          : "";
        const prompt =
          `Short-form product ad (${v.format} format).${v.hook ? ` Hook: ${v.hook}.` : ""}${v.setting ? ` Setting: ${v.setting}.` : ""}` +
          `${url ? ` Product: ${url}.` : ""}${brandBits}` +
          `${referenceAnalysis ? ` Recreate the structure/pacing of the analyzed reference ad: ${JSON.stringify(referenceAnalysis).slice(0, 800)}.` : ""}` +
          ` Vertical 9:16, platform-native, hook in the first 2 seconds.`;
        const refs: Array<{ role: string; url: string }> = [];
        if (kit?.logoUrl) refs.push({ role: "image_references", url: kit.logoUrl });
        const [row] = await db.insert(creativeJobs).values({
          companyId, provider: "higgsfield", mode: "video", model, prompt,
          params: { format: v.format, hook: v.hook, setting: v.setting, ...(characterId ? { character_id: characterId } : {}) },
          refs, status: "pending", purpose: "ad-variant", batchId, createdBy: actor?.actorId ?? "unknown",
        }).returning();
        try {
          const state = await creativeProviders().higgsfield.generate({
            mode: "video", model, prompt,
            params: { aspect_ratio: "9:16", ...(characterId ? { character_id: characterId } : {}) },
            refs,
          });
          const [updated] = await db.update(creativeJobs).set({
            providerJobId: state.providerJobId, status: state.status, outputs: state.outputs,
            costCredits: state.costCredits ?? null, error: state.error ?? null, updatedAt: new Date(),
          }).where(eq(creativeJobs.id, row.id)).returning();
          jobs.push(updated);
        } catch (e: any) {
          const [failed] = await db.update(creativeJobs).set({
            status: "failed", error: String(e?.message ?? e).slice(0, 500), updatedAt: new Date(),
          }).where(eq(creativeJobs.id, row.id)).returning();
          jobs.push(failed);
        }
      }

      await logActivity(db, { companyId, actorType: actor?.type === "agent" ? "agent" : "user", actorId: actor?.actorId ?? "unknown", action: "ad_batch_dispatched", entityType: "creative_job", entityId: batchRow.id, details: { batchId, variants: variants.length } });
      res.status(201).json({ batch: batchRow, jobs, batchId, estimatedCredits });
    } catch (err) { next(err); }
  });

  // ── batches list + detail (variant grid) ────────────────────────────────────
  router.get("/companies/:companyId/ad-studio/batches", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await db.select().from(creativeJobs)
        .where(and(eq(creativeJobs.companyId, companyId), eq(creativeJobs.purpose, "ad-batch")))
        .orderBy(desc(creativeJobs.createdAt)).limit(30);
      res.json({ batches: rows });
    } catch (err) { next(err); }
  });

  router.get("/companies/:companyId/ad-studio/batches/:batchId", async (req, res, next) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const batchId = req.params.batchId as string;
      const rows = await db.select().from(creativeJobs)
        .where(and(eq(creativeJobs.companyId, companyId), eq(creativeJobs.batchId, batchId)))
        .orderBy(desc(creativeJobs.createdAt));
      const batch = rows.find((r) => r.purpose === "ad-batch") ?? null;
      if (!batch) return res.status(404).json({ error: "batch not found" });
      res.json({ batch, variants: rows.filter((r) => r.purpose === "ad-variant") });
    } catch (err) { next(err); }
  });

  return router;
}
