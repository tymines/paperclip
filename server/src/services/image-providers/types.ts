/**
 * Image/video provider abstraction.
 *
 * Paperclip's Image Studio originally spoke only to Replicate. Tyler wants to
 * A/B the same persona prompt across multiple hosted providers (Replicate vs
 * Atlas Cloud vs WaveSpeed AI) to find which produces the best results, so the
 * inference surface is factored behind a uniform `ImageProvider` interface —
 * one module per provider under this directory.
 *
 * Each provider reads its bearer token from the shared provider-api-keys store
 * (~/.paperclip/provider-api-keys.json) and exposes a submit → poll → download
 * lifecycle the generator worker drives provider-agnostically.
 */
import type { ProviderKey } from "../provider-api-keys/index.js";

/** The three wired inference hosts. Mirrors generation_jobs.provider_host. */
export type ProviderHost = "replicate" | "atlascloud" | "wavespeedai";

export const PROVIDER_HOSTS: ProviderHost[] = ["replicate", "atlascloud", "wavespeedai"];

export function isProviderHost(value: unknown): value is ProviderHost {
  return typeof value === "string" && (PROVIDER_HOSTS as string[]).includes(value);
}

/** A single LoRA weight reference (WaveSpeed supports up to 4 simultaneously). */
export interface LoraWeight {
  /** HF repo id or a public .safetensors URL the provider can fetch. */
  path: string;
  scale?: number;
}

/** One selectable model in a provider's catalog (for the picker + cost preview). */
export interface ModelInfo {
  /** Provider-native model id (e.g. "bytedance/seedream-v5.0-lite"). */
  id: string;
  name: string;
  /** Image vs video output — drives the gallery + cost unit. */
  kind: "image" | "video";
  /** Rough USD cost per render. For video this is per-second (see costUnit). */
  costPerUnit: number;
  costUnit: "image" | "second";
  /** Whether the model accepts LoRA weights. */
  lora: boolean;
  /** Whether the model can run without a safety checker (NSFW-capable). */
  nsfw: boolean;
  /** The single ⭐ Recommended pick within this provider. */
  recommended?: boolean;
  /** Short why-pick-this note for the UI. */
  note?: string;
}

/** Normalised inference request. Each provider maps this onto its own schema. */
export interface GenerateParams {
  prompt: string;
  /** Provider-native model id. Falls back to the provider's default when unset. */
  model?: string;
  aspectRatio?: string;
  steps?: number;
  guidance?: number;
  seed?: number | null;
  loraScale?: number;
  /** Extra LoRA stack (WaveSpeed multi-LoRA). */
  loras?: LoraWeight[];
  /** Input image (data URI or URL) for image-to-video / edit models. */
  image?: string;
  /** Turn off the provider's safety checker (explicit personas). */
  disableSafety?: boolean;
  // ── Replicate persona targeting (no portable weights URL — the persona's
  //    LoRA IS its own published model). ──
  /** owner/name of the persona's published Replicate model. */
  modelRef?: string;
  /** Pinned version SHA of that model. */
  versionSha?: string;
}

export type PredictionState =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export interface PredictionStatus {
  id: string;
  status: PredictionState;
  /** First output asset URL once succeeded; null until then. */
  outputUrl: string | null;
  error?: string | null;
  /** Provider-reported actual cost in USD, when available. */
  costUsd?: number | null;
}

export interface VerifyResult {
  ok: boolean;
  /** Human-readable status (account name, balance summary, …). */
  detail?: string;
  /** Remaining credit in USD when the provider exposes it. */
  balanceUsd?: number | null;
  error?: string;
}

/**
 * Uniform provider interface. The generator worker submits a job, polls it to
 * completion, and downloads the output — without knowing which host it hit.
 */
export interface ImageProvider {
  id: ProviderHost;
  name: string;
  /** Brand chip color (hex) for the UI provider badge. */
  color: string;
  /** Key in the provider-api-keys store. */
  tokenKey: ProviderKey;

  /** True when a token is configured (does not hit the network). */
  isConfigured(): Promise<boolean>;
  /** Hit a real authenticated endpoint; report reachability + balance. */
  verify(): Promise<VerifyResult>;
  /** Catalog of selectable models for the picker. */
  listModels(): Promise<ModelInfo[]>;
  /** The default model id used for persona image generation. */
  defaultModel(): string;

  submitGeneration(params: GenerateParams): Promise<{ predictionId: string }>;
  pollPrediction(id: string): Promise<PredictionStatus>;
  /** Fetch an output asset (image/video) by its URL into a Buffer. */
  downloadOutput(url: string): Promise<Buffer>;

  // ── LoRA training (optional capability) ──────────────────────────────────
  // Not every host can TRAIN a LoRA. Replicate (ostris/flux-dev-lora-trainer)
  // and WaveSpeed (wavespeed-ai/flux-dev-lora-trainer) can; Atlas Cloud only
  // runs pre-trained LoRAs (inference), so it omits these. The persona-training
  // runner checks `listTrainers` / `submitLoraTraining` presence before use.

  /** LoRA trainers this provider offers. Omit/empty = training unsupported. */
  listTrainers?(): TrainerInfo[];
  /** Submit a LoRA training run from a zip of images. */
  submitLoraTraining?(params: LoraTrainingSubmit): Promise<LoraTrainingHandle>;
  /** Poll a training run; weightsUrl is set once the .safetensors is ready. */
  pollTraining?(externalId: string): Promise<LoraTrainingStatus>;
  /** Best-effort cancel (may no-op if the run is already terminal). */
  cancelTraining?(externalId: string): Promise<void>;
}

/** One selectable LoRA trainer in a provider's catalog (for the wizard picker). */
export interface TrainerInfo {
  /** Provider-native trainer model id (e.g. "wavespeed-ai/flux-dev-lora-trainer"). */
  id: string;
  name: string;
  /** Rough USD cost for one training run. */
  costEstimateUsd: number;
  /** Rough end-to-end wall time in minutes. */
  etaMinutes: number;
  defaultSteps: number;
  defaultRank: number;
  /** The single ⭐ Recommended trainer across all providers. */
  recommended?: boolean;
  /** Can train explicit personas (no SFW-only restriction). */
  nsfw?: boolean;
  note?: string;
}

/** Normalised LoRA training request. Each provider maps this onto its own API. */
export interface LoraTrainingSubmit {
  /** Which trainer model (from listTrainers). */
  trainerId: string;
  /** LoRA trigger word baked into the trained model. */
  triggerWord: string;
  /** Zip of training images. */
  zip: Buffer;
  zipFilename: string;
  steps?: number;
  loraRank?: number;
  /**
   * Where the host should publish the trained model (owner/name). Required by
   * Replicate (push-to-model); ignored by hosts that return a weights URL.
   */
  destination?: string;
}

export interface LoraTrainingHandle {
  /** Provider-native training/prediction id used for polling. */
  externalId: string;
  /** Published model owner/name when the host publishes one (Replicate). */
  destinationModel?: string | null;
}

export interface LoraTrainingStatus {
  id: string;
  status: PredictionState;
  /** URL of the trained .safetensors once succeeded; null until then. */
  weightsUrl: string | null;
  error?: string | null;
  costUsd?: number | null;
}

/** Map an aspect ratio onto concrete pixel dimensions (Atlas/WaveSpeed need W×H). */
export function aspectToDimensions(
  aspectRatio: string | null | undefined,
  base = 1024,
): { width: number; height: number } {
  switch (aspectRatio) {
    case "3:4":
      return { width: 896, height: 1152 };
    case "4:3":
      return { width: 1152, height: 896 };
    case "9:16":
      return { width: 768, height: 1344 };
    case "16:9":
      return { width: 1344, height: 768 };
    case "2:3":
      return { width: 832, height: 1216 };
    case "3:2":
      return { width: 1216, height: 832 };
    case "1:1":
    default:
      return { width: base, height: base };
  }
}
