/**
 * Image Studio — uploads directory.
 *
 * Persona gallery images (test previews + production renders) live under the
 * Paperclip instance's uploads dir and are served read-only at /api/uploads/...
 * (see app.ts). Paths stored in persona_generations.image_path are RELATIVE to
 * this root, e.g. 'personas/sidney-sfw/test-001.png'.
 */
import path from "node:path";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";

/** Absolute path to the uploads root (created lazily by writers). */
export function uploadsRoot(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "data", "uploads");
}

/**
 * Resolve a relative uploads path to an absolute one, guarding against
 * traversal outside the uploads root. Returns null for unsafe input.
 */
export function resolveUploadPath(relPath: string): string | null {
  const root = uploadsRoot();
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.split("/").some((p) => p === "." || p === "..")) {
    return null;
  }
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}
