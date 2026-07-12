/**
 * Bulk-upload routes — backs the "Bulk Upload" tab on the Social
 * Scheduler. Tyler's ask, verbatim:
 *   "Need a function where I can just upload a bunch of content and you
 *    schedule it based off the best timing/data and analytics."
 *
 * Endpoints (all scoped by company):
 *   POST   /companies/:companyId/social/bulk-upload/drafts
 *   GET    /companies/:companyId/social/bulk-upload/drafts
 *   GET    /companies/:companyId/social/bulk-upload/drafts/:draftId
 *   PATCH  /companies/:companyId/social/bulk-upload/drafts/:draftId
 *   DELETE /companies/:companyId/social/bulk-upload/drafts/:draftId
 *   POST   /companies/:companyId/social/bulk-upload/drafts/:draftId/files
 *   PATCH  /companies/:companyId/social/bulk-upload/drafts/:draftId/files/:fileId
 *   POST   /companies/:companyId/social/bulk-upload/drafts/:draftId/files/delete
 *   POST   /companies/:companyId/social/bulk-upload/drafts/:draftId/reorder
 *
 * ZIP archive extraction is intentionally a follow-up — multi-file upload
 * via the standard multipart array form is enough for v0, and the iOS file
 * picker hands you N images at once anyway.
 */
import { Router } from "express";
import multer from "multer";
import type { Db } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { designRuns } from "@paperclipai/db";
import { bulkUploadService } from "../services/bulk-upload.js";
import { socialService } from "../services/social.js";
import {
  BULK_UPLOAD_PLATFORMS,
  autoSchedule,
  computeBestTimes,
  type BulkUploadPlatform,
  type BestTimeSlot,
  type ScheduleStrategy,
  type ScheduleUpload,
} from "../services/best-time/index.js";
import {
  suggestCaption,
  CaptionProviderError,
  CaptionConfigError,
} from "../services/social-caption.js";
import { buildPublishMediaUrl } from "../services/social-scheduler/media.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound } from "../errors.js";

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function isBulkUploadPlatform(value: string): value is BulkUploadPlatform {
  return (BULK_UPLOAD_PLATFORMS as readonly string[]).includes(value);
}

/** What the bulk-upload tab will accept. Conservatively narrow on purpose. */
const ALLOWED_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);

const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200 MB per file
const MAX_FILES_PER_BATCH = 50;

function detectType(mimeType: string): "image" | "video" | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

function parseStrategy(input: unknown): ScheduleStrategy | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === "even") {
    const startDate = String(obj.startDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
    const dayCount =
      typeof obj.dayCount === "number" && obj.dayCount > 0
        ? Math.min(Math.floor(obj.dayCount), 90)
        : 7;
    const postsPerDayPerPlatform =
      typeof obj.postsPerDayPerPlatform === "number" && obj.postsPerDayPerPlatform > 0
        ? Math.min(Math.floor(obj.postsPerDayPerPlatform), 10)
        : 3;
    return { kind: "even", startDate, dayCount, postsPerDayPerPlatform };
  }
  if (kind === "best-times") {
    const startDate = String(obj.startDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
    return { kind: "best-times", startDate };
  }
  if (kind === "custom-queue") {
    const startDate = String(obj.startDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
    const raw = (obj.perPlatform ?? {}) as Record<string, unknown>;
    const perPlatform: Partial<
      Record<BulkUploadPlatform, Array<{ weekday: 0|1|2|3|4|5|6; hour: number; minute: number }>>
    > = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!isBulkUploadPlatform(k)) continue;
      if (!Array.isArray(v)) continue;
      const slots: Array<{ weekday: 0|1|2|3|4|5|6; hour: number; minute: number }> = [];
      for (const s of v) {
        if (!s || typeof s !== "object") continue;
        const so = s as Record<string, unknown>;
        const weekday = Number(so.weekday ?? 0);
        const hour = Number(so.hour ?? 12);
        const minute = Number(so.minute ?? 0);
        if (
          Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 &&
          Number.isInteger(hour) && hour >= 0 && hour <= 23 &&
          Number.isInteger(minute) && minute >= 0 && minute <= 59
        ) {
          slots.push({ weekday: weekday as 0|1|2|3|4|5|6, hour, minute });
        }
      }
      perPlatform[k] = slots;
    }
    return { kind: "custom-queue", startDate, perPlatform };
  }
  return null;
}

export function bulkUploadRoutes(db: Db, storage: StorageService) {
  const router = Router();
  const svc = bulkUploadService(db);
  const social = socialService(db);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_BATCH },
  });

  // ── Best times ──────────────────────────────────────────────────────────
  // GET /companies/:companyId/social/bulk-upload/best-times?platform=instagram
  // (also exposed under the friendlier alias /best-times so the UI can
  // call the same endpoint regardless of which bulk-upload subtree it's
  // currently in)
  router.get(
    "/companies/:companyId/social/bulk-upload/best-times",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const platformParam = String(req.query.platform ?? "").toLowerCase();
      if (!isBulkUploadPlatform(platformParam)) {
        throw badRequest(
          `Unknown or unsupported platform: '${platformParam || "(missing)"}'. Use one of: ${BULK_UPLOAD_PLATFORMS.join(", ")}`,
        );
      }
      // No user-audience data source wired yet (the social_account_analytics
      // table doesn't exist on this branch). The engine falls back to the
      // 2026 industry baseline automatically.
      const result = await computeBestTimes(companyId, platformParam);
      res.json(result);
    },
  );

  // ── Auto-caption (DeepSeek) ─────────────────────────────────────────────
  //
  // Tyler explicitly picked DeepSeek for this. Two callers:
  //   - Bulk Upload step 2 "AI suggest" passes { uploadId, platform } and
  //     gets back a caption + hashtags grounded in the visual content
  //     (Moonshot vision → DeepSeek chat).
  //   - Compose tab "Generate caption" passes { prompt, platform } and
  //     optionally { mediaUrl } and gets the same shape back.
  // Identical inputs short-circuit from an in-memory sha256 cache.
  router.post(
    "/companies/:companyId/social/captions/suggest",
    async (req, res, next) => {
      try {
        const companyId = req.params.companyId as string;
        assertCompanyAccess(req, companyId);

        const body = (req.body ?? {}) as {
          platform?: unknown;
          voice?: unknown;
          prompt?: unknown;
          uploadId?: unknown;
          mediaUrl?: unknown;
        };
        const platform = typeof body.platform === "string" ? body.platform.toLowerCase() : "";
        if (platform.length === 0) {
          throw badRequest("platform is required");
        }
        const voice = typeof body.voice === "string" ? body.voice : null;
        const prompt = typeof body.prompt === "string" ? body.prompt : null;
        const uploadId = typeof body.uploadId === "string" ? body.uploadId : null;
        const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : null;

        if (!uploadId && !mediaUrl && !(prompt && prompt.trim().length > 0)) {
          throw badRequest("provide one of: uploadId, mediaUrl, or a non-empty prompt");
        }

        let mediaBytes: Buffer | null = null;
        let mediaMime: string | null = null;
        let mediaFilename: string | null = null;
        if (uploadId) {
          const file = await svc.getUpload(uploadId);
          if (!file || file.companyId !== companyId) {
            throw notFound("Upload not found");
          }
          const object = await storage.getObject(file.companyId, file.storageKey);
          mediaBytes = await streamToBuffer(object.stream);
          mediaMime = file.mimeType ?? object.contentType ?? null;
          mediaFilename = file.filename ?? null;
        }

        const result = await suggestCaption({
          platform,
          voice,
          prompt,
          mediaBytes,
          mediaMime,
          mediaFilename,
          mediaUrl: uploadId ? null : mediaUrl,
        });

        res.json(result);
      } catch (err) {
        if (err instanceof CaptionConfigError) {
          res.status(503).json({
            error: "deepseek_key_missing",
            provider: err.provider,
            detail: err.message,
            fix: "Add the DeepSeek key at /instance/settings/provider-keys.",
          });
          return;
        }
        if (err instanceof CaptionProviderError) {
          res.status(502).json({
            error: err.status === 401 || err.status === 403
              ? "deepseek_key_unauthorized"
              : err.status === 429
                ? "deepseek_rate_limited"
                : "deepseek_upstream_error",
            provider: err.provider,
            upstreamStatus: err.status,
            detail: err.message,
            fix: "DeepSeek key needs attention — check /instance/settings/provider-keys.",
          });
          return;
        }
        next(err);
      }
    },
  );

  // ── Drafts ───────────────────────────────────────────────────────────────

  router.post(
    "/companies/:companyId/social/bulk-upload/drafts",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const name =
        typeof req.body?.name === "string" && req.body.name.trim().length > 0
          ? String(req.body.name).trim().slice(0, 200)
          : null;
      const draft = await svc.createDraft({
        companyId,
        name,
        createdBy: actor?.actorId ?? null,
      });
      res.status(201).json(draft);
    },
  );

  router.get(
    "/companies/:companyId/social/bulk-upload/drafts",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const drafts = await svc.listDrafts(companyId);
      res.json(drafts);
    },
  );

  router.get(
    "/companies/:companyId/social/bulk-upload/drafts/:draftId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const draft = await svc.getDraft(req.params.draftId as string);
      if (!draft || draft.companyId !== companyId) throw notFound("Draft not found");
      const uploads = await svc.listUploads(draft.id);
      res.json({ draft, uploads });
    },
  );

  router.patch(
    "/companies/:companyId/social/bulk-upload/drafts/:draftId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const draft = await svc.getDraft(req.params.draftId as string);
      if (!draft || draft.companyId !== companyId) throw notFound("Draft not found");
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (typeof body.name === "string") patch.name = body.name.slice(0, 200);
      if (typeof body.step === "string") patch.step = body.step;
      if (typeof body.strategy === "string") patch.strategy = body.strategy;
      if (body.strategyConfig !== undefined) patch.strategyConfig = body.strategyConfig;
      if (body.metadata !== undefined) patch.metadata = body.metadata;
      const next = await svc.updateDraft(draft.id, patch);
      res.json(next);
    },
  );

  router.delete(
    "/companies/:companyId/social/bulk-upload/drafts/:draftId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const draft = await svc.getDraft(req.params.draftId as string);
      if (!draft || draft.companyId !== companyId) throw notFound("Draft not found");
      // Files cascade-delete via FK; we leave the storage objects in place
      // for now (background sweeper will reclaim them).
      await svc.deleteDraft(draft.id);
      res.status(204).end();
    },
  );

  // ── Files ────────────────────────────────────────────────────────────────

  router.post(
    "/companies/:companyId/social/bulk-upload/drafts/:draftId/files",
    async (req, res, next) => {
      const companyId = req.params.companyId as string;
      const draftId = req.params.draftId as string;
      assertCompanyAccess(req, companyId);
      const draft = await svc.getDraft(draftId);
      if (!draft || draft.companyId !== companyId) throw notFound("Draft not found");

      try {
        await new Promise<void>((resolve, reject) => {
          upload.array("files", MAX_FILES_PER_BATCH)(req, res, (err: unknown) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            res.status(422).json({ error: `File exceeds ${MAX_FILE_BYTES} bytes` });
            return;
          }
          if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
            res.status(422).json({ error: `Too many files in one batch (max ${MAX_FILES_PER_BATCH})` });
            return;
          }
          res.status(400).json({ error: err.message });
          return;
        }
        next(err);
        return;
      }

      const files =
        ((req as unknown as { files?: Express.Multer.File[] }).files) ?? [];
      if (files.length === 0) {
        throw badRequest("No files attached. Use form-field 'files'.");
      }

      const actor = getActorInfo(req);
      const created: Array<Awaited<ReturnType<typeof svc.createUpload>>> = [];
      const errors: Array<{ filename: string; reason: string }> = [];

      for (const file of files) {
        const mimeType = (file.mimetype ?? "").toLowerCase();
        const detected = detectType(mimeType);
        if (!detected || !ALLOWED_MIME_TYPES.has(mimeType)) {
          errors.push({
            filename: file.originalname,
            reason: `Unsupported type: ${mimeType || "unknown"}`,
          });
          continue;
        }
        if (!file.buffer || file.buffer.length === 0) {
          errors.push({ filename: file.originalname, reason: "Empty file" });
          continue;
        }

        const putResult = await storage.putFile({
          companyId,
          namespace: "social/bulk",
          originalFilename: file.originalname,
          contentType: mimeType,
          body: file.buffer,
        });

        const row = await svc.createUpload({
          companyId,
          draftId: draft.id,
          filename: file.originalname,
          mimeType,
          sizeBytes: file.buffer.length,
          storageKey: putResult.objectKey,
          detectedType: detected,
          createdBy: actor?.actorId ?? null,
        });
        created.push(row);
      }

      res.status(201).json({ uploads: created, errors });
    },
  );

  router.patch(
    "/companies/:companyId/social/bulk-upload/drafts/:draftId/files/:fileId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const draft = await svc.getDraft(req.params.draftId as string);
      if (!draft || draft.companyId !== companyId) throw notFound("Draft not found");
      const file = await svc.getUpload(req.params.fileId as string);
      if (!file || file.draftId !== draft.id) throw notFound("File not found");

      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Parameters<typeof svc.updateUpload>[1] = {};
      if (body.caption === null || typeof body.caption === "string") {
        patch.caption = body.caption as string | null;
      }
      if (Array.isArray(body.hashtags)) {
        patch.hashtags = (body.hashtags as unknown[])
          .filter((h): h is string => typeof h === "string")
          .map((h) => h.trim())
          .filter((h) => h.length > 0)
          .slice(0, 30);
      }
      if (Array.isArray(body.platforms)) {
        patch.platforms = (body.platforms as unknown[]).filter(
          (p): p is string => typeof p === "string",
        );
      }
      if (
        body.aiSuggestedCaption === null ||
        typeof body.aiSuggestedCaption === "string"
      ) {
        patch.aiSuggestedCaption = body.aiSuggestedCaption as string | null;
      }
      if (typeof body.orderIndex === "number") {
        patch.orderIndex = body.orderIndex;
      }
      const next = await svc.updateUpload(file.id, patch);
      res.json(next);
    },
  );

  router.post(
    "/companies/:companyId/social/bulk-upload/drafts/:draftId/files/delete",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const draft = await svc.getDraft(req.params.draftId as string);
      if (!draft || draft.companyId !== companyId) throw notFound("Draft not found");
      const body = (req.body ?? {}) as { ids?: unknown };
      const ids = Array.isArray(body.ids)
        ? (body.ids as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
      if (ids.length === 0) {
        res.status(204).end();
        return;
      }
      const allFiles = await svc.listUploads(draft.id);
      const allowed = new Set(allFiles.map((f) => f.id));
      const toDelete = ids.filter((id) => allowed.has(id));
      if (toDelete.length > 0) {
        await svc.deleteUploads(toDelete);
        // Re-index remaining
        const remaining = (await svc.listUploads(draft.id)).map((f) => f.id);
        if (remaining.length > 0) {
          await svc.reorderUploads(draft.id, remaining);
        }
      }
      res.json({ deletedCount: toDelete.length });
    },
  );

  router.get(
    "/companies/:companyId/social/bulk-upload/uploads/:uploadId/content",
    async (req, res, next) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const file = await svc.getUpload(req.params.uploadId as string);
      if (!file || file.companyId !== companyId) throw notFound("File not found");
      const object = await storage.getObject(file.companyId, file.storageKey);
      const contentType = file.mimeType || object.contentType || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(file.sizeBytes || object.contentLength || 0));
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const safeName = (file.filename ?? "file").replaceAll("\"", "");
      res.setHeader("Content-Disposition", `inline; filename=\"${safeName}\"`);
      object.stream.on("error", (err) => next(err));
      object.stream.pipe(res);
    },
  );

  router.post(
    "/companies/:companyId/social/bulk-upload/drafts/:draftId/reorder",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const draft = await svc.getDraft(req.params.draftId as string);
      if (!draft || draft.companyId !== companyId) throw notFound("Draft not found");
      const body = (req.body ?? {}) as { ids?: unknown };
      const ids = Array.isArray(body.ids)
        ? (body.ids as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
      const uploads = await svc.reorderUploads(draft.id, ids);
      res.json({ uploads });
    },
  );

  // ── Schedule preview + commit ────────────────────────────────────────────

  async function buildSchedule(
    companyId: string,
    draftId: string,
    rawStrategy: unknown,
  ) {
    const draft = await svc.getDraft(draftId);
    if (!draft || draft.companyId !== companyId) throw notFound("Draft not found");
    const strategy = parseStrategy(rawStrategy);
    if (!strategy) throw badRequest("Invalid schedule strategy");

    const uploads = await svc.listUploads(draftId);
    const scheduleUploads: ScheduleUpload[] = uploads
      .filter((u) => Array.isArray(u.platforms) && (u.platforms as unknown[]).length > 0)
      .map((u) => ({
        id: u.id,
        platforms: (u.platforms as unknown[])
          .filter((p): p is string => typeof p === "string")
          .filter(isBulkUploadPlatform),
        orderIndex: u.orderIndex,
      }))
      .filter((u) => u.platforms.length > 0);

    // Pre-fetch best-time slots for every platform referenced in the
    // schedule (used by the "best-times" strategy; harmless for the others).
    const platformsInUse = new Set<BulkUploadPlatform>();
    for (const u of scheduleUploads) {
      for (const p of u.platforms) platformsInUse.add(p);
    }
    const bestSlotsByPlatform = new Map<BulkUploadPlatform, BestTimeSlot[]>();
    if (strategy.kind === "best-times") {
      for (const p of platformsInUse) {
        const res = await computeBestTimes(companyId, p);
        bestSlotsByPlatform.set(p, res.slots);
      }
    }

    const result = autoSchedule(scheduleUploads, strategy, bestSlotsByPlatform);
    return { draft, uploads, result, strategy };
  }

  router.post(
    "/companies/:companyId/social/bulk-upload/drafts/:draftId/preview",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const built = await buildSchedule(
        companyId,
        req.params.draftId as string,
        (req.body ?? {}).strategy,
      );
      res.json({
        items: built.result.items.map((i) => ({
          uploadId: i.uploadId,
          platform: i.platform,
          scheduledAt: i.scheduledAt.toISOString(),
        })),
        unscheduled: built.result.unscheduled,
      });
    },
  );

  router.post(
    "/companies/:companyId/social/bulk-upload/drafts/:draftId/commit",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const built = await buildSchedule(
        companyId,
        req.params.draftId as string,
        (req.body ?? {}).strategy,
      );

      // Map platform → first connected social_account on that platform.
      const accounts = await social.listAccounts(companyId);
      const accountByPlatform = new Map<string, string>();
      for (const a of accounts) {
        if (!accountByPlatform.has(a.platform)) {
          accountByPlatform.set(a.platform, a.id);
        }
      }

      const uploadById = new Map(built.uploads.map((u) => [u.id, u] as const));
      const created: Array<{ uploadId: string; platform: string; postId: string; scheduledAt: string }> = [];
      const errors: Array<{ uploadId: string; platform: string; reason: string }> = [];

      for (const item of built.result.items) {
        const accountId = accountByPlatform.get(item.platform);
        if (!accountId) {
          errors.push({
            uploadId: item.uploadId,
            platform: item.platform,
            reason: "No connected account for this platform",
          });
          continue;
        }
        const upload = uploadById.get(item.uploadId);
        if (!upload) continue;
        const post = await social.createPost(
          companyId,
          {
            title: null,
            content: upload.caption ?? "",
            postType: upload.detectedType === "video" ? "video" : "image",
            status: "scheduled",
            scheduledAt: item.scheduledAt,
            // Publishable URL (public base URL when configured, loopback
            // self-URL otherwise) — adapters can't do anything with a raw
            // storage key.
            mediaUrls: [buildPublishMediaUrl(upload.id, upload.storageKey).url],
            tags: Array.isArray(upload.hashtags) ? (upload.hashtags as string[]) : [],
            metadata: { bulkUploadId: upload.id, draftId: built.draft.id },
            createdBy: actor?.actorId ?? null,
          },
          [accountId],
        );
        await svc.updateUpload(upload.id, { scheduledPostId: post.id });
        created.push({
          uploadId: upload.id,
          platform: item.platform,
          postId: post.id,
          scheduledAt: item.scheduledAt.toISOString(),
        });
      }

      await svc.updateDraft(built.draft.id, {
        step: "schedule",
        strategy: built.strategy.kind,
        strategyConfig: built.strategy as unknown as Record<string, unknown>,
      });
      await svc.markDraftCommitted(built.draft.id);

      res.json({
        committed: created,
        unscheduled: built.result.unscheduled,
        errors,
      });
    },
  );

  // Auto-attach rasterized PNGs / MP4 from a completed design_run into the
  // draft's media list. Closes the loop on Generate-with-Design: once the
  // PNGs land on disk we hand them to the bulk-upload pipeline so they
  // schedule like any other media file.
  router.post(
    "/companies/:companyId/social/bulk-upload/drafts/:draftId/import-design-run",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const draftId = req.params.draftId as string;
      assertCompanyAccess(req, companyId);
      const draft = await svc.getDraft(draftId);
      if (!draft || draft.companyId !== companyId) throw notFound("Draft not found");
      const body = (req.body ?? {}) as Record<string, unknown>;
      const runId = typeof body.designRunId === "string" ? body.designRunId : null;
      if (!runId) throw badRequest("designRunId required");

      const runRow = await db
        .select()
        .from(designRuns)
        .where(eq(designRuns.id, runId))
        .then((rows) => rows[0] ?? null);
      if (!runRow) throw notFound("design run not found");
      if (runRow.companyId && runRow.companyId !== companyId) {
        throw badRequest("design run belongs to another company");
      }
      if (runRow.rasterStatus !== "completed") {
        res.status(409).json({
          error: "raster not ready",
          rasterStatus: runRow.rasterStatus,
          rasterError: runRow.rasterError,
        });
        return;
      }

      const actor = getActorInfo(req);
      const created: Array<Awaited<ReturnType<typeof svc.createUpload>>> = [];

      const pngPaths = Array.isArray(runRow.pngPaths) ? (runRow.pngPaths as string[]) : [];
      for (let i = 0; i < pngPaths.length; i += 1) {
        const p = pngPaths[i];
        try {
          const bytes = await fs.readFile(p);
          const baseName = path.basename(p);
          const putResult = await storage.putFile({
            companyId,
            namespace: "social/bulk",
            originalFilename: `design-${runRow.id.slice(0, 8)}-${baseName}`,
            contentType: "image/png",
            body: bytes,
          });
          const row = await svc.createUpload({
            companyId,
            draftId: draft.id,
            filename: `design-${runRow.skill}-${baseName}`,
            mimeType: "image/png",
            sizeBytes: bytes.length,
            storageKey: putResult.objectKey,
            detectedType: "image",
            createdBy: actor?.actorId ?? null,
          });
          created.push(row);
        } catch (err) {
          // Skip this slide; we still want the others to land.
          // eslint-disable-next-line no-console
          console.warn(`[bulk-upload] failed to import ${p}: ${err}`);
        }
      }

      if (runRow.mp4Path) {
        try {
          const bytes = await fs.readFile(runRow.mp4Path);
          const baseName = path.basename(runRow.mp4Path);
          const putResult = await storage.putFile({
            companyId,
            namespace: "social/bulk",
            originalFilename: `design-${runRow.id.slice(0, 8)}-${baseName}`,
            contentType: "video/mp4",
            body: bytes,
          });
          const row = await svc.createUpload({
            companyId,
            draftId: draft.id,
            filename: `design-${runRow.skill}-${baseName}`,
            mimeType: "video/mp4",
            sizeBytes: bytes.length,
            storageKey: putResult.objectKey,
            detectedType: "video",
            createdBy: actor?.actorId ?? null,
          });
          created.push(row);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[bulk-upload] failed to import mp4: ${err}`);
        }
      }

      res.status(201).json({ uploads: created, designRunId: runRow.id });
    },
  );

  return router;
}
