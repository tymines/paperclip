export type KnowledgeEntityType = "tool" | "file" | "error" | "decision" | "concept";
export type KnowledgeEdgeRelationType = "uses" | "modifies" | "caused" | "decided" | "references";

export interface KnowledgeEntity {
  id: string;
  companyId: string;
  type: KnowledgeEntityType;
  label: string;
  properties: Record<string, unknown> | null;
  sourceRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEdge {
  id: string;
  companyId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: KnowledgeEdgeRelationType;
  sourceRunId: string | null;
  createdAt: string;
}

export interface KnowledgeGraph {
  entities: KnowledgeEntity[];
  edges: KnowledgeEdge[];
}

export interface IngestRunResult {
  entitiesCreated: number;
  entitiesMerged: number;
  edgesCreated: number;
}

export interface ImportMarkdownResult {
  filesProcessed: number;
  entitiesCreated: number;
  entitiesMerged: number;
  edgesCreated: number;
  errors: string[];
}
