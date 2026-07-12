/**
 * Facebook adapter — real Page publish via the Graph API; OAuth handled by
 * the wizard.
 *
 * Facebook is the ONLY platform on Tyler's list with native scheduled
 * publishing in the API (per Hermes's social-platform-apis.md). That
 * makes it the flagship for v1 scheduling — the post metadata's
 * `scheduledPublishTime` becomes the literal `scheduled_publish_time`
 * request parameter instead of Paperclip's own queue.
 *
 * Real wiring:
 *   - Meta App (same one as Instagram if Tyler links his IG to a FB Page)
 *   - Permissions: pages_manage_posts, pages_read_engagement, pages_show_list
 *   - OAuth flow returning a long-lived user token; the adapter resolves the
 *     Page (+ Page access token) via GET /me/accounts at publish time.
 *   - Personal-profile posting is no longer supported by Graph API; this
 *     adapter targets Facebook Pages only.
 *
 * **App Review status (read vs publish):**
 *   - `public_profile` + `email` (verify only): default permissions, no
 *     App Review. Connect + /verify work today.
 *   - `pages_show_list` + `pages_read_engagement` (read connected Pages):
 *     usable in Development Mode for the app's admins/devs without App
 *     Review — fine for Tyler's own account.
 *   - `pages_manage_posts` (publish to a Page): requires Meta App Review.
 *     If review hasn't completed, Meta will not grant the scope and the
 *     Graph call fails with a permission error — surfaced verbatim on the
 *     target's errorMessage, never masked by a fake success.
 *
 * Publish — immediate (text/link):
 *   POST https://graph.facebook.com/v21.0/{page-id}/feed
 *   Body: { message, link?, access_token }
 *
 * Publish — image (single):
 *   POST https://graph.facebook.com/v21.0/{page-id}/photos
 *   Body: { url, caption, access_token }
 *
 * Publish — scheduled (NATIVE — flagship feature):
 *   POST .../feed with { published: false, scheduled_publish_time: <UNIX
 *   SECONDS> } — min 10 minutes in the future, max ~75 days. Pass the post
 *   metadata `scheduledPublishTime` (unix seconds or ISO string) to use it.
 *
 * Publish — multi-photo:
 *   N × POST /{page-id}/photos with { url, published: false } (unpublished
 *   photos), then POST /{page-id}/feed with attached_media[i] =
 *   {"media_fbid": <photo-id>} + message (+ native scheduling params).
 *
 * Publish — video:
 *   POST /{page-id}/videos with { file_url, description } — Graph
 *   downloads the file from the URL (+ native scheduling params).
 *
 * Facebook downloads url/file_url itself, so media URLs must be publicly
 * reachable — `assertPubliclyFetchableMediaUrl` fails loudly (naming
 * PAPERCLIP_PUBLIC_URL) when handed a localhost/LAN URL. Page target
 * selection: `metadata.pageId` on the post or account wins; otherwise the
 * first Page from /me/accounts.
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
import { NotSupportedError, requireRealAccessToken } from "./errors.js";
import { assertPubliclyFetchableMediaUrl } from "./media.js";

const FB_GRAPH = "https://graph.facebook.com/v21.0";
const FB_MULTI_PHOTO_MAX = 10;

export class FacebookApiError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;
  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "FacebookApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Parse a Graph response, surfacing Meta's `{ error: { message } }` envelope. */
async function parseGraphJson(res: Response, context: string): Promise<Record<string, unknown>> {
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    /* handled below via the !ok branch */
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const errObj = (obj.error ?? null) as { message?: unknown; code?: unknown } | null;
  if (!res.ok || errObj) {
    const message =
      typeof errObj?.message === "string" ? errObj.message : `HTTP ${res.status}`;
    throw new FacebookApiError(`Facebook ${context} failed: ${message}`, res.status || 502, obj);
  }
  return obj;
}

interface FacebookPage {
  id: string;
  name: string | null;
  accessToken: string;
}

/**
 * Resolve which Page to publish to (and its Page access token) from the
 * connected user token. `metadata.pageId` on the post (then the account)
 * wins; otherwise the first managed Page.
 */
async function resolvePage(
  account: SocialAccount,
  post: PostDraftPayload,
  userToken: string,
): Promise<FacebookPage> {
  const postMeta = (post.metadata ?? {}) as Record<string, unknown>;
  const accountMeta = (account.metadata ?? {}) as Record<string, unknown>;
  const wantedPageId =
    (typeof postMeta.pageId === "string" && postMeta.pageId) ||
    (typeof accountMeta.pageId === "string" && accountMeta.pageId) ||
    null;

  const url = new URL(`${FB_GRAPH}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("access_token", userToken);
  const res = await fetch(url);
  const json = await parseGraphJson(res, "GET /me/accounts");
  const rows = Array.isArray(json.data) ? (json.data as Array<Record<string, unknown>>) : [];
  const pages: FacebookPage[] = rows
    .filter((r) => typeof r.id === "string" && typeof r.access_token === "string")
    .map((r) => ({
      id: r.id as string,
      name: typeof r.name === "string" ? r.name : null,
      accessToken: r.access_token as string,
    }));

  if (pages.length === 0) {
    throw new FacebookApiError(
      "Connected Facebook account manages no Pages (pages_show_list scope + at least one Page required)",
      400,
    );
  }
  if (wantedPageId) {
    const match = pages.find((p) => p.id === wantedPageId);
    if (!match) {
      throw new FacebookApiError(
        `Facebook Page ${wantedPageId} not found among the ${pages.length} Page(s) this account manages`,
        404,
      );
    }
    return match;
  }
  return pages[0] as FacebookPage;
}

/** metadata.scheduledPublishTime (unix seconds or ISO string) → unix seconds. */
function readScheduledPublishTime(post: PostDraftPayload): number | null {
  const meta = (post.metadata ?? {}) as Record<string, unknown>;
  const raw = meta.scheduledPublishTime;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  if (typeof raw === "string" && raw) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return null;
}

export const facebookAdapter: SocialPlatformAdapter = {
  platform: "facebook",

  async startConnect(): Promise<ConnectAuthStart> {
    throw new NotSupportedError(
      "Facebook connect runs through the Social connect wizard (app credentials + OAuth callback), not the adapter.",
    );
  },

  async finishConnect(): Promise<SocialAccount> {
    throw new NotSupportedError(
      "Facebook connect runs through the Social connect wizard (app credentials + OAuth callback), not the adapter.",
    );
  },

  async refreshAuth(): Promise<SocialAccount> {
    throw new NotSupportedError(
      "Facebook long-lived tokens are not refreshable — reconnect through the wizard when expired (see token-exchange.ts).",
    );
  },

  async disconnect() {
    // Local disconnect only — deleting the social_accounts row drops our
    // copy of the token. Remote permission revoke (DELETE /me/permissions)
    // lands with the wizard-side revoke.
  },

  async listRecentPosts() {
    // Reading the Page feed needs pages_read_engagement + a resolved Page —
    // not wired yet. Honest empty page, never mock posts.
    return { posts: [], nextCursor: null };
  },

  async getAccountMetrics(): Promise<AccountMetrics> {
    // Page fan_count/insights sit behind pages_read_engagement + App
    // Review. Nothing real to report yet — honest empty.
    return {};
  },

  async publishPost(account, post): Promise<PublishedPostRef> {
    const userToken = requireRealAccessToken(account, "publish to Facebook");
    const meta = (post.metadata ?? {}) as Record<string, unknown>;
    const text = caption(post);
    const isVideo = post.postType === "video" || post.postType === "reel";

    if (!text && post.mediaUrls.length === 0) {
      throw new FacebookApiError("Facebook post needs either text or media", 400);
    }
    if (isVideo && post.mediaUrls.length !== 1) {
      throw new FacebookApiError("Facebook video posts take exactly one video file", 400);
    }
    if (!isVideo && post.mediaUrls.length > FB_MULTI_PHOTO_MAX) {
      throw new FacebookApiError(
        `Facebook multi-photo posts support at most ${FB_MULTI_PHOTO_MAX} images`,
        400,
      );
    }
    // Graph downloads url/file_url itself — hard-fail with the config fix
    // when the URL can never be reached from the public internet.
    for (const url of post.mediaUrls) {
      assertPubliclyFetchableMediaUrl(url, {
        platform: "facebook",
        action: "publish media (Facebook downloads url/file_url)",
      });
    }

    const page = await resolvePage(account, post, userToken);
    const scheduledPublishTime = readScheduledPublishTime(post);

    const withScheduling = (body: URLSearchParams) => {
      if (scheduledPublishTime != null) {
        body.set("published", "false");
        body.set("scheduled_publish_time", String(scheduledPublishTime));
      }
      return body;
    };
    const fbPost = async (path: string, body: URLSearchParams) => {
      const res = await fetch(`${FB_GRAPH}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      return parseGraphJson(res, `POST ${path}`);
    };

    let json: Record<string, unknown>;
    if (isVideo) {
      // Video → POST /{page-id}/videos; Graph downloads file_url.
      const body = withScheduling(new URLSearchParams());
      body.set("access_token", page.accessToken);
      body.set("file_url", post.mediaUrls[0] as string);
      if (text) body.set("description", text);
      json = await fbPost(`/${page.id}/videos`, body);
    } else if (post.mediaUrls.length === 1) {
      // Single image → POST /{page-id}/photos with the public image URL.
      const body = withScheduling(new URLSearchParams());
      body.set("access_token", page.accessToken);
      body.set("url", post.mediaUrls[0] as string);
      if (text) body.set("caption", text);
      json = await fbPost(`/${page.id}/photos`, body);
    } else if (post.mediaUrls.length > 1) {
      // Multi-photo → N unpublished photos, then one /feed post that
      // attaches them all via attached_media.
      const photoIds: string[] = [];
      for (const mediaUrl of post.mediaUrls) {
        const photoBody = new URLSearchParams();
        photoBody.set("access_token", page.accessToken);
        photoBody.set("url", mediaUrl);
        photoBody.set("published", "false");
        const photoJson = await fbPost(`/${page.id}/photos`, photoBody);
        const photoId = typeof photoJson.id === "string" ? photoJson.id : null;
        if (!photoId) {
          throw new FacebookApiError(
            "Facebook unpublished-photo upload returned no id",
            502,
            photoJson,
          );
        }
        photoIds.push(photoId);
      }
      const body = withScheduling(new URLSearchParams());
      body.set("access_token", page.accessToken);
      if (text) body.set("message", text);
      photoIds.forEach((photoId, i) => {
        body.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: photoId }));
      });
      json = await fbPost(`/${page.id}/feed`, body);
    } else {
      const body = withScheduling(new URLSearchParams());
      body.set("access_token", page.accessToken);
      body.set("message", text);
      const link = typeof meta.link === "string" ? meta.link : "";
      if (link) body.set("link", link);
      json = await fbPost(`/${page.id}/feed`, body);
    }

    // /feed returns { id: "<pageid>_<postid>" }; /photos returns
    // { id: <photo-id>, post_id?: "<pageid>_<postid>" }; /videos { id }.
    const postId =
      (typeof json.post_id === "string" && json.post_id) ||
      (typeof json.id === "string" && json.id) ||
      null;
    if (!postId) {
      throw new FacebookApiError("Facebook publish returned no post id", 502, json);
    }

    return {
      platformPostId: postId,
      platformUrl: `https://www.facebook.com/${postId}`,
      publishedAt: scheduledPublishTime != null ? new Date(scheduledPublishTime * 1000) : new Date(),
      caption: text || null,
      mediaUrl: post.mediaUrls[0] ?? null,
    };
  },

  validatePost(post): PostValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const text = caption(post);

    if (text.length === 0 && post.mediaUrls.length === 0) {
      errors.push("Facebook post needs either text or media.");
    }
    if (post.postType === "video" || post.postType === "reel") {
      if (post.mediaUrls.length !== 1) {
        errors.push("Facebook video posts take exactly one video file (mp4).");
      }
    } else if (post.mediaUrls.length > FB_MULTI_PHOTO_MAX) {
      errors.push(`Facebook multi-photo posts support at most ${FB_MULTI_PHOTO_MAX} images.`);
    }
    // FB has no hard caption cap but anything over ~5000 chars is unreadable.
    if (text.length > 5000) {
      warnings.push(`Post body is ${text.length} chars — most readers won't scroll past 500.`);
    }
    if ((text.match(/#\w+/g) ?? []).length > 5) {
      warnings.push("Hashtags do little on Facebook — most successful Page posts use zero.");
    }
    return { ok: errors.length === 0, errors, warnings };
  },
};
