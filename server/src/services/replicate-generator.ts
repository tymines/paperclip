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
import { getReplicateAccount, getLatestModelVersion } from "./replicate/index.js";
import {
  getProvider,
  type GenerateParams,
  type ImageProvider,
  type PredictionStatus,
} from "./image-providers/index.js";
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
 * Resolve the persona's published Replicate inference model ref (owner/name).
 *
 * Each persona's LoRA is published as a standalone inference-ready model (the
 * LoRA baked into Flux dev), e.g. `tymines/sidney-sfw` — NOT a weights URL loaded
 * into a separate base model. Prefers the persona's `endpoint` column; otherwise
 * derives `<account-username>/<hyphenated-persona-slug>` (e.g. Sidney SFW →
 * tymines/sidney-sfw), which matches the published model naming.
 */
async function resolvePersonaModel(persona: Persona): Promise<string | null> {
  const endpoint = typeof persona.endpoint === "string" ? persona.endpoint.trim() : "";
  if (endpoint.length > 0) return endpoint;
  const account = await getReplicateAccount();
  if (!account?.username) return null;
  return `${account.username}/${personaSlug(persona.name)}`;
}

// Cache the latest version SHA per model ref for the process lifetime — the
// version only rolls forward on a re-publish, and we don't want to GET /versions
// on every single job submit.
const versionCache = new Map<string, string>();
async function resolveModelVersion(model: string): Promise<string> {
  const cached = versionCache.get(model);
  if (cached) return cached;
  const version = await getLatestModelVersion(model);
  versionCache.set(model, version);
  return version;
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

/**
 * Apply a persona's locked generation config (stored in default_params +
 * attributes) onto the normalised params before submission:
 *
 *   - trigger word: prepended so the persona LoRA actually fires. Skipped if the
 *     prompt already contains it (the structured assembler leads with it; a raw
 *     prompt_text typed by the user does not), case-insensitive.
 *   - positive_template: the persona's locked quality/anatomy/identity emphasis,
 *     appended once. This is how Raven's "(jet black hair…), (perfect hands…)"
 *     specs ride along every prompt without the user retyping them.
 *   - extra_lora / extra_lora_scale: the realism LoRA stacked over the persona
 *     LoRA in one prediction (Raven's proven v6 photoreal recipe).
 *
 * The negative_template is intentionally NOT consumed here: Replicate's
 * flux-dev-lora input schema has no `negative_prompt` field, so passing it would
 * 422 the prediction. It's kept on the persona for record / portability to a
 * negative-capable host (SDXL/WaveSpeed) later.
 *
 * Generic: any persona that sets these default_params benefits — there's nothing
 * Raven-specific in the code path.
 */
function applyPersonaGenerationConfig(persona: Persona, params: GenerateParams): void {
  const dp = (persona.defaultParams as Record<string, unknown> | null) ?? {};
  const attrs = (persona.attributes as Record<string, unknown> | null) ?? {};
  let prompt = params.prompt ?? "";

  const trigger = typeof attrs["trigger_word"] === "string" ? attrs["trigger_word"].trim() : "";
  if (trigger && !prompt.toLowerCase().includes(trigger.toLowerCase())) {
    prompt = prompt.length > 0 ? `${trigger}, ${prompt}` : trigger;
  }

  const positive = typeof dp["positive_template"] === "string" ? dp["positive_template"].trim() : "";
  if (positive && !prompt.includes(positive)) {
    prompt = prompt.length > 0 ? `${prompt}, ${positive}` : positive;
  }
  params.prompt = prompt;

  const extraLora = typeof dp["extra_lora"] === "string" ? dp["extra_lora"].trim() : "";
  if (extraLora) {
    params.extraLora = extraLora;
    const scale = Number(dp["extra_lora_scale"]);
    params.extraLoraScale = Number.isFinite(scale) ? scale : 1.0;
  }
}

async function loadPersona(db: Db, personaId: string): Promise<Persona | null> {
  const [row] = await db
    .select()
    .from(imageProviders)
    .where(eq(imageProviders.id, personaId))
    .limit(1);
  return row ?? null;
}

/**
 * Build the normalised GenerateParams for a job. For Replicate the persona's own
 * model IS its LoRA on top of Flux dev (no portable weights URL), so we resolve
 * its published version SHA and pass it through. Atlas/WaveSpeed render the
 * prompt as text-to-image on the chosen provider model (the persona LoRA isn't
 * portable across hosts), so they only need the prompt + knobs.
 */
async function buildParams(
  db: Db,
  job: GenerationJob,
  provider: ImageProvider,
): Promise<{ params: GenerateParams; modelRef: string }> {
  const persona = await loadPersona(db, job.personaId);
  if (!persona) throw new Error("Persona not found");
  const disableSafety =
    job.contentRating === "explicit" || personaContentRating(persona) === "explicit";

  const params: GenerateParams = {
    prompt: job.promptText,
    model: job.model ?? undefined,
    aspectRatio: job.aspectRatio ?? "1:1",
    steps: job.steps ?? 28,
    guidance: job.guidance != null ? Number(job.guidance) : 3.5,
    seed: job.seed ?? null,
    loraScale: job.loraScale != null ? Number(job.loraScale) : 1.0,
    disableSafety,
  };

  // Fold in the persona's locked prompt templates + realism LoRA stack (no-op
  // for personas that don't set them).
  applyPersonaGenerationConfig(persona, params);

  if (provider.id === "replicate") {
    // General (non-persona) text-to-image: there is no LoRA / published model to
    // resolve. Render the raw prompt on the base Flux model (DEFAULT_MODEL) by
    // leaving modelRef/versionSha unset. Gated to the system "general" persona
    // (attributes.general === true) so real personas can't silently lose their LoRA.
    const isGeneral =
      (persona.attributes as Record<string, unknown> | null)?.["general"] === true;
    if (isGeneral) {
      return { params, modelRef: "general" };
    }
    // Persona generation always targets the persona's own published model.
    const ref = await resolvePersonaModel(persona);
    if (!ref) {
      throw new Error(
        "Could not resolve the persona's Replicate model — set image_providers.endpoint (e.g. owner/sidney-sfw).",
      );
    }
    params.modelRef = ref;
    params.versionSha = await resolveModelVersion(ref);
    return { params, modelRef: ref };
  }

  // Non-Replicate: fall back to the provider's default model when unspecified.
  const modelRef = params.model ?? provider.defaultModel();
  params.model = modelRef;
  return { params, modelRef };
}

/**
 * Submit a single queued job to its provider. Returns the prediction id, or
 * marks the job failed (with error_message) and returns null on any error.
 */
export async function fireGeneration(db: Db, job: GenerationJob): Promise<string | null> {
  try {
    const provider = getProvider(job.providerHost);
    if (!provider) throw new Error(`Unknown provider_host '${job.providerHost}'`);
    const { params } = await buildParams(db, job, provider);
    const { predictionId } = await provider.submitGeneration(params);
    await db
      .update(generationJobs)
      .set({ status: "submitted", replicatePredictionId: predictionId })
      .where(eq(generationJobs.id, job.id));
    return predictionId;
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

/** Pick a file extension for a downloaded output from its URL (default .png). */
function outputExt(url: string): string {
  const m = /\.(png|jpe?g|webp|mp4|webm|gif)(?:\?|$)/i.exec(url);
  return m ? `.${m[1].toLowerCase().replace("jpeg", "jpg")}` : ".png";
}

/** Download the finished asset, thumbnail it (images only), and land it in the gallery. */
async function landSucceededJob(
  db: Db,
  job: GenerationJob,
  provider: ImageProvider,
  status: PredictionStatus,
): Promise<void> {
  const url = status.outputUrl;
  if (!url) throw new Error("Prediction succeeded but returned no output URL");

  const persona = await loadPersona(db, job.personaId);
  // Record the concrete model that ran (persona model for Replicate, else the
  // job's provider model) so the A/B gallery can attribute results accurately.
  const modelRef =
    job.model ??
    (provider.id === "replicate"
      ? (persona ? (await resolvePersonaModel(persona)) ?? INFERENCE_MODEL : INFERENCE_MODEL)
      : provider.defaultModel());
  const slug = personaSlug(persona?.name ?? "persona");
  const relDir = path.posix.join("personas", slug, "generated", job.batchId);
  const absDir = path.join(uploadsRoot(), relDir);
  await fs.mkdir(absDir, { recursive: true });

  const ext = outputExt(url);
  const isImage = /\.(png|jpg|webp|gif)$/.test(ext);

  // Next sequential index within the batch dir (1-based) across any extension.
  let n = 1;
  try {
    const existing = await fs.readdir(absDir);
    const nums = existing
      .map((f) => /^(\d+)\./.exec(f)?.[1])
      .filter((x): x is string => Boolean(x))
      .map((x) => Number.parseInt(x, 10));
    if (nums.length > 0) n = Math.max(...nums) + 1;
  } catch {
    // dir freshly created — n stays 1.
  }

  const buf = await provider.downloadOutput(url);

  const relImage = path.posix.join(relDir, `${n}${ext}`);
  let relThumb: string | null = null;
  await fs.writeFile(path.join(uploadsRoot(), relImage), buf);
  if (isImage) {
    relThumb = path.posix.join(relDir, `${n}_thumb.webp`);
    try {
      const thumb = await sharp(buf).resize(512, 512, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
      await fs.writeFile(path.join(uploadsRoot(), relThumb), thumb);
    } catch {
      // Thumbnail is best-effort; the gallery falls back to the full image.
      relThumb = null;
    }
  }

  // Prefer the provider's reported cost; fall back to the enqueue-time estimate.
  const costUsd =
    status.costUsd != null
      ? status.costUsd.toFixed(4)
      : job.costEstimateUsd != null
        ? String(job.costEstimateUsd)
        : null;

  await db.insert(personaGenerations).values({
    personaId: job.personaId,
    source: "production",
    providerHost: job.providerHost,
    prompt: job.promptText,
    loraStrength: job.loraScale != null ? String(job.loraScale) : null,
    model: modelRef,
    imagePath: relImage,
    thumbnailPath: relThumb,
    generationMetadata: {
      batch_id: job.batchId,
      job_id: job.id,
      provider_host: job.providerHost,
      steps: job.steps,
      guidance: job.guidance,
      aspect_ratio: job.aspectRatio,
      seed: job.seed,
    },
    replicatePredictionId: status.id,
    costUsd,
    contentRating: job.contentRating,
  });

  await db
    .update(generationJobs)
    .set({
      status: "succeeded",
      outputPath: relImage,
      costUsd,
      actualCostUsd: costUsd,
      completedAt: new Date(),
    })
    .where(eq(generationJobs.id, job.id));
}

/** Poll one in-flight job and advance its state. Errors are stored, not thrown. */
async function pollOne(db: Db, job: GenerationJob): Promise<void> {
  if (!job.replicatePredictionId) return;
  try {
    const provider = getProvider(job.providerHost);
    if (!provider) throw new Error(`Unknown provider_host '${job.providerHost}'`);
    const status = await provider.pollPrediction(job.replicatePredictionId);
    if (status.status === "succeeded") {
      // Atomically claim the job before downloading/inserting so a concurrent
      // tick — or a second server process sharing this DB — can't land the same
      // prediction twice (which would duplicate the gallery row + double-count
      // cost). Only the worker whose UPDATE flips it out of an in-flight status
      // proceeds; others see 0 rows and bail.
      const claimed = await db
        .update(generationJobs)
        .set({ status: "succeeded" })
        .where(
          and(
            eq(generationJobs.id, job.id),
            inArray(generationJobs.status, [...IN_FLIGHT_STATUSES]),
          ),
        )
        .returning({ id: generationJobs.id });
      if (claimed.length === 0) return; // another worker already claimed it
      await landSucceededJob(db, job, provider, status);
    } else if (status.status === "failed" || status.status === "canceled") {
      await db
        .update(generationJobs)
        .set({
          status: "failed",
          errorMessage: status.error ?? `Prediction ${status.status}`,
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

// Per-provider "is the token configured?" cache for one tick (cheap disk reads,
// but avoid hammering the store inside the queued loop).
async function configuredHosts(): Promise<Set<string>> {
  const set = new Set<string>();
  await Promise.all(
    (["replicate", "atlascloud", "wavespeedai"] as const).map(async (host) => {
      const p = getProvider(host);
      if (p && (await p.isConfigured())) set.add(host);
    }),
  );
  return set;
}

async function runTick(db: Db): Promise<void> {
  // 1. Poll everything currently in flight (any provider).
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
  if (queued.length === 0) return;

  // A job whose provider has no token stays queued (matches the old Replicate
  // behaviour) — don't fail it just because a key isn't set yet.
  const configured = await configuredHosts();
  for (const job of queued) {
    if (!configured.has(job.providerHost)) continue;
    // Atomically claim queued → submitted so a concurrent tick / second server
    // process can't double-submit the same job (which would waste a paid
    // prediction). Only the worker that flips the row proceeds.
    const claimed = await db
      .update(generationJobs)
      .set({ status: "submitted" })
      .where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, "queued")))
      .returning({ id: generationJobs.id });
    if (claimed.length === 0) continue; // another worker grabbed it
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
