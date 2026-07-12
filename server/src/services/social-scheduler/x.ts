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
 *   { text, reply?: { in_reply_to_tweet_id } }
 * Threads = the editor splits text on blank lines; each segment becomes a
 * tweet chained via `reply.in_reply_to_tweet_id` after the first.
 *
 * Media upload (v2 media endpoint, chunked) is a separate flow — punted to
 * a follow-up iteration; `publishPost` throws `XApiError(501)` if media is
 * supplied. It never fakes a media publish.
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

const X_TWEET_MAX = 280;
const X_MEDIA_MAX = 4;

const X_API_BASE = "https://api.twitter.com/2";

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
  body: { text: string; reply?: { in_reply_to_tweet_id: string } },
): Promise<string> {
  const res = await xFetch("/tweets", { accessToken, method: "POST", body });
  const json = await parseXJson(res, "POST /2/tweets");
  const data = (json.data ?? null) as { id?: unknown } | null;
  const id = typeof data?.id === "string" ? data.id : null;
  if (!id) throw new XApiError("X POST /2/tweets returned no tweet id", 502, json);
  return id;
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

    if (post.mediaUrls.length > 0) {
      // v2 chunked media upload is a separate flow — fail loudly instead of
      // publishing a text-only tweet that silently drops the media.
      throw new XApiError(
        "X media posts not yet implemented (v2 media upload — next iteration)",
        501,
      );
    }

    const text = caption(post);
    if (!text) throw new XApiError("X post requires text (media upload not wired yet)", 400);

    if (post.postType === "thread") {
      const segments = threadSegments(text);
      if (segments.length === 0) throw new XApiError("X thread has no segments", 400);
      let previousId: string | null = null;
      let firstId: string | null = null;
      for (const segment of segments) {
        const id: string = await postTweet(accessToken, {
          text: segment,
          ...(previousId ? { reply: { in_reply_to_tweet_id: previousId } } : {}),
        });
        firstId = firstId ?? id;
        previousId = id;
      }
      return {
        platformPostId: firstId as string,
        platformUrl: tweetUrl(account, firstId as string),
        publishedAt: new Date(),
        caption: text,
        mediaUrl: null,
      };
    }

    const id = await postTweet(accessToken, { text });
    return {
      platformPostId: id,
      platformUrl: tweetUrl(account, id),
      publishedAt: new Date(),
      caption: text,
      mediaUrl: null,
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

    if (post.mediaUrls.length > X_MEDIA_MAX) {
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
