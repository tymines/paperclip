import type {
  SocialAccountPublic,
  SocialPlatform,
  SocialPostDetail,
  SocialPostListItem,
} from "@paperclipai/shared";
import { api } from "./client";

export interface SocialPlatformSupport {
  all: SocialPlatform[];
  supported: SocialPlatform[];
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

export const socialApi = {
  // ── Discovery ───────────────────────────────────────────────────────────
  platforms: () => api.get<SocialPlatformSupport>("/social/platforms"),

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
};
