/**
 * Replicate batch generator — the Image Studio inference worker.
 *
 * This is a PLAIN TypeScript module: no Claude/agent loop, just HTTP calls to
 * Replicate from the Paperclip server. It drives `generation_jobs` rows from
 * queued → submitted → polling → succeeded|failed:
 *
 *   - submitQueuedJobs(): for each free concurrency slot, build the flux LoRA
 *     input and POST a prediction; record the prediction id.
 *   - pollInFlight(): GET each in-flight prediction; on success download the PNG
 *     into <uploadsRoot>/personas/<slug>/generated/<batch_id>/<n>.png, build a
 *     thumbnail, insert a persona_generations row (so it lands in the gallery),
 *     and mark the job succeeded.
 *
 * `pollGenerations(db)` runs both halves and is invoked every 15s by the server
 * scheduler (see index.ts) and also kicked synchronously right after a batch is
 * enqueued by the generate route.
 *
 * Concurrency: Replicate caps in-flight predictions per account. We never keep
 * more than REPLICATE_CONCURRENCY_CAP (default 2 — Tyler's new account) jobs in
 * 'submitted'|'polling' at once; bump the env var when his account unlocks more.
 *
 * Adult content: when the persona (or the job) is rated 'explicit' we pass
 * `disable_safety_checker: true` automatically — the standard adult-content knob
 * for synthetic-character LoRA inference, wired as a normal config path.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  imageProviders,
  generationJobs,
  personaGenerations,
  type GenerationJob,
} from "@paperclipai/db";
import {
  getReplicateToken,
  getReplicateAccount,
  createReplicatePrediction,
  getReplicatePrediction,
  extractOutputUrl,
  type ReplicatePrediction,
} from "./replicate/index.js";
import { personaTrainingProfile } from "./image-studio/training.js";
import { uploadsRoot } from "./image-studio/uploads.js";

/** Public flux LoRA inference model (latest version is used automatically). */
export const INFERENCE_MODEL =
  process.env.REPLICATE_INFERENCE_MODEL ?? "black-forest-labs/flux-dev-lora";

/** Statuses that count against the Replicate concurrency cap. */
const IN_FLIGHT_STATUSES = ["submitted", "polling"] as const;

type Persona = typeof imageProviders.$inferSelect;

/** Per-account in-flight cap. Default 2 (Tyler's new account); env-overridable. */
export function concurrencyCap(): number {
  const raw = Number.parseInt(process.env.REPLICATE_CONCURRENCY_CAP ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

/** Filesystem-safe, hyphenated persona slug (matches the gallery's existing paths). */
export function personaSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "persona"
  );
}

/**
 * Resolve a persona's content rating. Prefers an explicit override in
 * default_params.content_rating; otherwise derives it from the training profile
 * (Sidney NSFW → 'explicit', everything else → 'sfw').
 */
export function personaContentRating(persona: Persona): "sfw" | "explicit" {
  const fromParams = (persona.defaultParams as Record<string, unknown> | null)?.[
    "content_rating"
  ];
  if (fromParams === "explicit" || fromParams === "sfw") return fromParams;
  return personaTrainingProfile(persona.name).contentRating;
}

/**
 * Resolve the LoRA weights reference passed to the inference model. Prefers an
 * explicit override in default_params.replicate_lora; otherwise derives the
 * trained destination model ref `<account>/<trainer-slug>` (the same destination
 * the training pipeline pushed weights to).
 */
async function resolveLoraWeights(persona: Persona): Promise<string | null> {
  const override = (persona.defaultParams as Record<string, unknown> | null)?.[
    "replicate_lora"
  ];
  if (typeof override === "string" && override.length > 0) return override;
  const account = await getReplicateAccount();
  if (!account?.username) return null;
  // training-runner pushes weights to `<username>/<profile.slug>` (underscored).
  return `${account.username}/${personaTrainingProfile(persona.name).slug}`;
}

/** Cross-product expand `{variation:a|b|c}` (or `{a|b|c}`) placeholders. */
export function expandPromptVariations(prompt: string): string[] {
  const groupRe = /\{([^{}]*)\}/g;
  type Token = { kind: "text"; value: string } | { kind: "options"; options: string[] };
  const tokens: Token[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = groupRe.exec(prompt)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", value: prompt.slice(lastIndex, match.index) });
    }
    let body = match[1];
    if (/^variation\s*:/i.test(body)) body = body.replace(/^variation\s*:/i, "");
    const hadPrefix = /^variation\s*:/i.test(match[1]);
    if (body.includes("|") || hadPrefix) {
      const options = body.split("|").map((o) => o.trim()).filter((o) => o.length > 0);
      tokens.push({ kind: "options", options: options.length > 0 ? options : [body.trim()] });
    } else {
      // A brace with no '|' and no 'variation:' prefix is literal text.
      tokens.push({ kind: "text", value: match[0] });
    }
    lastIndex = groupRe.lastIndex;
  }
  if (lastIndex < prompt.length) {
    tokens.push({ kind: "text", value: prompt.slice(lastIndex) });
  }

  let results = [""];
  for (const token of tokens) {
    if (token.kind === "text") {
      results = results.map((r) => r + token.value);
    } else {
      const next: string[] = [];
      for (const r of results) for (const opt of token.options) next.push(r + opt);
      results = next;
    }
  }
  return results.map((r) => r.trim()).filter((r) => r.length > 0);
}

async function loadPersona(db: Db, personaId: string): Promise<Persona | null> {
  const [row] = await db
    .select()
    .from(imageProviders)
    .where(eq(imageProviders.id, personaId))
    .limit(1);
  return row ?? null;
}

/** Build the flux LoRA prediction input for a job. */
function buildInput(
  job: GenerationJob,
  loraWeights: string,
  disableSafety: boolean,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: job.promptText,
    lora_weights: loraWeights,
    lora_scale: job.loraScale != null ? Number(job.loraScale) : 1.0,
    num_inference_steps: job.steps ?? 28,
    guidance: job.guidance != null ? Number(job.guidance) : 3.5,
    aspect_ratio: job.aspectRatio ?? "1:1",
    num_outputs: 1,
    output_format: "png",
    megapixels: "1",
    go_fast: false,
  };
  if (job.seed != null) input.seed = job.seed;
  // Standard adult-content knob for synthetic-character LoRAs — config path, not
  // a special case. Persona rating already baked into job.contentRating.
  if (disableSafety) input.disable_safety_checker = true;
  return input;
}

/**
 * Submit a single queued job to Replicate. Returns the prediction id, or marks
 * the job failed (with error_message) and returns null on any error.
 */
export async function fireGeneration(db: Db, job: GenerationJob): Promise<string | null> {
  try {
    const persona = await loadPersona(db, job.personaId);
    if (!persona) throw new Error("Persona not found");
    const loraWeights = await resolveLoraWeights(persona);
    if (!loraWeights) {
      throw new Error(
        "Could not resolve LoRA weights — set default_params.replicate_lora or finish training.",
      );
    }
    const disableSafety =
      job.contentRating === "explicit" || personaContentRating(persona) === "explicit";
    const prediction = await createReplicatePrediction(
      INFERENCE_MODEL,
      buildInput(job, loraWeights, disableSafety),
    );
    await db
      .update(generationJobs)
      .set({ status: "submitted", replicatePredictionId: prediction.id })
      .where(eq(generationJobs.id, job.id));
    return prediction.id;
  } catch (err) {
    await db
      .update(generationJobs)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      })
      .where(eq(generationJobs.id, job.id));
    return null;
  }
}

/** Download the finished image, thumbnail it, and land it in the gallery. */
async function landSucceededJob(
  db: Db,
  job: GenerationJob,
  prediction: ReplicatePrediction,
): Promise<void> {
  const url = extractOutputUrl(prediction);
  if (!url) throw new Error("Prediction succeeded but returned no output URL");

  const persona = await loadPersona(db, job.personaId);
  const slug = personaSlug(persona?.name ?? "persona");
  const relDir = path.posix.join("personas", slug, "generated", job.batchId);
  const absDir = path.join(uploadsRoot(), relDir);
  await fs.mkdir(absDir, { recursive: true });

  // Next sequential index within the batch dir (1-based).
  let n = 1;
  try {
    const existing = await fs.readdir(absDir);
    const nums = existing
      .map((f) => /^(\d+)\.png$/.exec(f)?.[1])
      .filter((x): x is string => Boolean(x))
      .map((x) => Number.parseInt(x, 10));
    if (nums.length > 0) n = Math.max(...nums) + 1;
  } catch {
    // dir freshly created — n stays 1.
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download output (${res.status}) from ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const relImage = path.posix.join(relDir, `${n}.png`);
  const relThumb = path.posix.join(relDir, `${n}_thumb.webp`);
  await fs.writeFile(path.join(uploadsRoot(), relImage), buf);
  try {
    const thumb = await sharp(buf).resize(512, 512, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
    await fs.writeFile(path.join(uploadsRoot(), relThumb), thumb);
  } catch {
    // Thumbnail is best-effort; the gallery falls back to the full image.
  }

  const seconds = prediction.metrics?.predict_time ?? prediction.metrics?.total_time;
  const costUsd = seconds ? (seconds * 0.001525).toFixed(4) : null;

  await db.insert(personaGenerations).values({
    personaId: job.personaId,
    source: "production",
    prompt: job.promptText,
    loraStrength: job.loraScale != null ? String(job.loraScale) : null,
    model: INFERENCE_MODEL,
    imagePath: relImage,
    thumbnailPath: relThumb,
    generationMetadata: {
      batch_id: job.batchId,
      job_id: job.id,
      steps: job.steps,
      guidance: job.guidance,
      aspect_ratio: job.aspectRatio,
      seed: job.seed,
    },
    replicatePredictionId: prediction.id,
    costUsd,
    contentRating: job.contentRating,
  });

  await db
    .update(generationJobs)
    .set({ status: "succeeded", outputPath: relImage, costUsd, completedAt: new Date() })
    .where(eq(generationJobs.id, job.id));
}

/** Poll one in-flight job and advance its state. Errors are stored, not thrown. */
async function pollOne(db: Db, job: GenerationJob): Promise<void> {
  if (!job.replicatePredictionId) return;
  try {
    const prediction = await getReplicatePrediction(job.replicatePredictionId);
    if (prediction.status === "succeeded") {
      await landSucceededJob(db, job, prediction);
    } else if (prediction.status === "failed" || prediction.status === "canceled") {
      await db
        .update(generationJobs)
        .set({
          status: "failed",
          errorMessage: prediction.error ?? `Prediction ${prediction.status}`,
          completedAt: new Date(),
        })
        .where(eq(generationJobs.id, job.id));
    } else if (job.status !== "polling") {
      // starting | processing → mark polling so the UI shows progress.
      await db
        .update(generationJobs)
        .set({ status: "polling" })
        .where(eq(generationJobs.id, job.id));
    }
  } catch (err) {
    await db
      .update(generationJobs)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      })
      .where(eq(generationJobs.id, job.id));
  }
}

// Serialise ticks so concurrent invocations (15s timer + post-enqueue kick)
// don't double-submit or exceed the concurrency cap.
let tickInFlight: Promise<void> | null = null;

async function runTick(db: Db): Promise<void> {
  // No token → nothing we can do; leave jobs queued for when one lands.
  if ((await getReplicateToken()) === null) return;

  // 1. Poll everything currently in flight.
  const inFlight = await db
    .select()
    .from(generationJobs)
    .where(inArray(generationJobs.status, [...IN_FLIGHT_STATUSES]));
  for (const job of inFlight) {
    await pollOne(db, job);
  }

  // 2. Submit queued jobs up to the free concurrency budget. Recompute in-flight
  // AFTER polling, since some of step 1 may have just succeeded/failed.
  const stillInFlight = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(inArray(generationJobs.status, [...IN_FLIGHT_STATUSES]));
  const slots = concurrencyCap() - stillInFlight.length;
  if (slots <= 0) return;

  const queued = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.status, "queued"))
    .orderBy(asc(generationJobs.createdAt))
    .limit(slots);
  for (const job of queued) {
    await fireGeneration(db, job);
  }
}

/**
 * Run one generator tick: poll in-flight predictions, then submit queued jobs up
 * to the concurrency cap. Safe to call concurrently — ticks are serialised.
 * Invoked every 15s by the scheduler and kicked right after a batch is enqueued.
 */
export async function pollGenerations(db: Db): Promise<void> {
  if (tickInFlight) return tickInFlight;
  tickInFlight = runTick(db).finally(() => {
    tickInFlight = null;
  });
  return tickInFlight;
}

/** Alias used by the generate route to kick the queue right after enqueue. */
export const kickGenerationQueue = pollGenerations;
