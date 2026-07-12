/**
 * Shared media plumbing for the social-scheduler adapters + routes.
 *
 * Two publishing styles exist across the five v1 platforms:
 *
 *   1. **Fetch-by-URL** (Instagram / Threads / Facebook photo+video):
 *      Meta's servers download the media from a URL we hand them. That URL
 *      must be reachable from the public internet — a localhost / LAN /
 *      tailnet URL can never work. `assertPubliclyFetchableMediaUrl()` is
 *      the data-honesty gate: it fails loudly (naming the config key that
 *      fixes it, `PAPERCLIP_PUBLIC_URL`) instead of letting Meta return an
 *      opaque "media download failed".
 *
 *   2. **Upload-the-bytes** (X media upload, Reddit asset lease): the
 *      adapter downloads the bytes itself (`fetchMediaBytes`) and pushes
 *      them to the platform. Any server-reachable URL works here,
 *      including the loopback self-URL the upload route falls back to
 *      when no public base URL is configured.
 *
 * The upload route (`routes/social-media.ts`) stores composer uploads via
 * the existing StorageService (same `bulk_uploads` table the Bulk Upload
 * tab uses, `draft_id = NULL`) and serves them back on a token-guarded
 * public endpoint. The token is an HMAC-style digest over the row's
 * unguessable random storage key, so no new secret material or DB column
 * is needed.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { loadConfig } from "../../config.js";

/** Composer upload allowlist — deliberately narrower than bulk upload. */
export const SOCIAL_MEDIA_IMAGE_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);
export const SOCIAL_MEDIA_VIDEO_MIMES: ReadonlySet<string> = new Set(["video/mp4"]);

export const SOCIAL_MEDIA_IMAGE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
export const SOCIAL_MEDIA_VIDEO_MAX_BYTES = 300 * 1024 * 1024; // 300 MB

export type SocialMediaKind = "image" | "video";

export function detectSocialMediaKind(mimeType: string): SocialMediaKind | null {
  const mime = mimeType.toLowerCase();
  if (SOCIAL_MEDIA_IMAGE_MIMES.has(mime)) return "image";
  if (SOCIAL_MEDIA_VIDEO_MIMES.has(mime)) return "video";
  return null;
}

/**
 * Thrown when a fetch-by-URL platform is handed media the platform could
 * never download (private-network URL, or no public base URL configured).
 * The scheduler surfaces `message` verbatim on the target's errorMessage.
 */
export class MediaPublicUrlError extends Error {
  readonly statusCode = 422;
  constructor(message: string) {
    super(message);
    this.name = "MediaPublicUrlError";
  }
}

/** Thrown when the server itself cannot download the media bytes. */
export class MediaFetchError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "MediaFetchError";
    this.statusCode = statusCode;
  }
}

/**
 * Deterministic access token for the public serving endpoint. Keyed on the
 * storage object key, which `StorageService.putFile` suffixes with a
 * `randomUUID()` — unguessable without DB access, so the digest works as a
 * capability token without new secret infrastructure.
 */
export function socialMediaToken(uploadId: string, storageKey: string): string {
  return createHash("sha256")
    .update(`paperclip-social-media:${uploadId}:${storageKey}`)
    .digest("hex");
}

export function verifySocialMediaToken(
  candidate: string,
  uploadId: string,
  storageKey: string,
): boolean {
  const expected = socialMediaToken(uploadId, storageKey);
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** App-relative path of the token-guarded public serving endpoint. */
export function publicSocialMediaPath(uploadId: string, token: string): string {
  return `/api/public/social-media/${uploadId}/${token}/content`;
}

// loadConfig() shells out to detect the tailnet bind host, so it's too
// heavy to run per uploaded file — cache the two derived base URLs after
// the first read (config is process-stable in practice).
let cachedBaseUrls: { publicBaseUrl: string | null; selfBaseUrl: string } | null = null;

function baseUrls(): { publicBaseUrl: string | null; selfBaseUrl: string } {
  if (!cachedBaseUrls) {
    const config = loadConfig();
    const raw = config.authPublicBaseUrl?.trim();
    cachedBaseUrls = {
      publicBaseUrl: raw ? raw.replace(/\/+$/, "") : null,
      selfBaseUrl: `http://127.0.0.1:${config.port}`,
    };
  }
  return cachedBaseUrls;
}

/** Test hook — clear the cached base URLs so config changes are re-read. */
export function __resetMediaBaseUrlCacheForTesting(): void {
  cachedBaseUrls = null;
}

/**
 * Public base URL of this Paperclip instance, if configured. Sourced from
 * `PAPERCLIP_PUBLIC_URL` / `PAPERCLIP_AUTH_PUBLIC_BASE_URL` /
 * `auth.publicBaseUrl` in config.json (see `loadConfig()`).
 */
export function resolvePublicBaseUrl(): string | null {
  return baseUrls().publicBaseUrl;
}

/**
 * Loopback base URL — always reachable from this server process. Used by
 * upload-the-bytes platforms (X, Reddit) when no public URL is configured.
 */
export function resolveSelfBaseUrl(): string {
  return baseUrls().selfBaseUrl;
}

export interface PublishMediaUrl {
  /** Absolute URL usable in a post's mediaUrls. */
  url: string;
  /**
   * True when the URL is under the configured public base URL and can be
   * fetched by Meta-family platforms. False = loopback fallback (fine for
   * X/Reddit byte uploads, honest error for IG/FB/Threads).
   */
  publiclyFetchable: boolean;
}

/** Absolute publish URL for a composer upload row. */
export function buildPublishMediaUrl(uploadId: string, storageKey: string): PublishMediaUrl {
  const token = socialMediaToken(uploadId, storageKey);
  const path = publicSocialMediaPath(uploadId, token);
  const publicBase = resolvePublicBaseUrl();
  if (publicBase) return { url: `${publicBase}${path}`, publiclyFetchable: true };
  return { url: `${resolveSelfBaseUrl()}${path}`, publiclyFetchable: false };
}

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /\.ts\.net$/i, // tailnet MagicDNS — reachable for us, not for Meta
];

export function isPrivateMediaHost(hostname: string): boolean {
  const host = hostname.trim();
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(host));
}

/**
 * Data-honesty gate for fetch-by-URL platforms. Throws
 * `MediaPublicUrlError` with the exact requirement + config key when the
 * platform's servers could never download this URL.
 */
export function assertPubliclyFetchableMediaUrl(
  url: string,
  opts: { platform: string; action: string },
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MediaPublicUrlError(
      `${opts.platform}: cannot ${opts.action} — media reference "${url.slice(0, 120)}" is not an ` +
        "absolute URL. Attach media through the composer upload (or paste a public https URL).",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new MediaPublicUrlError(
      `${opts.platform}: cannot ${opts.action} — media URL must be http(s), got "${parsed.protocol}".`,
    );
  }
  if (isPrivateMediaHost(parsed.hostname)) {
    throw new MediaPublicUrlError(
      `${opts.platform}: cannot ${opts.action} — ${opts.platform} downloads media from the URL you ` +
        `provide, and "${parsed.hostname}" is not reachable from the public internet. Set ` +
        "PAPERCLIP_PUBLIC_URL (or auth.publicBaseUrl in config.json) to this server's public " +
        "https URL and re-attach the media, or host the file on a public CDN.",
    );
  }
}

export interface FetchedMedia {
  buffer: Buffer;
  mimeType: string;
  byteSize: number;
}

/**
 * Download media bytes server-side (upload-the-bytes platforms). Uses the
 * global `fetch` so adapter tests can stub it alongside the platform calls.
 */
export async function fetchMediaBytes(
  url: string,
  opts: { maxBytes?: number } = {},
): Promise<FetchedMedia> {
  const maxBytes = opts.maxBytes ?? SOCIAL_MEDIA_VIDEO_MAX_BYTES;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new MediaFetchError(
      `failed to download media from ${url.slice(0, 200)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new MediaFetchError(
      `failed to download media from ${url.slice(0, 200)}: HTTP ${res.status}`,
      res.status === 404 ? 404 : 502,
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    throw new MediaFetchError(`media at ${url.slice(0, 200)} is empty`);
  }
  if (buffer.length > maxBytes) {
    throw new MediaFetchError(
      `media at ${url.slice(0, 200)} is ${buffer.length} bytes (max ${maxBytes})`,
      413,
    );
  }
  const mimeType = (res.headers.get("content-type") ?? "application/octet-stream")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  return { buffer, mimeType, byteSize: buffer.length };
}

/* ── Poll-loop timing (injectable so adapter tests run instantly) ─────── */

type SleepFn = (ms: number) => Promise<void>;

const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let activeSleep: SleepFn = realSleep;

/** Await between container/processing status polls. */
export function mediaPollSleep(ms: number): Promise<void> {
  return activeSleep(ms);
}

/** Test hook — pass null to restore the real timer. */
export function __setMediaPollSleepForTesting(fn: SleepFn | null): void {
  activeSleep = fn ?? realSleep;
}
