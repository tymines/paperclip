/**
 * Instagram adapter — stub implementation.
 *
 * Real wiring requires:
 *   - Meta App with Instagram Graph API permissions
 *     (instagram_basic, instagram_content_publish, pages_show_list,
 *     pages_read_engagement)
 *   - Instagram account linked to a Facebook Page (Business or Creator only;
 *     no personal IG via the Graph API)
 *   - OAuth flow via Facebook Login that returns a long-lived Page token
 *
 * Publish path: POST /{ig-user-id}/media (create container) → POST
 * /{ig-user-id}/media_publish (finalize). Carousels = N containers + 1
 * parent container with children=[...]. Stories = different media type and
 * separate publishing endpoint.
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
};
