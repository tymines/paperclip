import type { SocialPlatform, SocialAccountStatus, SocialPostStatus, SocialPostType } from "../constants.js";

export interface SocialAccount {
  id: string;
  companyId: string;
  platform: SocialPlatform;
  platformAccountId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  status: SocialAccountStatus;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Safe version without tokens, returned by list/get endpoints */
export interface SocialAccountPublic {
  id: string;
  companyId: string;
  platform: SocialPlatform;
  platformAccountId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  status: SocialAccountStatus;
  tokenExpiresAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialPost {
  id: string;
  companyId: string;
  title: string | null;
  content: string;
  postType: SocialPostType;
  status: SocialPostStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  mediaUrls: string[];
  tags: string[];
  metadata: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialPostTarget {
  id: string;
  postId: string;
  accountId: string;
  platform: SocialPlatform;
  platformPostId: string | null;
  platformUrl: string | null;
  status: SocialPostStatus;
  errorMessage: string | null;
  publishedAt: Date | null;
  analytics: SocialPostAnalytics | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SocialPostAnalytics {
  impressions?: number;
  engagements?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  reach?: number;
  [key: string]: unknown;
}

export interface SocialPostDetail extends SocialPost {
  targets: SocialPostTarget[];
}

export interface SocialPostListItem extends SocialPost {
  targetCount: number;
  platforms: SocialPlatform[];
}

/** Public (redacted) view of social_app_credentials. */
export interface SocialAppCredentialPublic {
  platform: SocialPlatform;
  clientId: string;
  /** Only the trailing 4 chars of the client secret — for confirmation. */
  clientSecretLast4: string | null;
  redirectUri: string | null;
  /** OAuth 1.0a consumer key (api_key) — not secret. */
  consumerKey?: string | null;
  /** Trailing 4 chars of OAuth 1.0a consumer secret. */
  consumerSecretLast4?: string | null;
  /** Trailing 4 chars of OAuth 1.0a app-only bearer token. */
  bearerTokenLast4?: string | null;
  /** Default OAuth 2.0 scopes requested at authorize time. */
  defaultScopes?: string[] | null;
  lastValidatedAt: Date | null;
  lastValidationStatus: "ok" | "error" | null;
  lastValidationMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Link to the Tyler's-Homework item that unlocks a gated feature. Served
 * alongside `available: false` responses so the UI can render "what unlocks
 * this" instead of mock data.
 */
export interface SocialFeatureHomeworkLink {
  title: string;
  href: string;
}

/**
 * Discriminated availability wrapper returned by the expansion endpoints
 * (analytics, competitors, hashtag suggestions, inbox). Data-honesty rule:
 * a route either has a real backing source (`available: true`) or says
 * exactly why it doesn't (`available: false` + reason + optional homework
 * link) — mock data is never served as real.
 */
export type SocialFeatureAvailability<T> =
  | { available: true; data: T }
  | { available: false; reason: string; homework?: SocialFeatureHomeworkLink };

/** Result of POST /social/credentials/:platform/test. */
export interface SocialAppCredentialTestResult {
  ok: boolean;
  message: string;
  /** Echo of platform handle/account the /me-equivalent returned, if any. */
  identity?: {
    handle?: string;
    displayName?: string;
    accountType?: string;
  } | null;
}
