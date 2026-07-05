export interface AppDevApp {
  id: string;
  key: string;
  name: string;
  tagline: string | null;
  kind: 'cockpit' | 'app';
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
  items: Array<{
    id: string;
    title: string;
    kind: string;
    status: string;
  }>;
}

export interface AppDevListAppsResponse {
  apps: AppDevApp[];
}

export interface AppDevBlueprintsResponse {
  blueprints: AppDevBlueprint[];
}

export interface AppDevBuildsResponse {
  appKey: string;
  stages: AppDevBuildStage[];
  builds: AppDevBuild[];
}

export interface AppDevReleasesResponse {
  appKey: string;
  source: string;
  latestVersion: number | null;
  unversionedCount: number;
  versions: AppDevReleaseVersion[];
}
