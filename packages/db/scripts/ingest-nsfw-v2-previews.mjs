/**
 * NSFW PhotoShoot v2 preview ingestion (auto-replace low-quality previews).
 *
 * Hermes is re-firing the 15 NSFW PhotoShoot category previews at 28 steps /
 * 1024² with anatomy quality hints, saving each as `<key>_v2.png`. When those
 * outputs land this script:
 *   1. picks up any `<key>_v2.png` under previews/nsfw/ (flat OR nested in
 *      previews/nsfw/<key>/),
 *   2. copies it to <uploads>/attribute-previews/nsfw/<key>/<key>_v2.png +
 *      a 256px thumbnail,
 *   3. repoints the matching explicit photoshoot template's
 *      preview_image_path to the v2 path — replacing the current low-quality
 *      version.
 *
 * Mirrors the SFW v2 flow in ingest-photoshoot-previews.mjs (sips thumbnails,
 * idempotent, embedded dev PG by default). Re-running is safe.
 *
 * Usage: node packages/db/scripts/ingest-nsfw-v2-previews.mjs
 *   env: PAPERCLIP_UPLOADS  (default ~/.paperclip/instances/default/data/uploads)
 *        PAPERCLIP_PREVIEWS (default ~/.openclaw/sidney-test-output/previews)
 *        DATABASE_URL       (default embedded dev PG)
 */
import { existsSync, readdirSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

const HOME = os.homedir();
const UPLOADS = process.env.PAPERCLIP_UPLOADS ?? `${HOME}/.paperclip/instances/default/data/uploads`;
const PREVIEWS = process.env.PAPERCLIP_PREVIEWS ?? `${HOME}/.openclaw/sidney-test-output/previews`;
const DB = process.env.DATABASE_URL ?? "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
const DEST = `${UPLOADS}/attribute-previews`;
const NSFW_ROOT = `${PREVIEWS}/nsfw`;

function copyWithThumb(src, destPng) {
  mkdirSync(path.dirname(destPng), { recursive: true });
  mkdirSync(path.join(path.dirname(destPng), "thumbnails"), { recursive: true });
  copyFileSync(src, destPng);
  try {
    execFileSync(
      "sips",
      ["-Z", "256", src, "--out", path.join(path.dirname(destPng), "thumbnails", path.basename(destPng))],
      { stdio: "ignore" },
    );
  } catch {
    // Thumbnail is best-effort (sips is macOS-only); the full PNG still lands.
  }
}

/** Collect every `<key>_v2.png` under previews/nsfw/ (flat or nested). */
function findV2Files(root) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    const full = `${root}/${entry}`;
    const st = statSync(full);
    if (st.isFile() && /_v2\.png$/i.test(entry)) {
      out.push({ key: entry.replace(/_v2\.png$/i, ""), src: full });
    } else if (st.isDirectory()) {
      // Nested previews/nsfw/<key>/<key>_v2.png (or any *_v2.png inside).
      for (const f of readdirSync(full).filter((f) => /_v2\.png$/i.test(f))) {
        out.push({ key: f.replace(/_v2\.png$/i, "") || entry, src: `${full}/${f}` });
      }
    }
  }
  return out;
}

const sql = postgres(DB, { max: 1 });
let copied = 0,
  repointed = 0,
  unmatched = 0;
try {
  const v2 = findV2Files(NSFW_ROOT);
  if (v2.length === 0) {
    console.log(`ingest-nsfw-v2: no *_v2.png found under ${NSFW_ROOT} (nothing to do)`);
  }
  for (const { key, src } of v2) {
    const rel = `attribute-previews/nsfw/${key}/${key}_v2.png`;
    copyWithThumb(src, `${DEST}/nsfw/${key}/${key}_v2.png`);
    copied++;

    // Match the explicit photoshoot template by its existing per-key preview
    // path (the originals live at attribute-previews/nsfw/<key>/<key>.png), and
    // tolerate a row already repointed to the v2 path (idempotent re-runs).
    const origRel = `attribute-previews/nsfw/${key}/${key}.png`;
    const rows = await sql`
      UPDATE prompt_templates
         SET preview_image_path = ${rel}
       WHERE category = 'photoshoot'
         AND content_rating = 'explicit'
         AND (preview_image_path = ${origRel}
              OR preview_image_path = ${rel}
              OR preview_image_path LIKE ${`attribute-previews/nsfw/${key}/%`})
       RETURNING id`;
    if (rows.length > 0) {
      repointed += rows.length;
    } else {
      unmatched++;
      console.warn(`ingest-nsfw-v2: no template matched key '${key}' (copied PNG, preview not repointed)`);
    }
  }
  console.log(
    `ingest-nsfw-v2: copied ${copied} v2 preview(s), repointed ${repointed} template(s), ${unmatched} unmatched`,
  );
} finally {
  await sql.end();
}
