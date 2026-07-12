/**
 * Legacy mock fixtures + the shared `caption()` helper.
 *
 * PRODUCTION CODE MUST NOT SERVE THE mock* EXPORTS. The adapters and routes
 * are data-honest: no real credential → `BlockedNoCredentialError` /
 * `available: false`, never fabricated data. The mock builders stay only as
 * fixtures for tests and explicit `?demo=true` previews; `caption()` is the
 * one production helper in this file.
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

/* ── Expansion-pass stub data ────────────────────────────────────────── */

import type {
  AccountAnalytics,
  CompetitorMetricsTimeseries,
  CompetitorProfile,
  DirectMessage,
  DirectMessageThread,
  HashtagSuggestion,
} from "./types.js";
import type { SocialPlatform } from "@paperclipai/shared";

const SAMPLE_HANDLES = [
  "earlysignals",
  "ops_weekly",
  "founderlog",
  "the.daily.build",
  "agentnotes",
  "studio.kettle",
  "buildwithlight",
  "northstar.exec",
];

const SAMPLE_DM_OPENERS = [
  "Hey! Loved your latest post — any chance we could collab?",
  "Quick question about the workflow you posted about yesterday.",
  "We're a small studio trying to figure out an agent stack — got 10m?",
  "Following your build series. The latest update on the orchestrator was 🔥.",
  "Pricing question — DM me when you're free 🙏",
  "Sending this to my CEO, thanks for putting it out there.",
];

export function mockDmThreads(platform: SocialPlatform, limit: number): DirectMessageThread[] {
  const out: DirectMessageThread[] = [];
  const now = Date.now();
  const seed = platform.length;
  for (let i = 0; i < limit; i++) {
    const handle = pick(SAMPLE_HANDLES, seed + i);
    const ageHours = i * 4 + ((seed * 7 + i) % 11);
    out.push({
      threadId: `${platform}-thread-${i}`,
      participantHandle: handle,
      participantAvatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${handle}`,
      lastMessageAt: new Date(now - ageHours * 3600_000),
      lastMessagePreview: pick(SAMPLE_DM_OPENERS, seed + i),
      unreadCount: i === 0 ? 2 : i === 1 ? 1 : 0,
      // IG/FB only allow outbound reply inside a 24h window after the last
      // user-initiated message — flip the toggle on older threads.
      canReply: platform === "instagram" || platform === "facebook" ? ageHours < 24 : true,
    });
  }
  return out;
}

export function mockDmStream(
  platform: SocialPlatform,
  threadId: string,
  participantHandle: string,
): DirectMessage[] {
  const seed = threadId.length + platform.length;
  const now = Date.now();
  const messages: DirectMessage[] = [];
  const lines = [
    pick(SAMPLE_DM_OPENERS, seed),
    "Thanks for reaching out! What's the use case you're thinking about?",
    "We run about 12 agents across CEO/CMO/Eng — orchestrating intake to launch.",
    "Got it — happy to set up a quick call. Tuesday or Wednesday afternoon?",
    "Tuesday 2pm works. I'll send the calendar link 🙏",
  ];
  for (let i = 0; i < lines.length; i++) {
    messages.push({
      id: `${threadId}-msg-${i}`,
      threadId,
      direction: i % 2 === 0 ? "inbound" : "outbound",
      sentAt: new Date(now - (lines.length - i) * 1800_000),
      text: lines[i] ?? "",
    });
  }
  return messages;
}

export function mockCompetitorSearch(platform: SocialPlatform, query: string): CompetitorProfile[] {
  const cleaned = query.trim().replace(/^@/, "");
  const base = cleaned.length > 0 ? [cleaned, `${cleaned}_co`, `${cleaned}.studio`] : SAMPLE_HANDLES;
  return base.slice(0, 5).map((handle, i) => {
    const seed = (handle.length + i + platform.length) * 13;
    return {
      platform,
      handle,
      displayName: handle.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      avatarUrl: `https://api.dicebear.com/7.x/identicon/svg?seed=${handle}`,
      bio: `${platform} — builder, operator, occasional contrarian.`,
      followerCount: 1200 + (seed % 240_000),
      postCount: 80 + (seed % 1800),
      postingCadencePerWeek: Number((((seed % 70) + 7) / 7).toFixed(1)),
      averageEngagement: 40 + (seed % 600),
    };
  });
}

export function mockCompetitorMetrics(
  handle: string,
  from: Date,
  to: Date,
): CompetitorMetricsTimeseries {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  const seed = handle.length * 31;
  const byDay = [];
  let followers = 2500 + (seed % 50_000);
  for (let i = 0; i < days; i++) {
    const date = new Date(from.getTime() + i * 86_400_000);
    followers += ((seed + i) % 12) - 3;
    byDay.push({
      date: date.toISOString().slice(0, 10),
      followerCount: followers,
      posts: i % 3 === 0 ? 1 : 0,
      totalEngagement: 30 + ((seed + i * 7) % 280),
    });
  }
  const topPosts = Array.from({ length: 5 }).map((_, i) => ({
    platformPostId: `${handle}-top-${i}`,
    caption: pick(PHRASES, seed + i),
    publishedAt: new Date(Date.now() - i * 86_400_000 * 3),
    likes: 220 + ((seed + i * 17) % 1800),
    comments: 8 + ((seed + i * 5) % 60),
    mediaUrl: `${pick(STOCK_IMAGES, seed + i)}?auto=format&fit=crop&w=320&h=320`,
  }));
  return { byDay, topPosts };
}

export function mockAccountAnalytics(from: Date, to: Date, seed: number): AccountAnalytics {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  let followers = 5000 + (seed % 8000);
  const followersSeries = [];
  const engagement = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    followers += ((seed + i * 3) % 20) - 4;
    followersSeries.push({ date, value: followers });
    engagement.push({
      date,
      likes: 80 + ((seed + i * 11) % 240),
      comments: 8 + ((seed + i * 7) % 40),
      shares: ((seed + i * 5) % 18),
      reach: 1200 + ((seed + i * 13) % 4800),
    });
  }
  // Best-times heatmap: 7 days × 24 hours; peak around Tue/Wed evening.
  const bestTimes: number[][] = [];
  for (let d = 0; d < 7; d++) {
    const row: number[] = [];
    for (let h = 0; h < 24; h++) {
      const peak = h >= 17 && h <= 21 && d >= 1 && d <= 3 ? 30 : 0;
      row.push(peak + ((seed + d * 17 + h * 3) % 30));
    }
    bestTimes.push(row);
  }
  const topPosts = Array.from({ length: 5 }).map((_, i) => ({
    platformPostId: `top-${i}-${seed}`,
    caption: pick(PHRASES, seed + i),
    publishedAt: new Date(Date.now() - i * 86_400_000 * 4),
    likes: 320 + ((seed + i * 13) % 1400),
    comments: 18 + ((seed + i * 7) % 80),
    mediaUrl: `${pick(STOCK_IMAGES, seed + i)}?auto=format&fit=crop&w=320&h=320`,
    engagement: 400 + ((seed + i * 11) % 1600),
  }));
  const topHashtags = ["build", "operator", "founderlog", "ai", "agents", "automation"].map((tag, i) => ({
    tag,
    uses: 4 + ((seed + i * 5) % 18),
    averageEngagement: 80 + ((seed + i * 31) % 280),
  }));
  return { followers: followersSeries, engagement, bestTimes, topPosts, topHashtags };
}

export function mockHashtagSuggestions(text: string, niche?: string): HashtagSuggestion[] {
  const seed = (text + (niche ?? "")).length * 11;
  const popular = ["build", "founder", "startup", "ai", "automation"];
  const medium = ["operator", "agentstack", "buildinpublic", "founderlife", "saaspath"];
  const nicheTags = ["agentops", "autonomousteam", "smallteambigoutput", "fewerpeoplemoreoutput"];
  return [
    ...popular.map((t, i) => ({
      tag: t,
      tier: "popular" as const,
      totalUses: 800_000 + (seed + i) * 3127,
      predictedReachLift: 8 + (seed + i) % 18,
    })),
    ...medium.map((t, i) => ({
      tag: t,
      tier: "medium" as const,
      totalUses: 40_000 + (seed + i) * 313,
      predictedReachLift: 22 + (seed + i) % 26,
    })),
    ...nicheTags.map((t, i) => ({
      tag: t,
      tier: "niche" as const,
      totalUses: 800 + (seed + i) * 31,
      predictedReachLift: 60 + (seed + i) % 30,
    })),
  ];
}
