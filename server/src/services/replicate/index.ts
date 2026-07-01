/**
 * Replicate cloud LoRA training client.
 *
 * Tyler is moving Sidney persona training off the local Mac mini FluxTrainer
 * onto Replicate's hosted `ostris/flux-dev-lora-trainer` (~30 min on an H100,
 * ~$3/run). This module centralises the HTTP surface: token resolution +
 * verification, training creation, and training status polling.
 *
 * The bearer token is stored in the same provider-api-keys store as the
 * elevenlabs key (see services/provider-api-keys). It can also be supplied via
 * the REPLICATE_API_TOKEN env var as an out-of-band override.
 */
import { getRawKey } from "../provider-api-keys/index.js";

export const REPLICATE_API_BASE = "https://api.replicate.com/v1";
export const REPLICATE_TRAINER_MODEL = "ostris/flux-dev-lora-trainer";

/**
 * Current published version SHA of ostris/flux-dev-lora-trainer.
 *
 * Looked up from https://replicate.com/ostris/flux-dev-lora-trainer/versions
 * on 2026-06-02 (most recent is 26dce37a…). The model GET endpoint requires
 * auth, so we couldn't verify the full 64-char hash against the live API yet.
 *
 * TODO(replicate): once REPLICATE_API_TOKEN is set, confirm the full SHA with
 *   GET /v1/models/ostris/flux-dev-lora-trainer  →  latest_version.id
 * and update this constant if it has rolled forward.
 */
export const REPLICATE_TRAINER_VERSION =
  "26dce37af90b9d997eeb970d92e47de3064d46c300504ae376c75bef6a9022d2";

export type ReplicateTrainingStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export interface ReplicateTraining {
  id: string;
  status: ReplicateTrainingStatus;
  output?: { weights?: string } | string | null;
  error?: string | null;
  urls?: { get?: string; cancel?: string };
  metrics?: { predict_time?: number; total_time?: number } | null;
  logs?: string | null;
}

/** Resolve the Replicate bearer token (env override → stored key). */
export async function getReplicateToken(): Promise<string | null> {
  const fromEnv = process.env.REPLICATE_API_TOKEN;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return getRawKey("replicate");
}

function authHeaders(token: string): Record<string, string> {
  // Replicate uses the legacy "Token <key>" scheme (not "Bearer").
  return { Authorization: `Token ${token}`, "Content-Type": "application/json" };
}

export interface VerifyResult {
  ok: boolean;
  username?: string;
  error?: string;
}

/**
 * Verify a token by hitting GET /v1/account. Used at save-time so the UI can
 * give green/red feedback before the token is trusted for a $3 training run.
 */
export async function verifyReplicateToken(token: string): Promise<VerifyResult> {
  try {
    const res = await fetch(`${REPLICATE_API_BASE}/account`, {
      headers: authHeaders(token),
    });
    if (res.status === 401) return { ok: false, error: "Invalid token (401 from Replicate)." };
    if (!res.ok) return { ok: false, error: `Replicate returned ${res.status}.` };
    const body = (await res.json()) as { username?: string; type?: string };
    return { ok: true, username: body.username };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Resolve the authenticated account (used to derive the destination owner). */
export async function getReplicateAccount(
  token?: string,
): Promise<{ username: string; type?: string } | null> {
  const key = token ?? (await getReplicateToken());
  if (!key) return null;
  const res = await fetch(`${REPLICATE_API_BASE}/account`, { headers: authHeaders(key) });
  if (!res.ok) return null;
  return (await res.json()) as { username: string; type?: string };
}

/** Fetch the latest published version SHA of the trainer model. */
export async function getLatestTrainerVersion(token?: string): Promise<string> {
  const key = token ?? (await getReplicateToken());
  if (!key) throw new Error("REPLICATE_API_TOKEN not set.");
  const res = await fetch(`${REPLICATE_API_BASE}/models/${REPLICATE_TRAINER_MODEL}/versions`, {
    headers: authHeaders(key),
  });
  if (!res.ok) return REPLICATE_TRAINER_VERSION;
  const body = (await res.json()) as { results?: Array<{ id: string }> };
  return body.results?.[0]?.id ?? REPLICATE_TRAINER_VERSION;
}

/** Upload a file (zip of training images) to Replicate; returns a fetchable URL. */
export async function uploadReplicateFile(
  content: Buffer,
  filename: string,
  token?: string,
): Promise<string> {
  const key = token ?? (await getReplicateToken());
  if (!key) throw new Error("REPLICATE_API_TOKEN not set.");
  const form = new FormData();
  form.append(
    "content",
    new Blob([new Uint8Array(content)], { type: "application/zip" }),
    filename,
  );
  const res = await fetch(`${REPLICATE_API_BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Token ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Replicate file upload failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { urls?: { get?: string } };
  const url = body.urls?.get;
  if (!url) throw new Error("Replicate file upload returned no URL");
  return url;
}

/** Ensure a destination model exists to push trained weights to. */
export async function ensureReplicateModel(
  owner: string,
  name: string,
  token?: string,
): Promise<void> {
  const key = token ?? (await getReplicateToken());
  if (!key) throw new Error("REPLICATE_API_TOKEN not set.");
  const get = await fetch(`${REPLICATE_API_BASE}/models/${owner}/${name}`, {
    headers: authHeaders(key),
  });
  if (get.ok) return;
  if (get.status !== 404) throw new Error(`Replicate model lookup failed (${get.status})`);
  const hwRes = await fetch(`${REPLICATE_API_BASE}/hardware`, { headers: authHeaders(key) });
  const hw = (await hwRes.json().catch(() => [])) as Array<{ sku: string }>;
  const sku =
    hw.find((h) => /h100/i.test(h.sku))?.sku ??
    hw.find((h) => /gpu/i.test(h.sku))?.sku ??
    hw[0]?.sku ??
    "gpu-h100";
  const mk = await fetch(`${REPLICATE_API_BASE}/models`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify({ owner, name, visibility: "private", hardware: sku }),
  });
  if (!mk.ok) throw new Error(`Replicate model create failed (${mk.status}): ${await mk.text()}`);
}

export interface CreateTrainingInput {
  /** Public URL or data URI of the zipped training images. */
  inputImages: string;
  triggerWord: string;
  /** Where Replicate should push the trained weights, e.g. a model you own. */
  destination: string;
  steps?: number;
  loraRank?: number;
  batchSize?: number;
  autocaption?: boolean;
  /** Override the pinned trainer version (defaults to the latest at call time). */
  version?: string;
  /** Optional webhook Replicate calls on status change. */
  webhook?: string;
}

/**
 * Create a training run against the pinned trainer version.
 *
 * POST /v1/models/{owner}/{name}/versions/{version}/trainings
 * Ref: https://replicate.com/docs/reference/http#trainings.create
 *
 * Throws if no token is configured — callers should guard with a mock path
 * until REPLICATE_API_TOKEN is set (Tyler is generating it in parallel).
 */
export async function createReplicateTraining(
  input: CreateTrainingInput,
): Promise<ReplicateTraining> {
  const token = await getReplicateToken();
  if (!token) {
    throw new Error(
      "REPLICATE_API_TOKEN not set — save a token via POST /api/credentials/replicate first.",
    );
  }
  const version = input.version ?? REPLICATE_TRAINER_VERSION;
  const url = `${REPLICATE_API_BASE}/models/${REPLICATE_TRAINER_MODEL}/versions/${version}/trainings`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      destination: input.destination,
      input: {
        input_images: input.inputImages,
        trigger_word: input.triggerWord,
        steps: input.steps ?? 1500,
        lora_rank: input.loraRank ?? 16,
        batch_size: input.batchSize ?? 1,
        autocaption: input.autocaption ?? true,
      },
      ...(input.webhook ? { webhook: input.webhook, webhook_events_filter: ["completed"] } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate trainings.create failed (${res.status}): ${text}`);
  }
  return (await res.json()) as ReplicateTraining;
}

/**
 * Cancel a training run. Best-effort: returns false if Replicate rejects it
 * (e.g. the run is already terminal). POST /v1/trainings/{id}/cancel
 */
export async function cancelReplicateTraining(externalId: string): Promise<boolean> {
  const token = await getReplicateToken();
  if (!token) throw new Error("REPLICATE_API_TOKEN not set.");
  const res = await fetch(`${REPLICATE_API_BASE}/trainings/${externalId}/cancel`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return res.ok;
}

/**
 * Poll a training's current status.
 * GET /v1/trainings/{id}
 */
export async function getReplicateTraining(externalId: string): Promise<ReplicateTraining> {
  const token = await getReplicateToken();
  if (!token) throw new Error("REPLICATE_API_TOKEN not set.");
  const res = await fetch(`${REPLICATE_API_BASE}/trainings/${externalId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate trainings.get failed (${res.status}): ${text}`);
  }
  return (await res.json()) as ReplicateTraining;
}

// ── Inference predictions (Image Studio batch generate) ─────────────────────

export type ReplicatePredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export interface ReplicatePrediction {
  id: string;
  status: ReplicatePredictionStatus;
  /** Flux LoRA models return an array of output image URLs (num_outputs). */
  output?: string[] | string | null;
  error?: string | null;
  metrics?: { predict_time?: number; total_time?: number } | null;
}

/**
 * Create an inference prediction against an official/owned model's LATEST
 * version (no version SHA needed for owner/name predictions).
 *
 * POST /v1/models/{owner}/{name}/predictions
 * Ref: https://replicate.com/docs/reference/http#predictions.create
 */
export async function createReplicatePrediction(
  model: string,
  input: Record<string, unknown>,
): Promise<ReplicatePrediction> {
  const token = await getReplicateToken();
  if (!token) {
    throw new Error(
      "REPLICATE_API_TOKEN not set — save a token via POST /api/credentials/replicate first.",
    );
  }
  const res = await fetch(`${REPLICATE_API_BASE}/models/${model}/predictions`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate predictions.create failed (${res.status}): ${text}`);
  }
  return (await res.json()) as ReplicatePrediction;
}

/** Fetch the latest published version SHA of an arbitrary model (owner/name). */
export async function getLatestModelVersion(model: string, token?: string): Promise<string> {
  const key = token ?? (await getReplicateToken());
  if (!key) throw new Error("REPLICATE_API_TOKEN not set.");
  const res = await fetch(`${REPLICATE_API_BASE}/models/${model}/versions`, {
    headers: authHeaders(key),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate models.versions failed for ${model} (${res.status}): ${text}`);
  }
  const body = (await res.json()) as { results?: Array<{ id: string }> };
  const id = body.results?.[0]?.id;
  if (!id) throw new Error(`Model ${model} has no published versions`);
  return id;
}

/**
 * Create an inference prediction against a specific version SHA.
 *
 * POST /v1/predictions  { version, input }
 * This is the path the proven Sidney generations used — the persona's own
 * published model (LoRA baked into Flux dev) is the inference target, so there
 * is NO external weights URL.
 */
export async function createReplicatePredictionByVersion(
  version: string,
  input: Record<string, unknown>,
): Promise<ReplicatePrediction> {
  const token = await getReplicateToken();
  if (!token) {
    throw new Error(
      "REPLICATE_API_TOKEN not set — save a token via POST /api/credentials/replicate first.",
    );
  }
  const res = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ version, input }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate predictions.create failed (${res.status}): ${text}`);
  }
  return (await res.json()) as ReplicatePrediction;
}

/**
 * Poll a prediction's current status.
 * GET /v1/predictions/{id}
 */
export async function getReplicatePrediction(id: string): Promise<ReplicatePrediction> {
  const token = await getReplicateToken();
  if (!token) throw new Error("REPLICATE_API_TOKEN not set.");
  const res = await fetch(`${REPLICATE_API_BASE}/predictions/${id}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate predictions.get failed (${res.status}): ${text}`);
  }
  return (await res.json()) as ReplicatePrediction;
}

/** Pull the first output image URL out of a finished prediction payload. */
export function extractOutputUrl(prediction: ReplicatePrediction): string | null {
  const out = prediction.output;
  if (!out) return null;
  if (typeof out === "string") return out;
  return Array.isArray(out) ? (out[0] ?? null) : null;
}

/** Pull the .safetensors weights URL out of a finished training payload. */
export function extractWeightsUrl(training: ReplicateTraining): string | null {
  const out = training.output;
  if (!out) return null;
  if (typeof out === "string") return out;
  return out.weights ?? null;
}
