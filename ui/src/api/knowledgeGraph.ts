import { api } from "./client";
import type { KnowledgeGraph, IngestRunResult, ImportMarkdownResult } from "@paperclipai/shared";

export interface KnowledgeHub {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  issueIds: string[];
  topTerms: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentSkillEdge {
  agentId: string;
  skillId: string;
}

export const knowledgeGraphApi = {
  // Phase 2: Hub clustering
  getHubs: (companyId: string) =>
    api.get<KnowledgeHub[]>(
      `/companies/${encodeURIComponent(companyId)}/knowledge-graph/hubs`,
    ),

  generateHubs: (companyId: string, k?: number) =>
    api.post<KnowledgeHub[]>(
      `/companies/${encodeURIComponent(companyId)}/knowledge-graph/generate-hubs`,
      k !== undefined ? { k } : {},
    ),

  getAgentSkillEdges: (companyId: string) =>
    api.get<AgentSkillEdge[]>(
      `/companies/${encodeURIComponent(companyId)}/knowledge-graph/agent-skills`,
    ),

  // Phase 4: Entity/Edge CRUD + export
  get: (companyId: string) =>
    api.get<KnowledgeGraph>(`/companies/${companyId}/knowledge-graph`),

  ingestRun: (companyId: string, runId: string) =>
    api.post<IngestRunResult>(`/companies/${companyId}/knowledge-graph/ingest-run`, { runId }),

  clearAll: (companyId: string) =>
    api.delete<void>(`/companies/${companyId}/knowledge-graph`),

  importMarkdown: (
    companyId: string,
    files: Array<{ filename: string; content: string }>,
  ) =>
    api.post<ImportMarkdownResult>(
      `/companies/${companyId}/knowledge-graph/import`,
      { files },
    ),

  exportObsidianUrl: (companyId: string) =>
    `/api/companies/${companyId}/knowledge-graph/export/obsidian`,
};
