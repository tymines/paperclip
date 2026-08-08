import type {
  CreateCreatorCampaign,
  CreateCreatorFlow,
  CreatorCampaignItemKind,
  CreatorCampaignRecord,
  CreatorContentSourceOption,
  CreatorFlowRecord,
  CreatorFlowRunRecord,
  CreatorReviewRequestRecord,
  CreatorSocialAccount,
  SocialPost,
  UpdateCreatorCampaign,
  UpdateCreatorFlow,
} from "@paperclipai/shared";
import { api } from "./client";

const base = (companyId: string) => `/companies/${companyId}/creator-os`;

export const creatorOsApi = {
  listFlows: (companyId: string, personaId: string) =>
    api.get<{ flows: CreatorFlowRecord[] }>(`${base(companyId)}/flows?personaId=${encodeURIComponent(personaId)}`),
  createFlow: (companyId: string, input: CreateCreatorFlow) =>
    api.post<{ flow: CreatorFlowRecord }>(`${base(companyId)}/flows`, input),
  updateFlow: (companyId: string, flowId: string, input: UpdateCreatorFlow) =>
    api.patch<{ flow: CreatorFlowRecord }>(`${base(companyId)}/flows/${flowId}`, input),
  archiveFlow: (companyId: string, flowId: string) =>
    api.post<{ flow: CreatorFlowRecord }>(`${base(companyId)}/flows/${flowId}/archive`, {}),
  listRuns: (companyId: string, flowId: string) =>
    api.get<{ runs: CreatorFlowRunRecord[] }>(`${base(companyId)}/flows/${flowId}/runs`),
  runFlow: (companyId: string, flowId: string, idempotencyKey: string) =>
    api.post<{ run: CreatorFlowRunRecord }>(`${base(companyId)}/flows/${flowId}/runs`, { confirm: true, idempotencyKey }),
  retryStep: (companyId: string, runId: string, stepId: string, idempotencyKey: string) =>
    api.post<{ run: CreatorFlowRunRecord }>(`${base(companyId)}/runs/${runId}/steps/${stepId}/retry`, { idempotencyKey }),

  listCampaigns: (companyId: string, personaId: string) =>
    api.get<{ campaigns: CreatorCampaignRecord[] }>(`${base(companyId)}/campaigns?personaId=${encodeURIComponent(personaId)}`),
  createCampaign: (companyId: string, input: CreateCreatorCampaign) =>
    api.post<{ campaign: CreatorCampaignRecord }>(`${base(companyId)}/campaigns`, input),
  updateCampaign: (companyId: string, campaignId: string, input: UpdateCreatorCampaign) =>
    api.patch<{ campaign: CreatorCampaignRecord }>(`${base(companyId)}/campaigns/${campaignId}`, input),
  archiveCampaign: (companyId: string, campaignId: string) =>
    api.post<{ campaign: CreatorCampaignRecord }>(`${base(companyId)}/campaigns/${campaignId}/archive`, {}),
  addCampaignItem: (companyId: string, campaignId: string, input: { kind: CreatorCampaignItemKind; referenceId: string }) =>
    api.post(`${base(companyId)}/campaigns/${campaignId}/items`, input),
  listSources: (companyId: string, personaId: string) =>
    api.get<{ sources: CreatorContentSourceOption[] }>(`${base(companyId)}/personas/${personaId}/sources`),

  listReviews: (companyId: string, personaId: string) =>
    api.get<{ reviews: CreatorReviewRequestRecord[] }>(`${base(companyId)}/reviews?personaId=${encodeURIComponent(personaId)}`),
  createReview: (companyId: string, input: { personaId: string; sourceType: "generation" | "asset" | "social_draft"; sourceId: string }) =>
    api.post<{ review: CreatorReviewRequestRecord }>(`${base(companyId)}/reviews`, input),
  decideReview: (companyId: string, reviewId: string, decision: "approved" | "rejected", feedback?: string) =>
    api.post<{ review: CreatorReviewRequestRecord }>(`${base(companyId)}/reviews/${reviewId}/decision`, { decision, feedback }),
  rereview: (companyId: string, reviewId: string) =>
    api.post<{ review: CreatorReviewRequestRecord }>(`${base(companyId)}/reviews/${reviewId}/rereview`, {}),

  getSocial: (companyId: string, personaId: string) =>
    api.get<{ accounts: CreatorSocialAccount[]; drafts: SocialPost[] }>(`${base(companyId)}/personas/${personaId}/social`),
  handoff: (companyId: string, reviewRequestId: string, content: string) =>
    api.post(`${base(companyId)}/social/handoff`, { reviewRequestId, content }),
  schedule: (companyId: string, personaId: string, postId: string, accountIds: string[], scheduledAt: string) =>
    api.post(`${base(companyId)}/personas/${personaId}/social/drafts/${postId}/schedule`, { confirmPublish: true, accountIds, scheduledAt }),
};
