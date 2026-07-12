// Creative Studio R2 — local asset store for REST providers that return bytes
// (Gemini/Imagen b64, OpenAI gpt-image b64) or short-lived URLs (Veo file URIs).
// Files land in CREATIVE_ASSETS_DIR and are served by the creative-assets route
// with a traversal guard (same pattern as book-studio narration-audio).

import { promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const CREATIVE_ASSETS_DIR = process.env.CREATIVE_ASSETS_DIR
  || path.join(process.env.HOME || "/tmp", "paperclip", "creative-assets");

const EXT_SAFE = /^[a-z0-9]{1,5}$/i;

export async function saveAssetBuffer(buf: Buffer, ext: string): Promise<{ filename: string }> {
  const safeExt = EXT_SAFE.test(ext) ? ext.toLowerCase() : "bin";
  const filename = `${randomUUID()}.${safeExt}`;
  await fsp.mkdir(CREATIVE_ASSETS_DIR, { recursive: true });
  await fsp.writeFile(path.join(CREATIVE_ASSETS_DIR, filename), buf);
  return { filename };
}

export async function saveAssetFromUrl(url: string, ext: string, headers?: Record<string, string>): Promise<{ filename: string }> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`asset download failed: HTTP ${res.status}`);
  return saveAssetBuffer(Buffer.from(await res.arrayBuffer()), ext);
}

/** URL path (client-side) for a stored asset within a company scope. */
export function assetUrlPath(companyId: string, filename: string): string {
  return `/api/companies/${companyId}/creative-assets/${filename}`;
}

/** Resolve + guard a requested filename; returns absolute path or null if unsafe/missing chars. */
export function resolveAssetPath(filename: string): string | null {
  if (!/^[a-z0-9-]+\.[a-z0-9]{1,5}$/i.test(filename)) return null;
  const resolved = path.resolve(CREATIVE_ASSETS_DIR, filename);
  if (!resolved.startsWith(path.resolve(CREATIVE_ASSETS_DIR))) return null;
  return resolved;
}
