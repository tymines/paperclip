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
  // Persona CMS (0123)
  groupId: string | null;
  avatarPath: string | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaGroup {
  id: string;
  companyId: string | null;
  name: string;
  color: string | null;
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

export interface ContentIdea {
  title: string;
  caption: string;
  suggestedHashtags: string[];
}

export interface SocialPost {
  id: string;
  companyId: string;
  title: string | null;
  content: string;
  postType: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  mediaUrls: string[];
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

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

export interface TrainerInfo {
  id: string;
  name: string;
  costEstimateUsd: number;
  etaMinutes: number;
  defaultSteps: number;
  defaultRank: number;
  recommended?: boolean;
  nsfw?: boolean;
  note?: string;
}

export interface TrainerProviderGroup {
  host: string;
  name: string;
  color: string;
  configured: boolean;
  trainers: TrainerInfo[];
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
  previewImagePaths: string[] | null;
  category: string | null;
  genderTargeting: string | null;
  applicableTools: string[] | null;
  compatibleModels: string[] | null;
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

export type ProviderHost = "replicate" | "atlascloud" | "wavespeedai";

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
  /** Which hosted provider to render on (default 'replicate'). */
  provider_host?: ProviderHost;
  /** Provider-native model id; null = the provider's default. */
  model?: string | null;
}

/** Status of one hosted provider (token + balance + rate limits). */
export interface ProviderHostStatus {
  host: ProviderHost;
  name: string;
  color: string;
  configured: boolean;
  verified: boolean;
  detail: string | null;
  error: string | null;
  balanceUsd: number | null;
  rateLimit: string;
  modelCount: number;
  isDefault: boolean;
}

export interface CompareResult {
  batch_id: string;
  prompt: string;
  providers: ProviderHost[];
  jobs_by_provider: Record<string, string[]>;
  total: number;
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
    opts: {
      provider_host?: string;
      trainer?: string;
      provider_id?: string;
      training_photos_dir?: string;
    },
  ) =>
    api.post<{
      job: LoraTrainingJob;
      photos: PersonaPhotos;
      provider?: string;
      trainer?: string;
      estimatedCostUsd: number;
      estimatedMinutes: number;
      note: string;
    }>(`/companies/${companyId}/image-studio/personas/${personaId}/train`, opts),

  /** Provider-grouped LoRA trainer catalog for the wizard picker. */
  listTrainers: () =>
    api.get<{ providers: TrainerProviderGroup[] }>(`/image-studio/trainers`),

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

  /** Fire the same prompt across every configured provider for side-by-side A/B. */
  generateCompare: (personaId: string, body: GenerateBatchBody & { providers?: ProviderHost[] }) =>
    api.post<CompareResult>(
      `/image-studio/personas/${personaId}/generate-compare`,
      body,
    ),

  /** The 3 hosted providers with token status, balance, and rate limits. */
  getProviderHosts: () =>
    api.get<{ providers: ProviderHostStatus[] }>(`/image-studio/providers`),

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

  /** Unified, cross-tool template browser. */
  listTemplates: (opts?: {
    tool?: string;
    model?: string;
    contentRating?: "sfw" | "explicit";
    personaId?: string;
    tags?: string[];
  }) => {
    const params = new URLSearchParams();
    if (opts?.tool) params.set("tool", opts.tool);
    if (opts?.model) params.set("model", opts.model);
    if (opts?.contentRating) params.set("content_rating", opts.contentRating);
    if (opts?.personaId) params.set("persona_id", opts.personaId);
    if (opts?.tags?.length) params.set("tags", opts.tags.join(","));
    const qs = params.toString();
    return api.get<{ templates: PromptTemplate[] }>(
      `/image-studio/templates${qs ? `?${qs}` : ""}`,
    );
  },

  /** Apply a template to a chosen tool/model/persona → assembled prompt + params. */
  applyTemplate: (
    id: string,
    body: { tool: string; model: string; persona_id?: string | null },
  ) =>
    api.post<{
      prompt: string;
      template_text: string;
      attribute_preset: Record<string, string>;
      tool: string;
      model: string;
      persona_id: string | null;
      params: { lora_scale: number; steps: number; guidance: number; aspect_ratio: string };
    }>(`/image-studio/templates/${id}/apply`, body),

  /** Female Undresser tool — stub until the generation backend lands. */
  femaleUndresserGenerate: (body: Record<string, unknown>) =>
    api.post<{ status: string; message: string }>(
      `/image-studio/tools/female-undresser/generate`,
      body,
    ),

  /** Fetch a single persona by id (detail page / deep-links). */
  getPersona: (personaId: string) =>
    api.get<{ provider: ImageProvider }>(`/image-studio/personas/${personaId}`),

  /** Edit a persona — bio, attributes, name, group, avatar, favorite, sort. */
  updatePersona: (
    personaId: string,
    body: {
      bio?: string | null;
      attributes?: Record<string, unknown>;
      name?: string;
      group_id?: string | null;
      avatar_path?: string | null;
      is_favorite?: boolean;
      sort_order?: number;
    },
  ) =>
    api.patch<{ provider: ImageProvider }>(
      `/image-studio/personas/${personaId}`,
      body,
    ),

  /** Create a new (untrained) persona under a company. */
  createPersona: (
    companyId: string,
    body: {
      name: string;
      bio?: string | null;
      attributes?: Record<string, unknown>;
      group_id?: string | null;
      avatar_path?: string | null;
      is_favorite?: boolean;
    },
  ) =>
    api.post<{ provider: ImageProvider }>(
      `/companies/${companyId}/image-studio/personas`,
      body,
    ),

  /** Persona folders (groups) for the Personas management surface. */
  listPersonaGroups: (companyId: string) =>
    api.get<{ groups: PersonaGroup[] }>(
      `/companies/${companyId}/image-studio/persona-groups`,
    ),
  createPersonaGroup: (companyId: string, body: { name: string; color?: string | null }) =>
    api.post<{ group: PersonaGroup }>(
      `/companies/${companyId}/image-studio/persona-groups`,
      body,
    ),
  updatePersonaGroup: (
    companyId: string,
    groupId: string,
    body: { name?: string; color?: string | null; sort_order?: number },
  ) =>
    api.patch<{ group: PersonaGroup }>(
      `/companies/${companyId}/image-studio/persona-groups/${groupId}`,
      body,
    ),
  deletePersonaGroup: (companyId: string, groupId: string) =>
    api.delete<{ group: PersonaGroup }>(
      `/companies/${companyId}/image-studio/persona-groups/${groupId}`,
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

  /** Generate AI content ideas for a persona */
  generateContent: (companyId: string, personaId: string, body: { topic: string; count?: number }) =>
    api.post<{ ideas: ContentIdea[] }>(
      `/companies/${companyId}/image-studio/personas/${personaId}/generate-content`,
      body,
    ),

  /** Schedule a draft social post for a persona */
  schedulePost: (companyId: string, personaId: string, body: { caption: string; imagePath?: string; scheduledAt?: string }) =>
    api.post<{ post: SocialPost }>(
      `/companies/${companyId}/image-studio/personas/${personaId}/schedule-post`,
      body,
    ),

  /** List drafts for a company, optional persona filter */
  listDrafts: (companyId: string, personaId?: string) => {
    const params = new URLSearchParams();
    if (personaId) params.set("personaId", personaId);
    const qs = params.toString();
    return api.get<{ drafts: SocialPost[] }>(
      `/companies/${companyId}/influencer/drafts${qs ? `?${qs}` : ""}`,
    );
  },
};
