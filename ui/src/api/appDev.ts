import { api } from "./client";
import type {
  AppDevApp,
  AppDevBlueprint,
  AppDevBuildStage,
  AppDevBuild,
  AppDevReleaseVersion,
} from "@paperclipai/shared";

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
