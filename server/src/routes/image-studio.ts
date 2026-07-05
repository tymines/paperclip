import { Router } from "express";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { and, eq, or, isNull, isNotNull, inArray, desc, asc, sql } from "drizzle-orm";
import {
  imageProviders,
  personaGroups,
  loraTrainingJobs,
  personaGenerations,
  promptTemplates,
  generationJobs,
} from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest, notFound, serviceUnavailable } from "../errors.js";
import { socialPosts } from "@paperclipai/db";
import { generateContentIdeas } from "../services/influencer-studio/content-generator.js";
import { logActivity } from "../services/index.js";
import { resolveUploadPath } from "../services/image-studio/uploads.js";
import {
  expandPromptVariations,
  kickGenerationQueue,
  personaContentRating,
} from "../services/replicate-generator.js";
import { loadCatalog } from "../services/image-studio/attribute-catalog.js";
import {
  assemblePrompt,
  detectFreeTextConflicts,
  type Selections,
} from "../services/prompt-assembler.js";
import {
  personaTrainingProfile,
  countTrainingPhotos,
  defaultHyperparams,
} from "../services/image-studio/training.js";
import {
  startPersonaTraining,
  stagePersonaTrainingPhotos,
  syncTrainingJob,
  startBackgroundTrainingPoller,
} from "../services/image-studio/training-runner.js";
import { runUndresserGeneration } from "../services/image-studio/undresser.js";
import type { StorageService } from "../storage/types.js";
import {
  getProvider,
  listProviders,
  isProviderHost,
  DEFAULT_PROVIDER_HOST,
  PROVIDER_HOSTS,
  type ProviderHost,
} from "../services/image-providers/index.js";

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

export function imageStudioRoutes(db: Db, storage?: StorageService) {
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

  // ── Persona CMS: create + groups (folders) ────────────────────────────────

  // POST /companies/:companyId/image-studio/personas
  // Create a new (untrained) persona. Distinct from the generic provider POST:
  // forces type=local_lora, seeds the trigger word from the name, and starts at
  // status='untrained' so it shows a "Start training" affordance in the list.
  router.post("/companies/:companyId/image-studio/personas", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      throw badRequest("Persona name is required");
    }
    // Trigger word: slug of the name unless one was supplied in attributes.
    const attributes: Record<string, unknown> =
      body.attributes && typeof body.attributes === "object" ? { ...body.attributes } : {};
    if (!attributes.trigger_word || typeof attributes.trigger_word !== "string") {
      attributes.trigger_word = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    }

    const [inserted] = await db
      .insert(imageProviders)
      .values({
        companyId,
        name,
        type: "local_lora",
        bio: typeof body.bio === "string" && body.bio.trim() ? body.bio.trim() : null,
        attributes,
        groupId: body.group_id ? String(body.group_id) : null,
        avatarPath:
          typeof body.avatar_path === "string" && body.avatar_path.trim() ? body.avatar_path.trim() : null,
        isFavorite: Boolean(body.is_favorite),
        costPerUnit: "0",
        status: "untrained",
        statusDetail: "Upload photos and train to bring this persona online.",
        sortOrder: 0,
      })
      .returning();

    res.status(201).json({ provider: inserted });
  });

  // GET /companies/:companyId/image-studio/persona-groups
  router.get("/companies/:companyId/image-studio/persona-groups", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const groups = await db
      .select()
      .from(personaGroups)
      .where(or(eq(personaGroups.companyId, companyId), isNull(personaGroups.companyId)))
      .orderBy(asc(personaGroups.sortOrder), asc(personaGroups.name));
    res.json({ groups });
  });

  // POST /companies/:companyId/image-studio/persona-groups  Body: { name, color? }
  router.post("/companies/:companyId/image-studio/persona-groups", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      throw badRequest("Group name is required");
    }
    const [inserted] = await db
      .insert(personaGroups)
      .values({ companyId, name, color: req.body?.color ?? null })
      .returning();
    res.status(201).json({ group: inserted });
  });

  // PATCH /companies/:companyId/image-studio/persona-groups/:groupId
  router.patch("/companies/:companyId/image-studio/persona-groups/:groupId", async (req, res) => {
    const { companyId, groupId } = req.params;
    assertCompanyAccess(req, companyId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof req.body?.name === "string" && req.body.name.trim()) patch.name = req.body.name.trim();
    if (req.body?.color !== undefined) patch.color = req.body.color ?? null;
    if (req.body?.sort_order !== undefined && Number.isFinite(Number(req.body.sort_order))) {
      patch.sortOrder = Number(req.body.sort_order);
    }
    const [updated] = await db
      .update(personaGroups)
      .set(patch)
      .where(and(eq(personaGroups.id, groupId), eq(personaGroups.companyId, companyId)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    res.json({ group: updated });
  });

  // DELETE /companies/:companyId/image-studio/persona-groups/:groupId
  // Personas in the group keep existing — the FK is ON DELETE SET NULL.
  router.delete("/companies/:companyId/image-studio/persona-groups/:groupId", async (req, res) => {
    const { companyId, groupId } = req.params;
    assertCompanyAccess(req, companyId);
    const [deleted] = await db
      .delete(personaGroups)
      .where(and(eq(personaGroups.id, groupId), eq(personaGroups.companyId, companyId)))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Group not found" });
      return;
    }
    res.json({ group: deleted });
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
  //   ?provider=<host>            which hosted trainer (replicate | wavespeedai)
  //   body { trainer?, provider_host?, provider_id?, training_photos_dir? }
  // Resolves the trainer through the provider abstraction and (once that
  // provider is configured) kicks off a LoRA training. Returns 202 + the job.
  router.post(
    "/companies/:companyId/image-studio/personas/:personaId/train",
    async (req, res) => {
      const { companyId, personaId } = req.params;
      assertCompanyAccess(req, companyId);

      const persona = await loadProvider(db, companyId, personaId);
      if (!persona || persona.type !== "local_lora") {
        res.status(404).json({ error: "Persona not found" });
        return;
      }

      // Resolve the provider host: explicit ?provider=/provider_host wins; else
      // derive it from a legacy provider_id trainer row; else the default host.
      const hostParam =
        (typeof req.query.provider === "string" && req.query.provider) ||
        (typeof req.body?.provider_host === "string" && req.body.provider_host) ||
        null;
      const legacyProviderId =
        typeof req.body?.provider_id === "string" && req.body.provider_id.length > 0
          ? req.body.provider_id
          : null;

      let providerHost: ProviderHost;
      let legacyTrainerRowId: string | null = null;
      if (hostParam && isProviderHost(hostParam)) {
        providerHost = hostParam;
      } else if (legacyProviderId) {
        const trainerRow = await loadProvider(db, companyId, legacyProviderId);
        if (!trainerRow) {
          res.status(404).json({ error: "Training provider not found" });
          return;
        }
        providerHost = isProviderHost(trainerRow.providerHost)
          ? trainerRow.providerHost
          : DEFAULT_PROVIDER_HOST;
        legacyTrainerRowId = trainerRow.id;
      } else {
        providerHost = DEFAULT_PROVIDER_HOST;
      }

      const provider = getProvider(providerHost);
      if (!provider?.listTrainers || !provider.submitLoraTraining) {
        throw badRequest(`Provider '${providerHost}' does not support LoRA training.`);
      }
      const trainers = provider.listTrainers();
      const trainerId =
        (typeof req.body?.trainer === "string" && req.body.trainer) ||
        trainers.find((t) => t.recommended)?.id ||
        trainers[0]?.id;
      const trainerInfo = trainers.find((t) => t.id === trainerId) ?? trainers[0];
      if (!trainerInfo) {
        throw badRequest(`Provider '${providerHost}' has no trainers configured.`);
      }

      const profile = personaTrainingProfile(persona.name);
      // Photos resolution, in priority order:
      //   1. an explicit server-side dir in the request body (power users),
      //   2. the photos the wizard uploaded to the asset store (staged to a
      //      temp dir the trainer can zip),
      //   3. the persona's default server-side photos dir (Sidney built-ins).
      let photosDir: string;
      const explicitDir =
        typeof req.body?.training_photos_dir === "string" && req.body.training_photos_dir.length > 0
          ? req.body.training_photos_dir
          : null;
      if (explicitDir) {
        photosDir = explicitDir;
      } else {
        const staged = storage
          ? await stagePersonaTrainingPhotos(db, storage, companyId, persona.id)
          : null;
        photosDir = staged?.dir ?? profile.defaultPhotosDir;
      }
      const photos = await countTrainingPhotos(photosDir);

      // Fire the run when the chosen provider is configured. Without a key,
      // create a 'pending' row that is never billed (the key lands later via the
      // credentials endpoint). The runner zips photosDir and submits through the
      // provider abstraction.
      const configured = await provider.isConfigured();
      if (configured) {
        try {
          const job = await startPersonaTraining(db, {
            persona: { id: persona.id, name: persona.name },
            photosDir,
            companyId,
            providerHost,
            trainerId: trainerInfo.id,
            providerId: legacyTrainerRowId,
          });
          // Drive the job to completion (download LoRA + flip persona to ready)
          // even if no client polls the status route.
          startBackgroundTrainingPoller(db, job.id);
          res.status(202).json({
            job,
            photos,
            provider: providerHost,
            trainer: trainerInfo.id,
            estimatedCostUsd: trainerInfo.costEstimateUsd,
            estimatedMinutes: trainerInfo.etaMinutes,
            externalJobId: job.externalJobId,
            note: `Training submitted to ${provider.name}.`,
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
          providerId: legacyTrainerRowId,
          providerHost,
          trainerModel: trainerInfo.id,
          status: "pending",
          contentRating: profile.contentRating,
          externalJobId: null,
          triggerWord: profile.triggerWord,
          trainingZipPath: null,
          hyperparams: defaultHyperparams(profile.triggerWord),
        })
        .returning();

      res.status(202).json({
        job,
        photos,
        provider: providerHost,
        trainer: trainerInfo.id,
        estimatedCostUsd: trainerInfo.costEstimateUsd,
        estimatedMinutes: trainerInfo.etaMinutes,
        note: `${provider.name} not configured yet — job created in 'pending'. Add its API key to enable.`,
      });
    },
  );

  // GET /image-studio/trainers — provider-grouped LoRA trainer catalog for the
  // wizard picker (mirrors the generation model picker). Marks which providers
  // are configured + the single ⭐ recommended trainer across all providers.
  router.get("/image-studio/trainers", async (_req, res) => {
    const groups = await Promise.all(
      listProviders().map(async (p) => ({
        host: p.id,
        name: p.name,
        color: p.color,
        configured: await p.isConfigured(),
        trainers: p.listTrainers?.() ?? [],
      })),
    );
    res.json({ providers: groups.filter((g) => g.trainers.length > 0) });
  });

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

      // Poll Replicate + sync both the job and its persona (status → ready/
      // failed, endpoint registration on success). Non-throwing: returns the
      // last-known row on any poll error.
      const updated = await syncTrainingJob(db, job);
      res.json({ job: updated });
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

  /** Coerce an arbitrary body field into a clean Record<string,string>. */
  function coerceSelections(raw: unknown): Selections {
    if (!raw || typeof raw !== "object") return {};
    const out: Selections = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim().length > 0) out[k] = v.trim();
    }
    return out;
  }

  // ── Structured attribute controls ─────────────────────────────────────────

  // GET /image-studio/attribute-controls?category=&content_rating=
  // The data-driven control catalog (controls + nested options) for the Generate
  // panel. Filterable so the UI can request just SFW options, or one category.
  router.get("/image-studio/attribute-controls", async (req, res) => {
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const contentRating =
      req.query.content_rating === "sfw" || req.query.content_rating === "explicit"
        ? req.query.content_rating
        : undefined;
    const { controls } = await loadCatalog(db, { category, contentRating });
    res.json({ controls });
  });

  // POST /image-studio/personas/:personaId/preview-prompt
  // Body: { selections?: Record<string,string>, freeText?: string }
  // Returns the assembled prompt for the live preview, plus any soft conflicts.
  router.post("/image-studio/personas/:personaId/preview-prompt", async (req, res) => {
    const { personaId } = req.params;
    const persona = await loadPersona(personaId);
    if (!persona || persona.type !== "local_lora") {
      res.status(404).json({ error: "Persona not found" });
      return;
    }
    const body = req.body ?? {};
    const selections = coerceSelections(body.selections);
    const freeText = typeof body.freeText === "string" ? body.freeText : "";
    const { catalog, controlLabels } = await loadCatalog(db);
    const prompt = assemblePrompt(
      { bio: persona.bio, attributes: persona.attributes },
      selections,
      freeText,
      catalog,
    );
    const conflicts = detectFreeTextConflicts(selections, freeText, catalog, controlLabels);
    res.json({ prompt, conflicts });
  });

  // PATCH /image-studio/personas/:personaId
  // Body: { bio?: string|null, attributes?: Record<string,unknown> }
  // Edits a persona's long-form bio + structured attribute defaults.
  router.patch("/image-studio/personas/:personaId", async (req, res) => {
    const { personaId } = req.params;
    const persona = await loadPersona(personaId);
    if (!persona || persona.type !== "local_lora") {
      res.status(404).json({ error: "Persona not found" });
      return;
    }
    const body = req.body ?? {};
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.bio !== undefined) {
      patch.bio = typeof body.bio === "string" && body.bio.trim().length > 0 ? body.bio.trim() : null;
    }
    if (body.attributes !== undefined && body.attributes && typeof body.attributes === "object") {
      patch.attributes = body.attributes;
    }
    // Persona CMS fields. Trigger word lives in attributes.trigger_word and is
    // intentionally NOT editable here once a persona is trained (renaming it
    // would break the installed LoRA); the UI locks it.
    if (body.name !== undefined && typeof body.name === "string" && body.name.trim().length > 0) {
      patch.name = body.name.trim();
    }
    if (body.group_id !== undefined) {
      patch.groupId = body.group_id === null || body.group_id === "" ? null : String(body.group_id);
    }
    if (body.avatar_path !== undefined) {
      patch.avatarPath =
        typeof body.avatar_path === "string" && body.avatar_path.trim().length > 0
          ? body.avatar_path.trim()
          : null;
    }
    if (body.is_favorite !== undefined) {
      patch.isFavorite = Boolean(body.is_favorite);
    }
    if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) {
      patch.sortOrder = Number(body.sort_order);
    }
    const [updated] = await db
      .update(imageProviders)
      .set(patch)
      .where(eq(imageProviders.id, personaId))
      .returning();
    res.json({ provider: updated });
  });

  // GET /image-studio/personas/:personaId — single persona (for the detail page
  // / deep-links where the providers list isn't already loaded).
  router.get("/image-studio/personas/:personaId", async (req, res) => {
    const { personaId } = req.params;
    const persona = await loadPersona(personaId);
    if (!persona || persona.type !== "local_lora") {
      res.status(404).json({ error: "Persona not found" });
      return;
    }
    res.json({ provider: persona });
  });

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

  // ── Batch generate (Replicate inference) ──────────────────────────────────

  const MAX_JOBS_PER_REQUEST = 24;
  const MAX_PHOTOSHOOT_JOBS = 96;

  /** Coerce a numeric body field to a fixed-precision string, or null. */
  function numOrNull(value: unknown): string | null {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : null;
  }

  /** Shared knobs for a generation job row. */
  interface JobDefaults {
    loraScale: string;
    steps: number;
    guidance: string;
    aspectRatio: string;
    contentRating: "sfw" | "explicit";
    promptTemplateId: string | null;
    baseSeed: number | null;
    providerHost: ProviderHost;
    /** Provider-native model id, or null = the provider's default. */
    model: string | null;
  }

  /**
   * Rough enqueue-time render cost for a (host, model). Image cost is per render;
   * video cost is per-second × an assumed ~5s clip. Returns a string for the
   * numeric column, or null when the model/cost is unknown.
   */
  async function estimateCostUsd(
    host: ProviderHost,
    model: string | null,
  ): Promise<string | null> {
    const provider = getProvider(host);
    if (!provider) return null;
    const models = await provider.listModels().catch(() => []);
    const id = model ?? provider.defaultModel();
    const info = models.find((m) => m.id === id) ?? models.find((m) => m.recommended);
    if (!info) return null;
    const usd = info.costUnit === "second" ? info.costPerUnit * 5 : info.costPerUnit;
    return usd.toFixed(4);
  }

  /** Build N generation_jobs rows for one prompt, fanning seeds out by index. */
  function buildJobRows(
    personaId: string,
    batchId: string,
    prompts: string[],
    defaults: JobDefaults,
    seedOffset = 0,
    costEstimate: string | null = null,
  ) {
    return prompts.map((prompt, i) => ({
      personaId,
      promptTemplateId: defaults.promptTemplateId,
      batchId,
      providerHost: defaults.providerHost,
      model: defaults.model,
      promptText: prompt,
      loraScale: defaults.loraScale,
      steps: defaults.steps,
      guidance: defaults.guidance,
      aspectRatio: defaults.aspectRatio,
      seed:
        defaults.baseSeed != null && Number.isFinite(defaults.baseSeed)
          ? defaults.baseSeed + seedOffset + i
          : null,
      status: "queued" as const,
      contentRating: defaults.contentRating,
      costEstimateUsd: costEstimate,
    }));
  }

  /** Resolve the provider host from a ?provider= query / body field (defaults to replicate). */
  function resolveHost(value: unknown): ProviderHost {
    return isProviderHost(value) ? value : DEFAULT_PROVIDER_HOST;
  }

  // POST /image-studio/personas/:personaId/generate
  // Body: { prompt_text, lora_scale?, steps?, guidance?, aspect_ratio?, seed?,
  //         count?, prompt_template_id? }
  // Expands {variation:a|b|c} placeholders (cross-product); when there is no
  // variation, `count` fans out N renders with different seeds. One
  // generation_jobs row per expansion (capped at 24), then kicks the queue.
  router.post("/image-studio/personas/:personaId/generate", async (req, res) => {
    const { personaId } = req.params;
    const persona = await loadPersona(personaId);
    if (!persona || persona.type !== "local_lora") {
      res.status(404).json({ error: "Persona not found" });
      return;
    }

    const body = req.body ?? {};

    // Structured-control mode: when `selections` (or `freeText`) is present, the
    // prompt is assembled from the persona bio + clicked attributes. Otherwise we
    // honor a raw `prompt_text` (backward-compatible composer path).
    const selections = coerceSelections(body.selections);
    const hasStructured =
      Object.keys(selections).length > 0 || typeof body.freeText === "string";

    let promptText = typeof body.prompt_text === "string" ? body.prompt_text.trim() : "";
    if (hasStructured) {
      const { catalog } = await loadCatalog(db);
      promptText = assemblePrompt(
        { bio: persona.bio, attributes: persona.attributes },
        selections,
        typeof body.freeText === "string" ? body.freeText : "",
        catalog,
      );
    }
    if (!promptText) throw badRequest("prompt_text or selections is required");

    const expanded = expandPromptVariations(promptText);
    const countRaw = Number.parseInt(String(body.count ?? "1"), 10);
    const count = Number.isFinite(countRaw) ? Math.min(Math.max(countRaw, 1), 8) : 1;

    // Variation placeholders define the batch; otherwise `count` fans it out.
    const prompts = expanded.length > 1 ? expanded : Array.from({ length: count }, () => expanded[0] ?? promptText);
    const capped = prompts.slice(0, MAX_JOBS_PER_REQUEST);

    const rating: "sfw" | "explicit" =
      body.content_rating === "explicit" ? "explicit" : personaContentRating(persona);

    const baseSeed = body.seed != null && body.seed !== "" ? Number(body.seed) : null;
    const templateId =
      typeof body.prompt_template_id === "string" && body.prompt_template_id.length > 0
        ? body.prompt_template_id
        : null;

    // Provider routing (0125): ?provider= query or body.provider_host, default
    // replicate. Optional body.model overrides the provider's default model.
    const providerHost = resolveHost(req.query.provider ?? body.provider_host);
    const model = typeof body.model === "string" && body.model.length > 0 ? body.model : null;
    const costEstimate = await estimateCostUsd(providerHost, model);

    const batchId = randomUUID();
    const rows = buildJobRows(
      personaId,
      batchId,
      capped,
      {
        loraScale: numOrNull(body.lora_scale) ?? "1.0",
        steps: Number.isFinite(Number(body.steps)) ? Number(body.steps) : 28,
        guidance: numOrNull(body.guidance) ?? "3.5",
        aspectRatio: typeof body.aspect_ratio === "string" ? body.aspect_ratio : "1:1",
        contentRating: rating,
        promptTemplateId: templateId,
        baseSeed,
        providerHost,
        model,
      },
      0,
      costEstimate,
    );

    const inserted = await db.insert(generationJobs).values(rows).returning({ id: generationJobs.id });

    // Kick the queue immediately (fire-and-forget); the 15s scheduler also drives it.
    void kickGenerationQueue(db).catch(() => {});

    res.status(202).json({
      batch_id: batchId,
      job_ids: inserted.map((r) => r.id),
      prompt: promptText,
      provider_host: providerHost,
    });
  });

  // POST /image-studio/generate — general (non-persona) text-to-image. Renders a
  // raw prompt on the base Flux model (no LoRA), ZenCreator-style. Uses a system
  // "General" persona row (attributes.general=true) to satisfy the generation_jobs
  // FK; the generator falls back to the base model for that persona.
  router.post("/image-studio/generate", async (req, res) => {
    const body = req.body ?? {};
    const companyId =
      typeof body.company_id === "string" && body.company_id.length > 0
        ? body.company_id
        : typeof req.query.company_id === "string"
          ? String(req.query.company_id)
          : null;
    if (!companyId) throw badRequest("company_id is required");

    const promptText = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!promptText) throw badRequest("prompt is required");

    // Find-or-create the system general persona for this company.
    let [general] = await db
      .select()
      .from(imageProviders)
      .where(
        and(
          eq(imageProviders.companyId, companyId),
          sql`(${imageProviders.attributes} ->> 'general') = 'true'`,
        ),
      )
      .limit(1);
    if (!general) {
      [general] = await db
        .insert(imageProviders)
        .values({
          companyId,
          name: "General",
          type: "external_api",
          providerHost: "replicate",
          attributes: { general: true },
          costPerUnit: "0",
        })
        .returning();
    }

    const countRaw = Number.parseInt(String(body.count ?? "1"), 10);
    const count = Number.isFinite(countRaw) ? Math.min(Math.max(countRaw, 1), 8) : 1;
    const capped = Array.from({ length: count }, () => promptText).slice(0, MAX_JOBS_PER_REQUEST);

    const rating: "sfw" | "explicit" = body.content_rating === "explicit" ? "explicit" : "sfw";
    const providerHost = resolveHost(req.query.provider ?? body.provider_host);
    const model = typeof body.model === "string" && body.model.length > 0 ? body.model : null;
    const costEstimate = await estimateCostUsd(providerHost, model);
    const baseSeed = body.seed != null && body.seed !== "" ? Number(body.seed) : null;

    const batchId = randomUUID();
    const rows = buildJobRows(
      general.id,
      batchId,
      capped,
      {
        loraScale: "1.0",
        steps: Number.isFinite(Number(body.steps)) ? Number(body.steps) : 28,
        guidance: "3.5",
        aspectRatio: typeof body.aspect_ratio === "string" ? body.aspect_ratio : "1:1",
        contentRating: rating,
        promptTemplateId:
          typeof body.prompt_template_id === "string" && body.prompt_template_id.length > 0
            ? body.prompt_template_id
            : null,
        baseSeed,
        providerHost,
        model,
      },
      0,
      costEstimate,
    );

    const inserted = await db
      .insert(generationJobs)
      .values(rows)
      .returning({ id: generationJobs.id });
    void kickGenerationQueue(db).catch(() => {});

    res.status(202).json({
      batch_id: batchId,
      persona_id: general.id,
      job_ids: inserted.map((r) => r.id),
      prompt: promptText,
      provider_host: providerHost,
    });
  });

  // GET /image-studio/generations?company_id=&limit= — Library/gallery: every
  // succeeded SFW creation for the company (across the general persona + any SFW
  // persona), newest first. Powers the MissionControl "Library" tab. NSFW is
  // intentionally excluded from the app gallery.
  router.get("/image-studio/generations", async (req, res) => {
    const companyId =
      typeof req.query.company_id === "string" && req.query.company_id.length > 0
        ? String(req.query.company_id)
        : null;
    if (!companyId) throw badRequest("company_id is required");

    const limitRaw = Number.parseInt(String(req.query.limit ?? ""), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 60;

    const personas = await db
      .select({ id: imageProviders.id })
      .from(imageProviders)
      .where(eq(imageProviders.companyId, companyId));
    const personaIds = personas.map((p) => p.id);
    if (personaIds.length === 0) {
      res.json({ generations: [] });
      return;
    }

    const rows = await db
      .select({
        id: generationJobs.id,
        prompt: generationJobs.promptText,
        outputPath: generationJobs.outputPath,
        aspectRatio: generationJobs.aspectRatio,
        contentRating: generationJobs.contentRating,
        createdAt: generationJobs.createdAt,
      })
      .from(generationJobs)
      .where(
        and(
          inArray(generationJobs.personaId, personaIds),
          eq(generationJobs.status, "succeeded"),
          isNotNull(generationJobs.outputPath),
          eq(generationJobs.contentRating, "sfw"),
        ),
      )
      .orderBy(desc(generationJobs.createdAt))
      .limit(limit);

    res.json({ generations: rows });
  });

  // ── Multi-provider: status, model catalogs, compare ───────────────────────

  // GET /image-studio/providers — the 3 hosted inference providers with token
  // status, balance (when exposed) and rate-limit notes. (Distinct from the
  // company-scoped persona-rows list at /companies/:id/image-studio/providers.)
  const RATE_LIMITS: Record<ProviderHost, string> = {
    replicate: "~6 prediction-creates/min (account cap)",
    atlascloud: "no published per-minute cap",
    wavespeedai: "no published per-minute cap",
  };
  router.get("/image-studio/providers", async (_req, res) => {
    const providers = await Promise.all(
      listProviders().map(async (p) => {
        const configured = await p.isConfigured();
        const verification = configured
          ? await p.verify().catch((err) => ({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }))
          : null;
        const models = await p.listModels().catch(() => []);
        return {
          host: p.id,
          name: p.name,
          color: p.color,
          configured,
          verified: verification?.ok ?? false,
          detail: verification && "detail" in verification ? verification.detail ?? null : null,
          error: verification && "error" in verification ? verification.error ?? null : null,
          balanceUsd:
            verification && "balanceUsd" in verification ? verification.balanceUsd ?? null : null,
          rateLimit: RATE_LIMITS[p.id],
          modelCount: models.length,
          isDefault: p.id === DEFAULT_PROVIDER_HOST,
        };
      }),
    );
    res.json({ providers });
  });

  // GET /image-studio/providers/:host/models — model catalog for one provider.
  router.get("/image-studio/providers/:host/models", async (req, res) => {
    const provider = getProvider(req.params.host);
    if (!provider) {
      res.status(404).json({ error: `Unknown provider '${req.params.host}'` });
      return;
    }
    const models = await provider.listModels().catch(() => []);
    res.json({ host: provider.id, models });
  });

  // POST /image-studio/personas/:personaId/generate-compare
  // Fire the SAME prompt across every configured provider (or an explicit
  // body.providers list) so the outputs can be reviewed side-by-side. Each
  // provider gets its own jobs under a shared batch_id, tagged by provider_host.
  router.post("/image-studio/personas/:personaId/generate-compare", async (req, res) => {
    const { personaId } = req.params;
    const persona = await loadPersona(personaId);
    if (!persona || persona.type !== "local_lora") {
      res.status(404).json({ error: "Persona not found" });
      return;
    }

    const body = req.body ?? {};

    // Assemble the prompt the same way the single-provider generate does.
    const selections = coerceSelections(body.selections);
    const hasStructured =
      Object.keys(selections).length > 0 || typeof body.freeText === "string";
    let promptText = typeof body.prompt_text === "string" ? body.prompt_text.trim() : "";
    if (hasStructured) {
      const { catalog } = await loadCatalog(db);
      promptText = assemblePrompt(
        { bio: persona.bio, attributes: persona.attributes },
        selections,
        typeof body.freeText === "string" ? body.freeText : "",
        catalog,
      );
    }
    if (!promptText) throw badRequest("prompt_text or selections is required");

    // Which providers to compare: explicit list, else every configured host.
    const requested: ProviderHost[] = Array.isArray(body.providers)
      ? body.providers.filter(isProviderHost)
      : PROVIDER_HOSTS;
    const hosts: ProviderHost[] = [];
    for (const host of requested) {
      const provider = getProvider(host);
      if (provider && (await provider.isConfigured())) hosts.push(host);
    }
    if (hosts.length === 0) {
      throw badRequest("No configured providers to compare — save at least one provider key.");
    }

    const rating: "sfw" | "explicit" =
      body.content_rating === "explicit" ? "explicit" : personaContentRating(persona);
    const baseSeed = body.seed != null && body.seed !== "" ? Number(body.seed) : null;
    const countRaw = Number.parseInt(String(body.count ?? "1"), 10);
    const count = Number.isFinite(countRaw) ? Math.min(Math.max(countRaw, 1), 4) : 1;

    const batchId = randomUUID();
    const allRows: ReturnType<typeof buildJobRows> = [];
    const byProvider: Record<string, number> = {};
    let seedOffset = 0;
    for (const host of hosts) {
      const prompts = Array.from({ length: count }, () => promptText);
      const costEstimate = await estimateCostUsd(host, null);
      allRows.push(
        ...buildJobRows(
          personaId,
          batchId,
          prompts,
          {
            loraScale: numOrNull(body.lora_scale) ?? "1.0",
            steps: Number.isFinite(Number(body.steps)) ? Number(body.steps) : 28,
            guidance: numOrNull(body.guidance) ?? "3.5",
            aspectRatio: typeof body.aspect_ratio === "string" ? body.aspect_ratio : "1:1",
            contentRating: rating,
            promptTemplateId: null,
            baseSeed,
            providerHost: host,
            model: null,
          },
          seedOffset,
          costEstimate,
        ),
      );
      byProvider[host] = count;
      // Share the same seed sequence across providers so each provider renders
      // the SAME seeds — a fairer A/B than independent random seeds.
    }

    const inserted = await db
      .insert(generationJobs)
      .values(allRows)
      .returning({ id: generationJobs.id, providerHost: generationJobs.providerHost });
    void kickGenerationQueue(db).catch(() => {});

    // Group the created job ids by provider for the side-by-side UI.
    const jobsByProvider: Record<string, string[]> = {};
    for (const row of inserted) {
      (jobsByProvider[row.providerHost] ??= []).push(row.id);
    }

    res.status(202).json({
      batch_id: batchId,
      prompt: promptText,
      providers: hosts,
      jobs_by_provider: jobsByProvider,
      total: inserted.length,
    });
  });

  // POST /image-studio/personas/:personaId/batch-generate  (PhotoShoot mode)
  // Body: { categories: [{ templateId, count }], shared_selections?, seed? }
  // For each category template, assemble persona bio + (shared_selections merged
  // with the template's attribute_preset) and fan out `count` renders. All
  // categories fire as one batch so the UI shows a single progress meter.
  router.post("/image-studio/personas/:personaId/batch-generate", async (req, res) => {
    const { personaId } = req.params;
    const persona = await loadPersona(personaId);
    if (!persona || persona.type !== "local_lora") {
      res.status(404).json({ error: "Persona not found" });
      return;
    }

    const body = req.body ?? {};
    const categories = Array.isArray(body.categories) ? body.categories : [];
    if (categories.length === 0) throw badRequest("categories is required");

    const shared = coerceSelections(body.shared_selections);
    const rating: "sfw" | "explicit" =
      body.content_rating === "explicit" ? "explicit" : personaContentRating(persona);
    const baseSeed = body.seed != null && body.seed !== "" ? Number(body.seed) : null;
    // PhotoShoot honors ?provider= too; defaults to replicate (persona LoRA).
    const photoshootHost = resolveHost(req.query.provider ?? body.provider_host);
    const photoshootCost = await estimateCostUsd(photoshootHost, null);

    const { catalog } = await loadCatalog(db);
    const batchId = randomUUID();
    const personaForAssembly = { bio: persona.bio, attributes: persona.attributes };

    const allRows: ReturnType<typeof buildJobRows> = [];
    let seedOffset = 0;
    for (const entry of categories) {
      const templateId = typeof entry?.templateId === "string" ? entry.templateId : null;
      if (!templateId) continue;
      const reqCount = Number.parseInt(String(entry?.count ?? "0"), 10);
      const count = Number.isFinite(reqCount) ? Math.min(Math.max(reqCount, 1), 30) : 1;

      const [tpl] = await db
        .select()
        .from(promptTemplates)
        .where(eq(promptTemplates.id, templateId))
        .limit(1);
      if (!tpl) continue;

      // Template preset defines the category; shared selections fill the gaps.
      const selections: Selections = { ...shared, ...coerceSelections(tpl.attributePreset) };
      // Fall back to the template's raw text if it has no structured preset.
      const prompt =
        Object.keys(selections).length > 0
          ? assemblePrompt(personaForAssembly, selections, "", catalog)
          : tpl.templateText;
      if (!prompt) continue;

      if (allRows.length + count > MAX_PHOTOSHOOT_JOBS) break;
      const prompts = Array.from({ length: count }, () => prompt);
      allRows.push(
        ...buildJobRows(personaId, batchId, prompts, {
          loraScale: tpl.defaultLoraScale != null ? String(tpl.defaultLoraScale) : "1.0",
          steps: tpl.defaultSteps ?? 28,
          guidance: tpl.defaultGuidance != null ? String(tpl.defaultGuidance) : "3.5",
          aspectRatio: tpl.defaultAspectRatio ?? "3:4",
          contentRating: tpl.contentRating === "explicit" ? "explicit" : rating,
          promptTemplateId: templateId,
          baseSeed,
          providerHost: photoshootHost,
          model: null,
        }, seedOffset, photoshootCost),
      );
      seedOffset += count;
    }

    if (allRows.length === 0) throw badRequest("No valid categories resolved");

    const inserted = await db.insert(generationJobs).values(allRows).returning({ id: generationJobs.id });
    void kickGenerationQueue(db).catch(() => {});

    res.status(202).json({
      batch_id: batchId,
      job_ids: inserted.map((r) => r.id),
      total: inserted.length,
    });
  });

  // GET /image-studio/personas/:personaId/generations/batch/:batchId
  router.get(
    "/image-studio/personas/:personaId/generations/batch/:batchId",
    async (req, res) => {
      const { personaId, batchId } = req.params;
      const jobs = await db
        .select()
        .from(generationJobs)
        .where(
          and(eq(generationJobs.personaId, personaId), eq(generationJobs.batchId, batchId)),
        )
        .orderBy(asc(generationJobs.createdAt));
      res.json({ jobs });
    },
  );

  // ── Tools: Female Undresser ──────────────────────────────────────────────
  // POST /image-studio/tools/female-undresser/generate
  // Body: { persona_id, source_file?, source_image?, model?, prompt?, count?,
  //         content_rating? }
  // Structurally complete: resolves the persona's configured undresser model
  // (image_providers.default_params.undresser_model) and fires through the
  // provider abstraction. Until Hermes' model selection lands as config, the
  // persona has no undresser_model and this returns a structured
  // `backend_pending` — setting the config is the only change needed to go live.
  router.post("/image-studio/tools/female-undresser/generate", async (req, res) => {
    const body = req.body ?? {};
    const personaId = typeof body.persona_id === "string" ? body.persona_id : "";
    if (!personaId) {
      throw badRequest("persona_id is required");
    }
    const contentRating = body.content_rating === "explicit" ? "explicit" : "sfw";
    const result = await runUndresserGeneration(db, {
      personaId,
      sourceImage: typeof body.source_image === "string" ? body.source_image : null,
      sourceFile: typeof body.source_file === "string" ? body.source_file : null,
      uiModel: typeof body.model === "string" ? body.model : null,
      prompt: typeof body.prompt === "string" ? body.prompt : null,
      count: Number.isFinite(Number(body.count)) ? Math.max(1, Number(body.count)) : 1,
      contentRating,
    });
    res.status(200).json(result);
  });

  // ── Unified template browser (cross-tool Library + template-click picker) ──

  // GET /image-studio/templates?tool=&model=&content_rating=&persona_id=&tags=a,b
  // Cross-tool template browser. `tool` matches applicable_tools; `persona_id`
  // includes shared (NULL) templates; `tags` is comma-separated (overlap).
  router.get("/image-studio/templates", async (req, res) => {
    const filters: ReturnType<typeof sql>[] = [];
    const tool = typeof req.query.tool === "string" ? req.query.tool : "";
    if (tool) filters.push(sql`${tool} = ANY(${promptTemplates.applicableTools})`);
    if (req.query.content_rating === "sfw" || req.query.content_rating === "explicit") {
      filters.push(eq(promptTemplates.contentRating, req.query.content_rating));
    }
    if (typeof req.query.persona_id === "string" && req.query.persona_id.length > 0) {
      filters.push(
        or(eq(promptTemplates.personaId, req.query.persona_id), isNull(promptTemplates.personaId))!,
      );
    }
    if (typeof req.query.model === "string" && req.query.model.length > 0) {
      filters.push(sql`${req.query.model} = ANY(${promptTemplates.compatibleModels})`);
    }
    if (typeof req.query.tags === "string" && req.query.tags.length > 0) {
      const tags = req.query.tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tags.length > 0) filters.push(sql`${promptTemplates.tags} && ${tags}`);
    }
    const templates = await db
      .select()
      .from(promptTemplates)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(promptTemplates.createdAt))
      .limit(500);
    res.json({ templates });
  });

  // POST /image-studio/templates/:id/apply
  // Body: { tool, model, persona_id? } → assembled prompt + recommended params.
  // For a persona + structured preset the prompt is assembled with the bio;
  // otherwise the raw template_text is returned. The UI loads the result into
  // the target tool's composer.
  router.post("/image-studio/templates/:id/apply", async (req, res) => {
    const { id } = req.params;
    const [tpl] = await db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.id, id))
      .limit(1);
    if (!tpl) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    const body = req.body ?? {};
    const personaId =
      typeof body.persona_id === "string" && body.persona_id.length > 0 ? body.persona_id : null;
    const preset = coerceSelections(tpl.attributePreset);

    let prompt = tpl.templateText;
    if (personaId && Object.keys(preset).length > 0) {
      const persona = await loadPersona(personaId);
      if (persona) {
        const { catalog } = await loadCatalog(db);
        prompt = assemblePrompt(
          { bio: persona.bio, attributes: persona.attributes },
          preset,
          "",
          catalog,
        );
      }
    }

    res.json({
      prompt,
      template_text: tpl.templateText,
      attribute_preset: preset,
      tool: typeof body.tool === "string" ? body.tool : (tpl.applicableTools?.[0] ?? "photoshoot"),
      model: typeof body.model === "string" ? body.model : (tpl.compatibleModels?.[0] ?? "general"),
      persona_id: personaId,
      params: {
        lora_scale: tpl.defaultLoraScale != null ? Number(tpl.defaultLoraScale) : 1.0,
        steps: tpl.defaultSteps ?? 28,
        guidance: tpl.defaultGuidance != null ? Number(tpl.defaultGuidance) : 3.5,
        aspect_ratio: tpl.defaultAspectRatio ?? "3:4",
      },
    });
  });

  // ── Prompt templates ──────────────────────────────────────────────────────

  // GET /image-studio/personas/:personaId/prompt-templates?category=&content_rating=
  // Returns this persona's templates + shared (persona_id IS NULL) templates,
  // optionally filtered by category / content_rating (for the Library tab chips).
  router.get(
    "/image-studio/personas/:personaId/prompt-templates",
    async (req, res) => {
      const { personaId } = req.params;
      const filters = [
        or(eq(promptTemplates.personaId, personaId), isNull(promptTemplates.personaId)),
      ];
      if (typeof req.query.category === "string" && req.query.category.length > 0) {
        filters.push(eq(promptTemplates.category, req.query.category));
      }
      if (req.query.content_rating === "sfw" || req.query.content_rating === "explicit") {
        filters.push(eq(promptTemplates.contentRating, req.query.content_rating));
      }
      const templates = await db
        .select()
        .from(promptTemplates)
        .where(and(...filters))
        .orderBy(desc(promptTemplates.createdAt));
      res.json({ templates });
    },
  );

  // POST /image-studio/personas/:personaId/prompt-templates
  router.post(
    "/image-studio/personas/:personaId/prompt-templates",
    async (req, res) => {
      const { personaId } = req.params;
      const persona = await loadPersona(personaId);
      if (!persona || persona.type !== "local_lora") {
        res.status(404).json({ error: "Persona not found" });
        return;
      }
      const body = req.body ?? {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const templateText = typeof body.template_text === "string" ? body.template_text.trim() : "";
      if (!name) throw badRequest("name is required");
      if (!templateText) throw badRequest("template_text is required");

      const rating: "sfw" | "explicit" =
        body.content_rating === "explicit" ? "explicit" : personaContentRating(persona);

      const [inserted] = await db
        .insert(promptTemplates)
        .values({
          name,
          description: typeof body.description === "string" ? body.description : null,
          personaId,
          templateText,
          defaultLoraScale: body.default_lora_scale != null ? String(body.default_lora_scale) : null,
          defaultSteps: Number.isFinite(Number(body.default_steps)) ? Number(body.default_steps) : null,
          defaultGuidance: body.default_guidance != null ? String(body.default_guidance) : null,
          defaultAspectRatio:
            typeof body.default_aspect_ratio === "string" ? body.default_aspect_ratio : null,
          contentRating: rating,
          tags: Array.isArray(body.tags) ? body.tags.map((t: unknown) => String(t)) : null,
          attributePreset:
            body.attribute_preset && typeof body.attribute_preset === "object"
              ? body.attribute_preset
              : {},
          category: typeof body.category === "string" ? body.category : null,
          genderTargeting:
            typeof body.gender_targeting === "string" ? body.gender_targeting : "any",
          previewImagePath:
            typeof body.preview_image_path === "string" ? body.preview_image_path : null,
        })
        .returning();

      res.status(201).json({ template: inserted });
    },
  );

  // PATCH /image-studio/prompt-templates/:id
  router.patch("/image-studio/prompt-templates/:id", async (req, res) => {
    const { id } = req.params;
    const body = req.body ?? {};
    const [updated] = await db
      .update(promptTemplates)
      .set({
        ...(typeof body.name === "string" && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(typeof body.template_text === "string" && { templateText: body.template_text }),
        ...(body.default_lora_scale !== undefined && {
          defaultLoraScale: body.default_lora_scale != null ? String(body.default_lora_scale) : null,
        }),
        ...(body.default_steps !== undefined && {
          defaultSteps: body.default_steps != null ? Number(body.default_steps) : null,
        }),
        ...(body.default_guidance !== undefined && {
          defaultGuidance: body.default_guidance != null ? String(body.default_guidance) : null,
        }),
        ...(body.default_aspect_ratio !== undefined && {
          defaultAspectRatio: body.default_aspect_ratio,
        }),
        ...(body.content_rating !== undefined && {
          contentRating: body.content_rating === "explicit" ? "explicit" : "sfw",
        }),
        ...(body.tags !== undefined && {
          tags: Array.isArray(body.tags) ? body.tags.map((t: unknown) => String(t)) : null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(promptTemplates.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json({ template: updated });
  });

  // DELETE /image-studio/prompt-templates/:id
  router.delete("/image-studio/prompt-templates/:id", async (req, res) => {
    const { id } = req.params;
    const [deleted] = await db
      .delete(promptTemplates)
      .where(eq(promptTemplates.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json({ template: deleted });
  });

  // ── Influencer Studio: Gemini content generation ──────────────────────

  // POST /companies/:companyId/image-studio/personas/:personaId/generate-content
  // Body: { topic: string, count?: number }
  // Uses Gemini to generate social media post ideas matching the persona's style.
  router.post("/companies/:companyId/image-studio/personas/:personaId/generate-content", async (req, res, next) => {
    try {
      const { companyId, personaId } = req.params;
      assertCompanyAccess(req, companyId);
      const { topic, count = 5 } = req.body ?? {};
      if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
        throw badRequest("topic is required");
      }

      // Load persona from existing imageProviders table
      const [persona] = await db
        .select()
        .from(imageProviders)
        .where(and(eq(imageProviders.id, personaId), eq(imageProviders.companyId, companyId)))
        .limit(1);
      if (!persona) throw notFound("Persona not found");

      const ideas = await generateContentIdeas(
        { name: persona.name, bio: persona.bio, attributes: persona.attributes ?? {} },
        topic.trim(),
        Math.min(Math.max(1, count), 20),
      );

      res.json({ ideas });
    } catch (err) {
      next(err);
    }
  });

  // POST /companies/:companyId/image-studio/personas/:personaId/schedule-post
  // Body: { caption: string, imagePath?: string, scheduledAt?: string }
  // Creates a draft social_post (status='draft') — target account assignment
  // happens later in the Social tab. Never auto-publishes.
  router.post("/companies/:companyId/image-studio/personas/:personaId/schedule-post", async (req, res, next) => {
    try {
      const { companyId, personaId } = req.params;
      assertCompanyAccess(req, companyId);
      const { caption, imagePath, scheduledAt } = req.body ?? {};
      if (!caption || typeof caption !== "string" || caption.trim().length === 0) {
        throw badRequest("caption is required");
      }

      // Verify persona exists
      const [persona] = await db
        .select({ id: imageProviders.id })
        .from(imageProviders)
        .where(and(eq(imageProviders.id, personaId), eq(imageProviders.companyId, companyId)))
        .limit(1);
      if (!persona) throw notFound("Persona not found");

      // Create social_post in DRAFT status only — no publish path reachable
      // Uses existing social_posts table. No social_post_targets created —
      // target account assignment happens later in the Social tab.
      const actor = getActorInfo(req);
      const insertData: Record<string, unknown> = {
        companyId,
        content: caption.trim(),
        postType: "text",
        status: "draft",
        mediaUrls: imagePath ? [imagePath] : [],
        metadata: { personaId, source: "influencer-studio" },
        createdBy: actor.actorId,
      };
      if (scheduledAt && typeof scheduledAt === "string") {
        insertData.scheduledAt = new Date(scheduledAt);
      }

      const [post] = await db
        .insert(socialPosts)
        .values(insertData as typeof socialPosts.$inferInsert)
        .returning();

      try {
        await logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          action: "influencer.post.drafted",
          entityType: "social_post",
          entityId: post.id,
          details: { personaId, source: "influencer-studio" },
        });
      } catch {
        // Activity logging is best-effort
      }

      res.status(201).json({ post });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
