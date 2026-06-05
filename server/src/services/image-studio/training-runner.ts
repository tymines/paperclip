/**
 * Orchestrates a real persona training run on Replicate:
 *   zip photos → upload → ensure destination model → create training → record,
 * then flips the persona's status and (on completion) registers the trained
 * model endpoint so the gallery generates against it.
 *
 * Used by the POST .../personas/:id/train route once a Replicate token is set.
 * Zipping shells out to the system `zip` (present on macOS/Linux hosts).
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq, like } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  assets,
  imageProviders,
  loraTrainingJobs,
  type LoraTrainingJob,
} from "@paperclipai/db";
import type { StorageService } from "../../storage/types.js";
import {
  getReplicateToken,
  getReplicateAccount,
  getLatestTrainerVersion,
  uploadReplicateFile,
  ensureReplicateModel,
  createReplicateTraining,
  getReplicateTraining,
  extractWeightsUrl,
} from "../replicate/index.js";
import { personaTrainingProfile, defaultHyperparams, downloadLora } from "./training.js";

const execFileAsync = promisify(execFile);

async function zipDir(dir: string, slug: string): Promise<string> {
  const zipPath = path.join(os.tmpdir(), `${slug}-training-${process.pid}.zip`);
  await fs.rm(zipPath, { force: true });
  // -j would flatten; trainer accepts a flat zip of images. Use relative paths.
  await execFileAsync("zip", ["-rq", zipPath, ".", "-x", ".*"], { cwd: dir });
  return zipPath;
}

const STAGE_IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export interface StagedPhotos {
  dir: string;
  count: number;
}

/**
 * Materialise the photos the wizard uploaded for a persona (stored in the asset
 * store under the `assets/personas/<id>/training` namespace) into a flat temp
 * directory the trainer can zip. Returns null when no uploaded photos exist so
 * callers fall back to a server-side default photos dir.
 */
export async function stagePersonaTrainingPhotos(
  db: Db,
  storage: StorageService,
  companyId: string,
  personaId: string,
): Promise<StagedPhotos | null> {
  const prefix = `${companyId}/assets/personas/${personaId}/training/`;
  const rows = await db
    .select({ objectKey: assets.objectKey, originalFilename: assets.originalFilename })
    .from(assets)
    .where(and(eq(assets.companyId, companyId), like(assets.objectKey, `${prefix}%`)));
  if (rows.length === 0) return null;

  const dir = path.join(os.tmpdir(), `persona-train-${personaId}-${process.pid}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });

  let count = 0;
  for (const row of rows) {
    try {
      const obj = await storage.getObject(companyId, row.objectKey);
      const buf = await readStreamToBuffer(obj.stream);
      if (buf.length === 0) continue;
      const base = path.basename(row.originalFilename ?? row.objectKey);
      const ext = path.extname(base).toLowerCase();
      const safeExt = STAGE_IMAGE_EXT.has(ext) ? ext : ".png";
      // Unique, ordinal filenames — original names may collide or be unsafe.
      const fileName = `photo-${String(count + 1).padStart(3, "0")}${safeExt}`;
      await fs.writeFile(path.join(dir, fileName), buf);
      count += 1;
    } catch {
      // Skip an unreadable asset rather than failing the whole run.
    }
  }
  if (count === 0) {
    await fs.rm(dir, { recursive: true, force: true });
    return null;
  }
  return { dir, count };
}

export interface StartTrainingArgs {
  persona: { id: string; name: string };
  trainer: { id: string };
  photosDir: string;
  companyId: string | null;
}

/**
 * Fire a training run and persist a lora_training_jobs row. Also flips the
 * persona's status to 'training' so the list/Studio reflect it immediately.
 * Throws if no token is configured.
 */
export async function startPersonaTraining(
  db: Db,
  args: StartTrainingArgs,
): Promise<LoraTrainingJob> {
  const token = await getReplicateToken();
  if (!token) {
    throw new Error(
      "REPLICATE_API_TOKEN not set — save a token via POST /api/credentials/replicate first.",
    );
  }
  const profile = personaTrainingProfile(args.persona.name);
  const account = await getReplicateAccount(token);
  if (!account?.username) throw new Error("Could not resolve Replicate account username");

  const zipPath = await zipDir(args.photosDir, profile.slug);
  const zipBuf = await fs.readFile(zipPath);
  const inputImages = await uploadReplicateFile(zipBuf, `${profile.slug}.zip`, token);

  // Published model name + endpoint use the hyphenated slug so the gallery
  // (replicate-generator.personaSlug) resolves the same `<owner>/<slug>` model.
  const destName = profile.modelSlug; // e.g. tymines/sidney-sfw
  await ensureReplicateModel(account.username, destName, token);
  const version = await getLatestTrainerVersion(token);

  const training = await createReplicateTraining({
    inputImages,
    triggerWord: profile.triggerWord,
    destination: `${account.username}/${destName}`,
    steps: 1500,
    loraRank: 16,
    batchSize: 1,
    autocaption: true,
    version,
  });

  const [job] = await db
    .insert(loraTrainingJobs)
    .values({
      companyId: args.companyId,
      personaId: args.persona.id,
      providerId: args.trainer.id,
      status: "training",
      contentRating: profile.contentRating,
      externalJobId: training.id,
      trainingZipPath: zipPath,
      triggerWord: profile.triggerWord,
      progress: 5,
      startedAt: new Date(),
      hyperparams: defaultHyperparams(profile.triggerWord),
    })
    .returning();

  // Reflect the in-flight training on the persona row immediately.
  await db
    .update(imageProviders)
    .set({
      status: "training",
      statusDetail: "Training on Replicate…",
      updatedAt: new Date(),
    })
    .where(eq(imageProviders.id, args.persona.id));

  return job;
}

/** Map a Replicate training status onto our lora_training_jobs status enum. */
export function mapTrainingStatus(
  status: string,
): "training" | "downloading" | "ready" | "failed" {
  switch (status) {
    case "succeeded":
      return "downloading";
    case "failed":
    case "canceled":
      return "failed";
    default:
      // starting | processing
      return "training";
  }
}

/**
 * Poll Replicate once for a training job and apply the result to BOTH the job
 * row and its persona (status → ready/failed, endpoint registration on success).
 * Idempotent and non-throwing: returns the last-known job on any poll error so
 * it is safe to call from a request handler or a background loop.
 */
export async function syncTrainingJob(db: Db, job: LoraTrainingJob): Promise<LoraTrainingJob> {
  if (job.status === "ready" || job.status === "failed") return job;
  if (!job.externalJobId) return job;
  const token = await getReplicateToken();
  if (!token) return job;

  let training;
  try {
    training = await getReplicateTraining(job.externalJobId);
  } catch {
    return job;
  }

  const next = mapTrainingStatus(training.status);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  let personaPatch: Record<string, unknown> | null = null;

  if (next === "failed") {
    patch.status = "failed";
    patch.errorMessage = training.error ?? "Training failed on Replicate";
    patch.completedAt = new Date();
    // Hand the persona back a retry affordance.
    personaPatch = {
      status: "untrained",
      statusDetail: `Training failed — ${patch.errorMessage}`,
    };
  } else if (next === "downloading") {
    const weights = extractWeightsUrl(training);
    if (weights) {
      const [persona] = await db
        .select()
        .from(imageProviders)
        .where(eq(imageProviders.id, job.personaId))
        .limit(1);
      const profile = personaTrainingProfile(persona?.name ?? "persona");
      const installed = await downloadLora(weights, profile.slug);
      patch.status = "ready";
      patch.outputLoraPath = installed;
      patch.progress = 100;
      patch.completedAt = new Date();
      const seconds = training.metrics?.total_time ?? training.metrics?.predict_time;
      // H100 ~ $0.001525/s; fall back to the flat ~$3 estimate.
      patch.costUsd = seconds ? (seconds * 0.001525).toFixed(4) : "3.0000";
      const account = await getReplicateAccount(token);
      const endpoint = account?.username
        ? `${account.username}/${profile.modelSlug}`
        : null;
      personaPatch = {
        status: "ready",
        statusDetail: "LoRA trained — ready for generation.",
        ...(endpoint ? { endpoint } : {}),
      };
    } else {
      patch.status = "downloading";
    }
  } else {
    patch.status = "training";
  }

  const [updated] = await db
    .update(loraTrainingJobs)
    .set(patch)
    .where(eq(loraTrainingJobs.id, job.id))
    .returning();

  if (personaPatch) {
    await db
      .update(imageProviders)
      .set({ ...personaPatch, updatedAt: new Date() })
      .where(eq(imageProviders.id, job.personaId));
  }

  return updated ?? job;
}

/**
 * Kick off a fire-and-forget background poller that drives a training job to a
 * terminal state (downloading the LoRA + flipping the persona to ready) even if
 * no client is polling the status route. Self-stops on completion or after a
 * safety timeout.
 */
export function startBackgroundTrainingPoller(
  db: Db,
  jobId: string,
  opts: { intervalMs?: number; maxMs?: number } = {},
): void {
  const intervalMs = opts.intervalMs ?? 15_000;
  const maxMs = opts.maxMs ?? 45 * 60_000;
  const startedAt = Date.now();

  const schedule = (fn: () => void) => {
    const t = setTimeout(fn, intervalMs);
    // Don't keep the event loop alive on shutdown.
    (t as { unref?: () => void }).unref?.();
  };

  const tick = async (): Promise<void> => {
    try {
      const [job] = await db
        .select()
        .from(loraTrainingJobs)
        .where(eq(loraTrainingJobs.id, jobId))
        .limit(1);
      if (!job) return;
      const updated = await syncTrainingJob(db, job);
      if (updated.status === "ready" || updated.status === "failed") return;
      if (Date.now() - startedAt > maxMs) return;
      schedule(tick);
    } catch {
      if (Date.now() - startedAt > maxMs) return;
      schedule(tick);
    }
  };

  schedule(tick);
}
