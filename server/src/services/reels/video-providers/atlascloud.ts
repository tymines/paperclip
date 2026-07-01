/**
 * Atlas Cloud video provider — bytedance/seedance-v1.5-pro/image-to-video
 *
 * The "image-to-video" variant respects content policy filters; the
 * "image-to-video-spicy" variant is the uncensored sibling for explicit
 * persona reels.
 *
 * Pricing: ~$0.049 per 4-12s 1080p clip on Atlas (per Atlas's spec sheet).
 * Auth: Bearer token from openclaw config (models.providers.atlascloud.apiKey
 * or env ATLAS_API_KEY).
 *
 * Endpoint: POST https://api.atlascloud.ai/api/v1/model/generateVideo
 */
import {
  registerVideoProvider,
  type VideoGenInput,
  type VideoGenSubmitResult,
  type VideoGenStatus,
  type VideoProvider,
} from "./index.js";

const GENERATE_URL = "https://api.atlascloud.ai/api/v1/model/generateVideo";
const STATUS_URL = "https://api.atlascloud.ai/api/v1/model/getVideoStatus";

/**
 * Toggle between spicy and standard model per persona content rating.
 * Pass this in via input if you want explicit; defaults to standard.
 */
type AtlasModelVariant = "image-to-video" | "image-to-video-spicy" | "image-to-video-fast";

function getApiKey(): string | null {
  // TODO: pull from openclaw config keystore at runtime. For now, env var.
  return process.env.ATLAS_API_KEY ?? null;
}

async function postJson(url: string, body: unknown, key: string): Promise<any> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Atlas ${r.status}: ${text.slice(0, 500)}`);
  }
  return r.json();
}

async function getJson(url: string, key: string): Promise<any> {
  const r = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Atlas ${r.status}: ${text.slice(0, 500)}`);
  }
  return r.json();
}

export const atlasVideoProvider: VideoProvider = {
  host: "atlascloud",
  displayName: "Atlas Cloud · ByteDance Seedance",

  async isConfigured(): Promise<boolean> {
    return !!getApiKey();
  },

  async submit(input: VideoGenInput): Promise<VideoGenSubmitResult> {
    const key = getApiKey();
    if (!key) throw new Error("Atlas API key not configured");

    // Choose model variant — default to standard; orchestrator can pass
    // `(input as any).variant` to opt into spicy for NSFW personas.
    const variant: AtlasModelVariant =
      (input as any).variant ?? "image-to-video";
    const model = `bytedance/seedance-v1.5-pro/${variant}`;

    const payload = {
      model,
      image: input.imageUrl,
      prompt: input.motionPrompt ?? "",
      duration: Math.max(4, Math.min(12, input.durationSeconds)),
      aspect_ratio: input.aspectRatio,
      camera_fixed: false,
      generate_audio: input.generateAudio ?? false,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    };

    const resp = await postJson(GENERATE_URL, payload, key);
    // Atlas returns task_id or id depending on endpoint version
    const jobId =
      resp.task_id ?? resp.id ?? resp.data?.task_id ?? resp.data?.id;
    if (!jobId) {
      throw new Error(`Atlas submit returned no task id: ${JSON.stringify(resp).slice(0, 200)}`);
    }

    return {
      jobId,
      estimatedCostUsd: 0.049,
    };
  },

  async poll(jobId: string): Promise<VideoGenStatus> {
    const key = getApiKey();
    if (!key) return { status: "failed", error: "Atlas API key not configured" };

    // Atlas exposes both GET ?task_id= and POST body shapes depending on
    // endpoint. Try GET first; on failure fall back to POST.
    let resp: any;
    try {
      resp = await getJson(`${STATUS_URL}?task_id=${encodeURIComponent(jobId)}`, key);
    } catch {
      resp = await postJson(STATUS_URL, { task_id: jobId }, key);
    }

    const status = resp.status ?? resp.data?.status;
    if (status === "completed" || status === "success" || status === "succeeded") {
      let videoUrl =
        resp.video_url ??
        resp.output ??
        resp.data?.video_url ??
        resp.data?.output;
      if (Array.isArray(videoUrl)) videoUrl = videoUrl[0];
      if (!videoUrl) return { status: "failed", error: "completed with no video_url" };
      return { status: "completed", videoUrl, actualCostUsd: 0.049 };
    }
    if (status === "failed" || status === "error" || status === "cancelled") {
      return {
        status: "failed",
        error:
          resp.error ?? resp.message ?? resp.data?.error ?? "atlas reported failure",
      };
    }
    return { status: "in_progress" };
  },
};

registerVideoProvider(atlasVideoProvider);
