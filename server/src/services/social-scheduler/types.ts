/**
 * Platform adapter contract for the social scheduler.
 *
 * Every platform Paperclip supports for publishing/scheduling (Instagram, X,
 * Facebook, Threads, Reddit, …) ships a file in this directory implementing
 * `SocialPlatformAdapter`. v1 ships stub implementations that return mock data
 * — they satisfy the contract so the UI can be built end-to-end before any
 * real OAuth credentials are wired in.
 *
 * When Tyler ships API credentials, only the per-platform adapter file needs
 * a real implementation; routes and UI stay untouched.
 */
import type {
  SocialAccount,
  SocialPlatform,
  SocialPostType,
} from "@paperclipai/shared";

/** Result of a connect-flow start — the URL we redirect the user to. */
export interface ConnectAuthStart {
  authUrl: string;
  state: string;
}

/** Per-platform input the user composed. */
export interface PostDraftPayload {
  baseCaption: string;
  /** Plain text override that wins over baseCaption when set. */
  caption?: string | null;
  postType: SocialPostType;
  mediaUrls: string[];
  /** IG-specific: post hashtags as the first comment after publish. */
  firstComment?: string | null;
  /** Free-form per-platform metadata (e.g. subreddit, flair, threading IDs). */
  metadata?: Record<string, unknown>;
}

/** Validation outcome before submit — feeds into UI character-count chips. */
export interface PostValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Cached representation of a previously-published post. */
export interface PublishedPostRef {
  platformPostId: string;
  platformUrl: string | null;
  publishedAt: Date;
  caption: string | null;
  mediaUrl: string | null;
  thumbnailUrl?: string | null;
  /** Optional engagement metrics (likes/comments/reach). */
  metrics?: Record<string, number>;
}

export interface AccountMetrics {
  followerCount?: number;
  postCount?: number;
  engagementRate?: number;
}

/**
 * The single contract each platform implements. v1 stubs return obviously-
 * fake data shaped exactly like the real responses will be, so the UI is
 * fully built and Tyler can demo the scheduler end-to-end before any real
 * OAuth wiring exists.
 */
export interface SocialPlatformAdapter {
  readonly platform: SocialPlatform;

  /** Begin OAuth — caller redirects the user to authUrl. */
  startConnect(opts: {
    companyId: string;
    redirectUri: string;
  }): Promise<ConnectAuthStart>;

  /** Finish OAuth — caller passes the code + state we got back from the redirect. */
  finishConnect(opts: {
    code: string;
    state: string;
    companyId: string;
  }): Promise<SocialAccount>;

  /** Refresh the stored access token. */
  refreshAuth(account: SocialAccount): Promise<SocialAccount>;

  /** Revoke our access token on the platform side. */
  disconnect(account: SocialAccount): Promise<void>;

  /** Fetch the most recent N posts from this account's feed. */
  listRecentPosts(
    account: SocialAccount,
    opts?: { limit?: number; cursor?: string | null },
  ): Promise<{ posts: PublishedPostRef[]; nextCursor: string | null }>;

  /** Fetch account-level totals shown on the Accounts card. */
  getAccountMetrics(account: SocialAccount): Promise<AccountMetrics>;

  /**
   * Publish immediately (used by both Post-Now and the scheduler worker when
   * a queued post's scheduledAt has come due).
   */
  publishPost(
    account: SocialAccount,
    post: PostDraftPayload,
  ): Promise<PublishedPostRef>;

  /**
   * Per-platform validation — character counts, media constraints, hashtag
   * rules. Pure function; doesn't hit the network.
   */
  validatePost(post: PostDraftPayload): PostValidation;
}
