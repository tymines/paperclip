import { api } from "./client";

export interface AppDevApp {
  id: string;
  key: string;
  name: string;
  tagline: string | null;
  kind: "cockpit" | "app";
  accent: string | null;
  repo: string | null;
  feedbackOriginId: string | null;
  feedbackCount: number;
  openFeedback: number;
  latestVersion: string | null;
  pendingApprovals: number;
}

export interface AppDevBlueprint {
  id: string;
  category: string;
  name: string;
  description: string | null;
  icon: string | null;
  starterStack: string[] | null;
  sortOrder: number;
}

export interface AppDevBuildStage {
  stage: string;
  agentId: string;
  agentName: string;
  agentStatus: string;
  latestRunStatus: string | null;
  progress: number | null;
}
export interface AppDevBuild {
  runId: string;
  stage: string;
  agentName: string;
  status: string;
  progress: number;
  commit: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface AppDevReleaseVersion {
  version: number;
  items: { id: string; title: string; kind: string; status: string }[];
}

export const appDevApi = {
  listApps: (companyId: string) =>
    api.get<{ apps: AppDevApp[] }>(`/companies/${companyId}/app-dev/apps`),
  blueprints: (companyId: string) =>
    api.get<{ blueprints: AppDevBlueprint[] }>(`/companies/${companyId}/app-dev/blueprints`),
  builds: (companyId: string, appKey: string) =>
    api.get<{ appKey: string; stages: AppDevBuildStage[]; builds: AppDevBuild[] }>(
      `/companies/${companyId}/app-dev/apps/${appKey}/builds`,
    ),
  releases: (companyId: string, appKey: string) =>
    api.get<{
      appKey: string;
      source: string;
      latestVersion: number | null;
      versions: AppDevReleaseVersion[];
    }>(`/companies/${companyId}/app-dev/apps/${appKey}/releases`),
  designChatStreamPath: (companyId: string) =>
    `/api/companies/${companyId}/app-dev/design-chat/stream`,
};
