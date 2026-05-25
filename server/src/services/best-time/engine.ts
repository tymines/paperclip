/**
 * Best-time-to-post engine.
 *
 * Priority order (per Tyler's spec):
 *   1. User's own audience data — when the company has ≥30 days of
 *      post-performance analytics for the platform, compute slots from
 *      when their audience actually engages.
 *   2. Industry baseline — 2026 Sprout/Hootsuite annual reports
 *      (see ./industry-baselines.ts for the constants and citation).
 *   3. Fallback — daily noon, used only if both above are unavailable.
 *
 * The engine is intentionally pure: it takes a `BestTimeDataSource`
 * (with one optional `loadUserAudience` callback) and returns a
 * `BestTimeResult`. The route layer wires the data source to the DB.
 * This keeps the engine trivially testable.
 */

import {
  FALLBACK_LABEL,
  FALLBACK_SLOT,
  SOURCE_LABEL,
  USER_AUDIENCE_LABEL_30D,
  getIndustryBaseline,
  type IndustrySlot,
} from "./industry-baselines.js";
import type {
  BestTimeResult,
  BestTimeSlot,
  BulkUploadPlatform,
} from "./types.js";

export interface UserAudienceSlot {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hour: number;
  /** Engagement count for this slot in the lookback window. */
  engagement: number;
}

export interface UserAudienceResponse {
  /** Number of distinct posts the slots were derived from. */
  postCount: number;
  /** Number of days of history actually present. */
  daysCovered: number;
  /** Raw aggregated engagement-by-slot (any order). */
  slots: UserAudienceSlot[];
}

export interface BestTimeDataSource {
  /**
   * Return aggregated audience-engagement data for this platform over
   * the last ~30 days, or `null` if the company doesn't have enough
   * history yet (or the analytics table isn't populated).
   */
  loadUserAudience?: (
    companyId: string,
    platform: BulkUploadPlatform,
  ) => Promise<UserAudienceResponse | null>;
}

/** Minimum days of history required to trust user data over the baseline. */
export const MIN_DAYS_FOR_USER_DATA = 30;
/** Minimum distinct posts required to avoid one-shot noise. */
export const MIN_POSTS_FOR_USER_DATA = 10;
/** Cap on how many slots the API returns per platform. */
export const MAX_RANKED_SLOTS = 14;

function fromIndustrySlot(s: IndustrySlot): BestTimeSlot {
  return { weekday: s.weekday, hour: s.hour, score: s.score };
}

function normalizeUserSlots(audience: UserAudienceResponse): BestTimeSlot[] {
  if (audience.slots.length === 0) return [];
  const maxEngagement = audience.slots.reduce(
    (acc, s) => (s.engagement > acc ? s.engagement : acc),
    0,
  );
  if (maxEngagement <= 0) return [];
  return audience.slots
    .map((s) => ({
      weekday: s.weekday,
      hour: s.hour,
      score: s.engagement / maxEngagement,
    }))
    .sort((a, b) => b.score - a.score);
}

export async function computeBestTimes(
  companyId: string,
  platform: BulkUploadPlatform,
  source: BestTimeDataSource = {},
): Promise<BestTimeResult> {
  // Tier 1 — user's own audience data
  if (source.loadUserAudience) {
    try {
      const audience = await source.loadUserAudience(companyId, platform);
      if (
        audience &&
        audience.postCount >= MIN_POSTS_FOR_USER_DATA &&
        audience.daysCovered >= MIN_DAYS_FOR_USER_DATA
      ) {
        const slots = normalizeUserSlots(audience).slice(0, MAX_RANKED_SLOTS);
        if (slots.length > 0) {
          return {
            platform,
            source: USER_AUDIENCE_LABEL_30D,
            slots,
            detail: `Based on ${audience.postCount} posts over the last ${audience.daysCovered} days`,
          };
        }
      }
    } catch {
      // Fall through to industry baseline on any data-source failure —
      // the engine should always return *something*.
    }
  }

  // Tier 2 — industry baseline
  const industry = getIndustryBaseline(platform);
  if (industry.length > 0) {
    return {
      platform,
      source: SOURCE_LABEL,
      slots: industry.map(fromIndustrySlot).slice(0, MAX_RANKED_SLOTS),
      detail: "Industry-average best times (Sprout / Hootsuite 2026)",
    };
  }

  // Tier 3 — fallback
  return {
    platform,
    source: FALLBACK_LABEL,
    slots: [fromIndustrySlot(FALLBACK_SLOT)],
    detail: "Default noon slot — no data available",
  };
}
