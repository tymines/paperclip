/**
 * Shared utilities for the v1 stub platform adapters. Real adapters will
 * replace `publishPost` / `listRecentPosts` with API calls; the validation
 * helpers stay forever.
 */
import { randomUUID } from "node:crypto";
import type { SocialAccount } from "@paperclipai/shared";
import type {
  AccountMetrics,
  ConnectAuthStart,
  PostDraftPayload,
  PublishedPostRef,
} from "./types.js";

const PHRASES = [
  "Shipping today: a fresh take on the v2 dashboard.",
  "Quick agent update — the fleet is finally in the green.",
  "Behind the scenes of how we orchestrate 9 agents in parallel.",
  "The single best decision we made this quarter.",
  "Three things we'd tell our past self if we were starting over.",
  "Hot take on what every operator should automate first.",
  "Long thread on the new compose flow ↓",
  "Building in public, week 14.",
];

const STOCK_IMAGES = [
  "https://images.unsplash.com/photo-1518770660439-4636190af475",
  "https://images.unsplash.com/photo-1542435503-956c469947f6",
  "https://images.unsplash.com/photo-1521737604893-d14cc237f11d",
  "https://images.unsplash.com/photo-1497032628192-86f99bcd76bc",
  "https://images.unsplash.com/photo-1551434678-e076c223a692",
  "https://images.unsplash.com/photo-1496180470114-6ef490f3ff22",
  "https://images.unsplash.com/photo-1532009324734-20a7a5813719",
  "https://images.unsplash.com/photo-1531403009284-440f080d1e12",
  "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d",
];

/** Reproducible-ish pick — for stable mock listings without storing state. */
function pick<T>(arr: readonly T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length] as T;
}

export function mockConnectStart(platform: string): ConnectAuthStart {
  const state = randomUUID();
  return {
    authUrl: `https://example.com/oauth/${platform}/authorize?state=${state}&stub=1`,
    state,
  };
}

export function mockConnectAccount(opts: {
  platform: SocialAccount["platform"];
  companyId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}): SocialAccount {
  const now = new Date();
  return {
    id: randomUUID(),
    companyId: opts.companyId,
    platform: opts.platform,
    platformAccountId: `${opts.platform}-${randomUUID().slice(0, 8)}`,
    displayName: opts.displayName ?? opts.username,
    username: opts.username,
    avatarUrl: opts.avatarUrl ?? `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(opts.username)}`,
    accessToken: "stub_access_token",
    refreshToken: "stub_refresh_token",
    tokenExpiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 60),
    status: "connected",
    metadata: { stub: true },
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function mockRecentPosts(account: SocialAccount, limit: number): PublishedPostRef[] {
  const out: PublishedPostRef[] = [];
  const seed = account.id.charCodeAt(0) || 1;
  const now = Date.now();
  for (let i = 0; i < limit; i++) {
    const captionBase = pick(PHRASES, seed + i);
    out.push({
      platformPostId: `${account.platform}-${i}-${seed}`,
      platformUrl: `https://example.com/${account.platform}/${account.username ?? "user"}/post/${i}`,
      publishedAt: new Date(now - (i + 1) * 1000 * 60 * 60 * 18),
      caption: captionBase,
      mediaUrl: `${pick(STOCK_IMAGES, seed + i)}?auto=format&fit=crop&w=540&h=540`,
      thumbnailUrl: `${pick(STOCK_IMAGES, seed + i)}?auto=format&fit=crop&w=180&h=180`,
      metrics: {
        likes: 40 + ((seed + i) % 220),
        comments: ((seed + i) % 22),
        reach: 400 + ((seed + i) % 1800),
      },
    });
  }
  return out;
}

export function mockAccountMetrics(account: SocialAccount): AccountMetrics {
  const seed = account.id.charCodeAt(0) || 1;
  return {
    followerCount: 800 + ((seed * 37) % 18000),
    postCount: 60 + ((seed * 11) % 240),
    engagementRate: Number((((seed * 13) % 47) / 10).toFixed(2)),
  };
}

export function mockPublishedRef(
  account: SocialAccount,
  post: PostDraftPayload,
): PublishedPostRef {
  const platformPostId = `${account.platform}-${randomUUID().slice(0, 12)}`;
  return {
    platformPostId,
    platformUrl: `https://example.com/${account.platform}/post/${platformPostId}`,
    publishedAt: new Date(),
    caption: post.caption ?? post.baseCaption,
    mediaUrl: post.mediaUrls[0] ?? null,
  };
}

/** Character-count helper shared by every adapter's validatePost. */
export function caption(post: PostDraftPayload): string {
  return (post.caption ?? post.baseCaption ?? "").trim();
}
