export const CREATOR_FLOW_STATUSES = ["draft", "active", "archived"] as const;
export const CREATOR_FLOW_RUN_STATUSES = ["pending", "running", "succeeded", "failed", "cancelled"] as const;
export const CREATOR_FLOW_STEP_STATUSES = ["pending", "running", "succeeded", "failed", "skipped", "cancelled"] as const;
export const CREATOR_CAMPAIGN_STATUSES = ["draft", "active", "archived"] as const;
export const CREATOR_CAMPAIGN_ITEM_KINDS = ["flow", "flow_run", "generation", "asset", "review_request", "social_draft"] as const;
export const CREATOR_REVIEW_SOURCE_TYPES = ["generation", "asset", "social_draft"] as const;
export const CREATOR_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;

export type CreatorFlowStatus = (typeof CREATOR_FLOW_STATUSES)[number];
export type CreatorFlowRunStatus = (typeof CREATOR_FLOW_RUN_STATUSES)[number];
export type CreatorFlowStepStatus = (typeof CREATOR_FLOW_STEP_STATUSES)[number];
export type CreatorCampaignStatus = (typeof CREATOR_CAMPAIGN_STATUSES)[number];
export type CreatorCampaignItemKind = (typeof CREATOR_CAMPAIGN_ITEM_KINDS)[number];
export type CreatorReviewSourceType = (typeof CREATOR_REVIEW_SOURCE_TYPES)[number];
export type CreatorReviewStatus = (typeof CREATOR_REVIEW_STATUSES)[number];

export interface CreatorFlowStepConfig {
  prompt: string;
  providerHost?: "replicate" | "atlascloud" | "wavespeedai";
  model?: string;
  aspectRatio?: string;
  loraScale?: number;
  steps?: number;
  guidance?: number;
  contentRating?: "sfw" | "explicit";
}

export interface CreatorFlowStepRecord {
  id: string;
  flowId: string;
  position: number;
  name: string;
  config: CreatorFlowStepConfig;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface CreatorFlowRecord {
  id: string;
  companyId: string;
  personaId: string;
  name: string;
  description: string | null;
  status: CreatorFlowStatus;
  createdBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  steps: CreatorFlowStepRecord[];
}

export interface CreatorFlowRunStepRecord {
  id: string;
  runId: string;
  flowStepId: string | null;
  stepName: string;
  configSnapshot: CreatorFlowStepConfig;
  position: number;
  attempt: number;
  status: CreatorFlowStepStatus;
  generationJobId: string | null;
  errorMessage: string | null;
  retryEligible: boolean;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
}

export interface CreatorFlowRunRecord {
  id: string;
  companyId: string;
  personaId: string;
  flowId: string;
  status: CreatorFlowRunStatus;
  errorMessage: string | null;
  idempotencyKey: string;
  createdBy: string | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  steps: CreatorFlowRunStepRecord[];
}

export interface CreatorCampaignRecord {
  id: string;
  companyId: string;
  personaId: string;
  name: string;
  description: string | null;
  channels: SocialPlatform[];
  status: CreatorCampaignStatus;
  createdBy: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  items: CreatorCampaignItemRecord[];
}

export interface CreatorCampaignItemRecord {
  id: string;
  companyId: string;
  campaignId: string;
  kind: CreatorCampaignItemKind;
  referenceId: string;
  createdBy: string | null;
  createdAt: string | Date;
}

export interface CreatorContentSourceOption {
  id: string;
  kind: CreatorCampaignItemKind;
  label: string;
  detail: string | null;
  reviewEligible: boolean;
  preview: {
    mediaUrl: string | null;
    content: string | null;
  };
}

export interface CreatorReviewRequestRecord {
  id: string;
  companyId: string;
  personaId: string;
  sourceType: CreatorReviewSourceType;
  sourceId: string;
  status: CreatorReviewStatus;
  feedback: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | Date | null;
  supersedesRequestId: string | null;
  createdAt: string | Date;
  preview: CreatorReviewPreview;
}

export interface CreatorReviewPreview {
  kind: CreatorReviewSourceType;
  mediaUrl: string | null;
  content: string | null;
}

export interface CreatorSocialPublishCapability {
  available: boolean;
  reason: string | null;
}

export interface CreatorSocialAccount extends SocialAccountPublic {
  publishCapability: CreatorSocialPublishCapability;
}

export const CREATOR_OS_GENERATION_WORKER_UNAVAILABLE_REASON =
  "Flow generation is unavailable because the dedicated Image Studio generation worker is disabled." as const;

export interface CreatorGenerationWorkerReadiness {
  enabled: boolean;
  disabledReason: string | null;
}

import type { SocialPlatform } from "../constants.js";
import type { SocialAccountPublic } from "./social.js";
