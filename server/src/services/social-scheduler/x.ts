/**
 * X adapter — OAuth token exchange wired through `token-exchange.ts`.
 *
 * Real wiring requires:
 *   - X Developer account with Project + App
 *   - OAuth 2.0 (PKCE) client with `tweet.read tweet.write users.read
 *     offline.access` scopes
 *   - Pay-per-use plan (X dropped the free tier in 2026 — see the wizard
 *     gate for credit-purchase instructions)
 *
 * **Paid-tier status (read vs publish):**
 *   - `tweet.read` + `users.read` (verify + read timeline): available on
 *     any tier including the bottom $0.001/owned-resource read pricing —
 *     no App Review needed.
 *   - `tweet.write` (publish a tweet): $0.015 per tweet, $0.20 per tweet
 *     containing a URL. Same wallet, same Developer Portal — no separate
 *     review queue. The wizard's gate confirms Tyler has bought credits.
 *   - DM scopes are intentionally NOT requested: Paperclip doesn't route
 *     DMs and the Developer Console app is configured Read+Write only,
 *     so requesting them would fail the handshake with `unauthorized_scope`.
 *
 * Publish path: POST /2/tweets with body { text, media: { media_ids: [..] } }.
 * Threads = chain via { reply: { in_reply_to_tweet_id } } on subsequent
 * tweets after the first.
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
import {
  caption,
  mockAccountMetrics,
  mockConnectAccount,
  mockConnectStart,
  mockPublishedRef,
  mockRecentPosts,
} from "./stub-helpers.js";
import { expansionStubs } from "./expansion-stubs.js";

const X_TWEET_MAX = 280;
const X_MEDIA_MAX = 4;

export const xAdapter: SocialPlatformAdapter = {
  platform: "x",

  async startConnect() {
    return mockConnectStart("x");
  },

  async finishConnect(opts) {
    return mockConnectAccount({
      platform: "x",
      companyId: opts.companyId,
      username: "stub_x_handle",
      displayName: "Stub X Account",
    });
  },

  async refreshAuth(account) {
    return { ...account, tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 2) };
  },

  async disconnect() {},

  async listRecentPosts(account, opts) {
    return {
      posts: mockRecentPosts(account, opts?.limit ?? 20),
      nextCursor: null,
    };
  },

  async getAccountMetrics(account): Promise<AccountMetrics> {
    return mockAccountMetrics(account);
  },

  async publishPost(account, post): Promise<PublishedPostRef> {
    return mockPublishedRef(account, post);
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

  ...expansionStubs("x"),
};
