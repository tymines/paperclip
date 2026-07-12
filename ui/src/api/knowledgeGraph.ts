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

// ─── Fleet KB (Obsidian vault surfaced read-only) ────────────────────────────

export interface FleetKbNote {
  id: string;
  title: string;
  date: string | null;
  category: string;
  categoryLabel: string;
  tags: string[];
  agentId: string | null;
  source: string | null;
  sourceScope: string | null;
  promoted: string | null;
  wikilinks: string[];
  path: string;
  /** Full markdown body. Only present when the graph was fetched with bodies=true. */
  body?: string;
  excerpt: string;
  updatedAt: string;
}

export type FleetKbNodeKind = "note" | "index" | "agent" | "category";

export interface FleetKbGraphNode {
  id: string;
  kind: FleetKbNodeKind;
  label: string;
  category?: string;
  agentId?: string | null;
  date?: string | null;
  noteId?: string;
}

export interface FleetKbGraphEdge {
  source: string;
  target: string;
  kind: "link" | "agent" | "category" | "related";
  weight?: number;
}

export interface FleetKbGraphResponse {
  available: boolean;
  vaultPath: string;
  generatedAt?: string;
  noteCount: number;
  indexExists?: boolean;
  notes: FleetKbNote[];
  categories: Array<{ key: string; label: string; count: number }>;
  tags: Array<{ tag: string; count: number }>;
  agents: Array<{ id: string; count: number }>;
  graph: { nodes: FleetKbGraphNode[]; edges: FleetKbGraphEdge[] };
}

export interface FleetKbNoteResponse {
  note: FleetKbNote;
  backlinks: Array<{ id: string; title: string; category: string }>;
  related: Array<{ id: string; title: string; category: string; date: string | null }>;
}

export interface FleetDreamsResponse {
  available: boolean;
  date: string | null;
  content: string;
  /** Parsed from the consolidation log when stated; null when unknown (never fabricated). */
  dirsConsolidated: number | null;
  failures: number | null;
  noteCount: number;
  filename: string | null;
}

export const fleetKbApi = {
  getGraph: (opts?: { bodies?: boolean }) =>
    api.get<FleetKbGraphResponse>(`/fleet-kb/graph${opts?.bodies ? "?bodies=1" : ""}`),
  getNote: (id: string) => api.get<FleetKbNoteResponse>(`/fleet-kb/notes/${encodeURIComponent(id)}`),
  getDreams: () => api.get<FleetDreamsResponse>(`/fleet-kb/dreams`),
};
