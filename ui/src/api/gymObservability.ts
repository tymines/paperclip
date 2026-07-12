import { api } from "./client";

export interface LearningFeedItem {
  id: string;
  agent: string;
  date: string;
  title: string;
  type: "deep-dream" | "session-end";
  summary: string;
  path: string;
}

export interface SkillProposal {
  id: string;
  agent_name: string | null;
  target_type: "skill" | "soul" | "workflow";
  target_name: string;
  title: string;
  detail: string | null;
  rationale: string | null;
  effort: string | null;
  value_note: string | null;
  confidence: string | null;
  source_type: string;
  source_file: string | null;
  source_ref: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
}

export interface SkillTimeline {
  target: string;
  type: string;
  versions: { version: string; title: string; agent: string | null; at: string | null }[];
}

export const gymObservabilityApi = {
  learningFeed: (companyId: string) =>
    api.get<{ items: LearningFeedItem[] }>(`/companies/${companyId}/gym/learning-feed`),

  proposals: (companyId: string, status?: string) =>
    api.get<{ proposals: SkillProposal[] }>(
      `/companies/${companyId}/gym/proposals${status ? `?status=${status}` : ""}`,
    ),

  generate: (companyId: string) =>
    api.post<{ scanned: number; inserted: number }>(`/companies/${companyId}/gym/generate-proposals`, {}),

  review: (companyId: string, id: string, decision: "approve" | "reject", note?: string) =>
    api.post<{ proposal: SkillProposal }>(`/companies/${companyId}/gym/proposals/${id}/review`, { decision, note }),

  edit: (companyId: string, id: string, data: { title?: string; detail?: string; target_name?: string }) =>
    api.patch<{ proposal: SkillProposal }>(`/companies/${companyId}/gym/proposals/${id}`, data),

  timeline: (companyId: string) =>
    api.get<{ timelines: SkillTimeline[] }>(`/companies/${companyId}/gym/skill-timeline`),
};
