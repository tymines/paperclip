/**
 * Social media upload + serving routes — backs the Compose tab's media
 * attach flow (and any other caller that needs a publishable media URL).
 *
 * Endpoints:
 *   POST /companies/:companyId/social/media
 *     multipart (field "files", up to 10) → stores each file via the
 *     existing StorageService (same machinery as Bulk Upload) and records
 *     a `bulk_uploads` row with `draft_id = NULL`. Returns per-file ids +
 *     URLs. NO new table — composer uploads are draft-less bulk uploads.
 *
 *   GET /companies/:companyId/social/media/:mediaId/content
 *     Authenticated stream for UI previews/thumbnails.
 *
 *   GET /public/social-media/:mediaId/:token/content
 *     Token-guarded UNauthenticated stream. This is the URL that goes on
 *     `social_posts.mediaUrls`: Meta-family platforms (IG/Threads/FB)
 *     download media from it, and the X/Reddit adapters fetch bytes from
 *     it server-side. The token is a sha256 digest over the row's random
 *     storage key (see `socialMediaToken`), so the URL is unguessable
 *     without DB access. Data honesty: when no public base URL is
 *     configured (`PAPERCLIP_PUBLIC_URL`), the returned mediaUrl falls
 *     back to a loopback self-URL and `publiclyFetchable: false` — the
 *     composer shows the amber hint, and the IG/FB/Threads adapters
 *     refuse it with the exact config-key error instead of letting Meta
 *     fail opaquely.
 */
import { Router } from "express";
import multer from "multer";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { bulkUploads } from "@paperclipai/db";
import type { StorageService } from "../storage/types.js";
import {
  SOCIAL_MEDIA_IMAGE_MAX_BYTES,
  SOCIAL_MEDIA_VIDEO_MAX_BYTES,
  buildPublishMediaUrl,
  detectSocialMediaKind,
  resolvePublicBaseUrl,
  verifySocialMediaToken,
} from "../services/social-scheduler/media.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound } from "../errors.js";

const MAX_FILES_PER_REQUEST = 10;

export interface SocialMediaUploadItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video";
  /** Authenticated preview URL for the UI (session cookie required). */
  contentUrl: string;
  /** Absolute URL to put on the post's mediaUrls. */
  mediaUrl: string;
  /** False when only the loopback fallback URL exists (no public base URL). */
  publiclyFetchable: boolean;
}

export function socialMediaRoutes(db: Db, storage: StorageService) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: SOCIAL_MEDIA_VIDEO_MAX_BYTES, files: MAX_FILES_PER_REQUEST },
  });

  // ── Composer upload ─────────────────────────────────────────────────────
  router.post("/companies/:companyId/social/media", async (req, res, next) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    try {
      await new Promise<void>((resolve, reject) => {
        upload.array("files", MAX_FILES_PER_REQUEST)(req, res, (err: unknown) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({
            error: `File exceeds ${SOCIAL_MEDIA_VIDEO_MAX_BYTES} bytes`,
          });
          return;
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
          res.status(422).json({
            error: `Too many files in one request (max ${MAX_FILES_PER_REQUEST})`,
          });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
      return;
    }

    const files = ((req as unknown as { files?: Express.Multer.File[] }).files) ?? [];
    if (files.length === 0) {
      throw badRequest("No files attached. Use form-field 'files'.");
    }

    const actor = getActorInfo(req);
    const media: SocialMediaUploadItem[] = [];
    const errors: Array<{ filename: string; reason: string }> = [];

    for (const file of files) {
      const mimeType = (file.mimetype ?? "").toLowerCase();
      const kind = detectSocialMediaKind(mimeType);
      if (!kind) {
        errors.push({
          filename: file.originalname,
          reason: `Unsupported type: ${mimeType || "unknown"}. Allowed: jpeg, png, webp, gif, mp4.`,
        });
        continue;
      }
      if (!file.buffer || file.buffer.length === 0) {
        errors.push({ filename: file.originalname, reason: "Empty file" });
        continue;
      }
      const maxBytes = kind === "image" ? SOCIAL_MEDIA_IMAGE_MAX_BYTES : SOCIAL_MEDIA_VIDEO_MAX_BYTES;
      if (file.buffer.length > maxBytes) {
        errors.push({
          filename: file.originalname,
          reason: `File is ${file.buffer.length} bytes (max ${maxBytes} for ${kind}s)`,
        });
        continue;
      }

      const putResult = await storage.putFile({
        companyId,
        namespace: "social/media",
        originalFilename: file.originalname,
        contentType: mimeType,
        body: file.buffer,
      });

      const [row] = await db
        .insert(bulkUploads)
        .values({
          companyId,
          draftId: null, // composer upload — not part of a bulk-upload draft
          filename: file.originalname,
          mimeType,
          sizeBytes: file.buffer.length,
          storageKey: putResult.objectKey,
          detectedType: kind,
          orderIndex: 0,
          createdBy: actor?.actorId ?? null,
        })
        .returning();
      if (!row) {
        errors.push({ filename: file.originalname, reason: "Failed to record upload" });
        continue;
      }

      const publish = buildPublishMediaUrl(row.id, row.storageKey);
      media.push({
        id: row.id,
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        kind,
        contentUrl: `/api/companies/${companyId}/social/media/${row.id}/content`,
        mediaUrl: publish.url,
        publiclyFetchable: publish.publiclyFetchable,
      });
    }

    const publicBaseUrl = resolvePublicBaseUrl();
    res.status(201).json({
      media,
      errors,
      publicBaseUrl,
      ...(publicBaseUrl
        ? {}
        : {
            publicUrlNotice:
              "No public base URL configured — Instagram / Facebook / Threads must download media " +
              "from a publicly reachable URL. Set PAPERCLIP_PUBLIC_URL (or auth.publicBaseUrl in " +
              "config.json) to enable those platforms. X and Reddit uploads still work.",
          }),
    });
  });

  // ── Authenticated preview stream (UI thumbnails) ────────────────────────
  router.get(
    "/companies/:companyId/social/media/:mediaId/content",
    async (req, res, next) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const row = await db
        .select()
        .from(bulkUploads)
        .where(eq(bulkUploads.id, req.params.mediaId as string))
        .then((rows) => rows[0] ?? null);
      if (!row || row.companyId !== companyId) throw notFound("Media not found");
      const object = await storage.getObject(row.companyId, row.storageKey);
      streamMedia(res, next, object.stream, {
        contentType: row.mimeType || object.contentType || "application/octet-stream",
        contentLength: row.sizeBytes || object.contentLength || 0,
        filename: row.filename,
        cacheControl: "private, max-age=300",
      });
    },
  );

  // ── Token-guarded public stream (platform fetch + adapter byte pulls) ───
  // Deliberately NO assertCompanyAccess: Meta's crawlers have no Paperclip
  // session. Access control is the unguessable token (sha256 over the
  // row's random storage key) — invalid token or unknown id → 404, no
  // detail leaked.
  router.get(
    "/public/social-media/:mediaId/:token/content",
    async (req, res, next) => {
      const mediaId = String(req.params.mediaId ?? "");
      const token = String(req.params.token ?? "");
      const row = await db
        .select()
        .from(bulkUploads)
        .where(eq(bulkUploads.id, mediaId))
        .then((rows) => rows[0] ?? null);
      if (!row || !token || !verifySocialMediaToken(token, row.id, row.storageKey)) {
        throw notFound("Media not found");
      }
      const object = await storage.getObject(row.companyId, row.storageKey);
      streamMedia(res, next, object.stream, {
        contentType: row.mimeType || object.contentType || "application/octet-stream",
        contentLength: row.sizeBytes || object.contentLength || 0,
        filename: row.filename,
        // Platforms may fetch more than once while processing containers.
        cacheControl: "public, max-age=3600",
      });
    },
  );

  return router;
}

function streamMedia(
  res: import("express").Response,
  next: import("express").NextFunction,
  stream: NodeJS.ReadableStream,
  opts: { contentType: string; contentLength: number; filename: string | null; cacheControl: string },
) {
  res.setHeader("Content-Type", opts.contentType);
  if (opts.contentLength > 0) res.setHeader("Content-Length", String(opts.contentLength));
  res.setHeader("Cache-Control", opts.cacheControl);
  res.setHeader("X-Content-Type-Options", "nosniff");
  const safeName = (opts.filename ?? "media").replaceAll("\"", "");
  res.setHeader("Content-Disposition", `inline; filename=\"${safeName}\"`);
  stream.on("error", (err) => next(err));
  stream.pipe(res);
}
