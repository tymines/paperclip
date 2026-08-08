import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  companies,
  createDb,
  creatorFlowRuns,
  creatorFlowRunSteps,
  generationJobs,
  imageProviders,
  personaGenerations,
  socialAccounts,
  socialPostTargets,
} from "@paperclipai/db";
import { creatorOsService } from "../services/creator-os.js";
import type { ImageProvider } from "../services/image-providers/index.js";
import { socialService } from "../services/social.js";
import { imageStudioRoutes } from "../routes/image-studio.js";
import { creatorOsRoutes } from "../routes/creator-os.js";

function requireTaskDatabaseUrl() {
  const value = process.env.CREATOR_OS_TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("CREATOR_OS_TEST_DATABASE_URL is required");
  const parsed = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("creator_os_test_")) {
    throw new Error("Refusing non-loopback or non-task Creator OS database");
  }
  return value;
}

function fakeProvider(id: "replicate" | "atlascloud", modelId: string, configured = true): ImageProvider {
  return {
    id,
    name: id,
    color: "#000000",
    tokenKey: id,
    isConfigured: async () => configured,
    verify: async () => ({ ok: configured }),
    listModels: async () => [{ id: modelId, name: modelId, kind: "image", costPerUnit: 0, costUnit: "image", lora: id === "replicate", nsfw: false }],
    defaultModel: () => modelId,
    submitGeneration: async () => { throw new Error("fake provider must never submit"); },
    pollPrediction: async () => { throw new Error("fake provider must never poll"); },
    downloadOutput: async () => { throw new Error("fake provider must never download"); },
  };
}

async function expectStatus(action: Promise<unknown>, status: number, message?: string) {
  await assert.rejects(action, (error: unknown) => {
    return typeof error === "object" && error !== null && "status" in error && error.status === status &&
      (message === undefined || (error instanceof Error && error.message === message));
  });
}

async function main() {
  const db = createDb(requireTaskDatabaseUrl());
  const providers = [fakeProvider("replicate", "persona-lora"), fakeProvider("atlascloud", "atlas-image")];
  const actor = { actorId: "creator-os-postgres-smoke" };
  const companyId = randomUUID();
  const foreignCompanyId = randomUUID();
  const personaId = randomUUID();
  const foreignPersonaId = randomUUID();
  const globalPersonaId = randomUUID();
  await db.insert(companies).values([
    { id: companyId, name: "Creator OS smoke", issuePrefix: `C${companyId.slice(0, 5)}` },
    { id: foreignCompanyId, name: "Foreign smoke", issuePrefix: `F${foreignCompanyId.slice(0, 5)}` },
  ]);
  await db.insert(imageProviders).values([
    { id: personaId, companyId, name: "Owned", type: "local_lora", status: "ready", endpoint: "owned/model:version" },
    { id: foreignPersonaId, companyId: foreignCompanyId, name: "Foreign", type: "local_lora", status: "ready", endpoint: "foreign/model:version" },
    { id: globalPersonaId, companyId: null, name: `Global template ${globalPersonaId}`, type: "local_lora", status: "ready" },
  ]);

  let routeActor: Express.Request["actor"] = { type: "board", userId: "board-smoke", source: "session", companyIds: [companyId], isInstanceAdmin: false };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.actor = routeActor; next(); });
  app.use(imageStudioRoutes(db));
  app.use(creatorOsRoutes(db, { generationWorkerReadiness: { enabled: true, disabledReason: null }, kickGenerationQueue: async () => undefined }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected test route error";
    res.status(status).json({ error: message });
  });
  for (const actor of [
    { type: "board", userId: "board-smoke", source: "session", companyIds: [companyId], isInstanceAdmin: false } as const,
    { type: "agent", agentId: "agent-smoke", companyId, source: "agent_key" } as const,
  ]) {
    routeActor = actor;
    const foreign = await request(app).get(`/image-studio/personas/${foreignPersonaId}`);
    const missing = await request(app).get(`/image-studio/personas/${randomUUID()}`);
    assert.equal(foreign.status, 404);
    assert.equal(missing.status, 404);
    assert.deepEqual(foreign.body, missing.body);
    assert.deepEqual(foreign.body, { error: "Persona not found" });
  }
  routeActor = { type: "board", userId: "board-smoke", source: "session", companyIds: [companyId], isInstanceAdmin: false };
  const globalTemplate = await request(app).get(`/image-studio/personas/${globalPersonaId}`);
  assert.equal(globalTemplate.status, 200);

  let queueKicks = 0;
  const kickGenerationQueue = async () => { queueKicks += 1; };
  const creator = creatorOsService(db, { providers, generationWorkerReadiness: { enabled: true, disabledReason: null }, kickGenerationQueue });
  const flow = await creator.createFlow(companyId, {
    personaId,
    name: "Durable two-step flow",
    status: "active",
    steps: [
      { name: "Hero", config: { prompt: "hero", providerHost: "replicate" } },
      { name: "Detail", config: { prompt: "detail", providerHost: "atlascloud", model: "atlas-image" } },
    ],
  }, actor);
  const preservedFlow = await creator.updateFlow(companyId, flow.id, { name: "Durable two-step flow revised" });
  assert.deepEqual(preservedFlow.steps.map((step) => ({ name: step.name, config: step.config })), [
    { name: "Hero", config: { prompt: "hero", providerHost: "replicate" } },
    { name: "Detail", config: { prompt: "detail", providerHost: "atlascloud", model: "atlas-image" } },
  ]);
  assert.equal((await db.select().from(generationJobs)).length, 0, "saving a flow must not enqueue work");
  const disabledRunCount = (await db.select().from(creatorFlowRuns)).length;
  const disabledStepCount = (await db.select().from(creatorFlowRunSteps)).length;
  await expectStatus(creatorOsService(db, { providers }).startRun(companyId, flow.id, "disabled-worker-run", actor), 422, "Flow generation is unavailable because the dedicated Image Studio generation worker is disabled.");
  assert.equal((await db.select().from(generationJobs)).length, 0, "disabled worker must not enqueue a job");
  assert.equal((await db.select().from(creatorFlowRuns)).length, disabledRunCount, "disabled worker must not create a run");
  assert.equal((await db.select().from(creatorFlowRunSteps)).length, disabledStepCount, "disabled worker must not create an attempt");
  await expectStatus(creator.getFlow(foreignCompanyId, flow.id), 404);
  const blockedCreator = creatorOsService(db, {
    providers: [fakeProvider("replicate", "persona-lora", false), fakeProvider("atlascloud", "atlas-image")],
    generationWorkerReadiness: { enabled: true, disabledReason: null },
  });
  await expectStatus(blockedCreator.startRun(companyId, flow.id, "blocked-provider-run", actor), 422);
  assert.equal((await db.select().from(generationJobs)).length, 0, "unavailable providers must not enqueue work");

  const run = await creator.startRun(companyId, flow.id, "durable-run-key", actor);
  const repeatedRun = await creator.startRun(companyId, flow.id, "durable-run-key", actor);
  await Promise.resolve();
  assert.equal(repeatedRun.id, run.id);
  assert.equal((await db.select().from(generationJobs)).length, 1);
  assert.equal(queueKicks, 1, "a newly committed run kicks once; its idempotency replay does not re-kick");
  await db.update(generationJobs).set({ status: "succeeded" }).where(eq(generationJobs.id, run.steps[0]!.generationJobId!));
  const restartedCreator = creatorOsService(db, { providers, generationWorkerReadiness: { enabled: true, disabledReason: null }, kickGenerationQueue });
  await restartedCreator.reconcileActiveRuns();
  const advanced = await restartedCreator.runDetail(companyId, run.id, false);
  assert.deepEqual(advanced.steps.map((step) => step.status), ["succeeded", "running"]);
  assert.equal((await db.select().from(creatorFlowRuns).where(eq(creatorFlowRuns.id, run.id))).length, 1, "restart recovery must not duplicate the run");
  assert.equal((await db.select().from(generationJobs)).length, 2, "restart recovery creates only the next ordered job");
  await db.update(generationJobs).set({ status: "failed", errorMessage: "fake failure" }).where(eq(generationJobs.id, advanced.steps[1]!.generationJobId!));
  const failed = await restartedCreator.runDetail(companyId, run.id);
  assert.equal(failed.status, "failed");
  const disabledRetryJobs = (await db.select().from(generationJobs)).length;
  const disabledRetrySteps = (await db.select().from(creatorFlowRunSteps)).length;
  await expectStatus(creatorOsService(db, { providers }).retryStep(companyId, run.id, failed.steps[1]!.id, "disabled-worker-retry"), 422, "Flow generation is unavailable because the dedicated Image Studio generation worker is disabled.");
  assert.equal((await db.select().from(generationJobs)).length, disabledRetryJobs, "disabled retry must not create a job");
  assert.equal((await db.select().from(creatorFlowRunSteps)).length, disabledRetrySteps, "disabled retry must not create an attempt");
  const retried = await restartedCreator.retryStep(companyId, run.id, failed.steps[1]!.id, "durable-retry-key");
  const repeatedRetry = await restartedCreator.retryStep(companyId, run.id, failed.steps[1]!.id, "durable-retry-key");
  await Promise.resolve();
  assert.equal(repeatedRetry.steps.length, retried.steps.length);
  assert.equal((await db.select().from(generationJobs)).length, 3);
  assert.equal(queueKicks, 2, "a newly committed retry kicks once; its idempotency replay does not re-kick");

  const campaign = await creator.createCampaign(companyId, {
    personaId,
    name: "Launch",
    channels: ["instagram"],
    status: "draft",
  }, actor);
  assert.equal("deadline" in campaign, false);
  const editedCampaign = await creator.updateCampaign(companyId, campaign.id, { channels: ["instagram", "tiktok"], name: "Launch edit" });
  assert.deepEqual(editedCampaign.channels, ["instagram", "tiktok"]);

  const generationId = randomUUID();
  const foreignGenerationId = randomUUID();
  await db.insert(personaGenerations).values([
    { id: generationId, personaId, imagePath: "smoke/owned.png" },
    { id: foreignGenerationId, personaId: foreignPersonaId, imagePath: "smoke/foreign.png" },
  ]);
  const visibleSources = await creator.listContentSources(companyId, personaId);
  assert.ok(visibleSources.some((source) => source.id === generationId && source.kind === "generation"));
  assert.equal(visibleSources.some((source) => source.id === foreignGenerationId), false);
  const sourcesResponse = await request(app).get(`/companies/${companyId}/creator-os/personas/${personaId}/sources`);
  assert.equal(sourcesResponse.status, 200);
  assert.ok(sourcesResponse.body.sources.some((source: { id: string; label: string }) => source.id === generationId && source.label.length > 0));
  await expectStatus(creator.addCampaignItem(companyId, campaign.id, { kind: "generation", referenceId: foreignGenerationId }, actor), 404);
  await creator.addCampaignItem(companyId, campaign.id, { kind: "generation", referenceId: generationId }, actor);
  await expectStatus(creator.createReview(companyId, { personaId, sourceType: "generation", sourceId: foreignGenerationId }, actor), 404);
  const review = await creator.createReview(companyId, { personaId, sourceType: "generation", sourceId: generationId }, actor);
  assert.ok(review.preview.mediaUrl?.includes(generationId));
  const rejected = await creator.decideReview(companyId, review.id, "rejected", "Fix crop", actor);
  const repeatedDecision = await creator.decideReview(companyId, review.id, "rejected", "Fix crop", actor);
  assert.equal(repeatedDecision.id, rejected.id);
  const rereview = await creator.rereview(companyId, review.id, actor);
  assert.equal(rereview.supersedesRequestId, review.id);
  const approved = await creator.decideReview(companyId, rereview.id, "approved", null, actor);
  const draft = await creator.handoffApprovedReview(companyId, approved.id, "Approved caption", actor);
  assert.equal(draft.status, "draft");
  assert.equal((await db.select().from(socialPostTargets).where(eq(socialPostTargets.postId, draft.id))).length, 0);

  const ownedAccountId = randomUUID();
  const foreignAccountId = randomUUID();
  const tokenlessAccountId = randomUUID();
  await db.insert(socialAccounts).values([
    { id: ownedAccountId, companyId, platform: "instagram", platformAccountId: "owned", displayName: "Owned", status: "connected", accessToken: "real-smoke-token" },
    { id: foreignAccountId, companyId: foreignCompanyId, platform: "instagram", platformAccountId: "foreign", displayName: "Foreign", status: "connected", accessToken: "foreign-smoke-token" },
    { id: tokenlessAccountId, companyId, platform: "instagram", platformAccountId: "tokenless", displayName: "Tokenless", status: "connected" },
  ]);
  const social = socialService(db);
  await expectStatus(social.scheduleExistingDraft(companyId, draft.id, [foreignAccountId], new Date(Date.now() + 60_000), new Date()), 422);
  await expectStatus(social.scheduleExistingDraft(companyId, draft.id, [tokenlessAccountId], new Date(Date.now() + 60_000), new Date()), 422);
  const socialResponse = await request(app).get(`/companies/${companyId}/creator-os/personas/${personaId}/social`);
  assert.equal(socialResponse.status, 200);
  assert.equal(socialResponse.body.accounts.find((account: { id: string }) => account.id === ownedAccountId).publishCapability.available, true);
  assert.match(socialResponse.body.accounts.find((account: { id: string }) => account.id === tokenlessAccountId).publishCapability.reason, /Reconnect Tokenless/);
  const rejectedSchedule = await request(app)
    .post(`/companies/${companyId}/creator-os/personas/${personaId}/social/drafts/${draft.id}/schedule`)
    .send({ confirmPublish: true, accountIds: [tokenlessAccountId], scheduledAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(rejectedSchedule.status, 422);
  const scheduled = await social.scheduleExistingDraft(companyId, draft.id, [ownedAccountId], new Date(Date.now() + 60_000), new Date());
  assert.equal(scheduled.status, "scheduled");
  assert.equal(typeof (scheduled.metadata as Record<string, unknown>).creatorPublishConfirmedAt, "string");

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    flowId: flow.id,
    runId: run.id,
    campaignId: campaign.id,
    reviewHistory: 2,
    generationJobs: 3,
    socialTargets: scheduled.targets.length,
  })}\n`);
}

await main();
process.exit(0);
