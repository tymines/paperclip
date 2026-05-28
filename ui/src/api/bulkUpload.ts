/**
 * Bulk-upload API client. Mirrors server/src/routes/bulk-upload.ts.
 */
import { api } from "./client";

export interface BulkUploadDraftRow {
  id: string;
  companyId: string;
  name: string | null;
  step: string;
  status: string;
  strategy: string | null;
  strategyConfig: unknown;
  metadata: unknown;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
}

export interface BulkUploadRow {
  id: string;
  companyId: string;
  draftId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  thumbnailKey: string | null;
  detectedType: "image" | "video";
  orderIndex: number;
  caption: string | null;
  hashtags: string[];
  platforms: string[];
  aiSuggestedCaption: string | null;
  scheduledPostId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadFilesResponse {
  uploads: BulkUploadRow[];
  errors: Array<{ filename: string; reason: string }>;
}

export interface UpdateUploadInput {
  caption?: string | null;
  hashtags?: string[];
  platforms?: string[];
  aiSuggestedCaption?: string | null;
  orderIndex?: number;
}

const base = (companyId: string) =>
  `/companies/${companyId}/social/bulk-upload`;

export const bulkUploadApi = {
  listDrafts: (companyId: string) =>
    api.get<BulkUploadDraftRow[]>(`${base(companyId)}/drafts`),

  createDraft: (companyId: string, name?: string) =>
    api.post<BulkUploadDraftRow>(`${base(companyId)}/drafts`, { name }),

  getDraft: (companyId: string, draftId: string) =>
    api.get<{ draft: BulkUploadDraftRow; uploads: BulkUploadRow[] }>(
      `${base(companyId)}/drafts/${draftId}`,
    ),

  updateDraft: (
    companyId: string,
    draftId: string,
    patch: {
      name?: string;
      step?: string;
      strategy?: string;
      strategyConfig?: unknown;
      metadata?: unknown;
    },
  ) =>
    api.patch<BulkUploadDraftRow>(
      `${base(companyId)}/drafts/${draftId}`,
      patch,
    ),

  deleteDraft: (companyId: string, draftId: string) =>
    api.delete<void>(`${base(companyId)}/drafts/${draftId}`),

  uploadFiles: (companyId: string, draftId: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) {
      form.append("files", file);
    }
    return api.postForm<UploadFilesResponse>(
      `${base(companyId)}/drafts/${draftId}/files`,
      form,
    );
  },

  updateUpload: (
    companyId: string,
    draftId: string,
    fileId: string,
    patch: UpdateUploadInput,
  ) =>
    api.patch<BulkUploadRow>(
      `${base(companyId)}/drafts/${draftId}/files/${fileId}`,
      patch,
    ),

  deleteUploads: (companyId: string, draftId: string, ids: string[]) =>
    api.post<{ deletedCount: number }>(
      `${base(companyId)}/drafts/${draftId}/files/delete`,
      { ids },
    ),

  reorderUploads: (companyId: string, draftId: string, ids: string[]) =>
    api.post<{ uploads: BulkUploadRow[] }>(
      `${base(companyId)}/drafts/${draftId}/reorder`,
      { ids },
    ),

  importDesignRun: (companyId: string, draftId: string, designRunId: string) =>
    api.post<{ uploads: BulkUploadRow[]; designRunId: string }>(
      `${base(companyId)}/drafts/${draftId}/import-design-run`,
      { designRunId },
    ),

  bestTimes: (companyId: string, platform: string) =>
    api.get<BestTimeResult>(
      `${base(companyId)}/best-times?platform=${encodeURIComponent(platform)}`,
    ),

  preview: (companyId: string, draftId: string, strategy: ScheduleStrategy) =>
    api.post<PreviewResponse>(
      `${base(companyId)}/drafts/${draftId}/preview`,
      { strategy },
    ),

  commit: (companyId: string, draftId: string, strategy: ScheduleStrategy) =>
    api.post<CommitResponse>(
      `${base(companyId)}/drafts/${draftId}/commit`,
      { strategy },
    ),
};

export interface BestTimeSlot {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hour: number;
  score: number;
}

export interface BestTimeResult {
  platform: string;
  source: "your-audience-30d" | "industry-2026" | "fallback";
  slots: BestTimeSlot[];
  detail?: string;
}

export interface EvenSpreadConfig {
  kind: "even";
  startDate: string;
  dayCount: number;
  postsPerDayPerPlatform: number;
}
export interface BestTimesConfig {
  kind: "best-times";
  startDate: string;
}
export interface CustomQueueSlot {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hour: number;
  minute: number;
}
export interface CustomQueueConfig {
  kind: "custom-queue";
  startDate: string;
  perPlatform: Record<string, CustomQueueSlot[]>;
}
export type ScheduleStrategy =
  | EvenSpreadConfig
  | BestTimesConfig
  | CustomQueueConfig;

export interface PreviewItem {
  uploadId: string;
  platform: string;
  scheduledAt: string;
}
export interface PreviewResponse {
  items: PreviewItem[];
  unscheduled: Array<{ uploadId: string; platform: string; reason: string }>;
}
export interface CommitResponse {
  committed: Array<{
    uploadId: string;
    platform: string;
    postId: string;
    scheduledAt: string;
  }>;
  unscheduled: Array<{ uploadId: string; platform: string; reason: string }>;
  errors: Array<{ uploadId: string; platform: string; reason: string }>;
}
