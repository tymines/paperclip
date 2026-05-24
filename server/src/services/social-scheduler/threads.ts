/**
 * Threads adapter — stub implementation.
 *
 * Real wiring requires:
 *   - Meta App with Threads API permissions (same app as IG/FB works)
 *   - Threads API launched publicly June 2024 — separate from IG Graph API
 *     even though both run on Meta infra
 *   - OAuth flow returning Threads-scoped token
 *
 * Publish path: POST /{threads-user-id}/threads (create container) → POST
 * /{threads-user-id}/threads_publish (finalize). Up to 10 images / 1 video.
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

const THREADS_MAX = 500;
const THREADS_MEDIA_MAX = 10;

export const threadsAdapter: SocialPlatformAdapter = {
  platform: "threads",

  async startConnect() {
    return mockConnectStart("threads");
  },

  async finishConnect(opts) {
    return mockConnectAccount({
      platform: "threads",
      companyId: opts.companyId,
      username: "stub_threads_handle",
      displayName: "Stub Threads Account",
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

    if (text.length > THREADS_MAX) {
      errors.push(`Threads post is ${text.length}/${THREADS_MAX} chars.`);
    }
    if (text.length === 0 && post.mediaUrls.length === 0) {
      errors.push("Threads post needs either text or media.");
    }
    if (post.mediaUrls.length > THREADS_MEDIA_MAX) {
      errors.push(`Threads allows at most ${THREADS_MEDIA_MAX} images per post.`);
    }
    return { ok: errors.length === 0, errors, warnings };
  },
};
