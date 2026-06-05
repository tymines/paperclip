/**
 * WaveSpeed AI provider — fast, cheap, NSFW-friendly image + video host with
 * multi-LoRA support (up to 4 LoRAs simultaneously on flux-dev-lora).
 *
 * Verified API surface (2026-06-04, live):
 *   base    https://api.wavespeed.ai
 *   auth    Authorization: Bearer wsk_live_…
 *   balance GET  /api/v3/balance → { data:{ balance:<usd> } }
 *   submit  POST /api/v3/{model_id}
 *             body { prompt, size:"W*H", num_inference_steps, seed?, guidance_scale?,
 *                    loras:[{path,scale}] (max 4), image?, num_images?, output_format? }
 *             → { code:200, data:{ id, urls:{ get }, status:"created" } }
 *   poll    GET  /api/v3/predictions/{id}/result
 *             → { data:{ status:"created"|"processing"|"completed"|"failed",
 *                        outputs:["<url>"], executionTime } }
 */
import type {
  GenerateParams,
  ImageProvider,
  ModelInfo,
  PredictionState,
  PredictionStatus,
  VerifyResult,
  TrainerInfo,
  LoraTrainingSubmit,
  LoraTrainingHandle,
  LoraTrainingStatus,
} from "./types.js";
import { aspectToDimensions } from "./types.js";
import { getRawKey } from "../provider-api-keys/index.js";

const BASE = "https://api.wavespeed.ai";

/** Max LoRAs WaveSpeed flux-dev-lora accepts in one request. */
export const MAX_LORAS = 4;

const CATALOG: ModelInfo[] = [
  {
    id: "wavespeed-ai/flux-dev",
    name: "Flux Dev (Ultra Fast)",
    kind: "image",
    costPerUnit: 0.012,
    costUnit: "image",
    lora: false,
    nsfw: true,
    recommended: true,
    note: "Cheap, ~1s renders — WaveSpeed default for A/B.",
  },
  {
    id: "wavespeed-ai/flux-dev-lora",
    name: "Flux Dev LoRA (multi)",
    kind: "image",
    costPerUnit: 0.02,
    costUnit: "image",
    lora: true,
    nsfw: true,
    note: "Stack up to 4 LoRAs simultaneously.",
  },
  {
    id: "wavespeed-ai/wan-2.2/t2v-480p-ultra-fast",
    name: "WAN 2.2 T2V (Ultra Fast)",
    kind: "video",
    costPerUnit: 0.02,
    costUnit: "second",
    lora: false,
    nsfw: true,
    note: "Cheap burst text-to-video.",
  },
  {
    id: "wavespeed-ai/wan-2.2/i2v-720p-ultra-fast",
    name: "WAN 2.2 I2V (Ultra Fast)",
    kind: "video",
    costPerUnit: 0.02,
    costUnit: "second",
    lora: false,
    nsfw: true,
    note: "Cheap burst image-to-video.",
  },
];

async function token(): Promise<string> {
  const t = await getRawKey("wavespeedai");
  if (!t) throw new Error("WaveSpeed AI key not set — save it under provider keys (wsk_live_…).");
  return t;
}

function authHeaders(t: string): Record<string, string> {
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

function mapStatus(raw: string | undefined): PredictionState {
  switch (raw) {
    case "completed":
      return "succeeded";
    case "failed":
    case "error":
      return "failed";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      // created | processing | queued
      return "processing";
  }
}

interface WaveEnvelope {
  code?: number;
  message?: string;
  data?: {
    id?: string;
    status?: string;
    outputs?: string[] | null;
    error?: string;
    executionTime?: number;
  };
}

export const wavespeedaiProvider: ImageProvider = {
  id: "wavespeedai",
  name: "WaveSpeed AI",
  color: "#10b981", // green
  tokenKey: "wavespeedai",

  async isConfigured() {
    return (await getRawKey("wavespeedai")) != null;
  },

  async verify(): Promise<VerifyResult> {
    try {
      const t = await getRawKey("wavespeedai");
      if (!t) return { ok: false, error: "No WaveSpeed AI key configured." };
      const res = await fetch(`${BASE}/api/v3/balance`, { headers: authHeaders(t) });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `WaveSpeed rejected the key (${res.status}).` };
      }
      if (!res.ok) return { ok: false, error: `WaveSpeed returned ${res.status}.` };
      const body = (await res.json()) as { data?: { balance?: number } };
      const balance = typeof body.data?.balance === "number" ? body.data.balance : null;
      return {
        ok: true,
        detail: balance != null ? `Balance $${balance.toFixed(2)}` : "Key valid",
        balanceUsd: balance,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async listModels(): Promise<ModelInfo[]> {
    return CATALOG;
  },

  defaultModel() {
    return "wavespeed-ai/flux-dev";
  },

  async submitGeneration(params: GenerateParams): Promise<{ predictionId: string }> {
    const t = await token();
    const model = params.model ?? this.defaultModel();
    const isVideo = CATALOG.find((m) => m.id === model)?.kind === "video" || /\/(i2v|t2v)/.test(model);
    const { width, height } = aspectToDimensions(params.aspectRatio);

    const body: Record<string, unknown> = {
      prompt: params.prompt,
      // WaveSpeed sizes use a "W*H" string (asterisk, not "x").
      size: `${width}*${height}`,
      num_inference_steps: params.steps ?? 28,
      output_format: "jpeg",
    };
    if (params.guidance != null) body.guidance_scale = params.guidance;
    if (params.seed != null) body.seed = params.seed;
    if (params.image && isVideo) body.image = params.image;
    if (Array.isArray(params.loras) && params.loras.length > 0) {
      body.loras = params.loras
        .slice(0, MAX_LORAS)
        .map((l) => ({ path: l.path, scale: l.scale ?? params.loraScale ?? 1.0 }));
    }

    const res = await fetch(`${BASE}/api/v3/${model}`, {
      method: "POST",
      headers: authHeaders(t),
      body: JSON.stringify(body),
    });
    const env = (await res.json().catch(() => ({}))) as WaveEnvelope;
    if (!res.ok || !env.data?.id) {
      throw new Error(
        `WaveSpeed submit failed (${res.status}) for ${model}: ${env.message ?? JSON.stringify(env)}`,
      );
    }
    return { predictionId: env.data.id };
  },

  async pollPrediction(id: string): Promise<PredictionStatus> {
    const t = await token();
    const res = await fetch(`${BASE}/api/v3/predictions/${id}/result`, { headers: authHeaders(t) });
    if (!res.ok) throw new Error(`WaveSpeed poll failed (${res.status}) for ${id}`);
    const env = (await res.json()) as WaveEnvelope;
    const data = env.data ?? {};
    return {
      id,
      status: mapStatus(data.status),
      outputUrl: Array.isArray(data.outputs) && data.outputs.length > 0 ? data.outputs[0] : null,
      error: data.error || null,
      costUsd: null, // WaveSpeed does not return per-call cost; estimate is used.
    };
  },

  async downloadOutput(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`WaveSpeed output download failed (${res.status}) from ${url}`);
    return Buffer.from(await res.arrayBuffer());
  },

  // ── LoRA training (wavespeed-ai/flux-dev-lora-trainer) ────────────────────
  // Flow: upload the dataset zip → /media/upload/binary (returns a download_url)
  // → POST /api/v3/{trainerId} { data: <url>, trigger_word, steps, lora_rank }
  // → poll /api/v3/predictions/{id}/result, outputs[0] is the .safetensors.

  listTrainers(): TrainerInfo[] {
    return [
      {
        id: "wavespeed-ai/flux-dev-lora-trainer",
        name: "Flux Dev LoRA Trainer",
        costEstimateUsd: 1.0,
        etaMinutes: 16,
        defaultSteps: 1000,
        defaultRank: 16,
        recommended: true,
        nsfw: true,
        note: "Cheapest real trainer (~$1) at comparable speed (~15.5 min).",
      },
      {
        id: "wavespeed-ai/flux-dev-lora-trainer-turbo",
        name: "Flux Dev LoRA Trainer (Turbo)",
        costEstimateUsd: 0.75,
        etaMinutes: 9,
        defaultSteps: 1000,
        defaultRank: 16,
        nsfw: true,
        note: "Faster turbo variant — final cost scales with steps.",
      },
    ];
  },

  async submitLoraTraining(params: LoraTrainingSubmit): Promise<LoraTrainingHandle> {
    const t = await token();
    // 1. Upload the dataset zip → a fetchable download_url.
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(params.zip)], { type: "application/zip" }),
      params.zipFilename,
    );
    const upRes = await fetch(`${BASE}/api/v3/media/upload/binary`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}` },
      body: form,
    });
    const upBody = (await upRes.json().catch(() => ({}))) as {
      data?: { download_url?: string };
      message?: string;
    };
    const datasetUrl = upBody.data?.download_url;
    if (!upRes.ok || !datasetUrl) {
      throw new Error(
        `WaveSpeed dataset upload failed (${upRes.status}): ${upBody.message ?? JSON.stringify(upBody)}`,
      );
    }

    // 2. Submit the training run.
    const res = await fetch(`${BASE}/api/v3/${params.trainerId}`, {
      method: "POST",
      headers: authHeaders(t),
      body: JSON.stringify({
        data: datasetUrl,
        trigger_word: params.triggerWord,
        steps: params.steps ?? 1000,
        lora_rank: params.loraRank ?? 16,
      }),
    });
    const env = (await res.json().catch(() => ({}))) as WaveEnvelope;
    if (!res.ok || !env.data?.id) {
      throw new Error(
        `WaveSpeed training submit failed (${res.status}) for ${params.trainerId}: ${env.message ?? JSON.stringify(env)}`,
      );
    }
    return { externalId: env.data.id, destinationModel: null };
  },

  async pollTraining(externalId: string): Promise<LoraTrainingStatus> {
    const t = await token();
    const res = await fetch(`${BASE}/api/v3/predictions/${externalId}/result`, {
      headers: authHeaders(t),
    });
    if (!res.ok) throw new Error(`WaveSpeed training poll failed (${res.status}) for ${externalId}`);
    const env = (await res.json()) as WaveEnvelope;
    const data = env.data ?? {};
    return {
      id: externalId,
      status: mapStatus(data.status),
      weightsUrl: Array.isArray(data.outputs) && data.outputs.length > 0 ? data.outputs[0] : null,
      error: data.error || null,
      costUsd: null,
    };
  },

  async cancelTraining(externalId: string): Promise<void> {
    const t = await token();
    // Best-effort — WaveSpeed rejects cancel on already-terminal runs (400).
    await fetch(`${BASE}/api/v3/predictions/${externalId}/cancel`, {
      method: "POST",
      headers: authHeaders(t),
    }).catch(() => undefined);
  },
};
