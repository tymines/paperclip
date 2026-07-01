export interface CompanySkillUsageEvent {
  id: string;
  companyId: string;
  skillId: string;
  actorType: string;
  actorId: string | null;
  agentName: string | null;
  context: string | null;
  outcome: string;
  createdAt: Date;
}

export interface CompanySkillUsageEventListResponse {
  events: CompanySkillUsageEvent[];
  total: number;
  skillId: string;
}

export interface CompanySkillRecordUsageEventRequest {
  actorType?: string;
  actorId?: string | null;
  agentName?: string | null;
  context?: string | null;
  outcome?: string;
}

export type CompanySkillSourceType = "local_path" | "github" | "url" | "catalog" | "skills_sh";

export type CompanySkillTrustLevel = "markdown_only" | "assets" | "scripts_executables";

export type CompanySkillCompatibility = "compatible" | "unknown" | "invalid";

export type CompanySkillSourceBadge = "paperclip" | "github" | "local" | "url" | "catalog" | "skills_sh";

export interface CompanySkillFileInventoryEntry {
  path: string;
  kind: "skill" | "markdown" | "reference" | "script" | "asset" | "other";
}

export interface CompanySkill {
  id: string;
  companyId: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  markdown: string;
  sourceType: CompanySkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: CompanySkillTrustLevel;
  compatibility: CompanySkillCompatibility;
  fileInventory: CompanySkillFileInventoryEntry[];
  metadata: Record<string, unknown> | null;
  enabled: boolean;
  iconKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompanySkillListItem {
  id: string;
  companyId: string;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  sourceType: CompanySkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: CompanySkillTrustLevel;
  compatibility: CompanySkillCompatibility;
  fileInventory: CompanySkillFileInventoryEntry[];
  enabled: boolean;
  iconKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  attachedAgentCount: number;
  totalAgentCount: number;
  usage30d: CompanySkillUsageStats;
  editable: boolean;
  editableReason: string | null;
  sourceLabel: string | null;
  sourceBadge: CompanySkillSourceBadge;
  sourcePath: string | null;
}

/**
 * 30-day usage rollup shown on Skills catalog cards and detail drawer.
 *
 * These numbers come from `activity_log` rows keyed to the skill. Until the
 * tool-invocation telemetry pipeline lands, the API returns zeros — but the
 * UI must already render them, so the shape is fixed here.
 */
export interface CompanySkillUsageStats {
  invocations: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  totalCostCents: number;
}

/**
 * A single agent surfaced in the catalog's per-agent enablement table.
 * `granted` mirrors whether the skill key is in the agent's
 * `adapterConfig.desiredSkills` list.
 */
export interface CompanySkillAgentGrant {
  agentId: string;
  agentName: string;
  agentUrlKey: string;
  adapterType: string;
  granted: boolean;
}

export interface CompanySkillAgentGrantsResponse {
  skillId: string;
  skillKey: string;
  grants: CompanySkillAgentGrant[];
}

export interface CompanySkillToggleEnabledRequest {
  enabled: boolean;
}

export interface CompanySkillToggleAgentRequest {
  granted: boolean;
}

/**
 * "Try it" stub. Until the runtime fans the test call through to a real
 * adapter, the server echoes the parsed input and returns a synthetic
 * preview built from the skill's SKILL.md frontmatter so reviewers can
 * see the round-trip wired up end-to-end.
 */
export interface CompanySkillInvokeRequest {
  input: Record<string, unknown>;
}

export interface CompanySkillInvokeResponse {
  status: "ok" | "error";
  startedAt: Date;
  finishedAt: Date;
  latencyMs: number;
  echo: Record<string, unknown>;
  preview: string;
  warnings: string[];
}

/**
 * Custom-skill installer payload. Either `manifestUrl` (fetched server-side
 * by the existing import flow) or an inline `manifest` blob — both go
 * through the same validation pass.
 */
export interface CompanySkillManifestInstallRequest {
  manifestUrl?: string | null;
  manifest?: CompanySkillManifest | null;
}

export interface CompanySkillManifest {
  name: string;
  slug?: string | null;
  description?: string | null;
  markdown?: string | null;
  iconKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CompanySkillUsageAgent {
  id: string;
  name: string;
  urlKey: string;
  adapterType: string;
  desired: boolean;
  /**
   * Runtime adapter skill state when a caller explicitly fetched it.
   * Company skill detail reads intentionally return null here to avoid probing
   * agent runtimes while loading operator-facing skill metadata.
   */
  actualState: string | null;
}

export interface CompanySkillDetail extends CompanySkill {
  attachedAgentCount: number;
  totalAgentCount: number;
  usage30d: CompanySkillUsageStats;
  usedByAgents: CompanySkillUsageAgent[];
  editable: boolean;
  editableReason: string | null;
  sourceLabel: string | null;
  sourceBadge: CompanySkillSourceBadge;
  sourcePath: string | null;
}

export interface CompanySkillUpdateStatus {
  supported: boolean;
  reason: string | null;
  trackingRef: string | null;
  currentRef: string | null;
  latestRef: string | null;
  hasUpdate: boolean;
}

export interface CompanySkillImportRequest {
  source: string;
}

export interface CompanySkillImportResult {
  imported: CompanySkill[];
  warnings: string[];
}

export interface CompanySkillProjectScanRequest {
  projectIds?: string[];
  workspaceIds?: string[];
}

export interface CompanySkillProjectScanSkipped {
  projectId: string;
  projectName: string;
  workspaceId: string | null;
  workspaceName: string | null;
  path: string | null;
  reason: string;
}

export interface CompanySkillProjectScanConflict {
  slug: string;
  key: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  path: string;
  existingSkillId: string;
  existingSkillKey: string;
  existingSourceLocator: string | null;
  reason: string;
}

export interface CompanySkillProjectScanResult {
  scannedProjects: number;
  scannedWorkspaces: number;
  discovered: number;
  imported: CompanySkill[];
  updated: CompanySkill[];
  skipped: CompanySkillProjectScanSkipped[];
  conflicts: CompanySkillProjectScanConflict[];
  warnings: string[];
}

export interface CompanySkillCreateRequest {
  name: string;
  slug?: string | null;
  description?: string | null;
  markdown?: string | null;
}

export interface CompanySkillFileDetail {
  skillId: string;
  path: string;
  kind: CompanySkillFileInventoryEntry["kind"];
  content: string;
  language: string | null;
  markdown: boolean;
  editable: boolean;
}

export interface CompanySkillFileUpdateRequest {
  path: string;
  content: string;
}
