import { api } from "./client";

export interface ImageProvider {
  id: string;
  companyId: string | null;
  name: string;
  type: "local_lora" | "external_api";
  providerKey: string | null;
  endpoint: string | null;
  model: string | null;
  defaultParams: Record<string, unknown> | null;
  costPerUnit: string;
  status: string | null;
  statusDetail: string | null;
  trainingCapable: boolean;
  trainingModel: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type TrainingStatus =
  | "pending"
  | "uploading"
  | "training"
  | "downloading"
  | "ready"
  | "failed";

export interface LoraTrainingJob {
  id: string;
  companyId: string | null;
  personaId: string;
  providerId: string;
  status: TrainingStatus;
  contentRating: "sfw" | "explicit";
  externalJobId: string | null;
  trainingZipPath: string | null;
  outputLoraPath: string | null;
  triggerWord: string | null;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  costUsd: string | null;
  errorMessage: string | null;
  hyperparams: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaPhotos {
  dir: string;
  exists: boolean;
  count: number;
  triggerWord: string;
  contentRating: "sfw" | "explicit";
}

export type GenerationSource = "test" | "production";

export interface PersonaGeneration {
  id: string;
  personaId: string;
  source: GenerationSource;
  prompt: string | null;
  loraStrength: string | null;
  model: string | null;
  imagePath: string;
  thumbnailPath: string | null;
  generationMetadata: Record<string, unknown> | null;
  replicatePredictionId: string | null;
  costUsd: string | null;
  contentRating: "sfw" | "explicit";
  createdAt: string;
}

/** Build a public URL for an uploads-relative media path. */
export function uploadUrl(relPath: string): string {
  return `/api/uploads/${relPath.replace(/^\/+/, "")}`;
}

export const imageStudioApi = {
  /** List all image providers for a company */
  listProviders: (companyId: string) =>
    api.get<{ providers: ImageProvider[] }>(`/companies/${companyId}/image-studio/providers`),

  /** Create a new provider */
  createProvider: (companyId: string, opts: {
    name: string;
    type?: "local_lora" | "external_api";
    providerKey?: string;
    endpoint?: string;
    model?: string;
    defaultParams?: Record<string, unknown>;
    costPerUnit?: string;
    status?: string;
    statusDetail?: string;
  }) =>
    api.post<{ provider: ImageProvider }>(`/companies/${companyId}/image-studio/providers`, opts),

  /** Update a provider */
  updateProvider: (companyId: string, providerId: string, opts: Partial<ImageProvider>) =>
    api.patch<{ provider: ImageProvider }>(
      `/companies/${companyId}/image-studio/providers/${providerId}`,
      opts,
    ),

  /** Delete a provider */
  deleteProvider: (companyId: string, providerId: string) =>
    api.delete<{ provider: ImageProvider }>(
      `/companies/${companyId}/image-studio/providers/${providerId}`,
    ),

  /** Read the training photos directory + image count for a persona */
  getPersonaPhotos: (companyId: string, personaId: string) =>
    api.get<PersonaPhotos>(
      `/companies/${companyId}/image-studio/personas/${personaId}/photos`,
    ),

  /** Kick off a training run for a persona. Returns 202 with the job. */
  trainPersona: (
    companyId: string,
    personaId: string,
    opts: { provider_id: string; training_photos_dir?: string },
  ) =>
    api.post<{
      job: LoraTrainingJob;
      photos: PersonaPhotos;
      estimatedCostUsd: number;
      estimatedMinutes: number;
      note: string;
    }>(`/companies/${companyId}/image-studio/personas/${personaId}/train`, opts),

  /** Poll a single training job (server polls Replicate on read). */
  getTrainingJob: (companyId: string, jobId: string) =>
    api.get<{ job: LoraTrainingJob; pollError?: string }>(
      `/companies/${companyId}/image-studio/training/${jobId}`,
    ),

  /** List recent training jobs for a company (newest first). */
  listTrainingJobs: (companyId: string) =>
    api.get<{ jobs: LoraTrainingJob[] }>(
      `/companies/${companyId}/image-studio/training`,
    ),

  /** List a persona's gallery generations (newest first). */
  listGenerations: (
    personaId: string,
    opts?: { source?: GenerationSource; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.source) params.set("source", opts.source);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<{ generations: PersonaGeneration[] }>(
      `/image-studio/personas/${personaId}/generations${qs ? `?${qs}` : ""}`,
    );
  },

  /** Insert a generation into a persona's gallery (future inference results). */
  createGeneration: (
    personaId: string,
    body: {
      image_path: string;
      thumbnail_path?: string;
      source?: GenerationSource;
      prompt?: string;
      lora_strength?: number;
      model?: string;
      generation_metadata?: Record<string, unknown>;
      replicate_prediction_id?: string;
      cost_usd?: number;
      content_rating?: "sfw" | "explicit";
    },
  ) =>
    api.post<{ generation: PersonaGeneration }>(
      `/image-studio/personas/${personaId}/generations`,
      body,
    ),

  /** Delete a generation (prune a bad output). */
  deleteGeneration: (id: string) =>
    api.delete<{ generation: PersonaGeneration }>(
      `/image-studio/generations/${id}`,
    ),
};
