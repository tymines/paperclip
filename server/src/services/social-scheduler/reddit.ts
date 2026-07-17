/**
 * Reddit adapter — real publish + verify + own-post listing.
 *
 * Wiring requires a "script" or "web app" registered at
 * https://www.reddit.com/prefs/apps. client_id + client_secret are stored
 * in `social_app_credentials` via the Connect Wizard; the wizard's OAuth
 * callback exchanges the auth code for a real bearer token which lands on
 * `account.accessToken`. Legacy stub rows (the `"stub_access_token"`
 * sentinel / `metadata.stub === true`) are refused: `publishPost` throws
 * `BlockedNoCredentialError` so the scheduler marks the target `blocked`
 * instead of faking a submit result.
 *
 * Publish path: POST https://oauth.reddit.com/api/submit with body
 *   { sr, kind: self|link|image, title, text|url, flair_id?, flair_text? }
 * Reddit caps each OAuth client at 60 req/min. We surface 429s as
 * `RedditRateLimitError` carrying the `Retry-After` seconds so the
 * scheduler can back off rather than retrying tight.
 *
 * Image/video posts run the asset-lease flow:
 *   1. POST /api/media/asset.json { filepath, mimetype } → S3 lease
 *      ({ args: { action, fields }, asset: { asset_id } })
 *   2. multipart POST to the lease URL (fields + file) → asset lands at
 *      `${action}/${fields.key}` (i.redd.it / v.redd.it backing store)
 *   3. POST /api/submit with kind=image|video and the asset URL. Media
 *      submits confirm asynchronously over websocket; when the sync
 *      response has no fullname we look the fresh post up via the
 *      free own-submissions listing rather than fabricating an id.
 * The adapter downloads the bytes itself (`fetchMediaBytes`), so a
 * loopback self-URL works — no public base URL required for Reddit.
 * Galleries (2+ images) need the websocket confirmation flow — v1 keeps
 * them an honest 501. Videos require a poster image
 * (`metadata.posterUrl`) — a clear 400 otherwise, never a silent drop.
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
  type FetchedMedia,
} from "./media.js";

const REDDIT_TITLE_MAX = 300;
const REDDIT_BODY_MAX = 40_000;

const REDDIT_OAUTH_BASE = "https://oauth.reddit.com";

// Reddit requires a unique User-Agent per their API rules
// (https://github.com/reddit-archive/reddit/wiki/API). Generic/shared UAs
// (e.g. "node-fetch", browser strings) get rate-limited or 403'd.
const REDDIT_USER_AGENT = "Paperclip:v1.0 (by /u/tylerswitzer19)";

/** Reddit returns a JSON-of-JSON envelope from /api/submit. */
interface RedditSubmitResponse {
  json?: {
    errors?: Array<[string, string, string?]>;
    data?: {
      id?: string;
      name?: string;
      url?: string;
    };
  };
}

/** Profile fields returned by GET /api/v1/me — used for verify + Accounts dot. */
export interface RedditMeProfile {
  name: string;
  link_karma: number;
  comment_karma: number;
}

export class RedditRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly statusCode = 429;
  constructor(retryAfterSeconds: number) {
    super(`Reddit rate-limited request (retry after ${retryAfterSeconds}s)`);
    this.name = "RedditRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class RedditApiError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;
  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "RedditApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function resolveSubreddit(account: SocialAccount, post: PostDraftPayload): string {
  const meta = (post.metadata ?? {}) as Record<string, unknown>;
  const explicit = typeof meta.subreddit === "string" ? meta.subreddit.trim() : "";
  if (explicit) {
    // Accept "r/test", "/r/test", "test", or "u/name" / "u_name" verbatim.
    return explicit.replace(/^\/?r\//i, "").replace(/^u\//i, "u_");
  }
  // Default: post to the connected user's own profile.
  // Reddit treats user-profile subs as `u_<name>` in the `sr` field.
  const username = (account.username ?? "").replace(/^u\//i, "");
  if (!username) {
    throw new RedditApiError(
      "No subreddit provided and account has no username to fall back on",
      400,
    );
  }
  return `u_${username}`;
}

function detectPostKind(
  post: PostDraftPayload,
  meta: Record<string, unknown>,
): "self" | "link" | "image" | "video" {
  const explicit = typeof meta.kind === "string" ? meta.kind : "";
  if (explicit === "self" || explicit === "link" || explicit === "image" || explicit === "video") {
    return explicit;
  }
  if (post.mediaUrls.length > 0) {
    return post.postType === "video" || post.postType === "reel" ? "video" : "image";
  }
  const linkUrl = typeof meta.url === "string" ? meta.url : "";
  if (linkUrl) return "link";
  return "self";
}

async function redditFetch(
  path: string,
  init: {
    accessToken: string;
    method?: string;
    body?: URLSearchParams;
  },
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `bearer ${init.accessToken}`,
    "User-Agent": REDDIT_USER_AGENT,
  };
  if (init.body) headers["Content-Type"] = "application/x-www-form-urlencoded";

  const res = await fetch(`${REDDIT_OAUTH_BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });

  if (res.status === 429) {
    const retryAfterHeader = res.headers.get("retry-after");
    const seconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 60;
    throw new RedditRateLimitError(Number.isFinite(seconds) && seconds > 0 ? seconds : 60);
  }

  return res;
}

/* ── Media asset-lease flow ─────────────────────────────────────────── */

interface RedditAssetLease {
  /** Absolute https upload URL (Reddit returns it scheme-relative). */
  actionUrl: string;
  /** Pre-signed S3 form fields, appended verbatim before the file part. */
  fields: Array<{ name: string; value: string }>;
  assetId: string;
}

const LEASE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
};

function leaseFilenameFor(mimeType: string): string {
  return `paperclip-upload.${LEASE_EXTENSION_BY_MIME[mimeType] ?? "bin"}`;
}

/** POST /api/media/asset.json — mint a pre-signed S3 upload lease. */
async function mintRedditAssetLease(
  accessToken: string,
  filename: string,
  mimeType: string,
): Promise<RedditAssetLease> {
  const body = new URLSearchParams({ filepath: filename, mimetype: mimeType });
  const res = await redditFetch("/api/media/asset.json", {
    accessToken,
    method: "POST",
    body,
  });
  type RedditAssetJson = {
    args?: { action?: string; fields?: Array<{ name?: unknown; value?: unknown }> };
    asset?: { asset_id?: unknown };
  };
  let parsed: RedditAssetJson | null = null;
  try {
    parsed = (await res.json()) as RedditAssetJson | null;
  } catch {
    /* handled below */
  }
  if (!res.ok) {
    throw new RedditApiError(
      `Reddit /api/media/asset.json failed: ${res.status}`,
      res.status,
      parsed,
    );
  }
  const action = typeof parsed?.args?.action === "string" ? parsed.args.action : "";
  const rawFields = Array.isArray(parsed?.args?.fields) ? parsed.args.fields : [];
  if (!action || rawFields.length === 0) {
    throw new RedditApiError("Reddit media lease returned no upload action/fields", 502, parsed);
  }
  const fields = rawFields
    .filter((f): f is { name: string; value: string } =>
      typeof f?.name === "string" && typeof f?.value === "string",
    )
    .map((f) => ({ name: f.name, value: f.value }));
  return {
    actionUrl: action.startsWith("//") ? `https:${action}` : action,
    fields,
    assetId: typeof parsed?.asset?.asset_id === "string" ? parsed.asset.asset_id : "",
  };
}

/**
 * Multipart POST to the lease URL. The asset's final URL is the lease
 * action + the pre-signed `key` field — that URL goes on /api/submit.
 */
async function uploadToRedditLease(
  lease: RedditAssetLease,
  media: FetchedMedia,
  filename: string,
): Promise<string> {
  const form = new FormData();
  for (const field of lease.fields) form.append(field.name, field.value);
  form.append("file", new Blob([new Uint8Array(media.buffer)], { type: media.mimeType }), filename);
  const res = await fetch(lease.actionUrl, { method: "POST", body: form });
  // S3 lease uploads answer 201 (Created) with an XML body.
  if (!res.ok && res.status !== 201) {
    throw new RedditApiError(
      `Reddit media upload to lease URL failed: HTTP ${res.status}`,
      502,
    );
  }
  const key = lease.fields.find((f) => f.name === "key")?.value;
  if (!key) {
    throw new RedditApiError("Reddit media lease had no 'key' field", 502, lease.fields);
  }
  return `${lease.actionUrl}/${key}`;
}

async function submitPost(
  account: SocialAccount,
  post: PostDraftPayload,
): Promise<PublishedPostRef> {
  if (!account.accessToken) {
    throw new RedditApiError("Reddit account has no access token", 401);
  }
  const meta = (post.metadata ?? {}) as Record<string, unknown>;
  const subreddit = resolveSubreddit(account, post);
  const kind = detectPostKind(post, meta);

  const fallbackTitle = (post.caption ?? post.baseCaption ?? "").trim().slice(0, REDDIT_TITLE_MAX);
  const title = typeof meta.title === "string" && meta.title.trim().length > 0
    ? meta.title.trim()
    : fallbackTitle;

  if (!title) throw new RedditApiError("Reddit post requires a title", 400);

  const body = new URLSearchParams();
  body.set("sr", subreddit);
  body.set("title", title);
  body.set("api_type", "json");
  body.set("resubmit", "true");
  body.set(
    "sendreplies",
    typeof meta.sendreplies === "boolean" ? String(meta.sendreplies) : "true",
  );
  if (typeof meta.flair_id === "string" && meta.flair_id) body.set("flair_id", meta.flair_id);
  if (typeof meta.flair_text === "string" && meta.flair_text) body.set("flair_text", meta.flair_text);
  if (typeof meta.nsfw === "boolean") body.set("nsfw", String(meta.nsfw));
  if (typeof meta.spoiler === "boolean") body.set("spoiler", String(meta.spoiler));

  if (kind === "self") {
    body.set("kind", "self");
    body.set("text", caption(post));
  } else if (kind === "link") {
    body.set("kind", "link");
    const url = typeof meta.url === "string" ? meta.url : post.mediaUrls[0] ?? "";
    if (!url) {
      throw new RedditApiError(
        "Reddit link post requires a url in metadata or mediaUrls",
        400,
      );
    }
    body.set("url", url);
  } else {
    // image | video via the asset-lease flow.
    if (post.mediaUrls.length > 1) {
      // Gallery submits need the websocket confirmation flow — honest 501.
      throw new RedditApiError(
        "Reddit gallery posts (multiple images) not yet implemented (websocket-confirmation flow) — attach a single image",
        501,
      );
    }
    const mediaUrl = post.mediaUrls[0] ?? "";
    if (!mediaUrl) {
      throw new RedditApiError("Reddit media post requires a media attachment", 400);
    }
    const media = await fetchMediaBytes(mediaUrl);
    const isVideoMime = SOCIAL_MEDIA_VIDEO_MIMES.has(media.mimeType);
    const isImageMime = SOCIAL_MEDIA_IMAGE_MIMES.has(media.mimeType);
    if (!isVideoMime && !isImageMime) {
      throw new RedditApiError(
        `Reddit media upload supports jpeg/png/webp/gif/mp4 — media served as "${media.mimeType}"`,
        415,
      );
    }
    if (kind === "video" && !isVideoMime) {
      throw new RedditApiError(
        `Reddit video post requires an mp4 — media served as "${media.mimeType}"`,
        415,
      );
    }
    // Reddit refuses kind=video without a poster frame. We can't extract
    // one server-side (no ffmpeg) — require it explicitly BEFORE spending
    // a lease + upload, never guess.
    const posterUrl = typeof meta.posterUrl === "string" ? meta.posterUrl.trim() : "";
    if (isVideoMime && !posterUrl) {
      throw new RedditApiError(
        "Reddit video posts require a poster image — set metadata.posterUrl to a public image URL",
        400,
      );
    }
    const filename = leaseFilenameFor(media.mimeType);
    const lease = await mintRedditAssetLease(
      account.accessToken as string,
      filename,
      media.mimeType,
    );
    const assetUrl = await uploadToRedditLease(lease, media, filename);
    if (isVideoMime) {
      body.set("kind", "video");
      body.set("url", assetUrl);
      body.set("video_poster_url", posterUrl);
    } else {
      body.set("kind", "image");
      body.set("url", assetUrl);
    }
  }

  const res = await redditFetch("/api/submit", {
    accessToken: account.accessToken,
    method: "POST",
    body,
  });

  let parsed: RedditSubmitResponse | null = null;
  try {
    parsed = (await res.json()) as RedditSubmitResponse;
  } catch {
    // Body wasn't JSON — handled below via the !ok branch.
  }

  if (!res.ok) {
    throw new RedditApiError(`Reddit /api/submit failed: ${res.status}`, res.status, parsed);
  }

  const errs = parsed?.json?.errors ?? [];
  if (errs.length > 0) {
    const first = errs[0]!;
    const code = first[0] ?? "unknown";
    const message = first[1] ?? "submit rejected";
    throw new RedditApiError(`Reddit rejected submit: ${code} — ${message}`, 422, errs);
  }

  const data = parsed?.json?.data;
  if (!data?.name || !data.url) {
    // Media submits (kind=image/video) confirm asynchronously over
    // websocket and can come back 200 + empty data. Data honesty: don't
    // fabricate an id — look the freshly-created post up via the free
    // own-submissions listing, and fail loudly if it isn't there.
    if (kind === "image" || kind === "video") {
      const recent = await listOwnSubmissions(account, { limit: 1 }).catch(() => null);
      const latest = recent?.posts[0];
      if (latest && Date.now() - latest.publishedAt.getTime() < 5 * 60_000) {
        return {
          platformPostId: latest.platformPostId,
          platformUrl: latest.platformUrl,
          publishedAt: latest.publishedAt,
          caption: caption(post),
          mediaUrl: post.mediaUrls[0] ?? null,
        };
      }
      throw new RedditApiError(
        "Reddit accepted the media submit but returned no post id (websocket-only confirmation) and the post has not appeared on the account's submissions yet",
        502,
        parsed,
      );
    }
    throw new RedditApiError("Reddit /api/submit returned no post id", 502, parsed);
  }

  return {
    platformPostId: data.name, // fullname `t3_xxx` — what API consumers reference
    platformUrl: data.url,
    publishedAt: new Date(),
    caption: caption(post),
    mediaUrl: post.mediaUrls[0] ?? null,
  };
}

/** GET /api/v1/me — used by the Accounts dot + the /verify route. */
export async function verifyRedditAccount(account: SocialAccount): Promise<RedditMeProfile> {
  if (!hasRealAccessToken(account)) {
    // Legacy stub rows never verify green — reconnect through the wizard.
    throw new RedditApiError(
      "Reddit account has no real access token — reconnect via the connect wizard",
      401,
    );
  }
  const res = await redditFetch("/api/v1/me", { accessToken: account.accessToken as string });
  if (!res.ok) {
    throw new RedditApiError(`Reddit /api/v1/me failed: ${res.status}`, res.status);
  }
  const body = (await res.json()) as Record<string, unknown>;
  return {
    name: String(body.name ?? account.username ?? ""),
    link_karma: Number(body.link_karma ?? 0) || 0,
    comment_karma: Number(body.comment_karma ?? 0) || 0,
  };
}

/** One `t3` child from a /user/{name}/submitted listing. */
interface RedditListingChild {
  data?: {
    name?: string;
    permalink?: string;
    created_utc?: number;
    title?: string;
    url?: string;
    thumbnail?: string;
    score?: number;
    num_comments?: number;
  };
}

/**
 * GET /user/{username}/submitted — the connected account's own posts.
 * Free own-resource read under Reddit's API rules.
 */
async function listOwnSubmissions(
  account: SocialAccount,
  opts?: { limit?: number; cursor?: string | null },
): Promise<{ posts: PublishedPostRef[]; nextCursor: string | null }> {
  const username = (account.username ?? "").replace(/^u\//, "");
  if (!username) {
    throw new RedditApiError("Reddit account has no username to list posts for", 400);
  }
  const params = new URLSearchParams({ limit: String(opts?.limit ?? 20), raw_json: "1" });
  if (opts?.cursor) params.set("after", opts.cursor);
  const res = await redditFetch(
    `/user/${encodeURIComponent(username)}/submitted?${params.toString()}`,
    { accessToken: account.accessToken as string },
  );
  if (!res.ok) {
    throw new RedditApiError(`Reddit /user/${username}/submitted failed: ${res.status}`, res.status);
  }
  const body = (await res.json()) as {
    data?: { children?: RedditListingChild[]; after?: string | null };
  };
  const children = Array.isArray(body.data?.children) ? body.data.children : [];
  const posts: PublishedPostRef[] = [];
  for (const child of children) {
    const d = child.data;
    if (!d?.name) continue;
    const thumbnail =
      typeof d.thumbnail === "string" && /^https?:\/\//.test(d.thumbnail) ? d.thumbnail : null;
    posts.push({
      platformPostId: d.name,
      platformUrl: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
      publishedAt:
        typeof d.created_utc === "number" ? new Date(d.created_utc * 1000) : new Date(),
      caption: d.title ?? null,
      mediaUrl: null,
      thumbnailUrl: thumbnail,
      metrics: {
        likes: Number(d.score ?? 0) || 0,
        comments: Number(d.num_comments ?? 0) || 0,
      },
    });
  }
  return { posts, nextCursor: body.data?.after ?? null };
}

export const redditAdapter: SocialPlatformAdapter = {
  platform: "reddit",

  async startConnect(): Promise<ConnectAuthStart> {
    throw new NotSupportedError(
      "Reddit connect runs through the Social connect wizard (app credentials + OAuth callback), not the adapter.",
    );
  },

  async finishConnect(): Promise<SocialAccount> {
    throw new NotSupportedError(
      "Reddit connect runs through the Social connect wizard (app credentials + OAuth callback), not the adapter.",
    );
  },

  async refreshAuth(): Promise<SocialAccount> {
    throw new NotSupportedError(
      "Token refresh is handled by ensureFreshToken() (freshness.ts), which persists the rotated token.",
    );
  },

  async disconnect() {
    // Local disconnect only — deleting the social_accounts row drops our
    // copy of the token. Remote revoke lands with the wizard-side revoke.
  },

  async listRecentPosts(account, opts) {
    // No real token → honest empty page, never mock posts.
    if (!hasRealAccessToken(account)) return { posts: [], nextCursor: null };
    return listOwnSubmissions(account, opts);
  },

  async getAccountMetrics(account): Promise<AccountMetrics> {
    // No real token → honest empty; the Accounts card renders "no data".
    if (!hasRealAccessToken(account)) return {};
    const profile = await verifyRedditAccount(account);
    // Reddit exposes karma, not followers/engagement-rate. Surface
    // total karma in the engagementRate field so the existing card UI
    // has something to render; followerCount/postCount stay undefined
    // until we add the listings calls.
    return {
      engagementRate: profile.link_karma + profile.comment_karma,
    };
  },

  async verifyAccount(account) {
    const profile = await verifyRedditAccount(account);
    return {
      ok: true,
      handle: profile.name,
      details: {
        link_karma: profile.link_karma,
        comment_karma: profile.comment_karma,
      },
    };
  },

  async publishPost(account, post): Promise<PublishedPostRef> {
    // Data honesty: no real token → BlockedNoCredentialError (the worker
    // marks the target `blocked`, terminal). Publish never fakes success.
    requireRealAccessToken(account, "publish to Reddit");
    return submitPost(account, post);
  },

  validatePost(post): PostValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const text = caption(post);
    const meta = post.metadata ?? {};
    const title = typeof meta.title === "string" ? meta.title.trim() : "";
    const subreddit = typeof meta.subreddit === "string" ? meta.subreddit.trim() : "";

    if (!title) errors.push("Reddit posts need a title.");
    if (title.length > REDDIT_TITLE_MAX) errors.push(`Title is ${title.length}/${REDDIT_TITLE_MAX} chars.`);
    if (!subreddit) errors.push("Pick a subreddit to post to.");
    if (text.length > REDDIT_BODY_MAX) errors.push(`Body is ${text.length}/${REDDIT_BODY_MAX} chars.`);

    if (/@\w+/.test(text) || /@\w+/.test(title)) {
      warnings.push("Reddit uses `u/username` for mentions, not `@username`.");
    }

    if (post.postType === "video" || post.postType === "reel") {
      if (post.mediaUrls.length !== 1) {
        errors.push("Reddit video posts take exactly one mp4 file.");
      }
      const posterUrl =
        typeof meta.posterUrl === "string" ? (meta.posterUrl as string).trim() : "";
      if (!posterUrl) {
        warnings.push(
          "Reddit video posts need a poster image (metadata.posterUrl) — the publish will fail without one.",
        );
      }
    } else if (post.mediaUrls.length > 1) {
      errors.push("Reddit galleries aren't supported yet — attach a single image.");
    }

    return { ok: errors.length === 0, errors, warnings };
  },
};
