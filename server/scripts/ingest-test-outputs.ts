/**
 * One-shot ingestion of hand-curated persona TEST outputs into
 * `persona_generations` so the Image Studio gallery picks them up.
 *
 * Augi/August drop rendered PNGs + JSON sidecars into a flat output dir, e.g.
 *   ~/.openclaw/sidney-test-output/sidney-nsfw-test-002.png
 *   ~/.openclaw/sidney-test-output/sidney-nsfw-test-002.json
 * The long-running gallery watcher from the earlier task has exited, so this
 * script does a one-shot sweep to catch up anything not yet in the DB.
 *
 * Glob-pattern based so it handles BOTH rating partitions:
 *   sidney-<sfw|nsfw>-test-<NNN>.png  →  persona "Sidney SFW" / "Sidney NSFW"
 *
 * For each PNG that HAS a matching .json sidecar and is NOT already in the DB:
 *   1. copy PNG       → <uploadsRoot>/personas/<slug>/test-<NNN>.png
 *   2. JPEG thumbnail → <uploadsRoot>/personas/<slug>/thumbnails/test-<NNN>.jpg
 *   3. INSERT persona_generations with the REAL sidecar prompt, source='test',
 *      content_rating from the partition, replicate_prediction_id from sidecar.
 *
 * Idempotent: a PNG whose image_path already has a row is skipped, so re-running
 * never duplicates. PNGs without a sidecar (e.g. *-test-001.png) are skipped.
 *
 * Sidecar shape: { prompt, lora_scale, seed, prediction_id, version, steps,
 *                  guidance_scale, aspect_ratio, generated_at }
 *
 * Usage (from repo root):
 *   DATABASE_URL="postgres://paperclip:paperclip@127.0.0.1:54329/paperclip" \
 *   pnpm --filter @paperclipai/server exec tsx scripts/ingest-test-outputs.ts
 *
 * Optional env:
 *   INGEST_SOURCE_DIR   override the source dir (default ~/.openclaw/sidney-test-output)
 *   REPLICATE_ACCOUNT   owner used in the model ref (default "tymines")
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { and, eq, isNull } from "drizzle-orm";
import { createDb, imageProviders, personaGenerations } from "@paperclipai/db";
import { resolveDatabaseTarget } from "@paperclipai/db/runtime-config";
import { uploadsRoot } from "../src/services/image-studio/uploads.js";
import { personaSlug } from "../src/services/replicate-generator.js";

interface Sidecar {
  prompt?: string;
  lora_scale?: number;
  seed?: number;
  prediction_id?: string;
  version?: string;
  steps?: number;
  guidance_scale?: number;
  aspect_ratio?: string;
  generated_at?: string;
}

/** Resolve a usable Postgres URL: explicit DATABASE_URL, else the running embedded PG. */
function resolveDbUrl(): string {
  const target = resolveDatabaseTarget();
  if (target.mode === "postgres") return target.connectionString;
  // Embedded PG uses fixed paperclip:paperclip creds (see migration-runtime.ts).
  return `postgres://paperclip:paperclip@127.0.0.1:${target.port}/paperclip`;
}

function sourceDir(): string {
  const override = process.env.INGEST_SOURCE_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".openclaw", "sidney-test-output");
}

const FILE_RE = /^sidney-(sfw|nsfw)-test-(\d+)\.png$/i;

async function main(): Promise<void> {
  const url = resolveDbUrl();
  const db = createDb(url);
  const dir = sourceDir();
  const account = process.env.REPLICATE_ACCOUNT?.trim() || "tymines";

  const entries = (await fs.readdir(dir)).filter((f) => FILE_RE.test(f)).sort();
  const root = uploadsRoot();

  let ingested = 0;
  let skippedNoSidecar = 0;
  let skippedExisting = 0;
  const byRating: Record<string, number> = { sfw: 0, explicit: 0 };

  // Cache persona rows by partition name.
  const personaCache = new Map<string, typeof imageProviders.$inferSelect>();
  async function loadPersona(name: string) {
    if (personaCache.has(name)) return personaCache.get(name)!;
    const [row] = await db
      .select()
      .from(imageProviders)
      .where(
        and(
          eq(imageProviders.name, name),
          eq(imageProviders.type, "local_lora"),
          isNull(imageProviders.companyId),
        ),
      )
      .limit(1);
    if (row) personaCache.set(name, row);
    return row ?? null;
  }

  for (const file of entries) {
    const m = FILE_RE.exec(file)!;
    const ratingTag = m[1].toLowerCase(); // 'sfw' | 'nsfw'
    const nnn = m[2]; // e.g. '002'
    const contentRating: "sfw" | "explicit" = ratingTag === "nsfw" ? "explicit" : "sfw";
    const personaName = ratingTag === "nsfw" ? "Sidney NSFW" : "Sidney SFW";

    const sidecarPath = path.join(dir, file.replace(/\.png$/i, ".json"));
    let sidecar: Sidecar | null = null;
    try {
      sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf8")) as Sidecar;
    } catch {
      console.log(`skip ${file} — no .json sidecar`);
      skippedNoSidecar += 1;
      continue;
    }
    if (!sidecar?.prompt) {
      console.log(`skip ${file} — sidecar has no prompt`);
      skippedNoSidecar += 1;
      continue;
    }

    const persona = await loadPersona(personaName);
    if (!persona) {
      console.log(`skip ${file} — persona "${personaName}" not found`);
      continue;
    }
    const slug = personaSlug(persona.name); // sidney-sfw | sidney-nsfw
    const relImage = path.posix.join("personas", slug, `test-${nnn}.png`);
    const relThumb = path.posix.join("personas", slug, "thumbnails", `test-${nnn}.jpg`);

    // Idempotency: skip if a row already exists for this image path.
    const [existing] = await db
      .select({ id: personaGenerations.id })
      .from(personaGenerations)
      .where(
        and(
          eq(personaGenerations.personaId, persona.id),
          eq(personaGenerations.imagePath, relImage),
        ),
      )
      .limit(1);
    if (existing) {
      console.log(`skip ${file} — already ingested (${relImage})`);
      skippedExisting += 1;
      continue;
    }

    // Copy the PNG into the uploads dir.
    const absImage = path.join(root, relImage);
    const absThumb = path.join(root, relThumb);
    await fs.mkdir(path.dirname(absImage), { recursive: true });
    await fs.mkdir(path.dirname(absThumb), { recursive: true });
    const buf = await fs.readFile(path.join(dir, file));
    await fs.writeFile(absImage, buf);

    // JPEG thumbnail (matches the existing test-001 convention).
    try {
      const thumb = await sharp(buf).resize(512, 512, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
      await fs.writeFile(absThumb, thumb);
    } catch (err) {
      console.warn(`  thumbnail failed for ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }

    await db.insert(personaGenerations).values({
      personaId: persona.id,
      source: "test",
      prompt: sidecar.prompt,
      loraStrength: sidecar.lora_scale != null ? String(sidecar.lora_scale) : null,
      model: `${account}/${slug}`,
      imagePath: relImage,
      thumbnailPath: relThumb,
      generationMetadata: {
        seed: sidecar.seed,
        steps: sidecar.steps,
        guidance_scale: sidecar.guidance_scale,
        aspect_ratio: sidecar.aspect_ratio,
        version: sidecar.version,
        generated_at: sidecar.generated_at,
        prediction_id: sidecar.prediction_id,
        source_file: file,
      },
      replicatePredictionId: sidecar.prediction_id ?? null,
      costUsd: null,
      contentRating,
    });

    console.log(`ingested ${file} → ${relImage} (${contentRating})`);
    ingested += 1;
    byRating[contentRating] += 1;
  }

  console.log(
    `\nDone. ingested=${ingested} (sfw=${byRating.sfw}, explicit=${byRating.explicit}), ` +
      `skipped_no_sidecar=${skippedNoSidecar}, skipped_existing=${skippedExisting}`,
  );

  // postgres-js keeps the process alive; close the pool (best-effort).
  await (db as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.().catch(() => {});
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ingestion failed:", err);
    process.exit(1);
  });
