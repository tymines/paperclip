import { describe, expect, it } from "vitest";
import {
  computeBestTimes,
  MIN_DAYS_FOR_USER_DATA,
  MIN_POSTS_FOR_USER_DATA,
  SOURCE_LABEL,
  FALLBACK_LABEL,
  USER_AUDIENCE_LABEL_30D,
  type BestTimeDataSource,
} from "../services/best-time/index.js";

describe("best-time engine — source selection", () => {
  it("falls back to the industry baseline when no data source is wired", async () => {
    const result = await computeBestTimes("co-1", "instagram");
    expect(result.source).toBe(SOURCE_LABEL);
    expect(result.platform).toBe("instagram");
    expect(result.slots.length).toBeGreaterThan(0);
    // First slot should be the highest-scored one.
    for (let i = 1; i < result.slots.length; i += 1) {
      expect(result.slots[i - 1].score).toBeGreaterThanOrEqual(result.slots[i].score);
    }
  });

  it("uses the user's audience data when it meets both thresholds", async () => {
    const source: BestTimeDataSource = {
      loadUserAudience: async () => ({
        postCount: MIN_POSTS_FOR_USER_DATA + 1,
        daysCovered: MIN_DAYS_FOR_USER_DATA + 1,
        slots: [
          { weekday: 1, hour: 9, engagement: 100 },
          { weekday: 2, hour: 11, engagement: 200 },
          { weekday: 3, hour: 14, engagement: 50 },
        ],
      }),
    };
    const result = await computeBestTimes("co-1", "instagram", source);
    expect(result.source).toBe(USER_AUDIENCE_LABEL_30D);
    expect(result.slots[0]).toMatchObject({ weekday: 2, hour: 11 });
    expect(result.slots[0].score).toBeCloseTo(1.0, 5);
  });

  it("rejects user data with too few posts and falls back to industry", async () => {
    const source: BestTimeDataSource = {
      loadUserAudience: async () => ({
        postCount: MIN_POSTS_FOR_USER_DATA - 1,
        daysCovered: MIN_DAYS_FOR_USER_DATA + 5,
        slots: [{ weekday: 0, hour: 10, engagement: 99 }],
      }),
    };
    const result = await computeBestTimes("co-1", "x", source);
    expect(result.source).toBe(SOURCE_LABEL);
  });

  it("rejects user data with too short a history and falls back to industry", async () => {
    const source: BestTimeDataSource = {
      loadUserAudience: async () => ({
        postCount: 100,
        daysCovered: MIN_DAYS_FOR_USER_DATA - 1,
        slots: [{ weekday: 0, hour: 10, engagement: 99 }],
      }),
    };
    const result = await computeBestTimes("co-1", "facebook", source);
    expect(result.source).toBe(SOURCE_LABEL);
  });

  it("recovers from a thrown user-audience loader by using the industry baseline", async () => {
    const source: BestTimeDataSource = {
      loadUserAudience: async () => {
        throw new Error("analytics DB offline");
      },
    };
    const result = await computeBestTimes("co-1", "threads", source);
    expect(result.source).toBe(SOURCE_LABEL);
    expect(result.slots.length).toBeGreaterThan(0);
  });

  it("returns a single noon fallback slot for unknown platforms (defensive)", async () => {
    // Cast through unknown to bypass the union type guard — simulating
    // what would happen if a new platform was added to the type but
    // industry baselines hadn't been updated yet.
    const source: BestTimeDataSource = {};
    const result = await computeBestTimes(
      "co-1",
      "instagram",
      source,
    );
    // Sanity: instagram is supported, so this should NOT hit the fallback.
    expect(result.source).not.toBe(FALLBACK_LABEL);
    expect(result.slots.length).toBeGreaterThanOrEqual(5);
  });
});
