import { api } from "./client";

// ────────────────────────────────────────────────────────────────────────────
// Types — mirror the Drizzle schema in packages/db/src/schema/reels.ts
// ────────────────────────────────────────────────────────────────────────────

export type ReelStatus =
  | "queued"
  | "directing"
  | "generating_keyframes"
  | "generating_video"
  | "stitching"
  | "complete"
  | "failed";

export type ReelSceneStatus =
  | "pending"
  | "keyframe_submitted"
  | "keyframe_ready"
  | "video_submitted"
  | "video_ready"
  | "failed";

export type AspectRatio = "9:16" | "16:9" | "1:1";

export type StylePreset =
  | "cinematic"
  | "viral_meme"
  | "day_in_life"
  | "thirst_trap"
  | "story_arc"
  | "how_to"
  | "asmr";

export interface Reel {
  id: string;
  companyId: string;
  personaId: string;
  title: string | null;
  prompt: string;
  stylePreset: StylePreset | null;
  durationSeconds: number;
  aspectRatio: AspectRatio;
  directorTitle: string | null;
  musicMood: string | null;
  status: ReelStatus;
  errorMessage: string | null;
  finalVideoUrl: string | null;
  finalVideoLocalPath: string | null;
  thumbnailUrl: string | null;
  finalDurationSeconds: string | null;
  totalCostUsd: string | null;
  postedToPlatforms: string[] | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ReelScene {
  id: string;
  reelId: string;
  sceneIndex: number;
  description: string;
  cameraFraming: string | null;
  emotion: string | null;
  sceneDurationSeconds: string;
  keyframePrompt: string;
  motionHint: string | null;
  keyframeJobId: string | null;
  keyframeProviderHost: string | null;
  keyframeImageUrl: string | null;
  keyframeImageLocalPath: string | null;
  keyframeCostUsd: string | null;
  videoJobId: string | null;
  videoProviderHost: string | null;
  videoModel: string | null;
  videoClipUrl: string | null;
  videoClipLocalPath: string | null;
  videoCostUsd: string | null;
  status: ReelSceneStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReelTemplate {
  id: string;
  companyId: string | null;
  name: string;
  description: string | null;
  stylePreset: StylePreset;
  promptScaffold: string;
  durationSeconds: number;
  aspectRatio: AspectRatio;
  defaultMusicMood: string | null;
  defaultVideoProvider: string | null;
  createdAt: string;
}

export interface ReelSeries {
  id: string;
  companyId: string;
  personaId: string;
  title: string;
  narrativeArc: string | null;
  createdAt: string;
}

export interface CreateReelInput {
  personaId: string;
  prompt: string;
  title?: string;
  stylePreset?: StylePreset;
  durationSeconds?: number;
  aspectRatio?: AspectRatio;
}

// ────────────────────────────────────────────────────────────────────────────
// API client
// ────────────────────────────────────────────────────────────────────────────

export const reelsApi = {
  list: async (
    companyId: string,
    opts?: { personaId?: string; status?: ReelStatus; limit?: number },
  ): Promise<{ reels: Reel[] }> => {
    const params = new URLSearchParams();
    if (opts?.personaId) params.set("personaId", opts.personaId);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get(`/api/companies/${companyId}/reels${qs ? `?${qs}` : ""}`);
  },

  get: async (
    companyId: string,
    reelId: string,
  ): Promise<{ reel: Reel; scenes: ReelScene[] }> => {
    return api.get(`/api/companies/${companyId}/reels/${reelId}`);
  },

  create: async (
    companyId: string,
    input: CreateReelInput,
  ): Promise<{ reelId: string; status: ReelStatus }> => {
    return api.post(`/api/companies/${companyId}/reels`, input);
  },

  update: async (
    companyId: string,
    reelId: string,
    patch: {
      title?: string;
      sceneEdits?: {
        sceneIndex: number;
        keyframePrompt?: string;
        motionHint?: string;
      }[];
    },
  ): Promise<{ ok: true }> => {
    return api.patch(`/api/companies/${companyId}/reels/${reelId}`, patch);
  },

  regenerateScene: async (
    companyId: string,
    reelId: string,
    sceneIndex: number,
  ): Promise<{ ok: true }> => {
    return api.post(
      `/api/companies/${companyId}/reels/${reelId}/regenerate/${sceneIndex}`,
      {},
    );
  },

  post: async (
    companyId: string,
    reelId: string,
    input: {
      platforms: ("instagram" | "tiktok" | "youtube_shorts")[];
      caption?: string;
      scheduleAt?: string;
    },
  ): Promise<{ ok: true }> => {
    return api.post(`/api/companies/${companyId}/reels/${reelId}/post`, input);
  },

  listTemplates: async (companyId: string): Promise<{ templates: ReelTemplate[] }> => {
    return api.get(`/api/companies/${companyId}/reel-templates`);
  },

  createTemplate: async (
    companyId: string,
    template: Omit<ReelTemplate, "id" | "companyId" | "createdAt">,
  ): Promise<{ template: ReelTemplate }> => {
    return api.post(`/api/companies/${companyId}/reel-templates`, template);
  },

  listSeries: async (companyId: string): Promise<{ series: ReelSeries[] }> => {
    return api.get(`/api/companies/${companyId}/reel-series`);
  },

  createSeries: async (
    companyId: string,
    input: { personaId: string; title: string; narrativeArc?: string },
  ): Promise<{ series: ReelSeries }> => {
    return api.post(`/api/companies/${companyId}/reel-series`, input);
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

export const REEL_STATUS_LABELS: Record<ReelStatus, string> = {
  queued: "Queued",
  directing: "Directing scenes",
  generating_keyframes: "Generating frames",
  generating_video: "Animating clips",
  stitching: "Stitching reel",
  complete: "Complete",
  failed: "Failed",
};

export const STYLE_PRESET_LABELS: Record<StylePreset, string> = {
  cinematic: "Cinematic",
  viral_meme: "Viral meme",
  day_in_life: "Day in the life",
  thirst_trap: "Thirst trap",
  story_arc: "Story arc",
  how_to: "How-to / tutorial",
  asmr: "ASMR / immersive",
};

export function isReelInProgress(reel: Reel): boolean {
  return ["queued", "directing", "generating_keyframes", "generating_video", "stitching"].includes(reel.status);
}

export function reelProgressPercent(reel: Reel): number {
  // Rough mapping per stage for the progress bar
  const map: Record<ReelStatus, number> = {
    queued: 5,
    directing: 15,
    generating_keyframes: 35,
    generating_video: 65,
    stitching: 90,
    complete: 100,
    failed: 0,
  };
  return map[reel.status] ?? 0;
}
