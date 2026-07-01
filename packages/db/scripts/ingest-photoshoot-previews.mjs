/**
 * Reusable PhotoShoot preview ingestion.
 *
 *  1. Copies SFW photoshoot preview PNGs (previews/sfw/photoshoot-batch2/*.png)
 *     into <uploads>/attribute-previews/sfw/photoshoot/ + 256px thumbnails.
 *  2. Auto-picks up NSFW category sidecars Augi posts under previews/nsfw/<key>/
 *     <key>.png (+ .json): for any whose name isn't already a template, inserts a
 *     SHARED (persona_id NULL) explicit photoshoot template using the sidecar's
 *     prompt, copies the PNG, and sets preview_image_path.
 *
 * Idempotent. Usage: node packages/db/scripts/ingest-photoshoot-previews.mjs
 *   env: PAPERCLIP_UPLOADS (default ~/.paperclip/instances/default/data/uploads)
 *        PAPERCLIP_PREVIEWS (default ~/.openclaw/sidney-test-output/previews)
 *        DATABASE_URL (default embedded dev PG)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

const HOME = os.homedir();
const UPLOADS = process.env.PAPERCLIP_UPLOADS ?? `${HOME}/.paperclip/instances/default/data/uploads`;
const PREVIEWS = process.env.PAPERCLIP_PREVIEWS ?? `${HOME}/.openclaw/sidney-test-output/previews`;
const DB = process.env.DATABASE_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const DEST = `${UPLOADS}/attribute-previews`;

// Friendly names for Augi's known NSFW keys; otherwise derive from the key.
const NSFW_NAME = {
  hentai_style: "Hentai Style 18+", bdsm_aesthetics: "BDSM aesthetics", bdsm: "BDSM aesthetics",
  auto_18: "Auto 18+", auto_nsfw: "Auto 18+",
};
const title = (k) => k.split(/[_-]/).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

function copyWithThumb(src, destPng) {
  mkdirSync(path.dirname(destPng), { recursive: true });
  mkdirSync(path.join(path.dirname(destPng), "thumbnails"), { recursive: true });
  copyFileSync(src, destPng);
  try { execFileSync("sips", ["-Z", "256", src, "--out", path.join(path.dirname(destPng), "thumbnails", path.basename(destPng))], { stdio: "ignore" }); } catch {}
}

const sql = postgres(DB, { max: 1 });
let copied = 0, inserted = 0;
try {
  // 1. SFW batch2 → uploads/attribute-previews/sfw/photoshoot
  const sfwDir = `${PREVIEWS}/sfw/photoshoot-batch2`;
  if (existsSync(sfwDir)) {
    for (const f of readdirSync(sfwDir).filter((f) => f.endsWith(".png"))) {
      copyWithThumb(`${sfwDir}/${f}`, `${DEST}/sfw/photoshoot/${f}`);
      copied++;
    }
  }

  // 2. NSFW auto-pickup: previews/nsfw/<key>/<key>.png + sidecar
  const nsfwRoot = `${PREVIEWS}/nsfw`;
  if (existsSync(nsfwRoot)) {
    for (const key of readdirSync(nsfwRoot)) {
      const dir = `${nsfwRoot}/${key}`;
      if (!statSync(dir).isDirectory()) continue;
      const png = `${dir}/${key}.png`, side = `${dir}/${key}.json`;
      if (!existsSync(png) || !existsSync(side)) continue;
      const meta = JSON.parse(readFileSync(side, "utf8"));
      const name = meta.name ?? NSFW_NAME[key] ?? title(key);
      const rel = `attribute-previews/nsfw/${key}/${key}.png`;
      copyWithThumb(png, `${DEST}/nsfw/${key}/${key}.png`);
      copied++;
      const [exists] = await sql`SELECT id FROM prompt_templates WHERE category='photoshoot' AND (preview_image_path=${rel} OR name=${name})`;
      if (exists) {
        await sql`UPDATE prompt_templates SET preview_image_path=${rel}, template_text=${meta.prompt} WHERE id=${exists.id}`;
      } else {
        await sql`INSERT INTO prompt_templates
          (name, persona_id, template_text, attribute_preset, preview_image_path, category, gender_targeting,
           default_lora_scale, default_steps, default_guidance, default_aspect_ratio, content_rating)
          VALUES (${name}, NULL, ${meta.prompt}, '{}'::jsonb, ${rel}, 'photoshoot', 'female', 1.0, 28, 3.5, '1:1', 'explicit')`;
        inserted++;
      }
    }
  }
  console.log(`ingest: copied ${copied} previews, inserted ${inserted} new NSFW templates`);
} finally {
  await sql.end();
}
