import { api } from "./client";

export type DesignSkill = {
  id: string;
  name: string;
  description: string;
  mode: string;
  surface?: string | null;
  scenario?: string | null;
  platform?: string | null;
  category?: string | null;
  previewType?: string | null;
  designSystemRequired?: boolean;
  examplePrompt?: string | null;
};

export type DesignAgent = {
  id: string;
  name: string;
  available: boolean;
  path?: string;
  version?: string;
};

export type DesignRun = {
  id: string;
  companyId: string | null;
  skill: string;
  agentId: string;
  designSystemId: string | null;
  prompt: string;
  params: Record<string, unknown>;
  outputType: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  odRunId: string | null;
  odProjectId: string | null;
  assetPath: string | null;
  assetUrl: string | null;
  previewUrl: string | null;
  pngPaths: string[];
  mp4Path: string | null;
  rasterStatus: "pending" | "running" | "completed" | "failed" | "skipped";
  rasterError: string | null;
  presetRunId: string | null;
  idempotencyKey: string | null;
  error: string | null;
  tokenCostUsd: string | null;
  renderCostUsd: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown>;
};

export type DesignPreset = {
  slug: string;
  name: string;
  description: string;
  estimateMin: string;
  cardEmoji: string;
  steps: Array<{ label: string; skill: string }>;
  stepCount: number;
};

export type DesignPresetRun = {
  id: string;
  companyId: string | null;
  presetSlug: string;
  brief: string;
  status: "running" | "completed" | "partial" | "failed";
  childRunIds: string[];
  resultSummary: Record<string, unknown>;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type DesignAsset = {
  id: string;
  companyId: string | null;
  runId: string;
  kind: "image" | "video";
  path: string;
  url: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  slideIndex: number;
  skill: string | null;
  prompt: string | null;
  agentId: string | null;
  persona: string | null;
  favorited: boolean;
  createdAt: string;
};

export type DesignAssetsResponse = {
  assets: DesignAsset[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export const designAssetsApi = {
  list: (
    companyId: string,
    params?: {
      page?: number;
      limit?: number;
      skill?: string;
      kind?: string;
      dateRange?: string;
      favorited?: string;
      persona?: string;
    },
  ) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.skill) qs.set("skill", params.skill);
    if (params?.kind) qs.set("kind", params.kind);
    if (params?.dateRange) qs.set("dateRange", params.dateRange);
    if (params?.favorited) qs.set("favorited", params.favorited);
    if (params?.persona) qs.set("persona", params.persona);
    const q = qs.toString();
    return api.get<DesignAssetsResponse>(`/companies/${companyId}/design/assets${q ? `?${q}` : ""}`);
  },
  skills: (companyId: string) =>
    api.get<{ skills: string[] }>(`/companies/${companyId}/design/assets/skills`),
  personas: (companyId: string) =>
    api.get<{ personas: string[] }>(`/companies/${companyId}/design/assets/personas`),
  toggleFavorite: (companyId: string, id: string, favorited: boolean) =>
    api.patch<{ asset: DesignAsset }>(`/companies/${companyId}/design/assets/${id}/favorite`, {
      favorited,
    }),
  exportZip: (companyId: string, ids: string[]) =>
    fetch(`/api/companies/${companyId}/design/assets/export-zip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ids }),
    }).then((r) => {
      if (!r.ok) throw new Error("export zip failed");
      return r.blob();
    }),
};

export const designApi = {
  health: () => api.get<{ ok: boolean; version?: string }>("/design/health"),
  skills: (mode?: string) =>
    api.get<{ skills: DesignSkill[]; total: number }>(
      `/design/skills${mode ? `?mode=${encodeURIComponent(mode)}` : ""}`,
    ),
  agents: () => api.get<{ agents: DesignAgent[] }>("/design/agents"),
  startRun: (
    companyId: string | null,
    body: {
      skill: string;
      prompt: string;
      agentId?: string;
      designSystemId?: string;
      model?: string;
      params?: Record<string, unknown>;
      outputType?: "html" | "png" | "mp4";
    },
  ) => {
    if (companyId) {
      return api.post<{ run: DesignRun }>(`/companies/${companyId}/design/run`, body);
    }
    return api.post<{ run: DesignRun }>(`/design/run`, body);
  },
  listRuns: (companyId: string | null, limit = 50) => {
    const qs = companyId
      ? `?companyId=${encodeURIComponent(companyId)}&limit=${limit}`
      : `?limit=${limit}`;
    return api.get<{ runs: DesignRun[] }>(`/design/runs${qs}`);
  },
  getRun: (id: string) => api.get<{ run: DesignRun }>(`/design/runs/${id}`),
  presets: () => api.get<{ presets: DesignPreset[] }>(`/design/presets`),
  startPresetRun: (
    slug: string,
    body: { companyId?: string | null; brief: string; voice?: string; persona?: string },
  ) => api.post<{ preset: DesignPresetRun; runs: DesignRun[] }>(`/design/presets/${slug}/run`, body),
  getPresetRun: (id: string) =>
    api.get<{ preset: DesignPresetRun; runs: DesignRun[] }>(`/design/preset-runs/${id}`),
  listPresetRuns: (companyId: string | null, limit = 25) => {
    const qs = companyId
      ? `?companyId=${encodeURIComponent(companyId)}&limit=${limit}`
      : `?limit=${limit}`;
    return api.get<{ presetRuns: DesignPresetRun[] }>(`/design/preset-runs${qs}`);
  },
};
