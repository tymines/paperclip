import { api } from "./client";

export type CreativeMode = "image" | "video" | "audio" | "3d";
export type CreativeProviderId = "higgsfield" | "openart";

export interface CreativeModel {
  provider: CreativeProviderId;
  id: string;
  displayName: string;
  description: string;
  modes: CreativeMode[];
}

export interface CreativeJob {
  id: string;
  provider: CreativeProviderId;
  providerJobId: string | null;
  mode: CreativeMode;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  refs: Array<{ role: string; url: string }>;
  status: "pending" | "running" | "completed" | "failed";
  outputs: Array<{ url: string; kind: string; thumbUrl?: string }>;
  costCredits: number | null;
  error: string | null;
  folder: string | null;
  favorite: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeStudioStatus {
  higgsfield: { configured: boolean; keyedOffHint: string };
  openart: { configured: boolean; keyedOffHint: string };
  krea: { configured: boolean; keyedOffHint: string };
  defaultProviderByMode: Record<CreativeMode, CreativeProviderId>;
  batchConfirmThresholdCredits: number;
}

export const creativeStudioApi = {
  status: (companyId: string) =>
    api.get<CreativeStudioStatus>(`/companies/${companyId}/creative-studio/status`),

  models: (companyId: string) =>
    api.get<{ models: CreativeModel[]; errors: string[] }>(`/companies/${companyId}/creative-studio/models`),

  credits: (companyId: string) =>
    api.get<{ credits: Record<string, { balance: number | null; error?: string }> }>(
      `/companies/${companyId}/creative-studio/credits`,
    ),

  generate: (companyId: string, body: {
    provider: CreativeProviderId;
    mode: CreativeMode;
    model: string;
    prompt: string;
    params?: Record<string, unknown>;
    refs?: Array<{ role: string; url: string }>;
    folder?: string;
  }) => api.post<{ job: CreativeJob }>(`/companies/${companyId}/creative-studio/generate`, body),

  jobs: (companyId: string, opts?: { status?: string; mode?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.status) q.set("status", opts.status);
    if (opts?.mode) q.set("mode", opts.mode);
    if (opts?.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return api.get<{ jobs: CreativeJob[] }>(`/companies/${companyId}/creative-studio/jobs${qs ? `?${qs}` : ""}`);
  },

  job: (companyId: string, jobId: string) =>
    api.get<{ job: CreativeJob; warning?: string }>(`/companies/${companyId}/creative-studio/jobs/${jobId}`),

  patchJob: (companyId: string, jobId: string, body: { favorite?: boolean; folder?: string | null }) =>
    api.patch<{ job: CreativeJob }>(`/companies/${companyId}/creative-studio/jobs/${jobId}`, body),
};
