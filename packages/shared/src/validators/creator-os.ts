import { z } from "zod";
import {
  CREATOR_CAMPAIGN_ITEM_KINDS,
  CREATOR_CAMPAIGN_STATUSES,
  CREATOR_FLOW_STATUSES,
  CREATOR_REVIEW_SOURCE_TYPES,
} from "../types/creator-os.js";
import { SOCIAL_PLATFORMS } from "../constants.js";

export const creatorFlowStepConfigSchema = z.object({
  prompt: z.string().trim().min(1).max(10_000),
  providerHost: z.enum(["replicate", "atlascloud", "wavespeedai"]).optional(),
  model: z.string().trim().min(1).max(500).optional(),
  aspectRatio: z.string().trim().min(1).max(50).optional(),
  loraScale: z.number().min(0).max(2).optional(),
  steps: z.number().int().min(1).max(100).optional(),
  guidance: z.number().min(0).max(30).optional(),
  contentRating: z.enum(["sfw", "explicit"]).optional(),
}).strict();

export const creatorFlowStepInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  config: creatorFlowStepConfigSchema,
}).strict();

export const createCreatorFlowSchema = z.object({
  personaId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional().nullable(),
  status: z.enum(CREATOR_FLOW_STATUSES).optional().default("draft"),
  steps: z.array(creatorFlowStepInputSchema).min(1).max(20),
}).strict();

export const updateCreatorFlowSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2_000).optional().nullable(),
  status: z.enum(CREATOR_FLOW_STATUSES).optional(),
  steps: z.array(creatorFlowStepInputSchema).min(1).max(20).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "At least one field is required");

export const runCreatorFlowSchema = z.object({
  confirm: z.literal(true),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const retryCreatorFlowStepSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

export const createCreatorCampaignSchema = z.object({
  personaId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional().nullable(),
  channels: z.array(z.enum(SOCIAL_PLATFORMS)).max(20).optional().default([]),
  status: z.enum(CREATOR_CAMPAIGN_STATUSES).optional().default("draft"),
}).strict();

export const updateCreatorCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2_000).optional().nullable(),
  channels: z.array(z.enum(SOCIAL_PLATFORMS)).max(20).optional(),
  status: z.enum(CREATOR_CAMPAIGN_STATUSES).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, "At least one field is required");

export const createCreatorCampaignItemSchema = z.object({
  kind: z.enum(CREATOR_CAMPAIGN_ITEM_KINDS),
  referenceId: z.string().uuid(),
}).strict();

export const createCreatorReviewSchema = z.object({
  personaId: z.string().uuid(),
  sourceType: z.enum(CREATOR_REVIEW_SOURCE_TYPES),
  sourceId: z.string().uuid(),
}).strict();

export const decideCreatorReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  feedback: z.string().trim().max(5_000).optional().nullable(),
}).strict().superRefine((body, ctx) => {
  if (body.decision === "rejected" && !body.feedback) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["feedback"], message: "Feedback is required when rejecting content" });
  }
});

export const handoffCreatorSocialDraftSchema = z.object({
  reviewRequestId: z.string().uuid(),
  content: z.string().trim().min(1).max(10_000),
}).strict();

export const scheduleCreatorSocialDraftSchema = z.object({
  confirmPublish: z.literal(true),
  accountIds: z.array(z.string().uuid()).min(1, "Select at least one account").max(20),
  scheduledAt: z.string().datetime().refine((value) => Date.parse(value) > Date.now(), "Schedule time must be in the future"),
}).strict();

export type CreateCreatorFlow = z.infer<typeof createCreatorFlowSchema>;
export type UpdateCreatorFlow = z.infer<typeof updateCreatorFlowSchema>;
export type RunCreatorFlow = z.infer<typeof runCreatorFlowSchema>;
export type RetryCreatorFlowStep = z.infer<typeof retryCreatorFlowStepSchema>;
export type CreateCreatorCampaign = z.infer<typeof createCreatorCampaignSchema>;
export type UpdateCreatorCampaign = z.infer<typeof updateCreatorCampaignSchema>;
export type CreateCreatorCampaignItem = z.infer<typeof createCreatorCampaignItemSchema>;
export type CreateCreatorReview = z.infer<typeof createCreatorReviewSchema>;
export type DecideCreatorReview = z.infer<typeof decideCreatorReviewSchema>;
export type HandoffCreatorSocialDraft = z.infer<typeof handoffCreatorSocialDraftSchema>;
export type ScheduleCreatorSocialDraft = z.infer<typeof scheduleCreatorSocialDraftSchema>;
