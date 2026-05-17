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
