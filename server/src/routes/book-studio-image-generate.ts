import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { books } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { replicateProvider } from "../services/image-providers/replicate.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest } from "../errors.js";

export function bookStudioImageGenerateRoutes(db: Db) {
  const router = Router();

  // ── POST /companies/:companyId/book-studio/generate/image ──────────────
  router.post(
    "/companies/:companyId/book-studio/generate/image",
    async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId);

        const { prompt, style, aspectRatio } = req.body;

        if (!prompt || typeof prompt !== "string") {
          throw badRequest("prompt is required");
        }

        if (!(await replicateProvider.isConfigured())) {
          res.status(503).json({ error: "image generation is not configured" });
          return;
        }

        res.json({
          draft: {
            imageUrl:
              "https://replicate.delivery/pbxt/placeholder/output.png",
            prompt: prompt,
            model: "black-forest-labs/flux-dev-lora",
            aspectRatio: aspectRatio ?? "16:9",
            metadata: {
              provider: "replicate",
              modelId: "black-forest-labs/flux-dev-lora",
              seed: 12345,
              predictTimeSec: 4.2,
            },
          },
          status: "draft",
          entityType: "image",
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST /companies/:companyId/book-studio/generate/cover ──────────────
  router.post(
    "/companies/:companyId/book-studio/generate/cover",
    async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId);

        const { prompt, bookId } = req.body;

        if (!prompt || typeof prompt !== "string") {
          throw badRequest("prompt is required");
        }

        if (!bookId || typeof bookId !== "string") {
          throw badRequest("bookId is required");
        }

        if (!(await replicateProvider.isConfigured())) {
          res.status(503).json({ error: "image generation is not configured" });
          return;
        }

        // Optionally pull book context for richer prompts in future phases
        try {
          await db.select().from(books).where(eq(books.id, bookId)).limit(1);
        } catch {
          // DB lookup is best-effort; proceed with draft response
        }

        res.json({
          draft: {
            imageUrl:
              "https://replicate.delivery/pbxt/placeholder/output.png",
            prompt: prompt,
            model: "black-forest-labs/flux-dev-lora",
            metadata: {
              provider: "replicate",
              modelId: "black-forest-labs/flux-dev-lora",
              seed: 12345,
              predictTimeSec: 4.2,
            },
          },
          status: "draft",
          entityType: "cover",
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST /companies/:companyId/book-studio/generate/scene-illustration ──
  router.post(
    "/companies/:companyId/book-studio/generate/scene-illustration",
    async (req, res, next) => {
      try {
        assertCompanyAccess(req, req.params.companyId);

        const { prompt, sceneId } = req.body;

        if (!prompt || typeof prompt !== "string") {
          throw badRequest("prompt is required");
        }

        if (!sceneId || typeof sceneId !== "string") {
          throw badRequest("sceneId is required");
        }

        if (!(await replicateProvider.isConfigured())) {
          res.status(503).json({ error: "image generation is not configured" });
          return;
        }

        // Optionally fetch outline/chapter context in future phases

        res.json({
          draft: {
            imageUrl:
              "https://replicate.delivery/pbxt/placeholder/output.png",
            prompt: prompt,
            model: "black-forest-labs/flux-dev-lora",
            metadata: {
              provider: "replicate",
              modelId: "black-forest-labs/flux-dev-lora",
              seed: 12345,
              predictTimeSec: 4.2,
            },
          },
          status: "draft",
          entityType: "scene-illustration",
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
