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
