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
import { bulkUploadService } from "../services/bulk-upload.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound } from "../errors.js";

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

export function bulkUploadRoutes(db: Db, storage: StorageService) {
  const router = Router();
  const svc = bulkUploadService(db);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_BATCH },
  });

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

  return router;
}
