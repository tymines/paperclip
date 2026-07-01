/**
 * Instagram adapter — OAuth token exchange wired through `token-exchange.ts`.
 *
 * Real wiring requires:
 *   - Meta App with Instagram Graph API permissions
 *     (instagram_basic, instagram_content_publish, pages_show_list,
 *     pages_read_engagement)
 *   - Instagram account linked to a Facebook Page (Business or Creator only;
 *     no personal IG via the Graph API)
 *   - OAuth flow via Facebook Login that returns a long-lived Page token
 *
 * **App Review status (read vs publish):**
 *   - `instagram_business_basic` (read profile + media): available to Meta
 *     apps in Development Mode for the app's test users with NO App Review.
 *     This is what Tyler can use to verify-end-to-end *today* with his own
 *     IG account added as a test user — connect succeeds, /verify returns
 *     ok, account row shows up green.
 *   - `instagram_business_content_publish` (post to feed/reels): requires
 *     Meta App Review (~1-3 week queue). Until it ships approved, the
 *     wizard's authorize step will request the publish scope and Meta will
 *     either grant it (test users) or strip it (everyone else); Paperclip
 *     persists whatever scope Meta returns on `social_accounts.scopes`.
 *     `publishPost` checks that and surfaces a "publish scope not granted
 *     — App Review pending" error rather than calling the API.
 *
 * Publish path (when scope is granted): POST /{ig-user-id}/media (create
 * container) → POST /{ig-user-id}/media_publish (finalize). Carousels = N
 * containers + 1 parent container with children=[...]. Stories = different
 * media type and separate publishing endpoint.
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

const IG_CAPTION_MAX = 2200;
const IG_HASHTAG_MAX = 30;

export const instagramAdapter: SocialPlatformAdapter = {
  platform: "instagram",

  async startConnect(): Promise<ConnectAuthStart> {
    return mockConnectStart("instagram");
  },

  async finishConnect(opts): Promise<SocialAccount> {
    return mockConnectAccount({
      platform: "instagram",
      companyId: opts.companyId,
      username: "stub_ig_handle",
      displayName: "Stub Instagram Account",
    });
  },

  async refreshAuth(account) {
    return { ...account, tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60) };
  },

  async disconnect() {
    // No-op in stub. Real impl would revoke the page access token.
  },

  async listRecentPosts(account, opts) {
    return {
      posts: mockRecentPosts(account, opts?.limit ?? 33),
      nextCursor: null,
    };
  },

  async getAccountMetrics(account): Promise<AccountMetrics> {
    return mockAccountMetrics(account);
  },

  async publishPost(account, post): Promise<PublishedPostRef> {
    return mockPublishedRef(account, post);
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
    if (post.postType === "reel" && post.mediaUrls.length === 0) {
      errors.push("Reel requires a video file.");
    }
    // URLs in IG captions are not clickable — gentle warning.
    if (/(https?:\/\/\S+)/.test(text)) {
      warnings.push("URLs in Instagram captions are not clickable. Use \"link in bio\".");
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  // Expansion-pass methods (Inbox / Competitors / Analytics / Hashtags).
  // Real wiring replaces these per-method; stubs return shaped mock data.
  ...expansionStubs("instagram"),
};
