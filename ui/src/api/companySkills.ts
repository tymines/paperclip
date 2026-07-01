import type {
  CompanySkill,
  CompanySkillAgentGrant,
  CompanySkillAgentGrantsResponse,
  CompanySkillCreateRequest,
  CompanySkillDetail,
  CompanySkillFileDetail,
  CompanySkillImportResult,
  CompanySkillInvokeResponse,
  CompanySkillListItem,
  CompanySkillManifest,
  CompanySkillProjectScanRequest,
  CompanySkillProjectScanResult,
  CompanySkillUpdateStatus,
  CompanySkillUsageEvent,
  CompanySkillUsageEventListResponse,
  CompanySkillRecordUsageEventRequest,
} from "@paperclipai/shared";
import { api } from "./client";

export const companySkillsApi = {
  list: (companyId: string) =>
    api.get<CompanySkillListItem[]>(`/companies/${encodeURIComponent(companyId)}/skills`),
  detail: (companyId: string, skillId: string) =>
    api.get<CompanySkillDetail>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}`,
    ),
  updateStatus: (companyId: string, skillId: string) =>
    api.get<CompanySkillUpdateStatus>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/update-status`,
    ),
  file: (companyId: string, skillId: string, relativePath: string) =>
    api.get<CompanySkillFileDetail>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files?path=${encodeURIComponent(relativePath)}`,
    ),
  updateFile: (companyId: string, skillId: string, path: string, content: string) =>
    api.patch<CompanySkillFileDetail>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/files`,
      { path, content },
    ),
  create: (companyId: string, payload: CompanySkillCreateRequest) =>
    api.post<CompanySkill>(
      `/companies/${encodeURIComponent(companyId)}/skills`,
      payload,
    ),
  importFromSource: (companyId: string, source: string) =>
    api.post<CompanySkillImportResult>(
      `/companies/${encodeURIComponent(companyId)}/skills/import`,
      { source },
    ),
  scanProjects: (companyId: string, payload: CompanySkillProjectScanRequest = {}) =>
    api.post<CompanySkillProjectScanResult>(
      `/companies/${encodeURIComponent(companyId)}/skills/scan-projects`,
      payload,
    ),
  installUpdate: (companyId: string, skillId: string) =>
    api.post<CompanySkill>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/install-update`,
      {},
    ),
  delete: (companyId: string, skillId: string) =>
    api.delete<CompanySkill>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}`,
    ),
  setEnabled: (companyId: string, skillId: string, enabled: boolean) =>
    api.patch<CompanySkillDetail>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/enabled`,
      { enabled },
    ),
  listAgentGrants: (companyId: string, skillId: string) =>
    api.get<CompanySkillAgentGrantsResponse>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/agents`,
    ),
  setAgentGrant: (companyId: string, skillId: string, agentId: string, granted: boolean) =>
    api.patch<CompanySkillAgentGrant>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/agents/${encodeURIComponent(agentId)}`,
      { granted },
    ),
  invoke: (companyId: string, skillId: string, input: Record<string, unknown>) =>
    api.post<CompanySkillInvokeResponse>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/invoke`,
      { input },
    ),
  installManifest: (
    companyId: string,
    payload: { manifestUrl?: string | null; manifest?: CompanySkillManifest | null },
  ) =>
    api.post<CompanySkill>(
      `/companies/${encodeURIComponent(companyId)}/skills/install-manifest`,
      payload,
    ),

  recordUsageEvent: (
    companyId: string,
    skillId: string,
    payload: CompanySkillRecordUsageEventRequest,
  ) =>
    api.post<CompanySkillUsageEvent>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/usage-events`,
      payload,
    ),

  listUsageEvents: (
    companyId: string,
    skillId: string,
    limit?: number,
    offset?: number,
  ) => {
    const params = new URLSearchParams();
    if (limit != null) params.set("limit", String(limit));
    if (offset != null) params.set("offset", String(offset));
    const qs = params.toString();
    return api.get<CompanySkillUsageEventListResponse>(
      `/companies/${encodeURIComponent(companyId)}/skills/${encodeURIComponent(skillId)}/usage-events${qs ? `?${qs}` : ""}`,
    );
  },
};
