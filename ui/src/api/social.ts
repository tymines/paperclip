import type {
  SocialAccountPublic,
  SocialAppCredentialPublic,
  SocialAppCredentialTestResult,
  SocialPlatform,
  SocialPostDetail,
  SocialPostListItem,
  WizardPlatformSpec,
} from "@paperclipai/shared";
import { api } from "./client";

export interface SocialPlatformSupport {
  all: SocialPlatform[];
  supported: SocialPlatform[];
}

export interface WizardSpecsResponse {
  callbackBase: string;
  specs: Partial<Record<SocialPlatform, WizardPlatformSpec>>;
}

export interface WizardAuthorizeResponse {
  authUrl: string;
  state: string;
  scopes: string[];
}

export interface PostValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface FeedPublished {
  platformPostId: string;
  platformUrl: string | null;
  publishedAt: string;
  caption: string | null;
  mediaUrl: string | null;
  thumbnailUrl?: string | null;
  metrics?: Record<string, number>;
}
export interface FeedScheduled {
  id: string;
  scheduledAt: string | null;
  caption: string;
  mediaUrl: string | null;
}
export interface SocialFeedResponse {
  hasAccount: boolean;
  account?: SocialAccountPublic;
  published: FeedPublished[];
  scheduled: FeedScheduled[];
}

export type FeatureStatus = "ok" | "review" | "paid" | "self" | "blocked" | "missing" | "banned";
export interface FeatureRow {
  feature: string;
  byPlatform: Partial<Record<SocialPlatform, { status: FeatureStatus; note?: string }>>;
}
export interface HomeworkItem {
  title: string;
  description: string;
  href: string;
  importance: "blocker" | "recommended";
}
export interface BannedFeature {
  title: string;
  detail: string;
}
export interface FeasibilityResponse {
  matrix: FeatureRow[];
  homework: HomeworkItem[];
  banned: BannedFeature[];
}

// ── Data-honesty envelope ───────────────────────────────────────────────────
// Analytics / competitors / hashtag-suggest / inbox(non-X) endpoints no longer
// return mock series. They return a discriminated union: either real data
// (`available: true`) or an explicit keyed-off state with the reason and the
// homework item (app registration / App Review / paid tier) that unlocks it.
export interface KeyedOffHomeworkLink {
  title: string;
  href: string;
}
export interface KeyedOff {
  available: false;
  reason: string;
  homework?: KeyedOffHomeworkLink;
}
export type KeyedResponse<T> = { available: true; data: T } | KeyedOff;

// GET /social/inbox returns ONE entry per account: identity fields plus the
// per-account availability envelope. Availability is per-account — X can be
// `available: true` while IG in the same response is `available: false` with
// its homework link. Never a single top-level envelope.
export type InboxAccountEntry = {
  accountId: string;
  platform: SocialPlatform;
} & KeyedResponse<DirectMessageThread[]>;

// ── Composer media uploads ──────────────────────────────────────────────────
// POST /companies/:id/social/media stores files via the existing storage
// machinery and returns per-file URLs. `mediaUrl` is what goes on the post's
// mediaUrls; `publiclyFetchable: false` means only a loopback fallback URL
// exists (no PAPERCLIP_PUBLIC_URL configured) — fine for X/Reddit (the server
// uploads the bytes itself), honest pre-publish amber hint for IG/FB/Threads
// (Meta must download the URL from the public internet).
export interface SocialMediaUploadItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video";
  /** Authenticated preview URL (already /api-prefixed) for <img>/<video>. */
  contentUrl: string;
  /** Absolute URL to place on the post's mediaUrls. */
  mediaUrl: string;
  publiclyFetchable: boolean;
}

export interface SocialMediaUploadResponse {
  media: SocialMediaUploadItem[];
  errors: Array<{ filename: string; reason: string }>;
  publicBaseUrl: string | null;
  /** Present when no public base URL is configured — show it to the user. */
  publicUrlNotice?: string;
}

export const socialApi = {
  // ── Discovery ───────────────────────────────────────────────────────────
  platforms: () => api.get<SocialPlatformSupport>("/social/platforms"),
  feasibility: () => api.get<FeasibilityResponse>("/social/feasibility"),

  // ── Accounts ────────────────────────────────────────────────────────────
  listAccounts: (companyId: string) =>
    api.get<SocialAccountPublic[]>(`/companies/${companyId}/social/accounts`),

  getAccount: (companyId: string, accountId: string) =>
    api.get<SocialAccountPublic>(`/companies/${companyId}/social/accounts/${accountId}`),

  createAccount: (companyId: string, data: Record<string, unknown>) =>
    api.post<SocialAccountPublic>(`/companies/${companyId}/social/accounts`, data),

  updateAccount: (companyId: string, accountId: string, data: Record<string, unknown>) =>
    api.patch<SocialAccountPublic>(`/companies/${companyId}/social/accounts/${accountId}`, data),

  deleteAccount: (companyId: string, accountId: string) =>
    api.delete<SocialAccountPublic>(`/companies/${companyId}/social/accounts/${accountId}`),

  // ── OAuth ───────────────────────────────────────────────────────────────
  oauthStart: (companyId: string, platform: SocialPlatform) =>
    api.post<{ authUrl: string; state: string }>(
      `/companies/${companyId}/social/oauth/start`,
      { platform },
    ),

  oauthFinish: (companyId: string, platform: SocialPlatform, code: string, state: string) =>
    api.post<SocialAccountPublic>(
      `/companies/${companyId}/social/oauth/finish`,
      { platform, code, state },
    ),

  // ── Posts ───────────────────────────────────────────────────────────────
  listPosts: (companyId: string, status?: string) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    return api.get<SocialPostListItem[]>(`/companies/${companyId}/social/posts${qs}`);
  },

  getPost: (companyId: string, postId: string) =>
    api.get<SocialPostDetail>(`/companies/${companyId}/social/posts/${postId}`),

  createPost: (companyId: string, data: Record<string, unknown>) =>
    api.post<SocialPostDetail>(`/companies/${companyId}/social/posts`, data),

  updatePost: (companyId: string, postId: string, data: Record<string, unknown>) =>
    api.patch<SocialPostDetail>(`/companies/${companyId}/social/posts/${postId}`, data),

  deletePost: (companyId: string, postId: string) =>
    api.delete<SocialPostDetail>(`/companies/${companyId}/social/posts/${postId}`),

  // ── Media (composer uploads) ────────────────────────────────────────────
  uploadMedia: (companyId: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return api.postForm<SocialMediaUploadResponse>(
      `/companies/${companyId}/social/media`,
      form,
    );
  },

  validatePost: (
    companyId: string,
    platforms: SocialPlatform[],
    post: Record<string, unknown>,
  ) =>
    api.post<Record<string, PostValidationResult>>(
      `/companies/${companyId}/social/posts/validate`,
      { platforms, post },
    ),

  // ── Scheduler-specific ──────────────────────────────────────────────────
  feed: (companyId: string, platform: SocialPlatform, opts?: { accountId?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.accountId) params.set("accountId", opts.accountId);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<SocialFeedResponse>(
      `/companies/${companyId}/social/feed/${platform}${qs ? `?${qs}` : ""}`,
    );
  },

  queue: (companyId: string, accountId?: string) => {
    const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
    return api.get<SocialPostListItem[]>(`/companies/${companyId}/social/queue${qs}`);
  },

  // ── Expansion-pass ──────────────────────────────────────────────────────

  inbox: (companyId: string, accountId?: string) => {
    const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
    return api.get<InboxAccountEntry[]>(
      `/companies/${companyId}/social/inbox${qs}`,
    );
  },

  // ── DM Inbox (real, polled into social_dms) ─────────────────────────────
  listDms: (
    companyId: string,
    opts?: { accountId?: string; unreadOnly?: boolean; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.accountId) params.set("accountId", opts.accountId);
    if (opts?.unreadOnly) params.set("unreadOnly", "true");
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<SocialDmRow[]>(
      `/companies/${companyId}/social/dms${qs ? `?${qs}` : ""}`,
    );
  },

  markDmRead: (companyId: string, dmId: string) =>
    api.post<{ id: string; readAt: string }>(
      `/companies/${companyId}/social/dms/${dmId}/mark-read`,
      {},
    ),

  dmUnreadCount: (companyId: string) =>
    api.get<{ unread: number }>(`/companies/${companyId}/social/dms/unread-count`),

  inboxThread: (companyId: string, accountId: string, threadId: string) =>
    api.get<KeyedResponse<DirectMessage[]>>(
      `/companies/${companyId}/social/inbox/${accountId}/${threadId}`,
    ),

  inboxSend: (companyId: string, accountId: string, threadId: string, text: string) =>
    api.post<DirectMessage>(
      `/companies/${companyId}/social/inbox/${accountId}/${threadId}/send`,
      { text },
    ),

  competitorSearch: (companyId: string, platform: SocialPlatform, q: string) =>
    api.get<KeyedResponse<CompetitorProfile[]>>(
      `/companies/${companyId}/social/competitors/search?platform=${platform}&q=${encodeURIComponent(q)}`,
    ),

  competitorMetrics: (
    companyId: string,
    platform: SocialPlatform,
    handle: string,
    from: Date,
    to: Date,
  ) =>
    api.get<KeyedResponse<CompetitorMetricsTimeseries>>(
      `/companies/${companyId}/social/competitors/${platform}/${encodeURIComponent(handle)}?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),

  analytics: (companyId: string, opts?: { accountId?: string; from?: Date; to?: Date }) => {
    const params = new URLSearchParams();
    if (opts?.accountId) params.set("accountId", opts.accountId);
    if (opts?.from) params.set("from", opts.from.toISOString());
    if (opts?.to) params.set("to", opts.to.toISOString());
    const qs = params.toString();
    return api.get<KeyedResponse<AccountAnalytics>>(
      `/companies/${companyId}/social/analytics${qs ? `?${qs}` : ""}`,
    );
  },

  suggestHashtags: (companyId: string, platform: SocialPlatform, text: string, niche?: string) =>
    api.post<KeyedResponse<HashtagSuggestion[]>>(`/companies/${companyId}/social/hashtags/suggest`, {
      platform,
      text,
      niche,
    }),

  // Auto-caption via DeepSeek. Provide ONE of: uploadId, mediaUrl, or
  // prompt. Returns caption + hashtags + intent + cache + cost metadata.
  suggestCaption: (
    companyId: string,
    input: {
      platform: SocialPlatform;
      voice?: string | null;
      prompt?: string | null;
      uploadId?: string | null;
      mediaUrl?: string | null;
    },
  ) =>
    api.post<CaptionSuggestion>(
      `/companies/${companyId}/social/captions/suggest`,
      input,
    ),

  // ── Connect Wizard ──────────────────────────────────────────────────────
  wizardSpecs: () => api.get<WizardSpecsResponse>("/social/wizard/specs"),

  listCredentials: () => api.get<SocialAppCredentialPublic[]>("/social/credentials"),

  getCredentials: (platform: SocialPlatform) =>
    api.get<SocialAppCredentialPublic | null>(`/social/credentials/${platform}`),

  saveCredentials: (
    platform: SocialPlatform,
    body: { clientId: string; clientSecret: string; redirectUri?: string },
  ) => api.put<SocialAppCredentialPublic>(`/social/credentials/${platform}`, body),

  deleteCredentials: (platform: SocialPlatform) =>
    api.delete<{ deleted: boolean }>(`/social/credentials/${platform}`),

  testCredentials: (
    platform: SocialPlatform,
    body: { clientId: string; clientSecret: string },
  ) =>
    api.post<SocialAppCredentialTestResult>(`/social/credentials/${platform}/test`, body),

  wizardAuthorize: (companyId: string, platform: SocialPlatform) =>
    api.post<WizardAuthorizeResponse>(
      `/companies/${companyId}/social/wizard/${platform}/authorize`,
      {},
    ),
};

export interface SocialDmRow {
  id: string;
  socialAccountId: string;
  platform: SocialPlatform;
  threadId: string;
  messageId: string;
  direction: "inbound" | "outbound";
  senderPlatformUserId: string | null;
  senderHandle: string | null;
  senderDisplayName: string | null;
  senderAvatarUrl: string | null;
  senderVerified: boolean;
  senderIsFirstContact: boolean;
  text: string | null;
  mediaUrls: string[];
  sentAt: string;
  readAt: string | null;
  createdAt: string;
}

export interface DirectMessageThread {
  threadId: string;
  participantHandle: string;
  participantAvatarUrl: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  canReply: boolean;
}
export interface DirectMessage {
  id: string;
  threadId: string;
  direction: "inbound" | "outbound";
  sentAt: string;
  text: string;
  attachments: string[];
}
export interface CompetitorProfile {
  platform: SocialPlatform;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followerCount: number;
  postCount: number;
  postingCadencePerWeek: number;
  averageEngagement: number;
}
export interface CompetitorMetricsTimeseries {
  byDay: Array<{ date: string; followerCount: number; posts: number; totalEngagement: number }>;
  topPosts: Array<{
    platformPostId: string;
    caption: string;
    publishedAt: string;
    likes: number;
    comments: number;
    mediaUrl: string | null;
  }>;
}
export interface AccountAnalytics {
  followers: Array<{ date: string; value: number }>;
  engagement: Array<{ date: string; likes: number; comments: number; shares: number; reach: number }>;
  bestTimes: number[][];
  topPosts: Array<{
    platformPostId: string;
    caption: string;
    publishedAt: string;
    likes: number;
    comments: number;
    mediaUrl: string | null;
    engagement: number;
  }>;
  topHashtags: Array<{ tag: string; uses: number; averageEngagement: number }>;
}
export interface HashtagSuggestion {
  tag: string;
  tier: "popular" | "medium" | "niche";
  totalUses: number;
  predictedReachLift?: number;
}

export interface CaptionSuggestion {
  caption: string;
  hashtags: string[];
  intent: string;
  cached: boolean;
  cacheKey: string;
  latencyMs: number;
  provider: "deepseek";
  estimatedCostUsd: number;
  usedVision: boolean;
}
