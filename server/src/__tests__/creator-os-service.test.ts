import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  companies,
  createDb,
  creatorCampaignItems,
  creatorFlowRuns,
  creatorFlowRunSteps,
  creatorReviewRequests,
  generationJobs,
  imageProviders,
  personaGenerations,
  socialAccounts,
  socialPosts,
  socialPostTargets,
} from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { creatorOsService } from "../services/creator-os.js";
import { socialService } from "../services/social.js";
import type { ImageProvider } from "../services/image-providers/index.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const embeddedSupport = await getEmbeddedPostgresTestSupport();
const externalTestDatabaseUrl = process.env.CREATOR_OS_TEST_DATABASE_URL?.trim();
const describePg = externalTestDatabaseUrl || embeddedSupport.supported ? describe : describe.skip;

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
    submitGeneration: async () => { throw new Error("fake provider must not be called"); },
    pollPrediction: async () => { throw new Error("fake provider must not be called"); },
    downloadOutput: async () => { throw new Error("fake provider must not be called"); },
  };
}

const fakeProviders = [
  fakeProvider("replicate", "persona-lora"),
  fakeProvider("atlascloud", "atlas-image"),
];

describePg("Creator OS operational lanes", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;
  let companyId: string;
  let foreignCompanyId: string;
  let personaId: string;
  let foreignPersonaId: string;
  let globalPersonaId: string;
  const actor = { actorId: "board-test" };

  beforeAll(async () => {
    if (externalTestDatabaseUrl) {
      const parsed = new URL(externalTestDatabaseUrl);
      if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.pathname.slice(1).startsWith("creator_os_test_")) {
        throw new Error("CREATOR_OS_TEST_DATABASE_URL must target a loopback creator_os_test_* database");
      }
      db = createDb(externalTestDatabaseUrl);
    } else {
      tempDb = await startEmbeddedPostgresTestDatabase("paperclip-creator-os-");
      db = createDb(tempDb.connectionString);
    }
    companyId = randomUUID();
    foreignCompanyId = randomUUID();
    personaId = randomUUID();
    foreignPersonaId = randomUUID();
    globalPersonaId = randomUUID();
    await db.insert(companies).values([
      { id: companyId, name: "Creator Co", issuePrefix: `C${companyId.slice(0, 5)}` },
      { id: foreignCompanyId, name: "Foreign Co", issuePrefix: `F${foreignCompanyId.slice(0, 5)}` },
    ]);
    await db.insert(imageProviders).values([
      { id: personaId, companyId, name: "Owned", type: "local_lora", status: "ready", endpoint: "owned/model:version" },
      { id: foreignPersonaId, companyId: foreignCompanyId, name: "Foreign", type: "local_lora", status: "ready" },
      { id: globalPersonaId, companyId: null, name: "Template", type: "local_lora", status: "ready" },
    ]);
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("persists ordered flows without enqueueing on save, then advances explicit runs and retries idempotently", async () => {
    const queueKick = vi.fn(async () => undefined);
    const workerReady = { enabled: true, disabledReason: null };
    const service = creatorOsService(db, { providers: fakeProviders, generationWorkerReadiness: workerReady, kickGenerationQueue: queueKick });
    await expect(service.createFlow(companyId, {
      personaId: foreignPersonaId,
      name: "Cross tenant",
      status: "active",
      steps: [{ name: "No", config: { prompt: "no" } }],
    }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(service.createFlow(companyId, {
      personaId: globalPersonaId,
      name: "Global template",
      status: "active",
      steps: [{ name: "No", config: { prompt: "no" } }],
    }, actor)).rejects.toMatchObject({ status: 404 });

    const flow = await service.createFlow(companyId, {
      personaId,
      name: "Two-step launch",
      status: "active",
      steps: [
        { name: "Hero image", config: { prompt: "hero image", providerHost: "replicate" } },
        { name: "Detail image", config: { prompt: "detail image", providerHost: "atlascloud", model: "atlas-image" } },
      ],
    }, actor);
    expect(flow.steps.map((step) => step.position)).toEqual([0, 1]);
    const renamed = await service.updateFlow(companyId, flow.id, { name: "Two-step launch revised" });
    expect(renamed.steps.map((step) => ({ name: step.name, position: step.position, config: step.config }))).toEqual([
      { name: "Hero image", position: 0, config: { prompt: "hero image", providerHost: "replicate" } },
      { name: "Detail image", position: 1, config: { prompt: "detail image", providerHost: "atlascloud", model: "atlas-image" } },
    ]);
    expect(await db.select().from(generationJobs)).toHaveLength(0);
    const runCountBeforeDisabled = (await db.select().from(creatorFlowRuns)).length;
    const stepCountBeforeDisabled = (await db.select().from(creatorFlowRunSteps)).length;
    await expect(creatorOsService(db, { providers: fakeProviders }).startRun(companyId, flow.id, "disabled-worker-run", actor)).rejects.toMatchObject({
      status: 422,
      message: "Flow generation is unavailable because the dedicated Image Studio generation worker is disabled.",
    });
    expect(await db.select().from(generationJobs)).toHaveLength(0);
    expect(await db.select().from(creatorFlowRuns)).toHaveLength(runCountBeforeDisabled);
    expect(await db.select().from(creatorFlowRunSteps)).toHaveLength(stepCountBeforeDisabled);
    await expect(creatorOsService(db, {
      providers: [fakeProvider("replicate", "persona-lora", false), fakeProvider("atlascloud", "atlas-image")],
      generationWorkerReadiness: workerReady,
    }).startRun(companyId, flow.id, "blocked-provider-run", actor)).rejects.toMatchObject({ status: 422 });
    expect(await db.select().from(generationJobs)).toHaveLength(0);

    const run = await service.startRun(companyId, flow.id, "run-idempotency-1", actor);
    await Promise.resolve();
    expect(queueKick).toHaveBeenCalledTimes(1);
    expect(run.status).toBe("running");
    expect(run.steps.map((step) => step.status)).toEqual(["running", "pending"]);
    const repeated = await service.startRun(companyId, flow.id, "run-idempotency-1", actor);
    await Promise.resolve();
    expect(repeated.id).toBe(run.id);
    expect(await db.select().from(generationJobs)).toHaveLength(1);
    expect(queueKick).toHaveBeenCalledTimes(1);

    await db.update(generationJobs).set({ status: "succeeded" }).where(eq(generationJobs.id, run.steps[0].generationJobId!));
    const restartedService = creatorOsService(db, { providers: fakeProviders, generationWorkerReadiness: workerReady, kickGenerationQueue: queueKick });
    await restartedService.reconcileActiveRuns();
    const advanced = await restartedService.runDetail(companyId, run.id, false);
    expect(advanced.steps.map((step) => step.status)).toEqual(["succeeded", "running"]);
    expect(await db.select().from(generationJobs)).toHaveLength(2);
    expect(await db.select().from(creatorFlowRuns).where(eq(creatorFlowRuns.id, run.id))).toHaveLength(1);

    await db.update(generationJobs).set({ status: "failed", errorMessage: "mock provider failure" }).where(eq(generationJobs.id, advanced.steps[1].generationJobId!));
    const failed = await service.runDetail(companyId, run.id);
    expect(failed.status).toBe("failed");
    expect(failed.steps[1]).toMatchObject({ status: "failed", retryEligible: true, errorMessage: "mock provider failure" });

    const jobsBeforeDisabledRetry = (await db.select().from(generationJobs)).length;
    const attemptsBeforeDisabledRetry = (await db.select().from(creatorFlowRunSteps)).length;
    await expect(creatorOsService(db, { providers: fakeProviders }).retryStep(companyId, run.id, failed.steps[1].id, "disabled-worker-retry")).rejects.toMatchObject({
      status: 422,
      message: "Flow generation is unavailable because the dedicated Image Studio generation worker is disabled.",
    });
    expect(await db.select().from(generationJobs)).toHaveLength(jobsBeforeDisabledRetry);
    expect(await db.select().from(creatorFlowRunSteps)).toHaveLength(attemptsBeforeDisabledRetry);

    const retried = await service.retryStep(companyId, run.id, failed.steps[1].id, "retry-idempotency-1");
    await Promise.resolve();
    const retriedAgain = await service.retryStep(companyId, run.id, failed.steps[1].id, "retry-idempotency-1");
    await Promise.resolve();
    expect(retriedAgain.steps).toHaveLength(retried.steps.length);
    expect(await db.select().from(generationJobs)).toHaveLength(3);
    expect(queueKick).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("enforces campaign linkage, immutable review decisions, approved handoff, and atomic company-owned scheduling", async () => {
    const creator = creatorOsService(db, { providers: fakeProviders });
    const social = socialService(db);
    const generationId = randomUUID();
    const foreignGenerationId = randomUUID();
    await db.insert(personaGenerations).values({ id: generationId, personaId, imagePath: "personas/owned/hero.png" });
    await db.insert(personaGenerations).values({ id: foreignGenerationId, personaId: foreignPersonaId, imagePath: "personas/foreign/hero.png" });
    const visibleSources = await creator.listContentSources(companyId, personaId);
    expect(visibleSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: generationId, kind: "generation", reviewEligible: true }),
    ]));
    expect(visibleSources).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: foreignGenerationId })]));

    const campaign = await creator.createCampaign(companyId, { personaId, name: "Launch", channels: ["instagram"], status: "draft" }, actor);
    expect(campaign.channels).toEqual(["instagram"]);
    const editedCampaign = await creator.updateCampaign(companyId, campaign.id, { name: "Launch edit", channels: ["instagram", "tiktok"] });
    expect(editedCampaign).toMatchObject({ name: "Launch edit", channels: ["instagram", "tiktok"] });
    expect(campaign).not.toHaveProperty("deadline");
    await expect(creator.createCampaign(companyId, { personaId: globalPersonaId, name: "Template campaign", channels: [], status: "draft" }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(creator.addCampaignItem(companyId, campaign.id, { kind: "generation", referenceId: foreignGenerationId }, actor)).rejects.toMatchObject({ status: 404 });
    await expect(creator.addCampaignItem(companyId, campaign.id, { kind: "generation", referenceId: randomUUID() }, actor)).rejects.toMatchObject({ status: 404 });
    const item = await creator.addCampaignItem(companyId, campaign.id, { kind: "generation", referenceId: generationId }, actor);
    expect(await db.select().from(creatorCampaignItems).where(eq(creatorCampaignItems.id, item.id))).toHaveLength(1);

    await expect(creator.createReview(companyId, { personaId, sourceType: "generation", sourceId: foreignGenerationId }, actor)).rejects.toMatchObject({ status: 404 });
    const review = await creator.createReview(companyId, { personaId, sourceType: "generation", sourceId: generationId }, actor);
    expect(review.preview.mediaUrl).toContain(generationId);
    await expect(creator.handoffApprovedReview(companyId, review.id, "Not approved", actor)).rejects.toMatchObject({ status: 422 });
    const rejected = await creator.decideReview(companyId, review.id, "rejected", "Fix the crop", actor);
    const repeated = await creator.decideReview(companyId, review.id, "rejected", "Fix the crop", actor);
    expect(repeated).toMatchObject({ id: rejected.id, decidedBy: "board-test", feedback: "Fix the crop" });
    await expect(creator.decideReview(companyId, review.id, "approved", null, actor)).rejects.toMatchObject({ status: 409 });
    const rereview = await creator.rereview(companyId, review.id, actor);
    expect(rereview).toMatchObject({ status: "pending", supersedesRequestId: review.id });
    const approved = await creator.decideReview(companyId, rereview.id, "approved", null, actor);
    expect(await db.select().from(creatorReviewRequests).where(eq(creatorReviewRequests.sourceId, generationId))).toHaveLength(2);

    const draft = await creator.handoffApprovedReview(companyId, approved.id, "Approved launch caption", actor);
    expect(draft).toMatchObject({ status: "draft", companyId });
    expect(await db.select().from(socialPostTargets).where(eq(socialPostTargets.postId, draft.id))).toHaveLength(0);

    const ownedAccountId = randomUUID();
    const foreignAccountId = randomUUID();
    const tokenlessAccountId = randomUUID();
    const stubAccountId = randomUUID();
    await db.insert(socialAccounts).values([
      { id: ownedAccountId, companyId, platform: "instagram", platformAccountId: "owned", displayName: "Owned account", status: "connected", accessToken: "real-test-token" },
      { id: foreignAccountId, companyId: foreignCompanyId, platform: "instagram", platformAccountId: "foreign", displayName: "Foreign account", status: "connected", accessToken: "foreign-test-token" },
      { id: tokenlessAccountId, companyId, platform: "instagram", platformAccountId: "tokenless", displayName: "Tokenless account", status: "connected" },
      { id: stubAccountId, companyId, platform: "instagram", platformAccountId: "stub", displayName: "Stub account", status: "connected", accessToken: "stub_access_token", metadata: { stub: true } },
    ]);
    await expect(social.scheduleExistingDraft(companyId, draft.id, [foreignAccountId], new Date(Date.now() + 60_000), new Date())).rejects.toMatchObject({ status: 422 });
    await expect(social.scheduleExistingDraft(companyId, draft.id, [tokenlessAccountId], new Date(Date.now() + 60_000), new Date())).rejects.toMatchObject({ status: 422, message: expect.stringContaining("no real platform access token") });
    await expect(social.scheduleExistingDraft(companyId, draft.id, [stubAccountId], new Date(Date.now() + 60_000), new Date())).rejects.toMatchObject({ status: 422, message: expect.stringContaining("no real platform access token") });
    const accountCapabilities = await social.listAccountsWithPublishCapability(companyId);
    expect(accountCapabilities.find((account) => account.id === ownedAccountId)?.publishCapability).toEqual({ available: true, reason: null });
    expect(accountCapabilities.find((account) => account.id === tokenlessAccountId)?.publishCapability.reason).toContain("Reconnect Tokenless account");
    expect((await db.select().from(socialPosts).where(eq(socialPosts.id, draft.id)))[0].status).toBe("draft");
    const scheduled = await social.scheduleExistingDraft(companyId, draft.id, [ownedAccountId], new Date(Date.now() + 60_000), new Date());
    expect(scheduled).toMatchObject({ status: "scheduled" });
    expect(scheduled.metadata).toMatchObject({ creatorPublishConfirmedAt: expect.any(String) });
    expect(scheduled.targets).toHaveLength(1);
  }, 20_000);
});
