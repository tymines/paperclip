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
  bio: string | null;
  attributes: Record<string, unknown> | null;
  costPerUnit: string;
  status: string | null;
  statusDetail: string | null;
  trainingCapable: boolean;
  trainingModel: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Structured attribute controls ──────────────────────────────────────────

export type ControlType = "toggle" | "slider" | "swatch" | "card_grid";
export type AttributeCategory =
  | "identity"
  | "body"
  | "face"
  | "pose"
  | "wardrobe"
  | "scene"
  | "lighting";

export interface AttributeOption {
  id: number;
  controlId: number;
  value: string;
  label: string;
  promptFragment: string;
  previewImagePath: string | null;
  sortOrder: number;
  enabled: boolean;
  contentRating: "sfw" | "explicit";
}

export interface AttributeControl {
  id: number;
  key: string;
  label: string;
  controlType: ControlType;
  category: AttributeCategory;
  promptTemplate: string;
  helperText: string | null;
  sortOrder: number;
  applicableTo: string[] | null;
  enabled: boolean;
  options: AttributeOption[];
}

export type Selections = Record<string, string>;

export interface PromptConflict {
  controlKey: string;
  controlLabel: string;
  selectedValue: string;
  selectedLabel: string;
  conflictingLabel: string;
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

export interface PromptTemplate {
  id: string;
  name: string;
  description: string | null;
  personaId: string | null;
  templateText: string;
  defaultLoraScale: string | null;
  defaultSteps: number | null;
  defaultGuidance: string | null;
  defaultAspectRatio: string | null;
  contentRating: "sfw" | "explicit";
  tags: string[] | null;
  attributePreset: Record<string, string> | null;
  previewImagePath: string | null;
  category: string | null;
  genderTargeting: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GenerationJobStatus =
  | "queued"
  | "submitted"
  | "polling"
  | "succeeded"
  | "failed";

export interface GenerationJob {
  id: string;
  personaId: string;
  promptTemplateId: string | null;
  batchId: string;
  promptText: string;
  loraScale: string | null;
  steps: number | null;
  guidance: string | null;
  aspectRatio: string | null;
  seed: number | null;
  status: GenerationJobStatus;
  replicatePredictionId: string | null;
  outputPath: string | null;
  contentRating: "sfw" | "explicit";
  costUsd: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface GenerateBatchBody {
  prompt_text?: string;
  /** Structured-control mode: clicked attributes compiled by the assembler. */
  selections?: Selections;
  freeText?: string;
  lora_scale?: number;
  steps?: number;
  guidance?: number;
  aspect_ratio?: string;
  seed?: number | null;
  count?: number;
  prompt_template_id?: string | null;
  content_rating?: "sfw" | "explicit";
}

export interface PhotoShootCategory {
  templateId: string;
  count: number;
}

export interface BatchGenerateBody {
  categories: PhotoShootCategory[];
  shared_selections?: Selections;
  seed?: number | null;
  content_rating?: "sfw" | "explicit";
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

  /** Fire a batch generation. Returns the batch id + queued job ids. */
  generateBatch: (personaId: string, body: GenerateBatchBody) =>
    api.post<{ batch_id: string; job_ids: string[]; prompt?: string }>(
      `/image-studio/personas/${personaId}/generate`,
      body,
    ),

  /** PhotoShoot: fire N categories × per-category quantity as one batch. */
  batchGenerate: (personaId: string, body: BatchGenerateBody) =>
    api.post<{ batch_id: string; job_ids: string[]; total: number }>(
      `/image-studio/personas/${personaId}/batch-generate`,
      body,
    ),

  /** The data-driven structured-control catalog for the Generate panel. */
  getAttributeControls: (opts?: {
    category?: string;
    contentRating?: "sfw" | "explicit";
  }) => {
    const params = new URLSearchParams();
    if (opts?.category) params.set("category", opts.category);
    if (opts?.contentRating) params.set("content_rating", opts.contentRating);
    const qs = params.toString();
    return api.get<{ controls: AttributeControl[] }>(
      `/image-studio/attribute-controls${qs ? `?${qs}` : ""}`,
    );
  },

  /** Assemble the live prompt for a persona's current selections + free text. */
  previewPrompt: (
    personaId: string,
    body: { selections?: Selections; freeText?: string },
  ) =>
    api.post<{ prompt: string; conflicts: PromptConflict[] }>(
      `/image-studio/personas/${personaId}/preview-prompt`,
      body,
    ),

  /** Edit a persona's long-form bio + structured attribute defaults. */
  updatePersona: (
    personaId: string,
    body: { bio?: string | null; attributes?: Record<string, unknown> },
  ) =>
    api.patch<{ provider: ImageProvider }>(
      `/image-studio/personas/${personaId}`,
      body,
    ),

  /** Poll all jobs in a batch with current status. */
  getBatch: (personaId: string, batchId: string) =>
    api.get<{ jobs: GenerationJob[] }>(
      `/image-studio/personas/${personaId}/generations/batch/${batchId}`,
    ),

  /** List a persona's prompt templates + shared (persona_id NULL) templates. */
  listPromptTemplates: (
    personaId: string,
    opts?: { category?: string; contentRating?: "sfw" | "explicit" },
  ) => {
    const params = new URLSearchParams();
    if (opts?.category) params.set("category", opts.category);
    if (opts?.contentRating) params.set("content_rating", opts.contentRating);
    const qs = params.toString();
    return api.get<{ templates: PromptTemplate[] }>(
      `/image-studio/personas/${personaId}/prompt-templates${qs ? `?${qs}` : ""}`,
    );
  },

  /** Save a new prompt template for a persona. */
  createPromptTemplate: (
    personaId: string,
    body: {
      name: string;
      template_text: string;
      description?: string;
      default_lora_scale?: number;
      default_steps?: number;
      default_guidance?: number;
      default_aspect_ratio?: string;
      content_rating?: "sfw" | "explicit";
      tags?: string[];
      attribute_preset?: Record<string, string>;
      category?: string;
      gender_targeting?: string;
      preview_image_path?: string;
    },
  ) =>
    api.post<{ template: PromptTemplate }>(
      `/image-studio/personas/${personaId}/prompt-templates`,
      body,
    ),

  /** Update a prompt template. */
  updatePromptTemplate: (id: string, body: Partial<Record<string, unknown>>) =>
    api.patch<{ template: PromptTemplate }>(
      `/image-studio/prompt-templates/${id}`,
      body,
    ),

  /** Delete a prompt template. */
  deletePromptTemplate: (id: string) =>
    api.delete<{ template: PromptTemplate }>(
      `/image-studio/prompt-templates/${id}`,
    ),
};
