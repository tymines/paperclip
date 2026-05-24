/**
 * Reddit adapter — stub implementation.
 *
 * Real wiring requires:
 *   - Reddit application registered at https://www.reddit.com/prefs/apps
 *     (script or web type)
 *   - OAuth 2.0 flow with scopes `submit identity read`
 *   - Per-subreddit posting rules — flair requirements, link/self
 *     enforcement, karma minimums. Adapter needs to read subreddit metadata
 *     before publishing.
 *
 * Publish path: POST /api/submit with body { sr, kind: self|link|image,
 * title, text|url, flair_id?, flair_text? }. Rate limit: 60 req/min per
 * user token.
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

const REDDIT_TITLE_MAX = 300;
const REDDIT_BODY_MAX = 40_000;

export const redditAdapter: SocialPlatformAdapter = {
  platform: "reddit",

  async startConnect() {
    return mockConnectStart("reddit");
  },

  async finishConnect(opts) {
    return mockConnectAccount({
      platform: "reddit",
      companyId: opts.companyId,
      username: "u/stub_reddit_user",
      displayName: "u/stub_reddit_user",
    });
  },

  async refreshAuth(account) {
    return { ...account, tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60) };
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

    return { ok: errors.length === 0, errors, warnings };
  },

  ...expansionStubs("reddit"),
};
