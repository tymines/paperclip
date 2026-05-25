/**
 * Industry-baseline "best time to post" data per platform.
 *
 * These are the constants the best-time engine falls back to when a
 * company doesn't yet have ≥30 days of its own audience-engagement
 * analytics. They're a starting point, not a destination — the engine
 * will switch over to user-specific data as soon as it's available.
 *
 * Source: aggregated from the 2026 best-time-to-post round-ups published
 * annually by Sprout Social and Hootsuite. The numbers are intentionally
 * conservative; we pick the windows that show up across both reports and
 * lean toward weekday mid-mornings (where engagement is highest for
 * most B2C / lifestyle / creator accounts — Paperclip's primary
 * audience for the social scheduler).
 *
 * Update cadence: re-review every January when the two annual reports
 * drop. Bump SOURCE_YEAR so the /best-times API can surface it.
 *
 *   https://sproutsocial.com/insights/best-times-to-post-on-social-media/
 *   https://blog.hootsuite.com/best-time-to-post-on-social-media/
 */

import type { BulkUploadPlatform } from "./types.js";

export const SOURCE_YEAR = 2026;
export const SOURCE_LABEL = "industry-2026";

export interface IndustrySlot {
  /** 0 = Sunday … 6 = Saturday */
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Hour of day, 0-23, in the company's local timezone. */
  hour: number;
  /** 0-1 relative engagement score (rough — used only for tie-breaking) */
  score: number;
}

// Tuesday=2, Wednesday=3, Thursday=4. Most platforms peak there.
const INDUSTRY_BASELINES: Record<BulkUploadPlatform, IndustrySlot[]> = {
  // Instagram — mornings on Tue/Wed/Thu still rule for feed posts; Friday
  // is fine; Sunday is the dead zone. Late evening hits on Sun/Mon
  // because of binge-scroll behavior, but lower-tier.
  instagram: [
    { weekday: 2, hour: 11, score: 1.0 },
    { weekday: 3, hour: 10, score: 0.95 },
    { weekday: 4, hour: 11, score: 0.92 },
    { weekday: 2, hour: 14, score: 0.88 },
    { weekday: 1, hour: 11, score: 0.84 },
    { weekday: 5, hour: 10, score: 0.80 },
    { weekday: 3, hour: 14, score: 0.78 },
    { weekday: 4, hour: 14, score: 0.75 },
    { weekday: 1, hour: 19, score: 0.70 },
    { weekday: 0, hour: 19, score: 0.62 },
  ],
  // X (Twitter) — earlier than the rest. Tweets break in the 8-10 AM
  // band, especially Tues/Wed. Quick decay; second peak around lunch.
  twitter: [
    { weekday: 2, hour: 9, score: 1.0 },
    { weekday: 3, hour: 9, score: 0.97 },
    { weekday: 2, hour: 12, score: 0.90 },
    { weekday: 4, hour: 9, score: 0.88 },
    { weekday: 3, hour: 12, score: 0.85 },
    { weekday: 1, hour: 9, score: 0.82 },
    { weekday: 4, hour: 12, score: 0.78 },
    { weekday: 1, hour: 13, score: 0.72 },
    { weekday: 5, hour: 9, score: 0.68 },
    { weekday: 0, hour: 20, score: 0.55 },
  ],
  // Facebook — the most "office hours" platform. Late morning Tue/Wed/Thu.
  facebook: [
    { weekday: 2, hour: 10, score: 1.0 },
    { weekday: 3, hour: 11, score: 0.96 },
    { weekday: 4, hour: 10, score: 0.92 },
    { weekday: 1, hour: 11, score: 0.86 },
    { weekday: 5, hour: 10, score: 0.78 },
    { weekday: 3, hour: 14, score: 0.74 },
    { weekday: 2, hour: 13, score: 0.72 },
    { weekday: 4, hour: 14, score: 0.68 },
    { weekday: 0, hour: 13, score: 0.55 },
    { weekday: 6, hour: 12, score: 0.50 },
  ],
  // Threads — follows Instagram's curve since they share the same audience.
  threads: [
    { weekday: 2, hour: 11, score: 1.0 },
    { weekday: 3, hour: 10, score: 0.94 },
    { weekday: 4, hour: 11, score: 0.91 },
    { weekday: 2, hour: 19, score: 0.85 },
    { weekday: 1, hour: 11, score: 0.82 },
    { weekday: 5, hour: 10, score: 0.78 },
    { weekday: 3, hour: 19, score: 0.74 },
    { weekday: 4, hour: 19, score: 0.71 },
    { weekday: 0, hour: 19, score: 0.62 },
    { weekday: 6, hour: 11, score: 0.55 },
  ],
  // Reddit — bookends. Early morning (6-9 AM ET) for commute scrollers,
  // late evening (8-10 PM ET) for end-of-day browsing. Subreddit-specific
  // patterns dwarf this, but it's a reasonable default.
  reddit: [
    { weekday: 0, hour: 8, score: 1.0 },
    { weekday: 1, hour: 8, score: 0.94 },
    { weekday: 2, hour: 8, score: 0.90 },
    { weekday: 0, hour: 20, score: 0.88 },
    { weekday: 6, hour: 9, score: 0.82 },
    { weekday: 1, hour: 20, score: 0.80 },
    { weekday: 2, hour: 20, score: 0.76 },
    { weekday: 3, hour: 8, score: 0.72 },
    { weekday: 4, hour: 20, score: 0.65 },
    { weekday: 5, hour: 12, score: 0.55 },
  ],
};

export function getIndustryBaseline(platform: BulkUploadPlatform): IndustrySlot[] {
  return INDUSTRY_BASELINES[platform];
}

/** Last-ditch fallback when even the industry baseline is unknown. */
export const FALLBACK_SLOT: IndustrySlot = {
  weekday: 2, // Tuesday — generically the safest non-weekend day
  hour: 12,
  score: 0.3,
};

export const FALLBACK_LABEL = "fallback";
export const USER_AUDIENCE_LABEL_30D = "your-audience-30d";
