/**
 * Facebook adapter — stub implementation.
 *
 * Real wiring requires:
 *   - Meta App (same one as Instagram if Tyler links his IG to a FB Page)
 *   - Permissions: pages_manage_posts, pages_read_engagement, pages_show_list
 *   - OAuth flow returning a long-lived Page access token (not user token)
 *   - Personal-profile posting is no longer supported by Graph API; this
 *     adapter targets Facebook Pages only.
 *
 * Publish path: POST /{page-id}/feed for text/link posts, POST
 * /{page-id}/photos for image posts (or POST /{page-id}/videos for video).
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

export const facebookAdapter: SocialPlatformAdapter = {
  platform: "facebook",

  async startConnect() {
    return mockConnectStart("facebook");
  },

  async finishConnect(opts) {
    return mockConnectAccount({
      platform: "facebook",
      companyId: opts.companyId,
      username: "stub_fb_page",
      displayName: "Stub Facebook Page",
    });
  },

  async refreshAuth(account) {
    return { ...account, tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60) };
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
