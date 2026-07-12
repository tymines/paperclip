/**
 * X adapter — real publish via the v2 API; OAuth handled by the wizard.
 *
 * Real wiring requires:
 *   - X Developer account with Project + App
 *   - OAuth 2.0 (PKCE) client with `tweet.read tweet.write users.read
 *     offline.access dm.read dm.write` scopes
 *   - X app permissions set to "Read and write and Direct messages" in
 *     the Developer Console (otherwise the dm.* scopes return
 *     `unauthorized_scope` at the consent screen)
 *   - Pay-per-use plan (X dropped the free tier in 2026 — see the wizard
 *     gate for credit-purchase instructions)
 *
 * **Paid-tier status (read vs publish vs DMs):**
 *   - `tweet.read` + `users.read` (verify + read timeline): available on
 *     any tier including the bottom $0.001/owned-resource read pricing —
 *     no App Review needed.
 *   - `tweet.write` (publish a tweet): $0.015 per tweet, $0.20 per tweet
 *     containing a URL. Same wallet, same Developer Portal — no separate
 *     review queue. The wizard's gate confirms Tyler has bought credits.
 *   - `dm.read` + `dm.write` (poll inbox / reply): $0.010 per DM event
 *     read on PPU; webhook push is Enterprise-only. The DM poller worker
 *     (`server/src/workers/social-dm-poller.ts`) polls /2/dm_events on a
 *     60s tick and writes inbound DMs into `social_dms` so the Inbox
 *     subtab and Jarvis briefing can surface them.
 *
 * Publish path: POST https://api.twitter.com/2/tweets with body
 *   { text, media?: { media_ids }, reply?: { in_reply_to_tweet_id } }
 * Threads = the editor splits text on blank lines; each segment becomes a
 * tweet chained via `reply.in_reply_to_tweet_id` after the first; media
 * attaches to the first tweet.
 *
 * Media upload (v2, OAuth2 user token) — POST https://api.x.com/2/media/upload:
 *   - Images/GIFs: single multipart POST (`media` + `media_category`)
 *     → { data: { id } }; up to 4 per tweet.
 *   - Video (mp4): chunked INIT → APPEND (4 MB segments) → FINALIZE, then
 *     `command=STATUS` polling until processing_info.state === "succeeded"
 *     (best-effort; "failed"/timeout throws — never a silent text-only
 *     tweet). The adapter downloads the bytes itself from the post's
 *     mediaUrls (`fetchMediaBytes`), so a loopback self-URL works — no
 *     public base URL required for X.
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
  DirectMessage,
  PostDraftPayload,
  PostValidation,
  PublishedPostRef,
  SocialPlatformAdapter,
} from "./types.js";
import { caption } from "./stub-helpers.js";
import {
  NotSupportedError,
  hasRealAccessToken,
  requireRealAccessToken,
} from "./errors.js";
import {
  SOCIAL_MEDIA_IMAGE_MIMES,
  SOCIAL_MEDIA_VIDEO_MIMES,
  fetchMediaBytes,
  mediaPollSleep,
  type FetchedMedia,
} from "./media.js";

const X_TWEET_MAX = 280;
const X_MEDIA_MAX = 4;

const X_API_BASE = "https://api.twitter.com/2";
const X_MEDIA_UPLOAD_URL = "https://api.x.com/2/media/upload";
const X_APPEND_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB segments
const X_STATUS_POLL_MAX_ATTEMPTS = 60; // ~5 min at the default check_after

export class XRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly statusCode = 429;
  constructor(retryAfterSeconds: number) {
    super(`X rate-limited request (retry after ${retryAfterSeconds}s)`);
    this.name = "XRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class XApiError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;
  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "XApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function xFetch(
  path: string,
  init: { accessToken: string; method?: string; body?: unknown },
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.accessToken}`,
  };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  const res = await fetch(`${X_API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body,
  });

  if (res.status === 429) {
    // X sends the epoch-seconds reset time; fall back to 60s if absent.
    const resetHeader = res.headers.get("x-rate-limit-reset");
    const resetEpoch = resetHeader ? Number.parseInt(resetHeader, 10) : NaN;
    const seconds = Number.isFinite(resetEpoch)
      ? Math.max(1, resetEpoch - Math.floor(Date.now() / 1000))
      : 60;
    throw new XRateLimitError(seconds);
  }

  return res;
}

async function parseXJson(res: Response, context: string): Promise<Record<string, unknown>> {
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    /* handled below via the !ok branch */
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  if (!res.ok) {
    const detail =
      typeof obj.detail === "string"
        ? obj.detail
        : typeof obj.title === "string"
          ? obj.title
          : `HTTP ${res.status}`;
    throw new XApiError(`X ${context} failed: ${detail}`, res.status, obj);
  }
  return obj;
}

/** Split thread text the same way validatePost does: blank-line separated. */
function threadSegments(text: string): string[] {
  return text.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
}

/** POST /2/tweets — returns the created tweet id. */
async function postTweet(
  accessToken: string,
  body: {
    text?: string;
    reply?: { in_reply_to_tweet_id: string };
    media?: { media_ids: string[] };
  },
): Promise<string> {
  const res = await xFetch("/tweets", { accessToken, method: "POST", body });
  const json = await parseXJson(res, "POST /2/tweets");
  const data = (json.data ?? null) as { id?: unknown } | null;
  const id = typeof data?.id === "string" ? data.id : null;
  if (!id) throw new XApiError("X POST /2/tweets returned no tweet id", 502, json);
  return id;
}

/* ── v2 media upload ─────────────────────────────────────────────────── */

/** Multipart POST against the media-upload host with rate-limit handling. */
async function xMediaFetch(
  accessToken: string,
  url: string,
  init: { method?: string; form?: FormData },
): Promise<Response> {
  const res = await fetch(url, {
    method: init.method ?? "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: init.form,
  });
  if (res.status === 429) {
    const resetHeader = res.headers.get("x-rate-limit-reset");
    const resetEpoch = resetHeader ? Number.parseInt(resetHeader, 10) : NaN;
    const seconds = Number.isFinite(resetEpoch)
      ? Math.max(1, resetEpoch - Math.floor(Date.now() / 1000))
      : 60;
    throw new XRateLimitError(seconds);
  }
  return res;
}

/** The v2 endpoint returns { data: { id, ... } }; v1.1-style fallbacks kept. */
function readMediaId(json: Record<string, unknown>, context: string): string {
  const data = (json.data ?? null) as Record<string, unknown> | null;
  const id =
    (typeof data?.id === "string" && data.id) ||
    (typeof data?.media_id_string === "string" && data.media_id_string) ||
    (typeof json.media_id_string === "string" && json.media_id_string) ||
    null;
  if (!id) throw new XApiError(`X ${context} returned no media id`, 502, json);
  return id;
}

function readProcessingInfo(json: Record<string, unknown>): {
  state: string | null;
  checkAfterSecs: number;
  error: string | null;
} {
  const data = (json.data ?? json) as Record<string, unknown>;
  const info = (data.processing_info ?? null) as Record<string, unknown> | null;
  if (!info) return { state: null, checkAfterSecs: 0, error: null };
  const state = typeof info.state === "string" ? info.state : null;
  const checkAfter = Number(info.check_after_secs);
  const errObj = (info.error ?? null) as { message?: unknown; name?: unknown } | null;
  const error =
    typeof errObj?.message === "string"
      ? errObj.message
      : typeof errObj?.name === "string"
        ? errObj.name
        : null;
  return {
    state,
    checkAfterSecs: Number.isFinite(checkAfter) && checkAfter > 0 ? checkAfter : 1,
    error,
  };
}

/** Simple (non-chunked) upload for images/GIFs → media id. */
async function uploadImageToX(accessToken: string, media: FetchedMedia): Promise<string> {
  const form = new FormData();
  form.append("media", new Blob([new Uint8Array(media.buffer)], { type: media.mimeType }), "media");
  form.append("media_category", media.mimeType === "image/gif" ? "tweet_gif" : "tweet_image");
  const res = await xMediaFetch(accessToken, X_MEDIA_UPLOAD_URL, { form });
  const json = await parseXJson(res, "POST /2/media/upload");
  return readMediaId(json, "POST /2/media/upload");
}

/**
 * Chunked INIT → APPEND → FINALIZE upload for video, then STATUS polling
 * until X finishes processing. Best-effort per spec: "failed" state or a
 * poll timeout throws — the tweet is never published without its video.
 */
async function uploadVideoToX(accessToken: string, media: FetchedMedia): Promise<string> {
  // INIT
  const initForm = new FormData();
  initForm.append("command", "INIT");
  initForm.append("media_type", media.mimeType);
  initForm.append("total_bytes", String(media.byteSize));
  initForm.append("media_category", "tweet_video");
  const initRes = await xMediaFetch(accessToken, X_MEDIA_UPLOAD_URL, { form: initForm });
  const initJson = await parseXJson(initRes, "media upload INIT");
  const mediaId = readMediaId(initJson, "media upload INIT");

  // APPEND — 4 MB segments
  for (
    let offset = 0, segment = 0;
    offset < media.buffer.length;
    offset += X_APPEND_CHUNK_BYTES, segment += 1
  ) {
    const chunk = media.buffer.subarray(offset, offset + X_APPEND_CHUNK_BYTES);
    const appendForm = new FormData();
    appendForm.append("command", "APPEND");
    appendForm.append("media_id", mediaId);
    appendForm.append("segment_index", String(segment));
    appendForm.append("media", new Blob([new Uint8Array(chunk)], { type: media.mimeType }), "media");
    const appendRes = await xMediaFetch(accessToken, X_MEDIA_UPLOAD_URL, { form: appendForm });
    if (!appendRes.ok) {
      let detail: unknown = null;
      try {
        detail = await appendRes.json();
      } catch {
        /* APPEND normally returns an empty 2xx body */
      }
      throw new XApiError(
        `X media upload APPEND (segment ${segment}) failed: HTTP ${appendRes.status}`,
        appendRes.status,
        detail,
      );
    }
  }

  // FINALIZE
  const finalizeForm = new FormData();
  finalizeForm.append("command", "FINALIZE");
  finalizeForm.append("media_id", mediaId);
  const finalizeRes = await xMediaFetch(accessToken, X_MEDIA_UPLOAD_URL, { form: finalizeForm });
  const finalizeJson = await parseXJson(finalizeRes, "media upload FINALIZE");

  // STATUS polling while X transcodes.
  let info = readProcessingInfo(finalizeJson);
  let attempts = 0;
  while (info.state === "pending" || info.state === "in_progress") {
    if (attempts >= X_STATUS_POLL_MAX_ATTEMPTS) {
      throw new XApiError(
        `X video processing did not finish after ${attempts} status polls (media_id ${mediaId})`,
        504,
      );
    }
    attempts += 1;
    await mediaPollSleep(Math.min(info.checkAfterSecs, 10) * 1000);
    const statusRes = await xMediaFetch(
      accessToken,
      `${X_MEDIA_UPLOAD_URL}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      { method: "GET" },
    );
    const statusJson = await parseXJson(statusRes, "media upload STATUS");
    info = readProcessingInfo(statusJson);
  }
  if (info.state === "failed") {
    throw new XApiError(
      `X video processing failed${info.error ? `: ${info.error}` : ""} (media_id ${mediaId})`,
      422,
    );
  }
  return mediaId;
}

/** Resolve the post's mediaUrls into uploaded X media ids. */
async function uploadPostMediaToX(
  accessToken: string,
  post: PostDraftPayload,
): Promise<string[]> {
  const isVideoPost = post.postType === "video" || post.postType === "reel";
  if (isVideoPost) {
    if (post.mediaUrls.length !== 1) {
      throw new XApiError("X video posts take exactly one mp4 file", 400);
    }
    const media = await fetchMediaBytes(post.mediaUrls[0] as string);
    if (!SOCIAL_MEDIA_VIDEO_MIMES.has(media.mimeType)) {
      throw new XApiError(
        `X video upload requires video/mp4 — media served as "${media.mimeType}"`,
        415,
      );
    }
    return [await uploadVideoToX(accessToken, media)];
  }

  if (post.mediaUrls.length > X_MEDIA_MAX) {
    throw new XApiError(`X allows at most ${X_MEDIA_MAX} media items per tweet`, 400);
  }
  const ids: string[] = [];
  for (const url of post.mediaUrls) {
    const media = await fetchMediaBytes(url);
    if (!SOCIAL_MEDIA_IMAGE_MIMES.has(media.mimeType)) {
      throw new XApiError(
        `X image upload supports jpeg/png/webp/gif — media served as "${media.mimeType}". ` +
          'For video, set the post type to "video".',
        415,
      );
    }
    ids.push(await uploadImageToX(accessToken, media));
  }
  return ids;
}

function tweetUrl(account: SocialAccount, tweetId: string): string {
  const handle = (account.username ?? "").replace(/^@/, "");
  return handle
    ? `https://x.com/${handle}/status/${tweetId}`
    : `https://x.com/i/web/status/${tweetId}`;
}

export const xAdapter: SocialPlatformAdapter = {
  platform: "x",

  async startConnect(): Promise<ConnectAuthStart> {
    throw new NotSupportedError(
      "X connect runs through the Social connect wizard (app credentials + OAuth callback), not the adapter.",
    );
  },

  async finishConnect(): Promise<SocialAccount> {
    throw new NotSupportedError(
      "X connect runs through the Social connect wizard (app credentials + OAuth callback), not the adapter.",
    );
  },

  async refreshAuth(): Promise<SocialAccount> {
    throw new NotSupportedError(
      "Token refresh is handled by ensureFreshToken() (freshness.ts), which persists the rotated token.",
    );
  },

  async disconnect() {
    // Local disconnect only — deleting the social_accounts row drops our
    // copy of the token. Remote revocation (POST /2/oauth2/revoke) needs
    // the app client credentials and lands with the wizard-side revoke.
  },

  async listRecentPosts() {
    // Reading the owned timeline costs per-post on the PPU tier and isn't
    // wired yet — return an honest empty page rather than mock posts.
    return { posts: [], nextCursor: null };
  },

  async getAccountMetrics(account): Promise<AccountMetrics> {
    // GET /2/users/me with public_metrics — an owned read, effectively free
    // on the PPU tier. Without a real token there is nothing to report.
    if (!hasRealAccessToken(account)) return {};
    const res = await xFetch("/users/me?user.fields=public_metrics", {
      accessToken: account.accessToken as string,
    });
    const json = await parseXJson(res, "GET /2/users/me");
    const data = (json.data ?? {}) as Record<string, unknown>;
    const metrics = (data.public_metrics ?? {}) as Record<string, unknown>;
    const followers = Number(metrics.followers_count);
    const tweets = Number(metrics.tweet_count);
    return {
      ...(Number.isFinite(followers) ? { followerCount: followers } : {}),
      ...(Number.isFinite(tweets) ? { postCount: tweets } : {}),
    };
  },

  async publishPost(account, post): Promise<PublishedPostRef> {
    const accessToken = requireRealAccessToken(account, "publish to X");

    // Real media upload: download the bytes, push them to the v2 media
    // endpoint, attach the returned ids. Any failure throws — a tweet is
    // never published with its media silently dropped.
    const mediaIds =
      post.mediaUrls.length > 0 ? await uploadPostMediaToX(accessToken, post) : [];

    const text = caption(post);
    if (!text && mediaIds.length === 0) {
      throw new XApiError("X post requires text or media", 400);
    }

    if (post.postType === "thread") {
      const segments = threadSegments(text);
      if (segments.length === 0) throw new XApiError("X thread has no segments", 400);
      let previousId: string | null = null;
      let firstId: string | null = null;
      for (const segment of segments) {
        const id: string = await postTweet(accessToken, {
          text: segment,
          ...(previousId ? { reply: { in_reply_to_tweet_id: previousId } } : {}),
          // Media rides on the opening tweet of the thread.
          ...(previousId === null && mediaIds.length > 0
            ? { media: { media_ids: mediaIds } }
            : {}),
        });
        firstId = firstId ?? id;
        previousId = id;
      }
      return {
        platformPostId: firstId as string,
        platformUrl: tweetUrl(account, firstId as string),
        publishedAt: new Date(),
        caption: text,
        mediaUrl: post.mediaUrls[0] ?? null,
      };
    }

    const id = await postTweet(accessToken, {
      ...(text ? { text } : {}),
      ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
    });
    return {
      platformPostId: id,
      platformUrl: tweetUrl(account, id),
      publishedAt: new Date(),
      caption: text || null,
      mediaUrl: post.mediaUrls[0] ?? null,
    };
  },

  validatePost(post): PostValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const text = caption(post);

    if (post.postType === "thread") {
      // For threads, the editor splits text on blank lines; each segment is a tweet.
      const segments = text.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
      segments.forEach((seg, i) => {
        if (seg.length > X_TWEET_MAX) {
          errors.push(`Thread segment #${i + 1} is ${seg.length}/${X_TWEET_MAX} chars.`);
        }
      });
      if (segments.length < 2) {
        warnings.push("Thread has only one segment — separate tweets with a blank line.");
      }
    } else {
      if (text.length > X_TWEET_MAX) {
        errors.push(`Tweet is ${text.length}/${X_TWEET_MAX} chars.`);
      }
      if (text.length === 0 && post.mediaUrls.length === 0) {
        errors.push("Tweet needs either text or media.");
      }
    }

    if (post.postType === "video" || post.postType === "reel") {
      if (post.mediaUrls.length !== 1) {
        errors.push("X video posts take exactly one mp4 file.");
      }
    } else if (post.mediaUrls.length > X_MEDIA_MAX) {
      errors.push(`X allows at most ${X_MEDIA_MAX} media items per tweet.`);
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  /**
   * Send a DM in an existing conversation — POST
   * /2/dm_conversations/{dm_conversation_id}/messages ($0.015/send on PPU,
   * needs the dm.write scope). `threadId` is the X dm_conversation_id the
   * DM poller stored on the social_dms row.
   */
  async sendDirectMessage(account, threadId, text): Promise<DirectMessage> {
    const accessToken = requireRealAccessToken(account, "send an X DM");
    const res = await xFetch(
      `/dm_conversations/${encodeURIComponent(threadId)}/messages`,
      { accessToken, method: "POST", body: { text } },
    );
    const json = await parseXJson(res, "POST /2/dm_conversations/:id/messages");
    const data = (json.data ?? {}) as Record<string, unknown>;
    const eventId = typeof data.dm_event_id === "string" ? data.dm_event_id : null;
    if (!eventId) {
      throw new XApiError("X DM send returned no dm_event_id", 502, json);
    }
    return {
      id: eventId,
      threadId,
      direction: "outbound",
      sentAt: new Date(),
      text,
    };
  },
};
