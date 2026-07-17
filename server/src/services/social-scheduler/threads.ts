/**
 * Threads adapter — real publish via the container → publish flow on
 * graph.threads.net; OAuth handled by the wizard.
 *
 * Real wiring requires:
 *   - Meta App with Threads API permissions (same app as IG/FB works)
 *   - Threads API launched publicly June 2024 — separate from IG Graph API
 *     even though both run on Meta infra
 *   - OAuth flow returning Threads-scoped token (graph.threads.net) — done
 *     by the wizard through `token-exchange.ts`
 *
 * **App Review status (read vs publish):**
 *   - `threads_basic` (verify identity + read self): no App Review needed
 *     for app admins/devs in Development Mode.
 *   - `threads_content_publish` / `threads_manage_replies` /
 *     `threads_manage_insights`: require Meta App Review. If the scope was
 *     not granted, the publish call fails with Meta's permission error —
 *     surfaced verbatim on the target's errorMessage, never masked by a
 *     fake success.
 *
 * Publish path:
 *   1. POST https://graph.threads.net/v1.0/{threads-user-id}/threads
 *      { media_type: TEXT|IMAGE, text?, image_url? } → { id: <container> }
 *   2. POST https://graph.threads.net/v1.0/{threads-user-id}/threads_publish
 *      { creation_id } → { id: <threads-media-id> }
 *   Carousels (2–10 images) = N child containers (is_carousel_item=true)
 *   + a CAROUSEL parent with children=[...]. Video = { media_type: VIDEO,
 *   video_url }. Both poll container status (GET /{id}?fields=status,
 *   error_message) until FINISHED before publish — ERROR/EXPIRED/timeout
 *   throw, never a fake publish.
 *
 *   Threads downloads image_url/video_url itself, so media URLs must be
 *   publicly reachable — `assertPubliclyFetchableMediaUrl` fails loudly
 *   (naming PAPERCLIP_PUBLIC_URL) when handed a localhost/LAN URL.
 *
 * Connect is NOT done through this adapter: `startConnect`/`finishConnect`
 * throw `NotSupportedError` — the wizard flow (`routes/social.ts` +
 * `token-exchange.ts`) is the only real connect path, and no stub account
 * is ever created.
 */
import type { SocialAccount } from "@paperclipai/shared";
import type {
  AccountMetrics,
  ConnectAuthStart,
  PostValidation,
  PublishedPostRef,
  SocialPlatformAdapter,
} from "./types.js";
import { caption } from "./stub-helpers.js";
import { NotSupportedError, requireRealAccessToken } from "./errors.js";
import { assertPubliclyFetchableMediaUrl, mediaPollSleep } from "./media.js";

const THREADS_MAX = 500;
const THREADS_MEDIA_MAX = 10;

const THREADS_GRAPH = "https://graph.threads.net/v1.0";
const THREADS_CONTAINER_POLL_INTERVAL_MS = 2_000;
const THREADS_CONTAINER_POLL_MAX_ATTEMPTS = 90; // ~3 min of processing

export class ThreadsApiError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;
  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "ThreadsApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Parse a Threads response, surfacing Meta's `{ error: { message } }` envelope. */
async function parseThreadsJson(res: Response, context: string): Promise<Record<string, unknown>> {
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    /* handled below via the !ok branch */
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const errObj = (obj.error ?? null) as { message?: unknown } | null;
  if (!res.ok || errObj) {
    const message =
      typeof errObj?.message === "string" ? errObj.message : `HTTP ${res.status}`;
    throw new ThreadsApiError(`Threads ${context} failed: ${message}`, res.status || 502, obj);
  }
  return obj;
}

async function threadsPost(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const res = await fetch(`${THREADS_GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseThreadsJson(res, `POST ${path}`);
}

function readId(json: Record<string, unknown>, context: string): string {
  const id = typeof json.id === "string" ? json.id : null;
  if (!id) throw new ThreadsApiError(`Threads ${context} returned no id`, 502, json);
  return id;
}

/**
 * Poll a container until Threads finishes processing it (video + carousel
 * parents are async). FINISHED → return; ERROR/EXPIRED or a poll timeout
 * → throw with the platform's error_message. Never publish an unfinished
 * container.
 */
async function waitForThreadsContainer(containerId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < THREADS_CONTAINER_POLL_MAX_ATTEMPTS; attempt += 1) {
    const url = new URL(`${THREADS_GRAPH}/${containerId}`);
    url.searchParams.set("fields", "status,error_message");
    url.searchParams.set("access_token", accessToken);
    const res = await fetch(url);
    const json = await parseThreadsJson(res, `GET /${containerId} (container status)`);
    const status = typeof json.status === "string" ? json.status : null;
    if (status === "FINISHED" || status === "PUBLISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      const detail = typeof json.error_message === "string" ? ` — ${json.error_message}` : "";
      throw new ThreadsApiError(
        `Threads container ${containerId} processing ${status}${detail}`,
        422,
        json,
      );
    }
    await mediaPollSleep(THREADS_CONTAINER_POLL_INTERVAL_MS);
  }
  throw new ThreadsApiError(
    `Threads container ${containerId} did not finish processing in time`,
    504,
  );
}

/** Best-effort permalink lookup for the published thread — null on failure. */
async function fetchPermalink(mediaId: string, accessToken: string): Promise<string | null> {
  try {
    const url = new URL(`${THREADS_GRAPH}/${mediaId}`);
    url.searchParams.set("fields", "permalink");
    url.searchParams.set("access_token", accessToken);
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    return typeof json.permalink === "string" ? json.permalink : null;
  } catch {
    return null;
  }
}

export const threadsAdapter: SocialPlatformAdapter = {
  platform: "threads",

  async startConnect(): Promise<ConnectAuthStart> {
    throw new NotSupportedError(
      "Threads connect runs through the Social connect wizard (app credentials + OAuth callback), not the adapter.",
    );
  },

  async finishConnect(): Promise<SocialAccount> {
    throw new NotSupportedError(
      "Threads connect runs through the Social connect wizard (app credentials + OAuth callback), not the adapter.",
    );
  },

  async refreshAuth(): Promise<SocialAccount> {
    throw new NotSupportedError(
      "Token refresh is handled by ensureFreshToken() (freshness.ts), which persists the rotated token.",
    );
  },

  async disconnect() {
    // Local disconnect only — deleting the social_accounts row drops our
    // copy of the token; Threads tokens expire on their own.
  },

  async listRecentPosts() {
    // GET /me/threads needs threads_basic and isn't wired yet — honest
    // empty page, never mock posts.
    return { posts: [], nextCursor: null };
  },

  async getAccountMetrics(): Promise<AccountMetrics> {
    // Follower/insights reads sit behind threads_manage_insights + App
    // Review — honest empty until that lands.
    return {};
  },

  async publishPost(account, post): Promise<PublishedPostRef> {
    const accessToken = requireRealAccessToken(account, "publish to Threads");
    const userId = account.platformAccountId;
    const text = caption(post);

    if (!text && post.mediaUrls.length === 0) {
      throw new ThreadsApiError("Threads post needs either text or media", 400);
    }
    const isVideo = post.postType === "video" || post.postType === "reel";
    if (isVideo && post.mediaUrls.length !== 1) {
      throw new ThreadsApiError("Threads video posts take exactly one video file", 400);
    }
    if (post.mediaUrls.length > THREADS_MEDIA_MAX) {
      throw new ThreadsApiError(
        `Threads allows at most ${THREADS_MEDIA_MAX} media items per post`,
        400,
      );
    }
    // Threads downloads image_url/video_url itself — hard-fail with the
    // config fix when the URL can never be reached from the public internet.
    for (const url of post.mediaUrls) {
      assertPubliclyFetchableMediaUrl(url, {
        platform: "threads",
        action: "publish media (Threads downloads image_url/video_url)",
      });
    }

    let containerId: string;
    if (post.mediaUrls.length > 1) {
      // Carousel: N child containers, then a CAROUSEL parent.
      const childIds: string[] = [];
      for (const mediaUrl of post.mediaUrls) {
        const child = await threadsPost(`/${userId}/threads`, {
          media_type: "IMAGE",
          image_url: mediaUrl,
          is_carousel_item: "true",
          access_token: accessToken,
        });
        childIds.push(readId(child, "carousel child container"));
      }
      const parent = await threadsPost(`/${userId}/threads`, {
        media_type: "CAROUSEL",
        children: childIds.join(","),
        ...(text ? { text } : {}),
        access_token: accessToken,
      });
      containerId = readId(parent, "carousel container");
      await waitForThreadsContainer(containerId, accessToken);
    } else if (isVideo) {
      const container = await threadsPost(`/${userId}/threads`, {
        media_type: "VIDEO",
        video_url: post.mediaUrls[0] as string,
        ...(text ? { text } : {}),
        access_token: accessToken,
      });
      containerId = readId(container, "video container");
      // Video containers process async — publish only after FINISHED.
      await waitForThreadsContainer(containerId, accessToken);
    } else {
      const container = await threadsPost(`/${userId}/threads`, {
        ...(post.mediaUrls.length === 1
          ? { media_type: "IMAGE", image_url: post.mediaUrls[0] as string }
          : { media_type: "TEXT" }),
        ...(text ? { text } : {}),
        access_token: accessToken,
      });
      containerId = readId(container, "container create");
    }

    const published = await threadsPost(`/${userId}/threads_publish`, {
      creation_id: containerId,
      access_token: accessToken,
    });
    const mediaId = readId(published, "threads_publish");
    const permalink = await fetchPermalink(mediaId, accessToken);

    return {
      platformPostId: mediaId,
      platformUrl: permalink,
      publishedAt: new Date(),
      caption: text || null,
      mediaUrl: post.mediaUrls[0] ?? null,
    };
  },

  validatePost(post): PostValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const text = caption(post);

    if (text.length > THREADS_MAX) {
      errors.push(`Threads post is ${text.length}/${THREADS_MAX} chars.`);
    }
    if (text.length === 0 && post.mediaUrls.length === 0) {
      errors.push("Threads post needs either text or media.");
    }
    if (post.postType === "video" || post.postType === "reel") {
      if (post.mediaUrls.length !== 1) {
        errors.push("Threads video posts take exactly one video file (mp4).");
      }
    } else if (post.mediaUrls.length > THREADS_MEDIA_MAX) {
      errors.push(`Threads allows at most ${THREADS_MEDIA_MAX} images per post.`);
    }
    return { ok: errors.length === 0, errors, warnings };
  },
};
