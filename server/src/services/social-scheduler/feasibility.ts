/**
 * Per-platform feasibility matrix — single source of truth for what
 * Paperclip can and can't do on each social platform today. Sourced from
 * `social-platform-apis.md` (Hermes research, 2026-05-24).
 *
 * Status legend:
 *   "ok"        — works free, no review
 *   "review"    — works free but needs Meta App Review (1–5d/round)
 *   "paid"      — works on paid tier (PPU on X)
 *   "self"      — Paperclip self-manages (e.g. scheduled posts for
 *                 platforms without native scheduling)
 *   "blocked"   — gated by an external contract or admin process
 *   "missing"   — API doesn't exist for this feature
 *   "banned"    — explicit ToS ban; we MUST NOT ship this
 *
 * The UI surfaces this matrix on the Accounts tab so Tyler sees what
 * lights up for free, what needs his OAuth setup, and what's permanently
 * out of reach.
 */
import type { SocialPlatform } from "@paperclipai/shared";

export type FeatureStatus = "ok" | "review" | "paid" | "self" | "blocked" | "missing" | "banned";

export interface FeatureRow {
  feature: string;
  /** Subset of platforms scoped for v1; falls back to "missing" elsewhere. */
  byPlatform: Partial<Record<SocialPlatform, { status: FeatureStatus; note?: string }>>;
}

/**
 * Tyler's Homework — the app-registration + OAuth setup steps Paperclip
 * cannot do for him. UI shows this in a banner inside the Accounts tab.
 */
export interface HomeworkItem {
  title: string;
  description: string;
  href: string;
  /** "blocker" = required before this platform works at all. */
  importance: "blocker" | "recommended";
}

export const SOCIAL_FEATURE_MATRIX: FeatureRow[] = [
  {
    feature: "Publish post",
    byPlatform: {
      instagram: { status: "review", note: "free, App Review per scope (~1–5d/round)" },
      x: { status: "paid", note: "$0.015/post, $0.20 with URL" },
      facebook: { status: "review", note: "free, App Review" },
      threads: { status: "review", note: "free, App Review" },
      reddit: { status: "ok", note: "free non-commercial; commercial = direct contract" },
    },
  },
  {
    feature: "Scheduled posting (native)",
    byPlatform: {
      instagram: { status: "self", note: "no API — Paperclip queue + fire at time" },
      x: { status: "self" },
      facebook: { status: "ok", note: "scheduled_publish_time supported" },
      threads: { status: "self" },
      reddit: { status: "self" },
    },
  },
  {
    feature: "Read DMs",
    byPlatform: {
      instagram: { status: "review", note: "webhooks + App Review" },
      x: { status: "paid", note: "poll-only on PPU, $0.010/event" },
      facebook: { status: "review", note: "webhooks + App Review" },
      threads: { status: "missing", note: "no Threads DM API" },
      reddit: { status: "self", note: "poll inbox + modmail" },
    },
  },
  {
    feature: "Send DMs",
    byPlatform: {
      instagram: { status: "review", note: "24h window + App Review" },
      x: { status: "paid", note: "150/day/user cap, $0.015/send" },
      facebook: { status: "review", note: "24h window + App Review" },
      threads: { status: "missing", note: "no Threads DM API" },
      reddit: { status: "self", note: "/api/compose, no webhooks" },
    },
  },
  {
    feature: "Real-time DM webhook (push)",
    byPlatform: {
      instagram: { status: "review" },
      x: { status: "blocked", note: "Enterprise tier only" },
      facebook: { status: "review" },
      threads: { status: "missing" },
      reddit: { status: "missing", note: "poll-only" },
    },
  },
  {
    feature: "Hashtag suggestions",
    byPlatform: {
      instagram: { status: "self", note: "30 tags/7d cap; build internal corpus" },
      x: { status: "paid", note: "Trends $0.010/each" },
      facebook: { status: "missing" },
      threads: { status: "self", note: "topic_tag only, no trending API" },
      reddit: { status: "self", note: "subreddit /hot, /top" },
    },
  },
  {
    feature: "Competitor profile fetch",
    byPlatform: {
      instagram: { status: "ok", note: "Business Discovery (public biz/creator)" },
      x: { status: "paid", note: "$0.010/user fetch" },
      facebook: { status: "blocked", note: "page admin token needed for depth" },
      threads: { status: "missing", note: "only authorized users" },
      reddit: { status: "ok", note: "/user/X/about + /submitted" },
    },
  },
  {
    feature: "Own analytics (per-post)",
    byPlatform: {
      instagram: { status: "review", note: "Insights + App Review" },
      x: { status: "paid", note: "Owned reads $0.001/post — basically free" },
      facebook: { status: "review", note: "Insights + App Review" },
      threads: { status: "review", note: "Insights + App Review" },
      reddit: { status: "self", note: "read own post score" },
    },
  },
];

export const TYLER_HOMEWORK: HomeworkItem[] = [
  {
    title: "Meta Developer Account + Business app",
    description:
      "Register a Business-type app at developers.facebook.com. Add Facebook Login for Business, Instagram Platform, Threads API, Webhooks, and Messenger products. Verify the business in Meta Business Suite (EIN/equivalent ready). Each permission needs its own App Review submission with a screencast — plan ~2 weeks per round, expect 1–2 rejections.",
    href: "https://developers.facebook.com",
    importance: "blocker",
  },
  {
    title: "Privacy / Terms / Data-deletion URLs",
    description:
      "Meta App Review requires public HTTPS URLs for Privacy Policy, Terms, and Data Deletion endpoint. They will test the data-deletion path.",
    href: "https://developers.facebook.com/docs/development/release/data-handling",
    importance: "blocker",
  },
  {
    title: "X Developer Portal + PPU credits",
    description:
      "Create an app at developer.x.com, generate OAuth 2.0 client + Bearer Token. Purchase credits (~$50 to start). Set a monthly spending cap in the console — recommend $200 hard cap. Set App permissions to \"Read and write and Direct messages\" so dm.read/dm.write are grantable. Scopes: tweet.read, tweet.write, users.read, offline.access, dm.read, dm.write.",
    href: "https://developer.x.com",
    importance: "blocker",
  },
  {
    title: "Reddit app + commercial decision",
    description:
      "Create a 'web app' at reddit.com/prefs/apps. CRITICAL: Paperclip-as-SaaS = commercial use → must contact dev-platform@reddit.com for a contract. Lead time is weeks-to-months; start the conversation early. Non-commercial / personal use is free under the Responsible Builder Policy.",
    href: "https://www.reddit.com/prefs/apps",
    importance: "blocker",
  },
  {
    title: "Webhook callback URLs",
    description:
      "Public HTTPS URL per environment (prod / staging / local) that responds to Meta's GET verify-token challenge in <20 seconds. Required for Instagram + Messenger real-time DM webhooks.",
    href: "https://developers.facebook.com/docs/messenger-platform/webhooks",
    importance: "recommended",
  },
];

/**
 * Look up a feature row's status for one platform. Returns null when the
 * feature or platform isn't in the matrix.
 */
export function getFeatureStatus(
  feature: string,
  platform: SocialPlatform,
): { status: FeatureStatus; note?: string } | null {
  const row = SOCIAL_FEATURE_MATRIX.find((r) => r.feature === feature);
  return row?.byPlatform[platform] ?? null;
}

/**
 * Human-readable "why isn't this live" sentence for an `available: false`
 * expansion-endpoint response, derived from the matrix so route handlers
 * never invent their own copy.
 */
export function describeFeatureGate(feature: string, platform: SocialPlatform): string {
  const entry = getFeatureStatus(feature, platform);
  if (!entry) return `${feature} is not available on ${platform}.`;
  const note = entry.note ? ` (${entry.note})` : "";
  switch (entry.status) {
    case "ok":
    case "self":
      return `${feature} on ${platform} is possible${note} but not wired into Paperclip yet.`;
    case "review":
      return `${feature} on ${platform} requires Meta App Review before the API grants the scope${note}.`;
    case "paid":
      return `${feature} on ${platform} requires a paid API tier${note}.`;
    case "blocked":
      return `${feature} on ${platform} is blocked by an external contract or admin process${note}.`;
    case "missing":
      return `${platform} has no API for ${feature.toLowerCase()}${note}.`;
    case "banned":
      return `${feature} is banned by ${platform}'s terms of service — Paperclip will not ship it.`;
  }
}

/**
 * The homework item that unlocks a platform (Meta app for the Meta family,
 * X Developer Portal for X, Reddit app for Reddit). Used to attach a
 * `homework` link to `available: false` responses.
 */
export function getHomeworkForPlatform(
  platform: SocialPlatform,
): { title: string; href: string } | null {
  const titleNeedle =
    platform === "instagram" || platform === "facebook" || platform === "threads"
      ? "Meta Developer"
      : platform === "x"
        ? "X Developer"
        : platform === "reddit"
          ? "Reddit app"
          : null;
  if (!titleNeedle) return null;
  const item = TYLER_HOMEWORK.find((h) => h.title.includes(titleNeedle));
  return item ? { title: item.title, href: item.href } : null;
}

/**
 * Hard never-ship list. Display these on the Accounts tab so Tyler
 * and any future operator sees the line. The adapters MUST refuse to
 * implement these even if explicitly asked — they're instant-ban risks
 * across every named platform.
 */
export const BANNED_FEATURES: { title: string; detail: string }[] = [
  {
    title: "Follow / unfollow automation",
    detail:
      "Banned across Instagram, X, and platform ToS in general. Meta detects mass-follow patterns and the follow→unfollow cleanup pattern. Penalty ladder: soft block → action block → temp ban → shadowban → permanent suspension.",
  },
  {
    title: "Auto-DM on follow",
    detail:
      "Banned unless the user explicitly triggers via comment keyword, story reply, or DM keyword. Pure 'send DM when X follows me' is on the ban list.",
  },
  {
    title: "Engagement pods / coordinated like-RT",
    detail:
      "Banned on Meta, X, and Reddit. Reddit's March 2026 enforcement wave specifically targeted these.",
  },
  {
    title: "Vote manipulation (Reddit)",
    detail:
      "Permanent ban risk. Never automate upvotes/downvotes — DO NOT even ship a vote button that hits the API.",
  },
  {
    title: "Browser automation / scraping",
    detail:
      "Any feature that scripts a platform's website instead of using the official API is banned everywhere.",
  },
];
