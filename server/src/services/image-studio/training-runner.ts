/**
 * Orchestrates a real persona training run on Replicate:
 *   zip photos → upload → ensure destination model → create training → record.
 *
 * Used by the POST .../personas/:id/train route once a Replicate token is set.
 * Zipping shells out to the system `zip` (present on macOS/Linux hosts).
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Db } from "@paperclipai/db";
import { loraTrainingJobs, type LoraTrainingJob } from "@paperclipai/db";
import {
  getReplicateToken,
  getReplicateAccount,
  getLatestTrainerVersion,
  uploadReplicateFile,
  ensureReplicateModel,
  createReplicateTraining,
} from "../replicate/index.js";
import { personaTrainingProfile, defaultHyperparams } from "./training.js";

const execFileAsync = promisify(execFile);

async function zipDir(dir: string, slug: string): Promise<string> {
  const zipPath = path.join(os.tmpdir(), `${slug}-training-${process.pid}.zip`);
  await fs.rm(zipPath, { force: true });
  // -j would flatten; trainer accepts a flat zip of images. Use relative paths.
  await execFileAsync("zip", ["-rq", zipPath, ".", "-x", ".*"], { cwd: dir });
  return zipPath;
}

export interface StartTrainingArgs {
  persona: { id: string; name: string };
  trainer: { id: string };
  photosDir: string;
  companyId: string | null;
}

/**
 * Fire a training run and persist a lora_training_jobs row.
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

  const destName = profile.slug; // e.g. tymines/sidney-sfw
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
  return job;
}
