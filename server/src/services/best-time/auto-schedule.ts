/**
 * Auto-schedule algorithm.
 *
 * Given a list of uploads (each targeted to ≥1 platform) and a strategy,
 * compute the `{uploadId, platform, scheduledAt}` tuples the user can
 * preview, drag-adjust, and commit.
 *
 * Conflict resolution (per spec): if two scheduled posts collide within
 * 30 minutes on the same platform, push the second one to the next-best
 * available slot. Cross-platform collisions at the same minute are fine
 * (IG + Twitter can both go at 10:00).
 */

import type { BestTimeSlot, BulkUploadPlatform } from "./types.js";

export const COLLISION_WINDOW_MS = 30 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ScheduleUpload {
  id: string;
  /** Platforms this upload should be posted to. */
  platforms: BulkUploadPlatform[];
  /** User-defined sort order (lower = earlier in the queue). */
  orderIndex: number;
}

export interface EvenSpreadConfig {
  kind: "even";
  /** YYYY-MM-DD in the company's local timezone (UTC for now). */
  startDate: string;
  /** How many days to spread across. */
  dayCount: number;
  /** Per-platform per-day quota. Default 3. */
  postsPerDayPerPlatform: number;
}

export interface BestTimesConfig {
  kind: "best-times";
  /** YYYY-MM-DD. */
  startDate: string;
}

export interface CustomQueueSlot {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hour: number;
  minute: number;
}

export interface CustomQueueConfig {
  kind: "custom-queue";
  /** YYYY-MM-DD. */
  startDate: string;
  /** Weekly recurring slots per platform. */
  perPlatform: Partial<Record<BulkUploadPlatform, CustomQueueSlot[]>>;
}

export type ScheduleStrategy =
  | EvenSpreadConfig
  | BestTimesConfig
  | CustomQueueConfig;

export interface ScheduledItem {
  uploadId: string;
  platform: BulkUploadPlatform;
  scheduledAt: Date;
}

export interface AutoScheduleResult {
  items: ScheduledItem[];
  /** Uploads that couldn't be slotted (e.g. no available time within window). */
  unscheduled: Array<{ uploadId: string; platform: BulkUploadPlatform; reason: string }>;
}

/** Parse YYYY-MM-DD → Date at 00:00 UTC. */
function parseDate(yyyymmdd: string): Date {
  const [y, m, d] = yyyymmdd.split("-").map((v) => parseInt(v, 10));
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0));
}

function weekdayOf(date: Date): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return date.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

interface BookedSlot {
  start: number; // epoch ms
}

class PlatformBookings {
  private byPlatform = new Map<BulkUploadPlatform, BookedSlot[]>();

  /** Returns true if the slot collides with an existing booking on the platform. */
  collides(platform: BulkUploadPlatform, ts: number): boolean {
    const list = this.byPlatform.get(platform);
    if (!list) return false;
    for (const b of list) {
      if (Math.abs(b.start - ts) < COLLISION_WINDOW_MS) return true;
    }
    return false;
  }

  book(platform: BulkUploadPlatform, ts: number): void {
    const list = this.byPlatform.get(platform) ?? [];
    list.push({ start: ts });
    this.byPlatform.set(platform, list);
  }
}

function evenSpread(
  uploads: ScheduleUpload[],
  cfg: EvenSpreadConfig,
): AutoScheduleResult {
  const items: ScheduledItem[] = [];
  const unscheduled: AutoScheduleResult["unscheduled"] = [];
  const bookings = new PlatformBookings();

  // Sort by user-defined order (preserves IG grid intent).
  const sorted = [...uploads].sort((a, b) => a.orderIndex - b.orderIndex);

  // Per-platform per-day fill pointers + hour cursor inside each day.
  const startEpoch = parseDate(cfg.startDate).getTime();
  const hoursWithinDay = [10, 14, 19]; // sane default 3-per-day spacing
  const perPlatformCursors = new Map<
    BulkUploadPlatform,
    { dayIdx: number; slotIdx: number }
  >();

  for (const upload of sorted) {
    for (const platform of upload.platforms) {
      let cursor = perPlatformCursors.get(platform) ?? { dayIdx: 0, slotIdx: 0 };
      let slotted = false;

      while (cursor.dayIdx < cfg.dayCount && !slotted) {
        const hour =
          hoursWithinDay[cursor.slotIdx % hoursWithinDay.length] ?? 12;
        const ts =
          startEpoch + cursor.dayIdx * MS_PER_DAY + hour * 60 * 60 * 1000;

        const overQuota =
          cursor.slotIdx >= cfg.postsPerDayPerPlatform * (cursor.dayIdx + 1);
        if (overQuota) {
          cursor = { dayIdx: cursor.dayIdx + 1, slotIdx: cursor.dayIdx + 1 };
          continue;
        }

        if (bookings.collides(platform, ts)) {
          cursor.slotIdx += 1;
          if (cursor.slotIdx >= cfg.postsPerDayPerPlatform * (cursor.dayIdx + 1)) {
            cursor.dayIdx += 1;
            cursor.slotIdx = cursor.dayIdx * cfg.postsPerDayPerPlatform;
          }
          continue;
        }

        bookings.book(platform, ts);
        items.push({ uploadId: upload.id, platform, scheduledAt: new Date(ts) });
        cursor.slotIdx += 1;
        slotted = true;
      }

      perPlatformCursors.set(platform, cursor);

      if (!slotted) {
        unscheduled.push({
          uploadId: upload.id,
          platform,
          reason: `No free slot within the ${cfg.dayCount}-day window`,
        });
      }
    }
  }

  return { items, unscheduled };
}

function bestTimes(
  uploads: ScheduleUpload[],
  cfg: BestTimesConfig,
  bestSlotsByPlatform: Map<BulkUploadPlatform, BestTimeSlot[]>,
): AutoScheduleResult {
  const items: ScheduledItem[] = [];
  const unscheduled: AutoScheduleResult["unscheduled"] = [];
  const bookings = new PlatformBookings();

  const sorted = [...uploads].sort((a, b) => a.orderIndex - b.orderIndex);
  const startEpoch = parseDate(cfg.startDate).getTime();
  // Look up to 28 days ahead to slot every upload + handle conflicts.
  const horizonDays = 28;

  for (const upload of sorted) {
    for (const platform of upload.platforms) {
      const slots = bestSlotsByPlatform.get(platform) ?? [];
      if (slots.length === 0) {
        unscheduled.push({
          uploadId: upload.id,
          platform,
          reason: "No best-time slots available for this platform",
        });
        continue;
      }

      // Walk forward day by day looking for the highest-scored slot
      // that hasn't already been booked within the collision window.
      let bookedTs: number | null = null;
      for (let d = 0; d < horizonDays && bookedTs === null; d += 1) {
        const dayStart = new Date(startEpoch + d * MS_PER_DAY);
        const wkday = weekdayOf(dayStart);
        const candidates = slots.filter((s) => s.weekday === wkday);
        // Higher score first.
        candidates.sort((a, b) => b.score - a.score);
        for (const c of candidates) {
          const ts = dayStart.getTime() + c.hour * 60 * 60 * 1000;
          if (ts <= Date.now()) continue; // never schedule in the past
          if (!bookings.collides(platform, ts)) {
            bookings.book(platform, ts);
            bookedTs = ts;
            break;
          }
        }
      }

      if (bookedTs !== null) {
        items.push({
          uploadId: upload.id,
          platform,
          scheduledAt: new Date(bookedTs),
        });
      } else {
        unscheduled.push({
          uploadId: upload.id,
          platform,
          reason: `No conflict-free best-time slot within ${horizonDays} days`,
        });
      }
    }
  }

  return { items, unscheduled };
}

function customQueue(
  uploads: ScheduleUpload[],
  cfg: CustomQueueConfig,
): AutoScheduleResult {
  const items: ScheduledItem[] = [];
  const unscheduled: AutoScheduleResult["unscheduled"] = [];
  const bookings = new PlatformBookings();

  const sorted = [...uploads].sort((a, b) => a.orderIndex - b.orderIndex);
  const startEpoch = parseDate(cfg.startDate).getTime();
  const horizonDays = 90;

  // Per-platform cursor through the recurring weekly slots.
  const perPlatformPtr = new Map<BulkUploadPlatform, number>();

  for (const upload of sorted) {
    for (const platform of upload.platforms) {
      const weekly = cfg.perPlatform[platform];
      if (!weekly || weekly.length === 0) {
        unscheduled.push({
          uploadId: upload.id,
          platform,
          reason: "No custom queue defined for this platform",
        });
        continue;
      }
      let ptr = perPlatformPtr.get(platform) ?? 0;
      let bookedTs: number | null = null;
      for (let attempt = 0; attempt < weekly.length * horizonDays && bookedTs === null; attempt += 1) {
        const slot = weekly[ptr % weekly.length];
        const weekOffset = Math.floor(ptr / weekly.length);
        // Find the next occurrence of this weekday on/after start + weekOffset weeks.
        const baseTs = startEpoch + weekOffset * 7 * MS_PER_DAY;
        const baseDate = new Date(baseTs);
        const baseWk = weekdayOf(baseDate);
        const dayDiff = (slot.weekday - baseWk + 7) % 7;
        const ts =
          baseTs +
          dayDiff * MS_PER_DAY +
          slot.hour * 60 * 60 * 1000 +
          slot.minute * 60 * 1000;
        ptr += 1;
        if (ts <= Date.now()) continue;
        if (bookings.collides(platform, ts)) continue;
        bookings.book(platform, ts);
        bookedTs = ts;
      }
      perPlatformPtr.set(platform, ptr);
      if (bookedTs !== null) {
        items.push({
          uploadId: upload.id,
          platform,
          scheduledAt: new Date(bookedTs),
        });
      } else {
        unscheduled.push({
          uploadId: upload.id,
          platform,
          reason: "Couldn't slot into custom queue within 90 days",
        });
      }
    }
  }

  return { items, unscheduled };
}

export function autoSchedule(
  uploads: ScheduleUpload[],
  strategy: ScheduleStrategy,
  bestSlotsByPlatform: Map<BulkUploadPlatform, BestTimeSlot[]> = new Map(),
): AutoScheduleResult {
  switch (strategy.kind) {
    case "even":
      return evenSpread(uploads, strategy);
    case "best-times":
      return bestTimes(uploads, strategy, bestSlotsByPlatform);
    case "custom-queue":
      return customQueue(uploads, strategy);
    default: {
      // Exhaustiveness check
      const _exhaustive: never = strategy;
      void _exhaustive;
      return { items: [], unscheduled: [] };
    }
  }
}
