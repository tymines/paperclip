/**
 * Best-time engine types. Shared between the engine, the route layer,
 * and the auto-schedule algorithm.
 */

export type BulkUploadPlatform =
  | "instagram"
  | "twitter"
  | "facebook"
  | "threads"
  | "reddit";

export const BULK_UPLOAD_PLATFORMS = [
  "instagram",
  "twitter",
  "facebook",
  "threads",
  "reddit",
] as const satisfies readonly BulkUploadPlatform[];

export type BestTimeSource = "your-audience-30d" | "industry-2026" | "fallback";

export interface BestTimeSlot {
  /** 0 = Sunday … 6 = Saturday */
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** Hour of day, 0-23, in the company's local timezone. */
  hour: number;
  /** Relative engagement, 0-1. Used to rank slots within a source tier. */
  score: number;
}

export interface BestTimeResult {
  platform: BulkUploadPlatform;
  source: BestTimeSource;
  /** Slots ordered by score, highest first. */
  slots: BestTimeSlot[];
  /** Free-form note for the UI ("Based on 47 posts over the last 30 days"). */
  detail?: string;
}
