/**
 * Image Studio — persona training helpers.
 *
 * Maps a built-in persona to its trigger word, content rating, and the local
 * directory holding its training photos, plus filesystem helpers for counting
 * photos and (eventually) zipping them for upload to Replicate.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface PersonaTrainingProfile {
  /** LoRA trigger word baked into the trained model. */
  triggerWord: string;
  /** 'sfw' | 'explicit' — explicit outputs are rejected from SFW-only surfaces. */
  contentRating: "sfw" | "explicit";
  /** Default directory of training photos for this persona. */
  defaultPhotosDir: string;
  /** Filesystem-safe slug used for the installed .safetensors filename. */
  slug: string;
  /**
   * Hyphenated slug used for the published Replicate model name + endpoint
   * (e.g. Sidney SFW → "sidney-sfw"). MUST match replicate-generator's
   * personaSlug so a freshly-trained persona resolves to the same model the
   * gallery generates against. (Distinct from `slug`, which is underscored to
   * match the trigger word / local .safetensors filename.)
   */
  modelSlug: string;
}

const HOME = os.homedir();

/**
 * Resolve the training profile for a persona by name. Sidney SFW/NSFW are the
 * two built-ins; anything else falls back to an SFW profile derived from the
 * name so the pipeline still works for future personas.
 */
export function personaTrainingProfile(name: string): PersonaTrainingProfile {
  const slug = slugify(name);
  const modelSlug = personaModelSlug(name);
  if (/nsfw/i.test(name)) {
    return {
      triggerWord: "sidney_nsfw",
      contentRating: "explicit",
      defaultPhotosDir: path.join(HOME, ".openclaw", "sidney-training-photos-nsfw"),
      slug,
      modelSlug,
    };
  }
  if (/sidney/i.test(name)) {
    return {
      triggerWord: "sidney_sfw",
      contentRating: "sfw",
      defaultPhotosDir: path.join(HOME, ".openclaw", "sidney-training-photos"),
      slug,
      modelSlug,
    };
  }
  return {
    triggerWord: `${slug}`,
    contentRating: "sfw",
    defaultPhotosDir: path.join(HOME, ".openclaw", `${slug}-training-photos`),
    slug,
    modelSlug,
  };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Hyphenated persona slug for the published Replicate model name/endpoint.
 * Kept byte-for-byte in sync with replicate-generator's `personaSlug` so a
 * persona trained here is generated against the same `<owner>/<slug>` model.
 */
export function personaModelSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "persona"
  );
}

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".tiff"]);

export interface PhotoCount {
  dir: string;
  exists: boolean;
  count: number;
}

/** Count image files in a training photos directory (non-recursive). */
export async function countTrainingPhotos(dir: string): Promise<PhotoCount> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const count = entries.filter(
      (e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()),
    ).length;
    return { dir, exists: true, count };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { dir, exists: false, count: 0 };
    throw err;
  }
}

/** Absolute path where a trained LoRA is installed for ComfyUI to pick up. */
export function loraInstallPath(slug: string): string {
  return path.join(HOME, ".comfyui", "models", "loras", `${slug}.safetensors`);
}

/**
 * Download a trained .safetensors from a Replicate output URL into ComfyUI's
 * loras directory. Returns the install path.
 */
export async function downloadLora(weightsUrl: string, slug: string): Promise<string> {
  const dest = loraInstallPath(slug);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(weightsUrl);
  if (!res.ok) throw new Error(`Failed to download LoRA weights (${res.status}) from ${weightsUrl}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
  return dest;
}

/** Default training hyperparameters for the flux-dev-lora-trainer. */
export function defaultHyperparams(triggerWord: string): Record<string, unknown> {
  return {
    steps: 1500,
    lora_rank: 16,
    batch_size: 1,
    autocaption: true,
    trigger_word: triggerWord,
  };
}
