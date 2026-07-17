/** App Dev Control Center API client (spec v1.1) — /companies/:id/appdev/* */
import { api } from "./client";

export interface AppdevApp {
  id: string;
  name: string;
  slug: string;
  phase: string;
  status: string;
  platform: string;
  repoUrl: string | null;
  spendCapUsdMonth: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppdevGateRow {
  id: string;
  gate: string;
  verdict: string;
  reviewer: string;
  evidence: Record<string, unknown> | null;
  comments: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface AppdevWorkOrder {
  id: string;
  code: string;
  type: string;
  lane: string;
  objective: string;
  acceptanceCriteria: Array<Record<string, unknown>> | null;
  referencePackId: string | null;
  touchesUi: boolean;
  sizeClass: string;
  plan: Record<string, unknown> | null;
  planStatus: string;
  status: string;
  costUsd: string;
  maxSteps: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppdevScreen {
  id: string;
  screenTag: string;
  description: string | null;
  comparisonMode: string;
  regions: Array<Record<string, unknown>> | null;
  baselineAssetId: string | null;
}

export interface AppdevVisualReview {
  id: string;
  workOrderId: string | null;
  verdict: string;
  worstScreen: string | null;
  summary: string | null;
  rubricScores: Record<string, Record<string, unknown>> | null;
  reviewerModel: string | null;
  createdAt: string;
}

export interface AppdevReferencePack {
  id: string;
  name: string;
  items: Array<Record<string, unknown>> | null;
  styleTokens: Record<string, unknown> | null;
  approvedBy: string | null;
  createdAt: string;
}

export interface EvidenceCheck {
  gate: string;
  ok: boolean;
  missing: string[];
  notes: string[];
}

export interface TylerQueueItem {
  kind: "gate" | "plan_escalation";
  appId: string;
  appName: string;
  appSlug: string;
  phase: string;
  id: string;
  title: string;
  createdAt: string;
  detail: Record<string, unknown>;
}

export interface AppdevOverview {
  migrationPending: boolean;
  migration?: string;
  message?: string;
  phases?: string[];
  apps?: AppdevApp[];
  waitingOnTyler?: number;
}

export interface AppdevAppDetail {
  migrationPending?: boolean;
  app?: AppdevApp;
  gates?: AppdevGateRow[];
  workOrders?: AppdevWorkOrder[];
  screens?: AppdevScreen[];
  referencePacks?: AppdevReferencePack[];
  visualReviews?: AppdevVisualReview[];
}

export const appdevControlApi = {
  overview: (companyId: string) =>
    api.get<AppdevOverview>(`/companies/${companyId}/appdev/overview`),
  appDetail: (companyId: string, appId: string) =>
    api.get<AppdevAppDetail>(`/companies/${companyId}/appdev/apps/${appId}`),
  createApp: (companyId: string, body: { name: string; platform?: string; repoUrl?: string }) =>
    api.post<{ app: AppdevApp }>(`/companies/${companyId}/appdev/apps`, body),
  gateEvidence: (companyId: string, appId: string, gate: string) =>
    api.get<EvidenceCheck & { migrationPending?: boolean }>(
      `/companies/${companyId}/appdev/apps/${appId}/gates/${gate}/evidence`,
    ),
  decideGate: (
    companyId: string,
    appId: string,
    gate: string,
    body: {
      verdict: "passed" | "failed" | "changes_requested";
      comments?: string;
      overrideReason?: string;
    },
  ) => api.post(`/companies/${companyId}/appdev/apps/${appId}/gates/${gate}`, body),
  createWorkOrder: (
    companyId: string,
    appId: string,
    body: Record<string, unknown>,
  ) =>
    api.post<{ workOrder: AppdevWorkOrder }>(
      `/companies/${companyId}/appdev/apps/${appId}/work-orders`,
      body,
    ),
  tylerQueue: (companyId: string) =>
    api.get<{ migrationPending: boolean; items: TylerQueueItem[] }>(
      `/companies/${companyId}/appdev/tyler-queue`,
    ),
  killApp: (companyId: string, appId: string, reason: string) =>
    api.post(`/companies/${companyId}/appdev/apps/${appId}/kill`, { reason }),
};

/* ── Studio API (Phases 3–6) ─────────────────────────────────────────────── */

export interface AppdevChatThread {
  id: string;
  title: string;
  lane: string;
  createdAt: string;
}
export interface AppdevChatMessage {
  id: string;
  role: string;
  content: string;
  pinned: boolean;
  promotedTo: string | null;
  createdAt: string;
}
export interface AppdevFeedbackItem {
  id: string;
  source: string;
  severity: string;
  title: string;
  body: string | null;
  status: string;
  convertedWorkOrderId: string | null;
  createdAt: string;
}
export interface AppdevSkill {
  id: string;
  name: string;
  slashCommand: string;
  description: string | null;
  runCount: number;
}
export interface AppdevRetro {
  id: string;
  doc: string | null;
  lessons: Array<Record<string, unknown>> | null;
  fedForwardIds: string[] | null;
  createdAt: string;
}
export interface AppdevAsset {
  id: string;
  kind: string;
  storagePath: string;
  source: string;
  sha256: string | null;
  createdAt: string;
}

export const appdevStudioApi = {
  // Phase 3
  referencePacks: (companyId: string, appId: string) =>
    api.get<{ referencePacks: AppdevReferencePack[]; migrationPending?: boolean }>(
      `/companies/${companyId}/appdev/apps/${appId}/reference-packs`,
    ),
  createReferencePack: (companyId: string, appId: string, body: Record<string, unknown>) =>
    api.post<{ referencePack: AppdevReferencePack }>(
      `/companies/${companyId}/appdev/apps/${appId}/reference-packs`,
      body,
    ),
  extractStyleTokens: (companyId: string, packId: string) =>
    api.post<{ styleTokens: Record<string, unknown>; model: string }>(
      `/companies/${companyId}/appdev/reference-packs/${packId}/extract-style-tokens`,
      {},
    ),
  // Phase 4
  runHarness: (companyId: string, appId: string, body: { baseUrl: string; workOrderId?: string; selfCheck?: Record<string, unknown> }) =>
    api.post<Record<string, unknown>>(`/companies/${companyId}/appdev/apps/${appId}/harness/run`, body),
  runVfgR: (companyId: string, woId: string, declaredScreenTags: string[]) =>
    api.post<{ visualReview: AppdevVisualReview }>(
      `/companies/${companyId}/appdev/work-orders/${woId}/vfg-r`,
      { declaredScreenTags },
    ),
  promoteBaseline: (companyId: string, screenId: string, assetId: string, commitSha?: string) =>
    api.post(`/companies/${companyId}/appdev/screens/${screenId}/promote-baseline`, { assetId, commitSha }),
  updateScreen: (companyId: string, screenId: string, body: { regions?: Array<Record<string, unknown>>; comparisonMode?: string }) =>
    api.patch<{ screen: AppdevScreen }>(`/companies/${companyId}/appdev/screens/${screenId}`, body),
  assets: (companyId: string, appId: string) =>
    api.get<{ assets: AppdevAsset[]; migrationPending?: boolean }>(
      `/companies/${companyId}/appdev/apps/${appId}/assets`,
    ),
  // Phase 5
  chatThreads: (companyId: string, appId: string) =>
    api.get<{ threads: AppdevChatThread[]; migrationPending?: boolean }>(
      `/companies/${companyId}/appdev/apps/${appId}/chat/threads`,
    ),
  createChatThread: (companyId: string, appId: string, title: string) =>
    api.post<{ thread: AppdevChatThread }>(`/companies/${companyId}/appdev/apps/${appId}/chat/threads`, { title }),
  chatMessages: (companyId: string, threadId: string) =>
    api.get<{ messages: AppdevChatMessage[] }>(`/companies/${companyId}/appdev/chat/threads/${threadId}/messages`),
  chatStreamPath: (companyId: string, threadId: string) =>
    `/api/companies/${companyId}/appdev/chat/threads/${threadId}/messages/stream`,
  pinMessage: (companyId: string, messageId: string, pinned: boolean) =>
    api.post(`/companies/${companyId}/appdev/chat/messages/${messageId}/pin`, { pinned }),
  promoteMessage: (companyId: string, messageId: string, to: string, extra?: Record<string, unknown>) =>
    api.post<Record<string, unknown>>(`/companies/${companyId}/appdev/chat/messages/${messageId}/promote`, { to, ...extra }),
  feedback: (companyId: string, appId: string) =>
    api.get<{ items: AppdevFeedbackItem[]; migrationPending?: boolean }>(
      `/companies/${companyId}/appdev/apps/${appId}/feedback`,
    ),
  addFeedback: (companyId: string, appId: string, body: { title: string; body?: string; severity?: string }) =>
    api.post<{ item: AppdevFeedbackItem; draftWorkOrder: AppdevWorkOrder | null }>(
      `/companies/${companyId}/appdev/apps/${appId}/feedback`,
      body,
    ),
  dismissFeedback: (companyId: string, itemId: string) =>
    api.post(`/companies/${companyId}/appdev/feedback/${itemId}/dismiss`, {}),
  convertFeedback: (companyId: string, itemId: string) =>
    api.post<{ workOrder: AppdevWorkOrder }>(`/companies/${companyId}/appdev/feedback/${itemId}/convert`, {}),
  // Phase 6
  skills: (companyId: string) =>
    api.get<{ skills: AppdevSkill[]; migrationPending?: boolean }>(`/companies/${companyId}/appdev/skills`),
  invokeSkill: (companyId: string, skillId: string, body: { confirm?: boolean; appId?: string; input?: string }) =>
    api.post<Record<string, unknown>>(`/companies/${companyId}/appdev/skills/${skillId}/invoke`, body),
  runDigest: (companyId: string) =>
    api.post<{ markdown: string; slack: string }>(`/companies/${companyId}/appdev/digest/run`, {}),
  retros: (companyId: string, appId: string) =>
    api.get<{ retros: AppdevRetro[]; migrationPending?: boolean }>(
      `/companies/${companyId}/appdev/apps/${appId}/retros`,
    ),
  createRetro: (companyId: string, appId: string, body: { doc: string; lessons: Array<{ text: string }> }) =>
    api.post<{ retro: AppdevRetro }>(`/companies/${companyId}/appdev/apps/${appId}/retros`, body),
  feedForward: (companyId: string, retroId: string, lesson: string, kind: "idea" | "work_order") =>
    api.post<{ kind: string; id: string }>(`/companies/${companyId}/appdev/retros/${retroId}/feed-forward`, { lesson, kind }),
};
