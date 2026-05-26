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

// SocialPlatform isn't always reused below — alias for the optional methods
// to make the contract self-documenting.
type _Platform = SocialPlatform;
void (null as unknown as _Platform);

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

/** Result of `adapter.verifyAccount()` — feeds the Accounts dot. */
export interface AccountVerification {
  ok: boolean;
  /** Handle the platform reports — useful if the user renamed since connect. */
  handle?: string;
  /** Platform-specific extras (Reddit karma, X followers count, etc.). */
  details?: Record<string, unknown>;
}

/** ── Expansion-pass shapes (Inbox / Analytics / Competitors / Hashtags) ── */

export interface DirectMessageThread {
  threadId: string;
  participantHandle: string;
  participantAvatarUrl: string | null;
  /** When the latest message in this thread arrived. */
  lastMessageAt: Date;
  /** Preview of the latest message, truncated. */
  lastMessagePreview: string;
  unreadCount: number;
  /**
   * Some platforms restrict outbound messages to a 24-hour window after the
   * last user-initiated message. When false, the UI greys out the reply
   * field with the right error explanation.
   */
  canReply: boolean;
}

export interface DirectMessage {
  id: string;
  threadId: string;
  direction: "inbound" | "outbound";
  sentAt: Date;
  text: string;
  attachments?: string[];
}

export interface CompetitorProfile {
  platform: SocialPlatform;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followerCount: number;
  postCount: number;
  /** Average posts per week over the trailing 30 days. */
  postingCadencePerWeek: number;
  /** Average engagement per post over the trailing 30 days. */
  averageEngagement: number;
}

export interface CompetitorMetricsTimeseries {
  /** ISO day → metrics for that day. */
  byDay: Array<{
    date: string;
    followerCount: number;
    posts: number;
    totalEngagement: number;
  }>;
  topPosts: Array<{
    platformPostId: string;
    caption: string;
    publishedAt: Date;
    likes: number;
    comments: number;
    mediaUrl: string | null;
  }>;
}

export interface AccountAnalytics {
  /** Sparkline of follower count by day. */
  followers: Array<{ date: string; value: number }>;
  engagement: Array<{ date: string; likes: number; comments: number; shares: number; reach: number }>;
  /** Heatmap matrix: 7 days × 24 hours of average engagement. */
  bestTimes: number[][];
  topPosts: Array<{
    platformPostId: string;
    caption: string;
    publishedAt: Date;
    likes: number;
    comments: number;
    mediaUrl: string | null;
    engagement: number;
  }>;
  topHashtags: Array<{ tag: string; uses: number; averageEngagement: number }>;
}

export interface HashtagSuggestion {
  tag: string;
  /** "popular" (1M+ uses), "medium" (10k–1M), "niche" (<10k). */
  tier: "popular" | "medium" | "niche";
  /** Cumulative uses of this hashtag on the platform. */
  totalUses: number;
  /** Internal-only: predicted reach uplift (relative %). */
  predictedReachLift?: number;
}

/**
 * The single contract each platform implements. v1 stubs return obviously-
 * fake data shaped exactly like the real responses will be, so the UI is
 * fully built and Tyler can demo the scheduler end-to-end before any real
 * OAuth wiring exists.
 */

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

  /**
   * Hit the platform's `/me`-style endpoint to confirm the stored token is
   * still good. Used by the Accounts dot. Optional because not every
   * platform exposes one; absent means the Accounts UI falls back to
   * `getAccountMetrics`.
   */
  verifyAccount?(account: SocialAccount): Promise<AccountVerification>;

  // ── Expansion-pass methods ────────────────────────────────────────────

  /** List inbound DM threads (most-recent-first). */
  listDirectMessageThreads?(
    account: SocialAccount,
    opts?: { limit?: number; since?: Date },
  ): Promise<DirectMessageThread[]>;

  /** Fetch the message stream for a specific thread. */
  listDirectMessages?(
    account: SocialAccount,
    threadId: string,
    opts?: { limit?: number },
  ): Promise<DirectMessage[]>;

  /** Send a DM in an existing thread. */
  sendDirectMessage?(
    account: SocialAccount,
    threadId: string,
    text: string,
  ): Promise<DirectMessage>;

  /** Search public profiles to add as competitor watch targets. */
  searchCompetitors?(query: string): Promise<CompetitorProfile[]>;

  /** Get a competitor's public engagement timeseries over a date range. */
  getCompetitorMetrics?(
    handle: string,
    opts: { from: Date; to: Date },
  ): Promise<CompetitorMetricsTimeseries>;

  /** Self-analytics for the Analytics dashboard. */
  getAccountAnalytics?(
    account: SocialAccount,
    opts: { from: Date; to: Date },
  ): Promise<AccountAnalytics>;

  /**
   * Hashtag suggestions. niche / seed text inform the recommendation tiers.
   * Real impl punts to a paid hashtag-intelligence provider or scrapes
   * platform search; stub returns deterministic mock tiers.
   */
  suggestHashtags?(opts: {
    text: string;
    niche?: string;
  }): Promise<HashtagSuggestion[]>;
}
