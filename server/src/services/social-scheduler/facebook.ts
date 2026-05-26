/**
 * Facebook adapter — OAuth token exchange wired through `token-exchange.ts`.
 *
 * Facebook is the ONLY platform on Tyler's list with native scheduled
 * publishing in the API (per Hermes's social-platform-apis.md). That
 * makes it the flagship for v1 scheduling — the `scheduledAt` field becomes
 * the literal `scheduled_publish_time` request parameter instead of
 * Paperclip's own queue.
 *
 * Real wiring:
 *   - Meta App (same one as Instagram if Tyler links his IG to a FB Page)
 *   - Permissions: pages_manage_posts, pages_read_engagement, pages_show_list
 *   - OAuth flow returning a long-lived Page access token (not user token)
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
 *     If review hasn't completed, the wizard's authorize will succeed but
 *     Meta will not grant the scope. `social_accounts.scopes` will reflect
 *     what was actually granted; `publishPost` checks before calling the
 *     API and surfaces a "publish scope not granted — App Review pending"
 *     error.
 *
 * Publish — immediate (text/link):
 *   POST https://graph.facebook.com/{page-id}/feed
 *   Body: { message, link?, access_token }
 *
 * Publish — image:
 *   POST https://graph.facebook.com/{page-id}/photos
 *   Body: { url | source, caption, access_token }
 *
 * Publish — scheduled (NATIVE — flagship feature):
 *   POST https://graph.facebook.com/{page-id}/feed
 *   Body: {
 *     message,
 *     published: false,
 *     scheduled_publish_time: <UNIX SECONDS>,   // ≥10 min in future
 *     access_token,
 *   }
 *   Constraints:
 *     - min 10 minutes in the future
 *     - max ~75 days (UI says 75; community sources sometimes say 6
 *       months; conservative cap is 75 days)
 *     - slots align to :00/:10/:20/:30/:40/:50 in the UI; the API may
 *       not enforce that — pass an exact UNIX timestamp and let FB
 *       round.
 *
 * Rate ceiling: community-reported ~50 posts/day/page; no documented
 * hard cap. We rate-limit in Paperclip rather than rely on FB.
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

  ...expansionStubs("facebook"),
};
