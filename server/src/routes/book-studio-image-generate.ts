/**
 * Book Studio Image Generation — generates images via Replicate.
 *
 * Endpoints:
 *   POST  .../generate/image           — submit image generation
 *   POST  .../generate/cover            — submit cover generation
 *   POST  .../generate/scene-illustration — submit scene illustration
 *   GET   .../generate/poll/:predictionId — poll prediction status
 *   GET   .../media/:bookSlug/:filename   — serve generated media
 */
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { replicateProvider } from "../services/image-providers/replicate.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";

const EXPORT_DIR =
  process.env.BOOK_EXPORT_DIR ||
  path.join(process.env.HOME || "/tmp", "paperclip", "book-exports");

// ── In-memory prediction tracking ──────────────────────────────────────

const activePredictions = new Map<
  string,
  {
    bookSlug: string;
    endpointType: "image" | "cover" | "scene-illustration";
    createdAt: Date;
  }
>();

// ── Helpers ────────────────────────────────────────────────────────────

function getEndpointType(entityType: string): "image" | "cover" | "scene-illustration" {
  if (entityType === "cover") return "cover";
  if (entityType === "scene-illustration") return "scene-illustration";
  return "image";
}

// ── Route factory ──────────────────────────────────────────────────────

export function bookStudioImageGenerateRoutes(_db: Db) {
  const router = Router();

  // ── POST .../generate/image ────────────────────────────────────────────
  router.post(
    "/companies/:companyId/book-studio/generate/image",
    async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId);

        const { prompt, bookSlug, aspectRatio } = req.body;

        if (!prompt || typeof prompt !== "string") {
          throw badRequest("prompt is required");
        }

        if (!bookSlug || typeof bookSlug !== "string") {
          throw badRequest("bookSlug is required");
        }

        if (!(await replicateProvider.isConfigured())) {
          throw serviceUnavailable("image generation is not configured");
        }

        const { predictionId } = await replicateProvider.submitGeneration({
          prompt,
          modelRef: "black-forest-labs/flux-dev-lora",
          aspectRatio: aspectRatio ?? "16:9",
          steps: 28,
        });

        activePredictions.set(predictionId, {
          bookSlug,
          endpointType: "image",
          createdAt: new Date(),
        });

        res.json({
          draft: {
            predictionId,
            status: "starting",
            prompt,
            model: "black-forest-labs/flux-dev-lora",
          },
          status: "generating",
          entityType: "image",
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST .../generate/cover ────────────────────────────────────────────
  router.post(
    "/companies/:companyId/book-studio/generate/cover",
    async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId);

        const { prompt, bookSlug, bookId } = req.body;

        if (!prompt || typeof prompt !== "string") {
          throw badRequest("prompt is required");
        }

        if (!bookSlug || typeof bookSlug !== "string") {
          throw badRequest("bookSlug is required");
        }

        if (!(await replicateProvider.isConfigured())) {
          throw serviceUnavailable("image generation is not configured");
        }

        const { predictionId } = await replicateProvider.submitGeneration({
          prompt,
          modelRef: "black-forest-labs/flux-dev-lora",
          aspectRatio: "2:3", // portrait aspect ratio for book covers
          steps: 28,
        });

        activePredictions.set(predictionId, {
          bookSlug,
          endpointType: "cover",
          createdAt: new Date(),
        });

        res.json({
          draft: {
            predictionId,
            status: "starting",
            prompt,
            model: "black-forest-labs/flux-dev-lora",
          },
          status: "generating",
          entityType: "cover",
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST .../generate/scene-illustration ───────────────────────────────
  router.post(
    "/companies/:companyId/book-studio/generate/scene-illustration",
    async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId);

        const { prompt, bookSlug, sceneId } = req.body;

        if (!prompt || typeof prompt !== "string") {
          throw badRequest("prompt is required");
        }

        if (!bookSlug || typeof bookSlug !== "string") {
          throw badRequest("bookSlug is required");
        }

        if (!(await replicateProvider.isConfigured())) {
          throw serviceUnavailable("image generation is not configured");
        }

        const { predictionId } = await replicateProvider.submitGeneration({
          prompt,
          modelRef: "black-forest-labs/flux-dev-lora",
          aspectRatio: "16:9",
          steps: 28,
        });

        activePredictions.set(predictionId, {
          bookSlug,
          endpointType: "scene-illustration",
          createdAt: new Date(),
        });

        res.json({
          draft: {
            predictionId,
            status: "starting",
            prompt,
            model: "black-forest-labs/flux-dev-lora",
          },
          status: "generating",
          entityType: "scene-illustration",
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── GET .../generate/poll/:predictionId ────────────────────────────────
  router.get(
    "/companies/:companyId/book-studio/generate/poll/:predictionId",
    async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId);

        const { predictionId } = req.params;

        const predictionMeta = activePredictions.get(predictionId);
        if (!predictionMeta) {
          throw notFound("Prediction not found or already cleaned up");
        }

        const result = await replicateProvider.pollPrediction(predictionId);

        if (result.status === "succeeded" && result.outputUrl) {
          // Download and save the generated image
          const mediaDir = path.join(
            EXPORT_DIR,
            predictionMeta.bookSlug,
            "media",
          );
          if (!existsSync(mediaDir)) {
            mkdirSync(mediaDir, { recursive: true });
          }

          const uuid = randomUUID();
          const filename = `${uuid}.png`;
          const filePath = path.join(mediaDir, filename);

          const buffer = await replicateProvider.downloadOutput(result.outputUrl);
          writeFileSync(filePath, buffer);

          // Clean up tracking
          activePredictions.delete(predictionId);

          return res.json({
            draft: {
              imageUrl: `/api/book-studio/media/${predictionMeta.bookSlug}/${filename}`,
              status: "completed",
            },
          });
        }

        if (result.status === "failed" || result.status === "canceled") {
          activePredictions.delete(predictionId);
          return res.json({
            draft: {
              status: "failed",
              error: result.error ?? `Prediction ${result.status}`,
            },
          });
        }

        // Still processing or starting up
        res.json({
          draft: {
            status: "processing",
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── GET .../media/:bookSlug/:filename ──────────────────────────────────
  router.get(
    "/companies/:companyId/book-studio/media/:bookSlug/:filename",
    async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId);

        const { bookSlug, filename } = req.params;

        // Safety: prevent directory traversal
        const mediaDir = path.resolve(
          path.join(EXPORT_DIR, bookSlug, "media"),
        );
        const filePath = path.resolve(path.join(mediaDir, filename));

        if (!filePath.startsWith(mediaDir)) {
          return res.status(403).json({ error: "Forbidden" });
        }

        if (!existsSync(filePath)) {
          throw notFound("File not found");
        }

        const ext = path.extname(filename).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".gif": "image/gif",
        };
        const contentType = mimeTypes[ext] || "application/octet-stream";

        const { readFileSync } = await import("node:fs");
        const data = readFileSync(filePath);
        res.set("Content-Type", contentType);
        res.set("Content-Length", String(data.length));
        res.send(data);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
