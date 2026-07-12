import { api } from "./client";
import type { CreativeJob } from "./creativeStudio";

export interface BrowseItem {
  id: string;
  name: string;
  description: string;
  category: string;
  previewUrl: string | null;
}

export interface BrandKit {
  id: string;
  name: string;
  productUrl: string | null;
  logoUrl: string | null;
  colors: string[];
  tone: string | null;
  description: string | null;
  createdAt: string;
}

export interface BatchEstimate {
  requiresConfirm: true;
  estimate: { variants: number; estimatedCredits: number; note: string; thresholdCredits: number };
  batch: null;
}
export interface BatchResult {
  batch: CreativeJob;
  jobs: CreativeJob[];
  batchId: string;
  estimatedCredits: number;
}

export const EDIT_TOOL_META = [
  { tool: "upscale_image", label: "Upscale Image", accepts: "image", desc: "Enhance / increase resolution (2K/4K)" },
  { tool: "upscale_video", label: "Upscale Video", accepts: "video", desc: "Video enhance / resolution bump" },
  { tool: "outpaint_image", label: "Expand Image", accepts: "image", desc: "Outpaint / uncrop to a new aspect" },
  { tool: "reframe", label: "Reframe Video", accepts: "video", desc: "Change a video's aspect ratio" },
  { tool: "remove_background", label: "Remove Background", accepts: "image", desc: "Cutout / transparent background" },
  { tool: "motion_control", label: "Recast / Motion", accepts: "video", desc: "Character swap / motion transfer" },
] as const;

export const creativeToolsApi = {
  presets: (companyId: string, category?: string) =>
    api.get<{ items: BrowseItem[] }>(`/companies/${companyId}/creative-tools/presets${category ? `?category=${encodeURIComponent(category)}` : ""}`),
  characters: (companyId: string) =>
    api.get<{ items: BrowseItem[] }>(`/companies/${companyId}/creative-tools/characters`),
  elements: (companyId: string) =>
    api.get<{ items: BrowseItem[] }>(`/companies/${companyId}/creative-tools/elements`),
  explainerPresets: (companyId: string) =>
    api.get<{ items: BrowseItem[] }>(`/companies/${companyId}/creative-tools/explainer-presets`),

  edit: (companyId: string, tool: string, body: { sourceUrl: string; prompt?: string; params?: Record<string, unknown> }) =>
    api.post<{ job: CreativeJob }>(`/companies/${companyId}/creative-tools/edit/${tool}`, body),

  virality: (companyId: string, jobId: string) =>
    api.post<{ job: CreativeJob; virality: { score: number | null; summary: string | null } }>(
      `/companies/${companyId}/creative-tools/virality/${jobId}`, {}),

  explainer: (companyId: string, body: { prompt: string; preset?: string; voiceId?: string }) =>
    api.post<{ job: CreativeJob }>(`/companies/${companyId}/creative-tools/explainer`, body),
  shorts: (companyId: string, body: { prompt: string; presetId?: string; sourceUrl?: string }) =>
    api.post<{ job: CreativeJob }>(`/companies/${companyId}/creative-tools/shorts`, body),
  clipper: (companyId: string, body: { youtubeUrl: string }) =>
    api.post<{ job: CreativeJob }>(`/companies/${companyId}/creative-tools/clipper`, body),
  launcherStatus: (companyId: string, jobId: string) =>
    api.post<{ job: CreativeJob; warning?: string }>(`/companies/${companyId}/creative-tools/launcher-status/${jobId}`, {}),
};

export const adStudioApi = {
  brandKits: (companyId: string) =>
    api.get<{ brandKits: BrandKit[] }>(`/companies/${companyId}/ad-studio/brand-kits`),
  createBrandKit: (companyId: string, body: { name: string; productUrl?: string; logoUrl?: string; colors?: string[]; tone?: string; description?: string }) =>
    api.post<{ brandKit: BrandKit }>(`/companies/${companyId}/ad-studio/brand-kits`, body),

  adReference: (companyId: string, videoUrl: string) =>
    api.post<{ job: CreativeJob }>(`/companies/${companyId}/ad-studio/ad-reference`, { videoUrl }),
  adReferenceRefresh: (companyId: string, jobId: string) =>
    api.post<{ job: CreativeJob; warning?: string }>(`/companies/${companyId}/ad-studio/ad-reference/${jobId}/refresh`, {}),

  createBatch: (companyId: string, body: {
    model: string; formats: string[]; hooks?: string[]; settings?: string[];
    brandKitId?: string; productUrl?: string; characterId?: string; adReferenceJobId?: string; confirm?: boolean;
  }) => api.post<BatchEstimate | BatchResult>(`/companies/${companyId}/ad-studio/batches`, body),

  batches: (companyId: string) =>
    api.get<{ batches: CreativeJob[] }>(`/companies/${companyId}/ad-studio/batches`),
  batch: (companyId: string, batchId: string) =>
    api.get<{ batch: CreativeJob; variants: CreativeJob[] }>(`/companies/${companyId}/ad-studio/batches/${batchId}`),
};

// Curated ad-format names (config, not data — mirrors Higgsfield Marketing Studio's
// public format list; the format string is folded into the generation prompt).
export const AD_FORMATS = [
  "UGC", "Selfie Testimonial", "Direct-to-Camera", "Before & After", "Tutorial",
  "Unboxing", "Unboxing ASMR", "Product Showcase", "TV Spot", "Secret Hack Reveal",
  "This Gadget Saved Me", "Mystery Box",
] as const;
