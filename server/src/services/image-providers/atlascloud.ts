/**
 * Atlas Cloud provider — NSFW-friendly ("Turbo Spicy") image + video host.
 *
 * Verified API surface (2026-06-04, live):
 *   base   https://api.atlascloud.ai/api/v1
 *   auth   Authorization: Bearer apikey-…
 *   submit POST /model/generateImage  { model, prompt, width, height }
 *          POST /model/generateVideo  { model, prompt, image?, … }
 *            → { code:200, data:{ id, urls:{ get }, status:"processing" } }
 *   poll   GET  /model/prediction/{id}        (== data.urls.get)
 *            → { data:{ status:"completed"|"failed"|…, outputs:["<url>"] } }
 *   models GET  /models  → { data:[{ model, type:"Image"|"Video"|"Text", … }] }
 *
 * Atlas exposes no programmatic credit-balance endpoint, so verify() confirms
 * the key by listing the model catalog (200 = good key) and reports balance null.
 */
import type {
  GenerateParams,
  ImageProvider,
  ModelInfo,
  PredictionState,
  PredictionStatus,
  VerifyResult,
} from "./types.js";
import { aspectToDimensions } from "./types.js";
import { getRawKey } from "../provider-api-keys/index.js";

const BASE = "https://api.atlascloud.ai/api/v1";

/**
 * Curated catalog of verified Atlas model ids (the spec's target models plus a
 * cheap default image model). Kept as a static allowlist so the picker stays
 * clean — the live /models endpoint carries 200+ entries. Costs are USD; video
 * is per-second of output, image is per render.
 */
const CATALOG: ModelInfo[] = [
  {
    id: "bytedance/seedream-v5.0-lite",
    name: "Seedream 5 Lite",
    kind: "image",
    costPerUnit: 0.02,
    costUnit: "image",
    lora: false,
    nsfw: true,
    recommended: true,
    note: "Cheap, fast text-to-image — Atlas default for A/B.",
  },
  {
    id: "qwen/qwen-image-2.0/text-to-image",
    name: "Qwen Image 2.0",
    kind: "image",
    costPerUnit: 0.05,
    costUnit: "image",
    lora: false,
    nsfw: true,
    note: "Sharper text + fine detail.",
  },
  {
    id: "alibaba/wan-2.7/text-to-image",
    name: "WAN 2.7 (image)",
    kind: "image",
    costPerUnit: 0.05,
    costUnit: "image",
    lora: false,
    nsfw: true,
    note: "WAN aesthetic, premium quality.",
  },
  {
    id: "atlascloud/wan-2.2-turbo-spicy/image-to-video-lora",
    name: "WAN 2.2 Turbo Spicy I2V (LoRA)",
    kind: "video",
    costPerUnit: 0.026,
    costUnit: "second",
    lora: true,
    nsfw: true,
    note: "Spicy image-to-video with LoRA — perfect for the Sidney pipeline.",
  },
  {
    id: "atlascloud/wan-2.2-turbo-spicy/image-to-video",
    name: "WAN 2.2 Turbo Spicy I2V",
    kind: "video",
    costPerUnit: 0.02,
    costUnit: "second",
    lora: false,
    nsfw: true,
    note: "Spicy image-to-video, no LoRA.",
  },
  {
    id: "alibaba/wan-2.7/image-to-video",
    name: "WAN 2.7 I2V",
    kind: "video",
    costPerUnit: 0.1,
    costUnit: "second",
    lora: false,
    nsfw: true,
    note: "Premium quality image-to-video.",
  },
  {
    id: "bytedance/seedance-2.0/image-to-video",
    name: "Seedance 2.0 I2V",
    kind: "video",
    costPerUnit: 0.096,
    costUnit: "second",
    lora: false,
    nsfw: true,
  },
  {
    id: "google/veo3.1-lite/image-to-video",
    name: "Veo 3.1 Lite I2V",
    kind: "video",
    costPerUnit: 0.05,
    costUnit: "second",
    lora: false,
    nsfw: false,
  },
  {
    id: "alibaba/happyhorse-1.0/image-to-video",
    name: "HappyHorse 1.0 I2V",
    kind: "video",
    costPerUnit: 0.14,
    costUnit: "second",
    lora: false,
    nsfw: true,
  },
  {
    id: "vidu/q3/reference-to-video",
    name: "Vidu Q3 Ref2V",
    kind: "video",
    costPerUnit: 0.042,
    costUnit: "second",
    lora: false,
    nsfw: true,
  },
];

async function token(): Promise<string> {
  const t = await getRawKey("atlascloud");
  if (!t) throw new Error("Atlas Cloud key not set — save it under provider keys (apikey-…).");
  return t;
}

function authHeaders(t: string): Record<string, string> {
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

function mapStatus(raw: string | undefined): PredictionState {
  switch (raw) {
    case "completed":
    case "succeeded":
    case "success":
      return "succeeded";
    case "failed":
    case "error":
      return "failed";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return "processing";
  }
}

interface AtlasEnvelope {
  code?: number | string;
  msg?: string;
  message?: string;
  data?: {
    id?: string;
    status?: string;
    outputs?: string[] | null;
    error?: string;
    urls?: { get?: string };
  };
}

export const atlascloudProvider: ImageProvider = {
  id: "atlascloud",
  name: "Atlas Cloud",
  color: "#3b82f6", // blue
  tokenKey: "atlascloud",

  async isConfigured() {
    return (await getRawKey("atlascloud")) != null;
  },

  async verify(): Promise<VerifyResult> {
    try {
      const t = await getRawKey("atlascloud");
      if (!t) return { ok: false, error: "No Atlas Cloud key configured." };
      const res = await fetch(`${BASE}/models`, { headers: authHeaders(t) });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `Atlas Cloud rejected the key (${res.status}).` };
      }
      if (!res.ok) return { ok: false, error: `Atlas Cloud returned ${res.status}.` };
      const body = (await res.json()) as { data?: unknown[] };
      const count = Array.isArray(body.data) ? body.data.length : 0;
      // No public balance endpoint — confirm reachability via the catalog size.
      return { ok: true, detail: `Key valid · ${count} models available`, balanceUsd: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async listModels(): Promise<ModelInfo[]> {
    return CATALOG;
  },

  defaultModel() {
    return "bytedance/seedream-v5.0-lite";
  },

  async submitGeneration(params: GenerateParams): Promise<{ predictionId: string }> {
    const t = await token();
    const model = params.model ?? this.defaultModel();
    const isVideo = CATALOG.find((m) => m.id === model)?.kind === "video" || /to-video/.test(model);
    const { width, height } = aspectToDimensions(params.aspectRatio);

    const body: Record<string, unknown> = { model, prompt: params.prompt };
    if (params.seed != null) body.seed = params.seed;
    if (isVideo) {
      if (params.image) body.image = params.image;
    } else {
      body.width = width;
      body.height = height;
    }

    const endpoint = isVideo ? "generateVideo" : "generateImage";
    const res = await fetch(`${BASE}/model/${endpoint}`, {
      method: "POST",
      headers: authHeaders(t),
      body: JSON.stringify(body),
    });
    const env = (await res.json().catch(() => ({}))) as AtlasEnvelope;
    if (!res.ok || !env.data?.id) {
      throw new Error(
        `Atlas Cloud ${endpoint} failed (${res.status}): ${env.msg ?? env.message ?? JSON.stringify(env)}`,
      );
    }
    return { predictionId: env.data.id };
  },

  async pollPrediction(id: string): Promise<PredictionStatus> {
    const t = await token();
    const res = await fetch(`${BASE}/model/prediction/${id}`, { headers: authHeaders(t) });
    if (!res.ok) throw new Error(`Atlas Cloud poll failed (${res.status}) for ${id}`);
    const env = (await res.json()) as AtlasEnvelope;
    const data = env.data ?? {};
    return {
      id,
      status: mapStatus(data.status),
      outputUrl: Array.isArray(data.outputs) && data.outputs.length > 0 ? data.outputs[0] : null,
      error: data.error || null,
      costUsd: null, // Atlas does not return per-call cost; estimate is used.
    };
  },

  async downloadOutput(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Atlas Cloud output download failed (${res.status}) from ${url}`);
    return Buffer.from(await res.arrayBuffer());
  },
};
