import { api } from "./client";

export interface StartBookWritingPayload {
  concept: string;
  genre: string;
  length: string;
  tone: string;
  authorName?: string;
}

export interface PipelineStatus {
  pipelineId: string;
  phase: "idle" | "foundation" | "drafting" | "revision" | "export" | "done" | "failed";
  stepLabel: string;
  iteration: number;
  estimatedMinutesRemaining: number;
  score: number | null;
  scoreHistory: number[];
  logLines: string[];
  error?: string;
  completedAt?: string;
}

export interface PipelineArtifact {
  type: "pdf" | "epub" | "audiobook" | "landing-page" | "cover";
  label: string;
  url: string;
  fileSize: number;
}

export interface PipelineResult {
  pipelineId: string;
  artifacts: PipelineArtifact[];
  wordCount: number;
  coverThumbnail?: string;
}

export interface StartPipelineResponse {
  success: boolean;
  pipelineId: string;
  message: string;
}

export const bookWritingApi = {
  start: (companyId: string, body: StartBookWritingPayload): Promise<StartPipelineResponse> =>
    api.post(`/companies/${companyId}/book-writing/start`, body),

  status: (companyId: string, pipelineId: string): Promise<PipelineStatus> =>
    api.get(`/companies/${companyId}/book-writing/status/${pipelineId}`),

  artifacts: (companyId: string, pipelineId: string): Promise<PipelineResult> =>
    api.get(`/companies/${companyId}/book-writing/artifacts/${pipelineId}`),

  cancel: (companyId: string, pipelineId: string): Promise<{ success: boolean; message: string }> =>
    api.post(`/companies/${companyId}/book-writing/cancel/${pipelineId}`, {}),
};
