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
 * Multi-photo and video posts need the unpublished-photos / video-upload
 * flows — punted; `publishPost` throws `FacebookApiError(501)` rather than
 * dropping media. Page target selection: `metadata.pageId` on the post or
 * account wins; otherwise the first Page from /me/accounts.
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

const FB_GRAPH = "https://graph.facebook.com/v21.0";

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

    if (post.mediaUrls.length > 1 || post.postType === "video" || post.postType === "reel") {
      throw new FacebookApiError(
        "Facebook multi-photo/video posts not yet implemented (unpublished-photos / video upload flow — next iteration)",
        501,
      );
    }
    if (!text && post.mediaUrls.length === 0) {
      throw new FacebookApiError("Facebook post needs either text or media", 400);
    }

    const page = await resolvePage(account, post, userToken);
    const scheduledPublishTime = readScheduledPublishTime(post);

    const body = new URLSearchParams();
    body.set("access_token", page.accessToken);
    if (scheduledPublishTime != null) {
      body.set("published", "false");
      body.set("scheduled_publish_time", String(scheduledPublishTime));
    }

    let endpoint: string;
    if (post.mediaUrls.length === 1) {
      // Single image → POST /{page-id}/photos with the public image URL.
      endpoint = `${FB_GRAPH}/${page.id}/photos`;
      body.set("url", post.mediaUrls[0] as string);
      if (text) body.set("caption", text);
    } else {
      endpoint = `${FB_GRAPH}/${page.id}/feed`;
      body.set("message", text);
      const link = typeof meta.link === "string" ? meta.link : "";
      if (link) body.set("link", link);
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await parseGraphJson(res, `POST ${endpoint.slice(FB_GRAPH.length)}`);
    // /feed returns { id: "<pageid>_<postid>" }; /photos returns
    // { id: <photo-id>, post_id?: "<pageid>_<postid>" }.
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
