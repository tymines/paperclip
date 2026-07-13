import { api } from "./client";
import type { CreativeJob, CreativeProviderId } from "./creativeStudio";

export interface BookMediaChapter {
  id: string;
  chapterNumber: number;
  title: string;
  contentChars: number;
  narration:
    | { state: "none" }
    | { state: "running" | "completed" | "failed"; chunksDone: number; chunksTotal: number; chunksFailed: number };
  illustrations: CreativeJob[];
}

export interface BookMediaAsset {
  id: string;
  purpose: string;
  mode: string;
  status: string;
  outputs: Array<{ url: string; kind: string; thumbUrl?: string }>;
  prompt: string;
  provider: string;
  characterId: string | null;
  chapterId: string | null;
  createdAt: string;
}

export interface BookMediaCharacter {
  id: string;
  name: string;
  role: string;
  iconUrl: string | null;
}

export interface BookMediaOverview {
  book: { id: string; slug: string; title: string; coverUrl: string | null };
  characters: BookMediaCharacter[];
  assets: BookMediaAsset[];
  chapters: BookMediaChapter[];
  trailerJobs: CreativeJob[];
  coverJobs: CreativeJob[];
  narrationExports: Array<{
    id: string; status: string; outputPath: string; createdAt: string;
    metadata: { exportId?: string; stitched?: boolean; chapterCount?: number; individualChapters?: Array<{ number: number; title: string; filename: string }> };
  }>;
  providerStatus: {
    higgsfield: { configured: boolean; keyedOffHint: string };
    openart: { configured: boolean; keyedOffHint: string };
    replicate: { configured: boolean; keyedOffHint: string };
  };
}

export interface NarrationVoice { id: string; name: string; description?: string }

export const bookMediaApi = {
  overview: (companyId: string, bookId: string) =>
    api.get<BookMediaOverview>(`/companies/${companyId}/book-media/${bookId}/overview`),

  voices: (companyId: string) =>
    api.get<{ voices: NarrationVoice[]; warning?: string }>(`/companies/${companyId}/book-media/voices`),

  generateCover: (companyId: string, bookId: string, body?: { prompt?: string; provider?: CreativeProviderId; model?: string }) =>
    api.post<{ job: CreativeJob }>(`/companies/${companyId}/book-media/${bookId}/cover`, body ?? {}),

  generateCharacterIcon: (companyId: string, bookId: string, body: { characterId: string; prompt?: string; model?: string }) =>
    api.post<{ job: CreativeJob }>(`/companies/${companyId}/book-media/${bookId}/character-icon`, body),

  applyAsset: (companyId: string, bookId: string, jobId: string, body: { action: "set-cover" | "set-character-icon"; characterId?: string }) =>
    api.post<{ applied: string; coverUrl?: string; iconUrl?: string }>(`/companies/${companyId}/book-media/${bookId}/assets/${jobId}/apply`, body),

  generateIllustration: (companyId: string, bookId: string, body: { chapterId: string; prompt?: string; model?: string }) =>
    api.post<{ job: CreativeJob }>(`/companies/${companyId}/book-media/${bookId}/illustration`, body),

  generateTrailer: (companyId: string, bookId: string, body: { model: string; premise?: string; params?: Record<string, unknown> }) =>
    api.post<{ job: CreativeJob }>(`/companies/${companyId}/book-media/${bookId}/trailer`, body),

  narrateChapter: (companyId: string, bookId: string, chapterId: string, body?: { voiceId?: string; model?: string }) =>
    api.post<{ jobs: CreativeJob[]; chunks: number; failed: number }>(
      `/companies/${companyId}/book-media/${bookId}/narration/${chapterId}`, body ?? {}),

  stitchNarration: (companyId: string, bookId: string) =>
    api.post<{ narration: unknown; exportId: string; stitched: boolean; ffmpegError: string | null; files: string[] }>(
      `/companies/${companyId}/book-media/${bookId}/narration/stitch`, {}),

  narrationAudioUrl: (companyId: string, bookSlug: string, exportId: string, filename: string) =>
    `/api/companies/${companyId}/book-studio/narration-audio/${bookSlug}/${exportId}/${filename}`,
};
