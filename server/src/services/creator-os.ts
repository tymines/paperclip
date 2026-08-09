import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  assets,
  creatorCampaignItems,
  creatorCampaigns,
  creatorFlowRuns,
  creatorFlowRunSteps,
  creatorFlowSteps,
  creatorFlows,
  creatorReviewRequests,
  generationJobs,
  imageProviders,
  personaGenerations,
  socialPosts,
} from "@paperclipai/db";
import type {
  CreateCreatorCampaign,
  CreateCreatorCampaignItem,
  CreateCreatorFlow,
  CreateCreatorReview,
  CreatorContentSourceOption,
  CreatorFlowStepConfig,
  CreatorGenerationWorkerReadiness,
  UpdateCreatorCampaign,
  UpdateCreatorFlow,
} from "@paperclipai/shared";
import { CREATOR_OS_GENERATION_WORKER_UNAVAILABLE_REASON } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { buildImageStudioCapabilityCatalog } from "./image-studio/capabilities.js";
import { listProviders, type ImageProvider } from "./image-providers/index.js";

type Actor = { actorId: string };

const ACTIVE_JOB_STATUSES = new Set(["queued", "submitting", "submitted", "polling", "landing"]);

export interface CreatorOsServiceOptions {
  providers?: ImageProvider[];
  generationWorkerReadiness?: CreatorGenerationWorkerReadiness;
  kickGenerationQueue?: () => Promise<unknown>;
  onQueueKickError?: () => void;
}

export function creatorOsService(db: Db, options: CreatorOsServiceOptions = {}) {
  const capabilityProviders = options.providers ?? listProviders();
  const generationWorkerReadiness = options.generationWorkerReadiness ?? {
    enabled: false,
    disabledReason: CREATOR_OS_GENERATION_WORKER_UNAVAILABLE_REASON,
  };

  function assertGenerationWorkerReady() {
    if (!generationWorkerReadiness.enabled) {
      throw unprocessable(generationWorkerReadiness.disabledReason ?? CREATOR_OS_GENERATION_WORKER_UNAVAILABLE_REASON);
    }
  }

  function kickGenerationQueueAfterCommit() {
    if (!options.kickGenerationQueue) return;
    void options.kickGenerationQueue().catch(() => options.onQueueKickError?.());
  }

  async function requirePersona(companyId: string, personaId: string) {
    const persona = await db
      .select()
      .from(imageProviders)
      .where(and(eq(imageProviders.id, personaId), eq(imageProviders.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!persona) throw notFound("Company-owned persona not found");
    return persona;
  }

  async function flowDetail(flow: typeof creatorFlows.$inferSelect) {
    const steps = await db
      .select()
      .from(creatorFlowSteps)
      .where(eq(creatorFlowSteps.flowId, flow.id))
      .orderBy(asc(creatorFlowSteps.position));
    return { ...flow, steps };
  }

  async function assertRunnableSteps(
    persona: typeof imageProviders.$inferSelect,
    steps: Array<{ name: string; config: CreatorFlowStepConfig | Record<string, unknown> }>,
  ) {
    const isGeneral = persona.attributes?.general === true;
    const catalog = await buildImageStudioCapabilityCatalog(capabilityProviders, {
      id: persona.id,
      isGeneral,
      hasResolvableReplicateModel:
        !isGeneral &&
        persona.status === "ready" &&
        typeof persona.endpoint === "string" &&
        persona.endpoint.trim().length > 0,
    });
    for (const step of steps) {
      const config = step.config as CreatorFlowStepConfig;
      const providerHost = config.providerHost ?? "replicate";
      const nativeModel = config.model ?? null;
      const capability = catalog.capabilities.find(
        (candidate) =>
          candidate.providerHost === providerHost &&
          candidate.nativeModel === nativeModel,
      );
      if (!capability) {
        throw unprocessable(
          `Flow step "${step.name}" is unavailable: the selected generation capability is not present in the server catalog.`,
        );
      }
      if (!capability.enabled) {
        throw unprocessable(
          `Flow step "${step.name}" is unavailable: ${capability.disabledReason ?? "the selected provider capability is not ready."}`,
        );
      }
    }
  }

  async function listFlows(companyId: string, personaId?: string) {
    const conditions = [eq(creatorFlows.companyId, companyId)];
    if (personaId) conditions.push(eq(creatorFlows.personaId, personaId));
    const rows = await db
      .select()
      .from(creatorFlows)
      .where(and(...conditions))
      .orderBy(desc(creatorFlows.updatedAt));
    return Promise.all(rows.map(flowDetail));
  }

  async function getFlow(companyId: string, flowId: string) {
    const flow = await db
      .select()
      .from(creatorFlows)
      .where(and(eq(creatorFlows.id, flowId), eq(creatorFlows.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!flow) throw notFound("Flow not found");
    return flowDetail(flow);
  }

  async function createFlow(companyId: string, input: CreateCreatorFlow, actor: Actor) {
    await requirePersona(companyId, input.personaId);
    return db.transaction(async (tx) => {
      const [flow] = await tx.insert(creatorFlows).values({
        companyId,
        personaId: input.personaId,
        name: input.name,
        description: input.description ?? null,
        status: input.status,
        createdBy: actor.actorId,
      }).returning();
      const steps = await tx.insert(creatorFlowSteps).values(input.steps.map((step, position) => ({
        flowId: flow.id,
        position,
        name: step.name,
        config: step.config,
      }))).returning();
      return { ...flow, steps };
    });
  }

  async function updateFlow(companyId: string, flowId: string, input: UpdateCreatorFlow) {
    const existing = await getFlow(companyId, flowId);
    if (existing.status === "archived") throw conflict("Archived flows are immutable");
    return db.transaction(async (tx) => {
      const [flow] = await tx.update(creatorFlows).set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      }).where(and(eq(creatorFlows.id, flowId), eq(creatorFlows.companyId, companyId))).returning();
      let steps = existing.steps;
      if (input.steps) {
        await tx.delete(creatorFlowSteps).where(eq(creatorFlowSteps.flowId, flowId));
        steps = await tx.insert(creatorFlowSteps).values(input.steps.map((step, position) => ({
          flowId,
          position,
          name: step.name,
          config: step.config,
        }))).returning();
      }
      return { ...flow, steps };
    });
  }

  async function enqueueStep(tx: Db, run: typeof creatorFlowRuns.$inferSelect, step: typeof creatorFlowRunSteps.$inferSelect) {
    const config = step.configSnapshot as unknown as CreatorFlowStepConfig;
    const [claimed] = await tx.update(creatorFlowRunSteps).set({
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(creatorFlowRunSteps.id, step.id), eq(creatorFlowRunSteps.status, "pending"))).returning();
    if (!claimed) return step;
    const [job] = await tx.insert(generationJobs).values({
      personaId: run.personaId,
      batchId: randomUUID(),
      providerHost: config.providerHost ?? "replicate",
      model: config.model ?? null,
      promptText: config.prompt,
      loraScale: config.loraScale?.toString(),
      steps: config.steps,
      guidance: config.guidance?.toString(),
      aspectRatio: config.aspectRatio,
      contentRating: config.contentRating ?? "sfw",
      status: "queued",
      submissionEligibleAt: new Date(),
    }).returning();
    const [updated] = await tx.update(creatorFlowRunSteps).set({
      generationJobId: job.id,
      updatedAt: new Date(),
    }).where(eq(creatorFlowRunSteps.id, step.id)).returning();
    return updated;
  }

  async function runDetail(companyId: string, runId: string, reconcile = true) {
    if (reconcile) await reconcileRun(companyId, runId);
    const run = await db.select().from(creatorFlowRuns)
      .where(and(eq(creatorFlowRuns.id, runId), eq(creatorFlowRuns.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!run) throw notFound("Flow run not found");
    const steps = await db.select().from(creatorFlowRunSteps)
      .where(eq(creatorFlowRunSteps.runId, run.id))
      .orderBy(asc(creatorFlowRunSteps.position), asc(creatorFlowRunSteps.attempt));
    return { ...run, steps: steps.map((step) => ({ ...step, retryEligible: step.status === "failed" || step.status === "cancelled" })) };
  }

  async function startRun(companyId: string, flowId: string, idempotencyKey: string, actor: Actor) {
    assertGenerationWorkerReady();
    const flow = await getFlow(companyId, flowId);
    if (flow.status !== "active") throw conflict("Only active flows can run");
    const previous = await db.select().from(creatorFlowRuns)
      .where(and(eq(creatorFlowRuns.flowId, flowId), eq(creatorFlowRuns.idempotencyKey, idempotencyKey)))
      .then((rows) => rows[0] ?? null);
    if (previous) return runDetail(companyId, previous.id);
    const persona = await requirePersona(companyId, flow.personaId);
    await assertRunnableSteps(persona, flow.steps);
    let created = false;
    const runId = await db.transaction(async (tx) => {
      const [run] = await tx.insert(creatorFlowRuns).values({
        companyId,
        personaId: flow.personaId,
        flowId,
        status: "running",
        idempotencyKey,
        createdBy: actor.actorId,
        startedAt: new Date(),
      }).onConflictDoNothing({
        target: [creatorFlowRuns.flowId, creatorFlowRuns.idempotencyKey],
      }).returning();
      if (!run) {
        const prior = await tx.select({ id: creatorFlowRuns.id }).from(creatorFlowRuns)
          .where(and(eq(creatorFlowRuns.flowId, flowId), eq(creatorFlowRuns.idempotencyKey, idempotencyKey)))
          .then((rows) => rows[0] ?? null);
        if (!prior) throw conflict("Flow run idempotency claim failed");
        return prior.id;
      }
      created = true;
      const attempts = await tx.insert(creatorFlowRunSteps).values(flow.steps.map((step) => ({
        runId: run.id,
        flowStepId: step.id,
        stepName: step.name,
        configSnapshot: step.config,
        position: step.position,
        attempt: 1,
        status: "pending",
      }))).returning();
      await enqueueStep(tx as unknown as Db, run, attempts[0]);
      return run.id;
    });
    if (created) kickGenerationQueueAfterCommit();
    return runDetail(companyId, runId, false);
  }

  async function reconcileRun(companyId: string, runId: string) {
    const run = await db.select().from(creatorFlowRuns)
      .where(and(eq(creatorFlowRuns.id, runId), eq(creatorFlowRuns.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!run || ["succeeded", "cancelled"].includes(run.status)) return;
    await db.transaction(async (tx) => {
      const attempts = await tx.select().from(creatorFlowRunSteps)
        .where(eq(creatorFlowRunSteps.runId, runId))
        .orderBy(asc(creatorFlowRunSteps.position), desc(creatorFlowRunSteps.attempt));
      const jobIds = attempts.flatMap((step) => step.generationJobId ? [step.generationJobId] : []);
      const jobs = jobIds.length
        ? await tx.select().from(generationJobs).where(inArray(generationJobs.id, jobIds))
        : [];
      const byId = new Map(jobs.map((job) => [job.id, job]));
      for (const step of attempts) {
        if (step.status !== "running" || !step.generationJobId) continue;
        const job = byId.get(step.generationJobId);
        if (!job || ACTIVE_JOB_STATUSES.has(job.status)) continue;
        const status = job.status === "succeeded" ? "succeeded" : job.status === "cancelled" ? "cancelled" : "failed";
        await tx.update(creatorFlowRunSteps).set({
          status,
          errorMessage: status === "failed" ? job.errorMessage ?? "Generation failed" : null,
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(creatorFlowRunSteps.id, step.id));
        step.status = status;
        step.errorMessage = status === "failed" ? job.errorMessage ?? "Generation failed" : null;
      }
      const latest = new Map<number, typeof attempts[number]>();
      for (const step of attempts) if (!latest.has(step.position)) latest.set(step.position, step);
      const ordered = [...latest.values()].sort((a, b) => a.position - b.position);
      const failed = ordered.find((step) => step.status === "failed" || step.status === "cancelled");
      if (failed) {
        await tx.update(creatorFlowRuns).set({ status: "failed", errorMessage: failed.errorMessage, updatedAt: new Date() })
          .where(eq(creatorFlowRuns.id, runId));
        return;
      }
      const pending = ordered.find((step) => step.status === "pending");
      const active = ordered.some((step) => step.status === "running");
      if (pending && !active && ordered.filter((step) => step.position < pending.position).every((step) => step.status === "succeeded")) {
        await enqueueStep(tx as unknown as Db, run, pending);
        return;
      }
      if (!pending && !active && ordered.every((step) => step.status === "succeeded")) {
        await tx.update(creatorFlowRuns).set({ status: "succeeded", errorMessage: null, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(creatorFlowRuns.id, runId));
      }
    });
  }

  async function listRuns(companyId: string, flowId: string) {
    await getFlow(companyId, flowId);
    const runs = await db.select({ id: creatorFlowRuns.id }).from(creatorFlowRuns)
      .where(and(eq(creatorFlowRuns.companyId, companyId), eq(creatorFlowRuns.flowId, flowId)))
      .orderBy(desc(creatorFlowRuns.createdAt));
    return Promise.all(runs.map((run) => runDetail(companyId, run.id)));
  }

  async function reconcileActiveRuns() {
    const runs = await db
      .select({ id: creatorFlowRuns.id, companyId: creatorFlowRuns.companyId })
      .from(creatorFlowRuns)
      .where(inArray(creatorFlowRuns.status, ["pending", "running"]));
    for (const run of runs) await reconcileRun(run.companyId, run.id);
    return { reconciled: runs.length };
  }

  async function retryStep(companyId: string, runId: string, stepId: string, idempotencyKey: string) {
    assertGenerationWorkerReady();
    const detail = await runDetail(companyId, runId);
    const priorByKey = detail.steps.find((step) => step.retryIdempotencyKey === idempotencyKey);
    if (priorByKey) return detail;
    const target = detail.steps.find((step) => step.id === stepId);
    if (!target) throw notFound("Flow run step not found");
    const latestAttempt = Math.max(...detail.steps.filter((step) => step.position === target.position).map((step) => step.attempt));
    if (target.attempt !== latestAttempt || !target.retryEligible) throw conflict("Only the latest failed or cancelled attempt can be retried");
    const persona = await requirePersona(companyId, detail.personaId);
    await assertRunnableSteps(persona, [{ name: target.stepName, config: target.configSnapshot }]);
    let created = false;
    await db.transaction(async (tx) => {
      const [attempt] = await tx.insert(creatorFlowRunSteps).values({
        runId,
        flowStepId: target.flowStepId,
        stepName: target.stepName,
        configSnapshot: target.configSnapshot,
        position: target.position,
        attempt: target.attempt + 1,
        status: "pending",
        retryIdempotencyKey: idempotencyKey,
      }).onConflictDoNothing({
        target: [creatorFlowRunSteps.runId, creatorFlowRunSteps.retryIdempotencyKey],
      }).returning();
      if (!attempt) return;
      created = true;
      const [run] = await tx.update(creatorFlowRuns).set({ status: "running", errorMessage: null, completedAt: null, updatedAt: new Date() })
        .where(eq(creatorFlowRuns.id, runId)).returning();
      await enqueueStep(tx as unknown as Db, run, attempt);
    });
    if (created) kickGenerationQueueAfterCommit();
    return runDetail(companyId, runId, false);
  }

  async function campaignDetail(campaign: typeof creatorCampaigns.$inferSelect) {
    const items = await db.select().from(creatorCampaignItems)
      .where(and(
        eq(creatorCampaignItems.campaignId, campaign.id),
        eq(creatorCampaignItems.companyId, campaign.companyId),
      ))
      .orderBy(asc(creatorCampaignItems.createdAt));
    return { ...campaign, items };
  }

  async function listCampaigns(companyId: string, personaId?: string) {
    const conditions = [eq(creatorCampaigns.companyId, companyId)];
    if (personaId) conditions.push(eq(creatorCampaigns.personaId, personaId));
    const rows = await db.select().from(creatorCampaigns).where(and(...conditions)).orderBy(desc(creatorCampaigns.updatedAt));
    return Promise.all(rows.map(campaignDetail));
  }

  async function getCampaign(companyId: string, campaignId: string) {
    const campaign = await db.select().from(creatorCampaigns)
      .where(and(eq(creatorCampaigns.id, campaignId), eq(creatorCampaigns.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!campaign) throw notFound("Campaign not found");
    return campaignDetail(campaign);
  }

  async function createCampaign(companyId: string, input: CreateCreatorCampaign, actor: Actor) {
    await requirePersona(companyId, input.personaId);
    const [campaign] = await db.insert(creatorCampaigns).values({ ...input, description: input.description ?? null, companyId, createdBy: actor.actorId }).returning();
    return { ...campaign, items: [] };
  }

  async function updateCampaign(companyId: string, campaignId: string, input: UpdateCreatorCampaign) {
    const existing = await getCampaign(companyId, campaignId);
    if (existing.status === "archived") throw conflict("Archived campaigns are immutable");
    const [campaign] = await db.update(creatorCampaigns).set({ ...input, updatedAt: new Date() })
      .where(and(eq(creatorCampaigns.id, campaignId), eq(creatorCampaigns.companyId, companyId))).returning();
    return campaignDetail(campaign);
  }

  function postMatchesPersona(post: typeof socialPosts.$inferSelect, personaId: string) {
    return post.metadata && typeof post.metadata === "object" && (post.metadata as Record<string, unknown>).personaId === personaId;
  }

  async function validateReference(companyId: string, personaId: string, kind: CreateCreatorCampaignItem["kind"], referenceId: string) {
    switch (kind) {
      case "flow": return db.select().from(creatorFlows).where(and(eq(creatorFlows.id, referenceId), eq(creatorFlows.companyId, companyId), eq(creatorFlows.personaId, personaId))).then((r) => r[0] ?? null);
      case "flow_run": return db.select().from(creatorFlowRuns).where(and(eq(creatorFlowRuns.id, referenceId), eq(creatorFlowRuns.companyId, companyId), eq(creatorFlowRuns.personaId, personaId))).then((r) => r[0] ?? null);
      case "generation": return db.select({ id: personaGenerations.id }).from(personaGenerations).innerJoin(imageProviders, eq(personaGenerations.personaId, imageProviders.id)).where(and(eq(personaGenerations.id, referenceId), eq(personaGenerations.personaId, personaId), eq(imageProviders.companyId, companyId))).then((r) => r[0] ?? null);
      case "asset": return db.select().from(assets).where(and(eq(assets.id, referenceId), eq(assets.companyId, companyId))).then((r) => r[0] ?? null);
      case "review_request": return db.select().from(creatorReviewRequests).where(and(eq(creatorReviewRequests.id, referenceId), eq(creatorReviewRequests.companyId, companyId), eq(creatorReviewRequests.personaId, personaId))).then((r) => r[0] ?? null);
      case "social_draft": {
        const post = await db.select().from(socialPosts).where(and(eq(socialPosts.id, referenceId), eq(socialPosts.companyId, companyId), eq(socialPosts.status, "draft"))).then((r) => r[0] ?? null);
        return post && postMatchesPersona(post, personaId) ? post : null;
      }
    }
  }

  async function addCampaignItem(companyId: string, campaignId: string, input: CreateCreatorCampaignItem, actor: Actor) {
    const campaign = await getCampaign(companyId, campaignId);
    if (campaign.status === "archived") throw conflict("Archived campaigns are immutable");
    if (!await validateReference(companyId, campaign.personaId, input.kind, input.referenceId)) throw notFound("Campaign item not found for this company and persona");
    const [item] = await db.insert(creatorCampaignItems).values({ companyId, campaignId, ...input, createdBy: actor.actorId }).returning();
    return item;
  }

  function shortText(value: string | null | undefined, fallback: string) {
    const clean = value?.trim();
    if (!clean) return fallback;
    return clean.length > 72 ? `${clean.slice(0, 69)}...` : clean;
  }

  async function listContentSources(companyId: string, personaId: string): Promise<CreatorContentSourceOption[]> {
    await requirePersona(companyId, personaId);
    const [flows, runs, generations, companyAssets, reviews, drafts] = await Promise.all([
      db.select({ id: creatorFlows.id, name: creatorFlows.name, status: creatorFlows.status })
        .from(creatorFlows)
        .where(and(eq(creatorFlows.companyId, companyId), eq(creatorFlows.personaId, personaId)))
        .orderBy(desc(creatorFlows.updatedAt)),
      db.select({ id: creatorFlowRuns.id, flowName: creatorFlows.name, status: creatorFlowRuns.status })
        .from(creatorFlowRuns)
        .innerJoin(creatorFlows, eq(creatorFlowRuns.flowId, creatorFlows.id))
        .where(and(eq(creatorFlowRuns.companyId, companyId), eq(creatorFlowRuns.personaId, personaId)))
        .orderBy(desc(creatorFlowRuns.createdAt)),
      db.select({ id: personaGenerations.id, prompt: personaGenerations.prompt, imagePath: personaGenerations.imagePath, source: personaGenerations.source })
        .from(personaGenerations)
        .innerJoin(imageProviders, eq(personaGenerations.personaId, imageProviders.id))
        .where(and(eq(personaGenerations.personaId, personaId), eq(imageProviders.companyId, companyId)))
        .orderBy(desc(personaGenerations.createdAt)),
      db.select({ id: assets.id, originalFilename: assets.originalFilename, contentType: assets.contentType })
        .from(assets)
        .where(eq(assets.companyId, companyId))
        .orderBy(desc(assets.createdAt)),
      db.select({ id: creatorReviewRequests.id, sourceType: creatorReviewRequests.sourceType, status: creatorReviewRequests.status })
        .from(creatorReviewRequests)
        .where(and(eq(creatorReviewRequests.companyId, companyId), eq(creatorReviewRequests.personaId, personaId)))
        .orderBy(desc(creatorReviewRequests.createdAt)),
      db.select({ id: socialPosts.id, content: socialPosts.content, mediaUrls: socialPosts.mediaUrls })
        .from(socialPosts)
        .where(and(
          eq(socialPosts.companyId, companyId),
          eq(socialPosts.status, "draft"),
          sql`${socialPosts.metadata}->>'personaId' = ${personaId}`,
        ))
        .orderBy(desc(socialPosts.createdAt)),
    ]);

    return [
      ...generations.map((row) => ({
        id: row.id,
        kind: "generation" as const,
        label: shortText(row.prompt, `Generation ${row.id.slice(0, 8)}`),
        detail: `${row.source} generation`,
        reviewEligible: true,
        preview: { mediaUrl: `/api/companies/${companyId}/creator-os/media/generations/${row.id}`, content: row.prompt ?? null },
      })),
      ...companyAssets.map((row) => ({
        id: row.id,
        kind: "asset" as const,
        label: shortText(row.originalFilename, `Library asset ${row.id.slice(0, 8)}`),
        detail: row.contentType,
        reviewEligible: true,
        preview: { mediaUrl: row.contentType.startsWith("image/") ? `/api/assets/${row.id}/content` : null, content: null },
      })),
      ...drafts.map((row) => ({
        id: row.id,
        kind: "social_draft" as const,
        label: shortText(row.content, `Social draft ${row.id.slice(0, 8)}`),
        detail: "Social draft",
        reviewEligible: true,
        preview: {
          mediaUrl: Array.isArray(row.mediaUrls) && typeof row.mediaUrls[0] === "string" ? row.mediaUrls[0] : null,
          content: row.content,
        },
      })),
      ...flows.map((row) => ({ id: row.id, kind: "flow" as const, label: row.name, detail: `${row.status} flow`, reviewEligible: false, preview: { mediaUrl: null, content: null } })),
      ...runs.map((row) => ({ id: row.id, kind: "flow_run" as const, label: `${row.flowName} run`, detail: row.status, reviewEligible: false, preview: { mediaUrl: null, content: null } })),
      ...reviews.map((row) => ({ id: row.id, kind: "review_request" as const, label: `${row.sourceType.replace("_", " ")} review`, detail: row.status, reviewEligible: false, preview: { mediaUrl: null, content: null } })),
    ];
  }

  async function validateReviewSource(companyId: string, input: CreateCreatorReview) {
    if (!await validateReference(companyId, input.personaId, input.sourceType === "social_draft" ? "social_draft" : input.sourceType, input.sourceId)) {
      throw notFound("Review source not found for this company and persona");
    }
  }

  async function createReview(companyId: string, input: CreateCreatorReview, actor: Actor, supersedesRequestId?: string) {
    await requirePersona(companyId, input.personaId);
    await validateReviewSource(companyId, input);
    const [review] = await db.insert(creatorReviewRequests).values({ companyId, ...input, requestedBy: actor.actorId, supersedesRequestId }).returning();
    return reviewDetail(review);
  }

  async function reviewDetail(review: typeof creatorReviewRequests.$inferSelect) {
    if (review.sourceType === "generation") {
      const source = await db.select({ id: personaGenerations.id }).from(personaGenerations)
        .innerJoin(imageProviders, eq(personaGenerations.personaId, imageProviders.id))
        .where(and(
          eq(personaGenerations.id, review.sourceId),
          eq(personaGenerations.personaId, review.personaId),
          eq(imageProviders.companyId, review.companyId),
        ))
        .then((rows) => rows[0] ?? null);
      return {
        ...review,
        preview: {
          kind: review.sourceType,
          mediaUrl: source ? `/api/companies/${review.companyId}/creator-os/media/generations/${review.sourceId}` : null,
          content: null,
        },
      };
    }
    if (review.sourceType === "asset") {
      const source = await db.select({ id: assets.id }).from(assets)
        .where(and(eq(assets.id, review.sourceId), eq(assets.companyId, review.companyId)))
        .then((rows) => rows[0] ?? null);
      return {
        ...review,
        preview: {
          kind: review.sourceType,
          mediaUrl: source ? `/api/assets/${review.sourceId}/content` : null,
          content: null,
        },
      };
    }
    const source = await db.select().from(socialPosts)
      .where(and(eq(socialPosts.id, review.sourceId), eq(socialPosts.companyId, review.companyId)))
      .then((rows) => rows[0] ?? null);
    const ownedSource = source && postMatchesPersona(source, review.personaId) ? source : null;
    const mediaUrls = Array.isArray(ownedSource?.mediaUrls)
      ? ownedSource.mediaUrls.filter((value): value is string => typeof value === "string")
      : [];
    return {
      ...review,
      preview: {
        kind: review.sourceType as "social_draft",
        mediaUrl: mediaUrls[0] ?? null,
        content: ownedSource?.content ?? null,
      },
    };
  }

  async function listReviews(companyId: string, personaId?: string, status?: string) {
    const conditions = [eq(creatorReviewRequests.companyId, companyId)];
    if (personaId) conditions.push(eq(creatorReviewRequests.personaId, personaId));
    if (status) conditions.push(eq(creatorReviewRequests.status, status));
    const reviews = await db.select().from(creatorReviewRequests).where(and(...conditions)).orderBy(desc(creatorReviewRequests.createdAt));
    return Promise.all(reviews.map(reviewDetail));
  }

  async function decideReview(companyId: string, reviewId: string, decision: "approved" | "rejected", feedback: string | null, actor: Actor) {
    const review = await db.select().from(creatorReviewRequests)
      .where(and(eq(creatorReviewRequests.id, reviewId), eq(creatorReviewRequests.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!review) throw notFound("Review request not found");
    if (review.status !== "pending") {
      if (review.status === decision && review.feedback === feedback) return reviewDetail(review);
      throw conflict("Review request already has a terminal decision");
    }
    const [updated] = await db.update(creatorReviewRequests).set({ status: decision, feedback, decidedBy: actor.actorId, decidedAt: new Date() })
      .where(and(eq(creatorReviewRequests.id, reviewId), eq(creatorReviewRequests.status, "pending"))).returning();
    if (!updated) throw conflict("Review request was decided concurrently");
    return reviewDetail(updated);
  }

  async function rereview(companyId: string, reviewId: string, actor: Actor) {
    const prior = await db.select().from(creatorReviewRequests)
      .where(and(eq(creatorReviewRequests.id, reviewId), eq(creatorReviewRequests.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!prior) throw notFound("Review request not found");
    if (prior.status === "pending") throw conflict("Pending review requests cannot be re-reviewed");
    return createReview(companyId, { personaId: prior.personaId, sourceType: prior.sourceType as CreateCreatorReview["sourceType"], sourceId: prior.sourceId }, actor, prior.id);
  }

  async function handoffApprovedReview(companyId: string, reviewId: string, content: string, actor: Actor) {
    const review = await db.select().from(creatorReviewRequests)
      .where(and(eq(creatorReviewRequests.id, reviewId), eq(creatorReviewRequests.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!review) throw notFound("Review request not found");
    if (review.status !== "approved") throw unprocessable("Content must be approved before Social handoff");
    const existing = await db.select().from(socialPosts)
      .where(and(eq(socialPosts.companyId, companyId), sql`${socialPosts.metadata}->>'creatorReviewRequestId' = ${review.id}`))
      .then((rows) => rows[0] ?? null);
    if (existing) return existing;
    const mediaUrls: string[] = [];
    if (review.sourceType === "generation") mediaUrls.push(`/api/companies/${companyId}/creator-os/media/generations/${review.sourceId}`);
    if (review.sourceType === "asset") mediaUrls.push(`/api/assets/${review.sourceId}/content`);
    const [post] = await db.insert(socialPosts).values({
      companyId,
      content,
      postType: mediaUrls.length ? "image" : "text",
      status: "draft",
      mediaUrls,
      metadata: { personaId: review.personaId, source: "creator-os", creatorReviewRequestId: review.id },
      createdBy: actor.actorId,
    }).returning();
    return post;
  }

  return {
    requirePersona,
    listFlows,
    getFlow,
    createFlow,
    updateFlow,
    startRun,
    listRuns,
    runDetail,
    reconcileActiveRuns,
    retryStep,
    listCampaigns,
    getCampaign,
    createCampaign,
    updateCampaign,
    addCampaignItem,
    listContentSources,
    createReview,
    listReviews,
    decideReview,
    rereview,
    handoffApprovedReview,
  };
}
