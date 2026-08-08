import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { creatorReviewRequests, imageProviders, personaGenerations, socialPosts } from "@paperclipai/db";
import {
  createCreatorCampaignItemSchema,
  createCreatorCampaignSchema,
  createCreatorFlowSchema,
  createCreatorReviewSchema,
  decideCreatorReviewSchema,
  handoffCreatorSocialDraftSchema,
  retryCreatorFlowStepSchema,
  runCreatorFlowSchema,
  scheduleCreatorSocialDraftSchema,
  updateCreatorCampaignSchema,
  updateCreatorFlowSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { creatorOsService, logActivity, socialService } from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { notFound, unprocessable } from "../errors.js";
import type { CreatorGenerationWorkerReadiness } from "@paperclipai/shared";

export interface CreatorOsRouteOptions {
  generationWorkerReadiness?: CreatorGenerationWorkerReadiness;
  kickGenerationQueue?: () => Promise<unknown>;
  onQueueKickError?: () => void;
}

export function creatorOsRoutes(db: Db, options: CreatorOsRouteOptions = {}) {
  const router = Router();
  const creator = creatorOsService(db, options);
  const social = socialService(db);

  async function audit(req: Parameters<typeof getActorInfo>[0], companyId: string, action: string, entityType: string, entityId: string, details?: Record<string, unknown>) {
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action,
      entityType,
      entityId,
      details,
    });
  }

  router.get("/companies/:companyId/creator-os/flows", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const personaId = typeof req.query.personaId === "string" ? req.query.personaId : undefined;
    res.json({ flows: await creator.listFlows(companyId, personaId) });
  });

  router.post("/companies/:companyId/creator-os/flows", validate(createCreatorFlowSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const flow = await creator.createFlow(companyId, req.body, actor);
    await audit(req, companyId, "creator.flow.created", "creator_flow", flow.id, { personaId: flow.personaId, stepCount: flow.steps.length });
    res.status(201).json({ flow });
  });

  router.patch("/companies/:companyId/creator-os/flows/:flowId", validate(updateCreatorFlowSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const flow = await creator.updateFlow(companyId, req.params.flowId as string, req.body);
    await audit(req, companyId, "creator.flow.updated", "creator_flow", flow.id, { stepCount: flow.steps.length });
    res.json({ flow });
  });

  router.post("/companies/:companyId/creator-os/flows/:flowId/archive", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const existing = await creator.getFlow(companyId, req.params.flowId as string);
    const flow = existing.status === "archived" ? existing : await creator.updateFlow(companyId, existing.id, { status: "archived" });
    if (existing.status !== "archived") await audit(req, companyId, "creator.flow.archived", "creator_flow", flow.id);
    res.json({ flow });
  });

  router.get("/companies/:companyId/creator-os/flows/:flowId/runs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({ runs: await creator.listRuns(companyId, req.params.flowId as string) });
  });

  router.post("/companies/:companyId/creator-os/flows/:flowId/runs", validate(runCreatorFlowSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const actor = getActorInfo(req);
    const run = await creator.startRun(companyId, req.params.flowId as string, req.body.idempotencyKey, actor);
    await audit(req, companyId, "creator.flow.run_started", "creator_flow_run", run.id, { flowId: run.flowId });
    res.status(202).json({ run });
  });

  router.get("/companies/:companyId/creator-os/runs/:runId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json({ run: await creator.runDetail(companyId, req.params.runId as string) });
  });

  router.post("/companies/:companyId/creator-os/runs/:runId/steps/:stepId/retry", validate(retryCreatorFlowStepSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const run = await creator.retryStep(companyId, req.params.runId as string, req.params.stepId as string, req.body.idempotencyKey);
    await audit(req, companyId, "creator.flow.step_retried", "creator_flow_run", run.id, { stepId: req.params.stepId });
    res.status(202).json({ run });
  });

  router.get("/companies/:companyId/creator-os/campaigns", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const personaId = typeof req.query.personaId === "string" ? req.query.personaId : undefined;
    res.json({ campaigns: await creator.listCampaigns(companyId, personaId) });
  });

  router.post("/companies/:companyId/creator-os/campaigns", validate(createCreatorCampaignSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const campaign = await creator.createCampaign(companyId, req.body, getActorInfo(req));
    await audit(req, companyId, "creator.campaign.created", "creator_campaign", campaign.id, { personaId: campaign.personaId });
    res.status(201).json({ campaign });
  });

  router.patch("/companies/:companyId/creator-os/campaigns/:campaignId", validate(updateCreatorCampaignSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const campaign = await creator.updateCampaign(companyId, req.params.campaignId as string, req.body);
    await audit(req, companyId, "creator.campaign.updated", "creator_campaign", campaign.id);
    res.json({ campaign });
  });

  router.post("/companies/:companyId/creator-os/campaigns/:campaignId/archive", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const existing = await creator.getCampaign(companyId, req.params.campaignId as string);
    const campaign = existing.status === "archived" ? existing : await creator.updateCampaign(companyId, existing.id, { status: "archived" });
    if (existing.status !== "archived") await audit(req, companyId, "creator.campaign.archived", "creator_campaign", campaign.id);
    res.json({ campaign });
  });

  router.post("/companies/:companyId/creator-os/campaigns/:campaignId/items", validate(createCreatorCampaignItemSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const item = await creator.addCampaignItem(companyId, req.params.campaignId as string, req.body, getActorInfo(req));
    await audit(req, companyId, "creator.campaign.item_linked", "creator_campaign", item.campaignId, { kind: item.kind, referenceId: item.referenceId });
    res.status(201).json({ item });
  });

  router.get("/companies/:companyId/creator-os/personas/:personaId/sources", async (req, res) => {
    const companyId = req.params.companyId as string;
    const personaId = req.params.personaId as string;
    assertCompanyAccess(req, companyId);
    res.json({ sources: await creator.listContentSources(companyId, personaId) });
  });

  router.get("/companies/:companyId/creator-os/reviews", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const personaId = typeof req.query.personaId === "string" ? req.query.personaId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ reviews: await creator.listReviews(companyId, personaId, status) });
  });

  router.post("/companies/:companyId/creator-os/reviews", validate(createCreatorReviewSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const review = await creator.createReview(companyId, req.body, getActorInfo(req));
    await audit(req, companyId, "creator.review.requested", "creator_review_request", review.id, { sourceType: review.sourceType, sourceId: review.sourceId });
    res.status(201).json({ review });
  });

  router.post("/companies/:companyId/creator-os/reviews/:reviewId/decision", validate(decideCreatorReviewSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    const review = await creator.decideReview(companyId, req.params.reviewId as string, req.body.decision, req.body.feedback ?? null, getActorInfo(req));
    await audit(req, companyId, `creator.review.${review.status}`, "creator_review_request", review.id, { feedback: review.feedback });
    res.json({ review });
  });

  router.post("/companies/:companyId/creator-os/reviews/:reviewId/rereview", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const review = await creator.rereview(companyId, req.params.reviewId as string, getActorInfo(req));
    await audit(req, companyId, "creator.review.rerequested", "creator_review_request", review.id, { supersedesRequestId: review.supersedesRequestId });
    res.status(201).json({ review });
  });

  router.get("/companies/:companyId/creator-os/personas/:personaId/social", async (req, res) => {
    const companyId = req.params.companyId as string;
    const personaId = req.params.personaId as string;
    assertCompanyAccess(req, companyId);
    await creator.requirePersona(companyId, personaId);
    const accounts = (await social.listAccountsWithPublishCapability(companyId)).map(({ accessToken: _a, refreshToken: _r, oauthAccessTokenEncrypted: _oa, oauthRefreshTokenEncrypted: _or, ...account }) => account);
    const drafts = await db.select().from(socialPosts)
      .where(and(eq(socialPosts.companyId, companyId), sql`${socialPosts.metadata}->>'personaId' = ${personaId}`))
      .orderBy(desc(socialPosts.createdAt));
    res.json({ accounts, drafts });
  });

  router.post("/companies/:companyId/creator-os/social/handoff", validate(handoffCreatorSocialDraftSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const post = await creator.handoffApprovedReview(companyId, req.body.reviewRequestId, req.body.content, getActorInfo(req));
    await audit(req, companyId, "creator.social.handed_off", "social_post", post.id, { reviewRequestId: req.body.reviewRequestId, targetCount: 0 });
    res.status(201).json({ post, targets: [] });
  });

  router.post("/companies/:companyId/creator-os/personas/:personaId/social/drafts/:postId/schedule", validate(scheduleCreatorSocialDraftSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    const personaId = req.params.personaId as string;
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    await creator.requirePersona(companyId, personaId);
    const existing = await db.select().from(socialPosts)
      .where(and(eq(socialPosts.id, req.params.postId as string), eq(socialPosts.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!existing) throw notFound("Social draft not found");
    const metadata = existing.metadata as Record<string, unknown> | null;
    if (!metadata || metadata.personaId !== personaId) throw unprocessable("Social draft does not belong to this persona");
    const reviewRequestId = typeof metadata.creatorReviewRequestId === "string" ? metadata.creatorReviewRequestId : null;
    if (!reviewRequestId) throw unprocessable("Creator OS scheduling requires an approved review handoff");
    const approvedReview = await db.select({ id: creatorReviewRequests.id }).from(creatorReviewRequests)
      .where(and(
        eq(creatorReviewRequests.id, reviewRequestId),
        eq(creatorReviewRequests.companyId, companyId),
        eq(creatorReviewRequests.personaId, personaId),
        eq(creatorReviewRequests.status, "approved"),
      ))
      .then((rows) => rows[0] ?? null);
    if (!approvedReview) throw unprocessable("Creator OS scheduling requires an approved review handoff");
    const post = await social.scheduleExistingDraft(
      companyId,
      existing.id,
      req.body.accountIds,
      new Date(req.body.scheduledAt),
      new Date(),
    );
    await audit(req, companyId, "creator.social.scheduled", "social_post", post.id, { targetCount: post.targets.length, scheduledAt: req.body.scheduledAt });
    res.json({ post });
  });

  router.get("/companies/:companyId/creator-os/media/generations/:generationId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const row = await db.select({ imagePath: personaGenerations.imagePath }).from(personaGenerations)
      .innerJoin(imageProviders, eq(personaGenerations.personaId, imageProviders.id))
      .where(and(eq(personaGenerations.id, req.params.generationId as string), eq(imageProviders.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Generation media not found");
    res.redirect(302, `/api/uploads/${row.imagePath.replace(/^\/+/, "")}`);
  });

  return router;
}
