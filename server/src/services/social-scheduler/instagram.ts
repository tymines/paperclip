/**
 * Instagram adapter — real content-publish via the container → publish
 * flow; OAuth handled by the wizard.
 *
 * Real wiring requires:
 *   - Meta App with the Instagram API (Instagram Login) product — the same
 *     app the wizard's token-exchange path targets (api.instagram.com +
 *     graph.instagram.com)
 *   - Instagram Business or Creator account (no personal IG via the API)
 *
 * **App Review status (read vs publish):**
 *   - `instagram_business_basic` (read profile + media): available to Meta
 *     apps in Development Mode for the app's test users with NO App Review.
 *     This is what Tyler can use to verify end-to-end *today* with his own
 *     IG account added as a test user — connect succeeds, /verify returns
 *     ok, account row shows up green.
 *   - `instagram_business_content_publish` (post to feed/reels): requires
 *     Meta App Review (~1-3 week queue). Until it ships approved, the
 *     publish call fails with Meta's permission error — surfaced verbatim
 *     on the target's errorMessage, never masked by a fake success.
 *
 * Publish path:
 *   1. POST https://graph.instagram.com/v21.0/{ig-user-id}/media
 *      { image_url, caption } → { id: <container-id> }
 *   2. POST https://graph.instagram.com/v21.0/{ig-user-id}/media_publish
 *      { creation_id } → { id: <media-id> }
 *   Carousels = N child containers (is_carousel_item=true) + 1 parent
 *   container (media_type=CAROUSEL, children=[...]) + publish.
 *   Video/Reels = { media_type: REELS, video_url } container, then a
 *   status poll (GET /{container}?fields=status_code) until FINISHED
 *   before media_publish — ERROR/EXPIRED/timeout throw, never a fake
 *   publish. Stories remain 501 (honest) for now.
 *
 *   IG downloads image_url/video_url itself, so every media URL must be
 *   publicly reachable — `assertPubliclyFetchableMediaUrl` fails loudly
 *   (naming PAPERCLIP_PUBLIC_URL) when handed a localhost/LAN URL.
 *
 * Instagram cannot publish text-only posts — a post without media fails
 * with a clear 400 rather than being silently dropped.
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
import { assertPubliclyFetchableMediaUrl, mediaPollSleep } from "./media.js";

const IG_CAPTION_MAX = 2200;
const IG_HASHTAG_MAX = 30;

const IG_GRAPH = "https://graph.instagram.com/v21.0";
const IG_CONTAINER_POLL_INTERVAL_MS = 2_000;
const IG_CONTAINER_POLL_MAX_ATTEMPTS = 90; // ~3 min of video processing

export class InstagramApiError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;
  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "InstagramApiError";
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
  const errObj = (obj.error ?? null) as { message?: unknown } | null;
  if (!res.ok || errObj) {
    const message =
      typeof errObj?.message === "string" ? errObj.message : `HTTP ${res.status}`;
    throw new InstagramApiError(`Instagram ${context} failed: ${message}`, res.status || 502, obj);
  }
  return obj;
}

async function igPost(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const res = await fetch(`${IG_GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseGraphJson(res, `POST ${path}`);
}

function readId(json: Record<string, unknown>, context: string): string {
  const id = typeof json.id === "string" ? json.id : null;
  if (!id) throw new InstagramApiError(`Instagram ${context} returned no id`, 502, json);
  return id;
}

/**
 * Poll a media container until IG finishes processing it (video/reels are
 * async). FINISHED → return; ERROR/EXPIRED or a poll timeout → throw with
 * the real status. Publishing an unfinished container fails opaquely, so
 * this runs before every video media_publish.
 */
async function waitForIgContainer(containerId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < IG_CONTAINER_POLL_MAX_ATTEMPTS; attempt += 1) {
    const url = new URL(`${IG_GRAPH}/${containerId}`);
    url.searchParams.set("fields", "status_code,status");
    url.searchParams.set("access_token", accessToken);
    const res = await fetch(url);
    const json = await parseGraphJson(res, `GET /${containerId} (container status)`);
    const statusCode = typeof json.status_code === "string" ? json.status_code : null;
    if (statusCode === "FINISHED") return;
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      const detail = typeof json.status === "string" ? ` — ${json.status}` : "";
      throw new InstagramApiError(
        `Instagram container ${containerId} processing ${statusCode}${detail}`,
        422,
        json,
      );
    }
    await mediaPollSleep(IG_CONTAINER_POLL_INTERVAL_MS);
  }
  throw new InstagramApiError(
    `Instagram container ${containerId} did not finish processing in time`,
    504,
  );
}

/** Best-effort permalink lookup for the published media — null on failure. */
async function fetchPermalink(mediaId: string, accessToken: string): Promise<string | null> {
  try {
    const url = new URL(`${IG_GRAPH}/${mediaId}`);
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

export const instagramAdapter: SocialPlatformAdapter = {
  platform: "instagram",

  async startConnect(): Promise<ConnectAuthStart> {
    throw new NotSupportedError(
      "Instagram connect runs through the Social connect wizard (app credentials + OAuth callback), not the adapter.",
    );
  },

  async finishConnect(): Promise<SocialAccount> {
    throw new NotSupportedError(
      "Instagram connect runs through the Social connect wizard (app credentials + OAuth callback), not the adapter.",
    );
  },

  async refreshAuth(): Promise<SocialAccount> {
    throw new NotSupportedError(
      "Token refresh is handled by ensureFreshToken() (freshness.ts), which persists the rotated token.",
    );
  },

  async disconnect() {
    // Local disconnect only — deleting the social_accounts row drops our
    // copy of the token; Meta tokens expire on their own.
  },

  async listRecentPosts() {
    // GET /me/media needs instagram_business_basic and isn't wired yet —
    // honest empty page, never mock posts.
    return { posts: [], nextCursor: null };
  },

  async getAccountMetrics(): Promise<AccountMetrics> {
    // followers_count/media_count sit behind instagram_business_basic and
    // aren't wired yet — honest empty.
    return {};
  },

  async publishPost(account, post): Promise<PublishedPostRef> {
    const accessToken = requireRealAccessToken(account, "publish to Instagram");
    const igUserId = account.platformAccountId;
    const text = caption(post);

    if (post.mediaUrls.length === 0) {
      throw new InstagramApiError(
        "Instagram cannot publish text-only posts — attach at least one image",
        400,
      );
    }
    if (post.postType === "story") {
      throw new InstagramApiError(
        "Instagram story publishing not yet implemented (STORIES container — next iteration)",
        501,
      );
    }
    // IG's servers download every image_url/video_url — hard-fail with the
    // config fix if the URL can never be reached from the public internet.
    for (const url of post.mediaUrls) {
      assertPubliclyFetchableMediaUrl(url, {
        platform: "instagram",
        action: "publish media (Instagram downloads image_url/video_url)",
      });
    }

    const isVideo = post.postType === "video" || post.postType === "reel";

    let containerId: string;
    if (isVideo) {
      // Feed video + reels both publish through the REELS container type.
      if (post.mediaUrls.length !== 1) {
        throw new InstagramApiError("Instagram video/reel posts take exactly one video", 400);
      }
      const created = await igPost(`/${igUserId}/media`, {
        media_type: "REELS",
        video_url: post.mediaUrls[0] as string,
        ...(text ? { caption: text } : {}),
        access_token: accessToken,
      });
      containerId = readId(created, "REELS container");
      // Video containers process async — publish only after FINISHED.
      await waitForIgContainer(containerId, accessToken);
    } else if (post.mediaUrls.length === 1) {
      // Single image: one container carrying the caption.
      const created = await igPost(`/${igUserId}/media`, {
        image_url: post.mediaUrls[0] as string,
        ...(text ? { caption: text } : {}),
        access_token: accessToken,
      });
      containerId = readId(created, "media container");
    } else {
      // Carousel: N child containers, then a parent CAROUSEL container.
      const childIds: string[] = [];
      for (const mediaUrl of post.mediaUrls) {
        const child = await igPost(`/${igUserId}/media`, {
          image_url: mediaUrl,
          is_carousel_item: "true",
          access_token: accessToken,
        });
        childIds.push(readId(child, "carousel child container"));
      }
      const parent = await igPost(`/${igUserId}/media`, {
        media_type: "CAROUSEL",
        children: childIds.join(","),
        ...(text ? { caption: text } : {}),
        access_token: accessToken,
      });
      containerId = readId(parent, "carousel container");
    }

    const published = await igPost(`/${igUserId}/media_publish`, {
      creation_id: containerId,
      access_token: accessToken,
    });
    const mediaId = readId(published, "media_publish");
    const permalink = await fetchPermalink(mediaId, accessToken);

    return {
      platformPostId: mediaId,
      platformUrl: permalink,
      publishedAt: new Date(),
      caption: text || null,
      mediaUrl: post.mediaUrls[0] ?? null,
    };
  },

  validatePost(post: PostDraftPayload): PostValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const text = caption(post);

    if (text.length > IG_CAPTION_MAX) {
      warnings.push(`Caption is ${text.length} chars — IG truncates above ${IG_CAPTION_MAX}.`);
    }
    const hashtags = text.match(/#\w+/g) ?? [];
    if (hashtags.length > IG_HASHTAG_MAX) {
      errors.push(`Instagram allows at most ${IG_HASHTAG_MAX} hashtags (caption has ${hashtags.length}).`);
    }
    if (post.postType === "image" && post.mediaUrls.length === 0) {
      errors.push("Image post requires at least one media item.");
    }
    if (post.postType === "carousel" && (post.mediaUrls.length < 2 || post.mediaUrls.length > 10)) {
      errors.push("Carousel needs 2–10 media items.");
    }
    if ((post.postType === "reel" || post.postType === "video") && post.mediaUrls.length !== 1) {
      errors.push("Instagram video/reel posts take exactly one video file (mp4).");
    }
    if (post.postType === "story") {
      errors.push("Instagram story publishing is not wired yet.");
    }
    if (post.postType === "text") {
      // Warning (not error) so a caption-only post to other platforms isn't
      // hard-blocked just because IG is also selected — the IG target itself
      // fails visibly at publish time with the same reason.
      warnings.push("Instagram cannot publish text-only posts — this target will fail unless media is attached.");
    }
    // URLs in IG captions are not clickable — gentle warning.
    if (/(https?:\/\/\S+)/.test(text)) {
      warnings.push("URLs in Instagram captions are not clickable. Use \"link in bio\".");
    }

    return { ok: errors.length === 0, errors, warnings };
  },
};
