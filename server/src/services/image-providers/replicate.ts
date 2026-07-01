/**
 * Replicate provider — the original (and default) Image Studio inference host.
 *
 * Wraps the existing services/replicate HTTP client behind the uniform
 * ImageProvider interface. Persona generation targets the persona's OWN
 * published model by version SHA (the LoRA baked into Flux dev — there is no
 * portable weights URL), so the generator resolves modelRef/versionSha and
 * passes them through GenerateParams.
 */
import type {
  GenerateParams,
  ImageProvider,
  ModelInfo,
  PredictionStatus,
  PredictionState,
  VerifyResult,
  TrainerInfo,
  LoraTrainingSubmit,
  LoraTrainingHandle,
  LoraTrainingStatus,
} from "./types.js";
import {
  getReplicateToken,
  getReplicateAccount,
  createReplicatePrediction,
  createReplicatePredictionByVersion,
  getReplicatePrediction,
  extractOutputUrl,
  getLatestTrainerVersion,
  uploadReplicateFile,
  ensureReplicateModel,
  createReplicateTraining,
  getReplicateTraining,
  cancelReplicateTraining,
  extractWeightsUrl,
} from "../replicate/index.js";

const REPLICATE_TRAINER_ID = "ostris/flux-dev-lora-trainer";

function mapReplicateTrainState(raw: string | undefined): PredictionState {
  switch (raw) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "processing":
      return "processing";
    default:
      return "starting";
  }
}

/** Public flux LoRA inference model (used when no persona version SHA is given). */
const DEFAULT_MODEL =
  process.env.REPLICATE_INFERENCE_MODEL ?? "black-forest-labs/flux-dev-lora";

/** Replicate predict-time → USD (H100 rate, matches the existing generator). */
const PREDICT_USD_PER_SEC = 0.001525;

function buildInput(params: GenerateParams): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: params.prompt,
    model: "dev",
    lora_scale: params.loraScale ?? 1.0,
    num_inference_steps: params.steps ?? 28,
    guidance_scale: params.guidance ?? 3.5,
    aspect_ratio: params.aspectRatio ?? "1:1",
    output_format: "png",
    output_quality: 95,
    num_outputs: 1,
  };
  if (params.seed != null) input.seed = params.seed;
  if (params.disableSafety) input.disable_safety_checker = true;
  // Stack a second LoRA in the same prediction (e.g. XLabs realism over a
  // persona LoRA). Both fields are in the flux-dev-lora input schema.
  if (params.extraLora) {
    input.extra_lora = params.extraLora;
    input.extra_lora_scale = params.extraLoraScale ?? 1.0;
  }
  return input;
}

export const replicateProvider: ImageProvider = {
  id: "replicate",
  name: "Replicate",
  color: "#ec4899", // pink/orange — Replicate brand
  tokenKey: "replicate",

  async isConfigured() {
    return (await getReplicateToken()) != null;
  },

  async verify(): Promise<VerifyResult> {
    const account = await getReplicateAccount();
    if (!account?.username) {
      return { ok: false, error: "Replicate token missing or invalid (GET /account failed)." };
    }
    // Replicate exposes no programmatic credit balance — show the account name.
    return { ok: true, detail: `Authenticated as ${account.username}`, balanceUsd: null };
  },

  async listModels(): Promise<ModelInfo[]> {
    return [
      {
        id: "persona-lora",
        name: "Persona LoRA (General)",
        kind: "image",
        costPerUnit: 0.04,
        costUnit: "image",
        lora: true,
        nsfw: true,
        recommended: true,
        note: "Tested best quality on Sidney — renders through this persona's trained LoRA.",
      },
      {
        id: DEFAULT_MODEL,
        name: "Flux Dev LoRA",
        kind: "image",
        costPerUnit: 0.04,
        costUnit: "image",
        lora: true,
        nsfw: true,
        note: "Base flux-dev-lora inference.",
      },
    ];
  },

  defaultModel() {
    return "persona-lora";
  },

  async submitGeneration(params: GenerateParams): Promise<{ predictionId: string }> {
    const input = buildInput(params);
    const prediction = params.versionSha
      ? await createReplicatePredictionByVersion(params.versionSha, input)
      : await createReplicatePrediction(params.modelRef ?? DEFAULT_MODEL, input);
    return { predictionId: prediction.id };
  },

  async pollPrediction(id: string): Promise<PredictionStatus> {
    const p = await getReplicatePrediction(id);
    const seconds = p.metrics?.predict_time ?? p.metrics?.total_time;
    return {
      id: p.id,
      status: p.status,
      outputUrl: extractOutputUrl(p),
      error: p.error ?? null,
      costUsd: seconds ? Number((seconds * PREDICT_USD_PER_SEC).toFixed(4)) : null,
    };
  },

  async downloadOutput(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Replicate output download failed (${res.status}) from ${url}`);
    return Buffer.from(await res.arrayBuffer());
  },

  // ── LoRA training (ostris/flux-dev-lora-trainer) ──────────────────────────

  listTrainers(): TrainerInfo[] {
    return [
      {
        id: REPLICATE_TRAINER_ID,
        name: "Flux Dev LoRA Trainer",
        costEstimateUsd: 1.58,
        etaMinutes: 17,
        defaultSteps: 1500,
        defaultRank: 16,
        nsfw: true,
        note: "Proven on Sidney — highest face fidelity. Publishes a private model you own.",
      },
    ];
  },

  async submitLoraTraining(params: LoraTrainingSubmit): Promise<LoraTrainingHandle> {
    const token = await getReplicateToken();
    if (!token) throw new Error("Replicate token not set.");
    if (!params.destination) {
      throw new Error("Replicate training requires a destination model (owner/name).");
    }
    const [owner, name] = params.destination.split("/");
    if (!owner || !name) throw new Error(`Invalid destination '${params.destination}'.`);

    const inputImages = await uploadReplicateFile(params.zip, params.zipFilename, token);
    await ensureReplicateModel(owner, name, token);
    const version = await getLatestTrainerVersion(token);
    const training = await createReplicateTraining({
      inputImages,
      triggerWord: params.triggerWord,
      destination: params.destination,
      steps: params.steps ?? 1500,
      loraRank: params.loraRank ?? 16,
      batchSize: 1,
      autocaption: true,
      version,
    });
    return { externalId: training.id, destinationModel: params.destination };
  },

  async pollTraining(externalId: string): Promise<LoraTrainingStatus> {
    const t = await getReplicateTraining(externalId);
    const seconds = t.metrics?.total_time ?? t.metrics?.predict_time;
    return {
      id: externalId,
      status: mapReplicateTrainState(t.status),
      weightsUrl: extractWeightsUrl(t),
      error: t.error ?? null,
      costUsd: seconds ? Number((seconds * PREDICT_USD_PER_SEC).toFixed(4)) : null,
    };
  },

  async cancelTraining(externalId: string): Promise<void> {
    await cancelReplicateTraining(externalId);
  },
};
