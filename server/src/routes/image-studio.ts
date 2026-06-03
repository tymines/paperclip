import { Router } from "express";
import { promises as fs } from "node:fs";
import type { Db } from "@paperclipai/db";
import { and, eq, or, isNull, desc } from "drizzle-orm";
import { imageProviders, loraTrainingJobs, personaGenerations } from "@paperclipai/db";
import { assertCompanyAccess } from "./authz.js";
import { badRequest } from "../errors.js";
import { resolveUploadPath } from "../services/image-studio/uploads.js";
import {
  personaTrainingProfile,
  countTrainingPhotos,
  defaultHyperparams,
  downloadLora,
} from "../services/image-studio/training.js";
import { startPersonaTraining } from "../services/image-studio/training-runner.js";
import {
  getReplicateToken,
  getReplicateTraining,
  extractWeightsUrl,
} from "../services/replicate/index.js";

/** Map a Replicate training status onto our lora_training_jobs status enum. */
function mapReplicateStatus(
  status: string,
): "training" | "downloading" | "ready" | "failed" {
  switch (status) {
    case "succeeded":
      return "downloading";
    case "failed":
    case "canceled":
      return "failed";
    default:
      // starting | processing
      return "training";
  }
}

/** Load a global-or-company-scoped provider row by id. */
async function loadProvider(db: Db, companyId: string, providerId: string) {
  const [row] = await db
    .select()
    .from(imageProviders)
    .where(
      and(
        eq(imageProviders.id, providerId),
        or(eq(imageProviders.companyId, companyId), isNull(imageProviders.companyId)),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function imageStudioRoutes(db: Db) {
  const router = Router();

  // GET /api/companies/:companyId/image-studio/providers
  router.get("/companies/:companyId/image-studio/providers", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const providers = await db
      .select()
      .from(imageProviders)
      .where(
        and(
          or(
            eq(imageProviders.companyId, companyId),
            isNull(imageProviders.companyId),
          ),
        ),
      )
      .orderBy(imageProviders.sortOrder);

    res.json({ providers });
  });

  // POST /api/companies/:companyId/image-studio/providers
  router.post("/companies/:companyId/image-studio/providers", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const { name, type, providerKey, endpoint, model, defaultParams, costPerUnit, status, statusDetail } =
      req.body;

    const [inserted] = await db
      .insert(imageProviders)
      .values({
        companyId,
        name,
        type: type ?? "external_api",
        providerKey,
        endpoint,
        model,
        defaultParams: defaultParams ?? {},
        costPerUnit: costPerUnit ?? "0",
        status,
        statusDetail,
        sortOrder: 0,
      })
      .returning();

    res.status(201).json({ provider: inserted });
  });

  // PATCH /api/companies/:companyId/image-studio/providers/:providerId
  router.patch("/companies/:companyId/image-studio/providers/:providerId", async (req, res) => {
    const { companyId, providerId } = req.params;
    assertCompanyAccess(req, companyId);

    const { name, type, providerKey, endpoint, model, defaultParams, costPerUnit, status, statusDetail, sortOrder } =
      req.body;

    const [updated] = await db
      .update(imageProviders)
      .set({
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(providerKey !== undefined && { providerKey }),
        ...(endpoint !== undefined && { endpoint }),
        ...(model !== undefined && { model }),
        ...(defaultParams !== undefined && { defaultParams }),
        ...(costPerUnit !== undefined && { costPerUnit }),
        ...(status !== undefined && { status }),
        ...(statusDetail !== undefined && { statusDetail }),
        ...(sortOrder !== undefined && { sortOrder }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(imageProviders.id, providerId),
          eq(imageProviders.companyId, companyId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }

    res.json({ provider: updated });
  });

  // DELETE /api/companies/:companyId/image-studio/providers/:providerId
  router.delete("/companies/:companyId/image-studio/providers/:providerId", async (req, res) => {
    const { companyId, providerId } = req.params;
    assertCompanyAccess(req, companyId);

    const [deleted] = await db
      .delete(imageProviders)
      .where(
        and(
          eq(imageProviders.id, providerId),
          eq(imageProviders.companyId, companyId),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }

    res.json({ provider: deleted });
  });

  // ── Persona training (Replicate cloud LoRA) ───────────────────────────────

  // GET /companies/:companyId/image-studio/personas/:personaId/photos
  // Returns the training photos directory + image count (for the Train modal).
  router.get(
    "/companies/:companyId/image-studio/personas/:personaId/photos",
    async (req, res) => {
      const { companyId, personaId } = req.params;
      assertCompanyAccess(req, companyId);

      const persona = await loadProvider(db, companyId, personaId);
      if (!persona || persona.type !== "local_lora") {
        res.status(404).json({ error: "Persona not found" });
        return;
      }
      const profile = personaTrainingProfile(persona.name);
      const dir =
        typeof req.query.dir === "string" && req.query.dir.length > 0
          ? req.query.dir
          : profile.defaultPhotosDir;
      const photos = await countTrainingPhotos(dir);
      res.json({ ...photos, triggerWord: profile.triggerWord, contentRating: profile.contentRating });
    },
  );

  // POST /companies/:companyId/image-studio/personas/:personaId/train
  // Body: { provider_id: string (uuid), training_photos_dir?: string }
  // Creates a lora_training_jobs row and (once a token is set) kicks off a
  // Replicate training. Returns 202 with the job id.
  router.post(
    "/companies/:companyId/image-studio/personas/:personaId/train",
    async (req, res) => {
      const { companyId, personaId } = req.params;
      assertCompanyAccess(req, companyId);

      const providerId = req.body?.provider_id;
      if (typeof providerId !== "string" || providerId.length === 0) {
        throw badRequest("provider_id is required");
      }

      const persona = await loadProvider(db, companyId, personaId);
      if (!persona || persona.type !== "local_lora") {
        res.status(404).json({ error: "Persona not found" });
        return;
      }
      const trainer = await loadProvider(db, companyId, providerId);
      if (!trainer) {
        res.status(404).json({ error: "Training provider not found" });
        return;
      }
      if (!trainer.trainingCapable) {
        throw badRequest(`Provider '${trainer.name}' is not training-capable`);
      }

      const profile = personaTrainingProfile(persona.name);
      const photosDir =
        typeof req.body?.training_photos_dir === "string" && req.body.training_photos_dir.length > 0
          ? req.body.training_photos_dir
          : profile.defaultPhotosDir;
      const photos = await countTrainingPhotos(photosDir);
      const hyperparams = defaultHyperparams(profile.triggerWord);

      // Fire the run when a Replicate token is configured. Without one, create
      // a 'pending' row that is never billed (token lands via the credentials
      // endpoint). The runner zips photosDir → uploads → ensures the
      // destination model → creates the training and records the job.
      const hasToken = (await getReplicateToken()) !== null;
      if (hasToken) {
        try {
          const job = await startPersonaTraining(db, {
            persona: { id: persona.id, name: persona.name },
            trainer: { id: trainer.id },
            photosDir,
            companyId,
          });
          res.status(202).json({
            job,
            photos,
            estimatedCostUsd: 3,
            estimatedMinutes: 30,
            externalJobId: job.externalJobId,
            note: "Training submitted to Replicate.",
          });
          return;
        } catch (err) {
          res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
          return;
        }
      }

      const [job] = await db
        .insert(loraTrainingJobs)
        .values({
          companyId,
          personaId: persona.id,
          providerId: trainer.id,
          status: "pending",
          contentRating: profile.contentRating,
          externalJobId: null,
          triggerWord: profile.triggerWord,
          trainingZipPath: null,
          hyperparams,
        })
        .returning();

      res.status(202).json({
        job,
        photos,
        estimatedCostUsd: 3,
        estimatedMinutes: 30,
        note: "No Replicate token set yet — job created in 'pending'. Set one via POST /api/credentials/replicate.",
      });
    },
  );

  // GET /companies/:companyId/image-studio/training/:jobId
  // Returns the job; if it has a live Replicate job and a token is set, polls
  // Replicate, updates status/progress/cost, and installs the LoRA on success.
  router.get(
    "/companies/:companyId/image-studio/training/:jobId",
    async (req, res) => {
      const { companyId, jobId } = req.params;
      assertCompanyAccess(req, companyId);

      const [job] = await db
        .select()
        .from(loraTrainingJobs)
        .where(and(eq(loraTrainingJobs.id, jobId), eq(loraTrainingJobs.companyId, companyId)))
        .limit(1);
      if (!job) {
        res.status(404).json({ error: "Training job not found" });
        return;
      }

      const terminal = job.status === "ready" || job.status === "failed";
      const token = await getReplicateToken();
      if (terminal || !job.externalJobId || !token) {
        res.json({ job });
        return;
      }

      // Live poll. Errors here are non-fatal — return the last-known row.
      try {
        const training = await getReplicateTraining(job.externalJobId);
        let next = mapReplicateStatus(training.status);
        const patch: Record<string, unknown> = { updatedAt: new Date() };

        if (next === "failed") {
          patch.status = "failed";
          patch.errorMessage = training.error ?? "Training failed on Replicate";
          patch.completedAt = new Date();
        } else if (next === "downloading") {
          const weights = extractWeightsUrl(training);
          if (weights) {
            const profile = personaTrainingProfile(
              (await loadProvider(db, companyId, job.personaId))?.name ?? "persona",
            );
            const installed = await downloadLora(weights, profile.slug);
            patch.status = "ready";
            patch.outputLoraPath = installed;
            patch.progress = 100;
            patch.completedAt = new Date();
            const seconds = training.metrics?.total_time ?? training.metrics?.predict_time;
            // H100 ~ $0.001525/s; fall back to the flat ~$3 estimate.
            patch.costUsd = seconds ? (seconds * 0.001525).toFixed(4) : "3.0000";
            next = "ready";
          } else {
            patch.status = "downloading";
          }
        } else {
          patch.status = "training";
        }

        const [updated] = await db
          .update(loraTrainingJobs)
          .set(patch)
          .where(eq(loraTrainingJobs.id, job.id))
          .returning();
        res.json({ job: updated });
      } catch (err) {
        res.json({ job, pollError: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // GET /companies/:companyId/image-studio/training (recent jobs, newest first)
  router.get("/companies/:companyId/image-studio/training", async (req, res) => {
    const { companyId } = req.params;
    assertCompanyAccess(req, companyId);
    const jobs = await db
      .select()
      .from(loraTrainingJobs)
      .where(eq(loraTrainingJobs.companyId, companyId))
      .orderBy(desc(loraTrainingJobs.createdAt))
      .limit(50);
    res.json({ jobs });
  });

  // ── Persona generations gallery ───────────────────────────────────────────
  // Personas are global (company_id IS NULL) or company-scoped, so these
  // routes key off the persona id rather than a company in the path.

  async function loadPersona(personaId: string) {
    const [row] = await db
      .select()
      .from(imageProviders)
      .where(eq(imageProviders.id, personaId))
      .limit(1);
    return row ?? null;
  }

  // GET /image-studio/personas/:personaId/generations?source=test|production&limit=20
  router.get(
    "/image-studio/personas/:personaId/generations",
    async (req, res) => {
      const { personaId } = req.params;
      const persona = await loadPersona(personaId);
      if (!persona || persona.type !== "local_lora") {
        res.status(404).json({ error: "Persona not found" });
        return;
      }

      const source = req.query.source;
      const limitRaw = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(limitRaw, 1), 100)
        : 20;

      const filters = [eq(personaGenerations.personaId, personaId)];
      if (source === "test" || source === "production") {
        filters.push(eq(personaGenerations.source, source));
      }

      const generations = await db
        .select()
        .from(personaGenerations)
        .where(and(...filters))
        .orderBy(desc(personaGenerations.createdAt))
        .limit(limit);

      res.json({ generations });
    },
  );

  // POST /image-studio/personas/:personaId/generations
  // Storage endpoint for inference results to land in the gallery. Body:
  // { image_path (required, relative to uploads dir), thumbnail_path?, source?,
  //   prompt?, lora_strength?, model?, generation_metadata?,
  //   replicate_prediction_id?, cost_usd?, content_rating? }
  router.post(
    "/image-studio/personas/:personaId/generations",
    async (req, res) => {
      const { personaId } = req.params;
      const persona = await loadPersona(personaId);
      if (!persona || persona.type !== "local_lora") {
        res.status(404).json({ error: "Persona not found" });
        return;
      }

      const body = req.body ?? {};
      const imagePath = typeof body.image_path === "string" ? body.image_path.trim() : "";
      if (!imagePath) {
        throw badRequest("image_path is required");
      }
      const source = body.source === "production" ? "production" : "test";
      const contentRating = body.content_rating === "explicit" ? "explicit" : "sfw";

      const [inserted] = await db
        .insert(personaGenerations)
        .values({
          personaId,
          source,
          prompt: typeof body.prompt === "string" ? body.prompt : null,
          loraStrength:
            body.lora_strength != null ? String(body.lora_strength) : null,
          model: typeof body.model === "string" ? body.model : null,
          imagePath,
          thumbnailPath:
            typeof body.thumbnail_path === "string" ? body.thumbnail_path : null,
          generationMetadata:
            body.generation_metadata && typeof body.generation_metadata === "object"
              ? body.generation_metadata
              : null,
          replicatePredictionId:
            typeof body.replicate_prediction_id === "string"
              ? body.replicate_prediction_id
              : null,
          costUsd: body.cost_usd != null ? String(body.cost_usd) : null,
          contentRating,
        })
        .returning();

      res.status(201).json({ generation: inserted });
    },
  );

  // DELETE /image-studio/generations/:id
  // Prune a bad output. Best-effort removes the underlying image + thumbnail.
  router.delete("/image-studio/generations/:id", async (req, res) => {
    const { id } = req.params;
    const [deleted] = await db
      .delete(personaGenerations)
      .where(eq(personaGenerations.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Generation not found" });
      return;
    }

    for (const rel of [deleted.imagePath, deleted.thumbnailPath]) {
      if (!rel) continue;
      const abs = resolveUploadPath(rel);
      if (abs) await fs.rm(abs, { force: true }).catch(() => {});
    }

    res.json({ generation: deleted });
  });

  return router;
}
