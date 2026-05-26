import { describe, expect, it } from "vitest";
import {
  autoSchedule,
  COLLISION_WINDOW_MS,
  type BestTimeSlot,
  type BulkUploadPlatform,
  type ScheduleUpload,
} from "../services/best-time/index.js";

function makeUpload(
  id: string,
  platforms: BulkUploadPlatform[],
  orderIndex: number,
): ScheduleUpload {
  return { id, platforms, orderIndex };
}

describe("auto-schedule algorithm — conflict resolution", () => {
  it("spreads uploads evenly across the configured days for each platform", () => {
    const uploads: ScheduleUpload[] = [
      makeUpload("a", ["instagram"], 0),
      makeUpload("b", ["instagram"], 1),
      makeUpload("c", ["instagram"], 2),
      makeUpload("d", ["instagram"], 3),
    ];
    const result = autoSchedule(uploads, {
      kind: "even",
      startDate: "2099-01-05", // far-future so nothing is "in the past"
      dayCount: 7,
      postsPerDayPerPlatform: 3,
    });
    expect(result.items).toHaveLength(4);
    expect(result.unscheduled).toHaveLength(0);
    // No two posts should land within the collision window.
    for (let i = 0; i < result.items.length; i += 1) {
      for (let j = i + 1; j < result.items.length; j += 1) {
        if (result.items[i].platform === result.items[j].platform) {
          const diff = Math.abs(
            result.items[i].scheduledAt.getTime() -
              result.items[j].scheduledAt.getTime(),
          );
          expect(diff).toBeGreaterThanOrEqual(COLLISION_WINDOW_MS);
        }
      }
    }
  });

  it("preserves user-defined order (lowest orderIndex → earliest slot) per platform", () => {
    // Pass uploads out of order to make sure the algo re-sorts them.
    const uploads: ScheduleUpload[] = [
      makeUpload("z", ["instagram"], 2),
      makeUpload("a", ["instagram"], 0),
      makeUpload("m", ["instagram"], 1),
    ];
    const result = autoSchedule(uploads, {
      kind: "even",
      startDate: "2099-01-05",
      dayCount: 7,
      postsPerDayPerPlatform: 3,
    });
    const ig = result.items.filter((i) => i.platform === "instagram");
    expect(ig.map((i) => i.uploadId)).toEqual(["a", "m", "z"]);
  });

  it("allows cross-platform posts at the same minute (IG + X at 10:00)", () => {
    const uploads: ScheduleUpload[] = [
      makeUpload("a", ["instagram", "x"], 0),
    ];
    const result = autoSchedule(uploads, {
      kind: "even",
      startDate: "2099-01-05",
      dayCount: 7,
      postsPerDayPerPlatform: 3,
    });
    expect(result.items).toHaveLength(2);
    const [ig, tw] = result.items;
    expect(ig.scheduledAt.getTime()).toBe(tw.scheduledAt.getTime());
  });

  it("best-times: picks the highest-scored conflict-free slot each upload", () => {
    const slots: BestTimeSlot[] = [
      { weekday: 2, hour: 11, score: 1.0 }, // Tues 11am
      { weekday: 3, hour: 10, score: 0.95 }, // Wed 10am
      { weekday: 4, hour: 11, score: 0.9 }, // Thu 11am
    ];
    const best = new Map<BulkUploadPlatform, BestTimeSlot[]>([["instagram", slots]]);
    const uploads: ScheduleUpload[] = [
      makeUpload("a", ["instagram"], 0),
      makeUpload("b", ["instagram"], 1),
      makeUpload("c", ["instagram"], 2),
    ];
    const result = autoSchedule(
      uploads,
      { kind: "best-times", startDate: "2099-01-05" }, // 2099-01-05 is a Mon
      best,
    );
    expect(result.items).toHaveLength(3);
    expect(result.unscheduled).toHaveLength(0);
    // First upload gets the highest-scoring Tue 11am slot.
    const a = result.items.find((i) => i.uploadId === "a")!;
    expect(a.scheduledAt.getUTCDay()).toBe(2);
    expect(a.scheduledAt.getUTCHours()).toBe(11);
  });

  it("best-times: pushes the second post to the next best slot when within 30-min collision window", () => {
    // Two slots that would collide: Tue 11:00 and Tue 11:20.
    const slots: BestTimeSlot[] = [
      { weekday: 2, hour: 11, score: 1.0 },
    ];
    const best = new Map<BulkUploadPlatform, BestTimeSlot[]>([["instagram", slots]]);
    // Two uploads both targeting Instagram → the second one must move
    // to next Tuesday 11am (the same weekly slot, one week later) since
    // there's only one slot per weekday.
    const uploads: ScheduleUpload[] = [
      makeUpload("a", ["instagram"], 0),
      makeUpload("b", ["instagram"], 1),
    ];
    const result = autoSchedule(
      uploads,
      { kind: "best-times", startDate: "2099-01-05" },
      best,
    );
    expect(result.items).toHaveLength(2);
    const a = result.items.find((i) => i.uploadId === "a")!;
    const b = result.items.find((i) => i.uploadId === "b")!;
    const diff = b.scheduledAt.getTime() - a.scheduledAt.getTime();
    // Must be at least the collision window apart, and in practice one
    // week (the next Tuesday matching the slot).
    expect(diff).toBeGreaterThanOrEqual(COLLISION_WINDOW_MS);
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("best-times: emits unscheduled when no slot exists for a platform", () => {
    const empty = new Map<BulkUploadPlatform, BestTimeSlot[]>();
    const uploads: ScheduleUpload[] = [
      makeUpload("a", ["facebook"], 0),
    ];
    const result = autoSchedule(
      uploads,
      { kind: "best-times", startDate: "2099-01-05" },
      empty,
    );
    expect(result.items).toHaveLength(0);
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0].platform).toBe("facebook");
  });

  it("custom-queue: walks the user-defined weekly slots in round-robin", () => {
    const uploads: ScheduleUpload[] = [
      makeUpload("a", ["instagram"], 0),
      makeUpload("b", ["instagram"], 1),
      makeUpload("c", ["instagram"], 2),
    ];
    const result = autoSchedule(uploads, {
      kind: "custom-queue",
      startDate: "2099-01-05",
      perPlatform: {
        instagram: [
          { weekday: 1, hour: 10, minute: 0 }, // Mon 10:00
          { weekday: 3, hour: 14, minute: 0 }, // Wed 14:00
          { weekday: 5, hour: 19, minute: 0 }, // Fri 19:00
        ],
      },
    });
    expect(result.items).toHaveLength(3);
    expect(result.unscheduled).toHaveLength(0);
    const a = result.items.find((i) => i.uploadId === "a")!;
    const b = result.items.find((i) => i.uploadId === "b")!;
    const c = result.items.find((i) => i.uploadId === "c")!;
    expect(a.scheduledAt.getUTCDay()).toBe(1); // Mon
    expect(b.scheduledAt.getUTCDay()).toBe(3); // Wed
    expect(c.scheduledAt.getUTCDay()).toBe(5); // Fri
  });
});
