/**
 * Time-of-day context for the Jarvis system prompt.
 *
 * Tyler wants the greeting to adapt to when he's actually asking — "Good
 * afternoon" at 2pm, "Burning the midnight oil" at 2am. This helper
 * computes a per-call snapshot of local time in Tyler's timezone (default
 * America/New_York — Tyler is on the Florida east coast) and renders it
 * into a system-prompt block.
 *
 * TODO: expose a per-user timezone override via the Jarvis settings
 * popover so non-ET users (and Tyler if he travels) can pick their own
 * zone instead of relying on this fallback.
 *
 * Computed once per reply, injected as TIME CONTEXT immediately after the
 * persona base. The persona doc references {{currentTime}}, {{currentDate}},
 * {{partOfDay}}, {{greeting}} so it can use the values directly.
 */

export type PartOfDay = "morning" | "afternoon" | "evening" | "late_night";

export interface JarvisTimeContext {
  /** ISO timezone identifier used to render the values. */
  timezone: string;
  /** 0..23 hour in the resolved timezone. */
  hour: number;
  /** Human-readable local time, e.g. "8:14 AM". */
  currentTime: string;
  /** Date phrase, e.g. "Monday, May 25". */
  currentDate: string;
  /** Day name, e.g. "Monday". */
  dayName: string;
  /** Buck of {morning|afternoon|evening|late_night}. */
  partOfDay: PartOfDay;
  /** Pre-rendered greeting line tuned to partOfDay. */
  greeting: string;
}

const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Map a 0..23 local hour to one of four bands per Tyler's spec:
 *   05–11 → morning      ("Good morning")
 *   12–16 → afternoon    ("Good afternoon")
 *   17–21 → evening      ("Good evening")
 *   22–04 → late_night   ("Burning the midnight oil")
 */
export function partOfDayForHour(hour: number): PartOfDay {
  if (hour >= 5 && hour <= 11) return "morning";
  if (hour >= 12 && hour <= 16) return "afternoon";
  if (hour >= 17 && hour <= 21) return "evening";
  return "late_night";
}

export function greetingForPartOfDay(part: PartOfDay): string {
  switch (part) {
    case "morning":
      return "Good morning";
    case "afternoon":
      return "Good afternoon";
    case "evening":
      return "Good evening";
    case "late_night":
    default:
      return "Burning the midnight oil";
  }
}

interface DateParts {
  hour: number;
  minute: number;
  dayName: string;
  monthName: string;
  day: number;
  hour12: number;
  ampm: "AM" | "PM";
}

function extractParts(now: Date, timezone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  const hour = Number(lookup.hour ?? "0");
  const minute = Number(lookup.minute ?? "0");
  const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const ampm: "AM" | "PM" = hour >= 12 ? "PM" : "AM";
  return {
    hour,
    minute,
    dayName: lookup.weekday ?? "",
    monthName: lookup.month ?? "",
    day: Number(lookup.day ?? "0"),
    hour12,
    ampm,
  };
}

export interface TimeContextOptions {
  /** Override `new Date()` for tests. */
  now?: Date;
  /** Override Tyler's timezone. Defaults to America/New_York (ET). */
  timezone?: string;
}

export function buildTimeContext(opts: TimeContextOptions = {}): JarvisTimeContext {
  const now = opts.now ?? new Date();
  const timezone = opts.timezone || DEFAULT_TIMEZONE;
  const parts = extractParts(now, timezone);
  const partOfDay = partOfDayForHour(parts.hour);
  const greeting = greetingForPartOfDay(partOfDay);
  const minuteStr = parts.minute.toString().padStart(2, "0");
  const currentTime = `${parts.hour12}:${minuteStr} ${parts.ampm}`;
  const currentDate = `${parts.dayName}, ${parts.monthName} ${parts.day}`;
  return {
    timezone,
    hour: parts.hour,
    currentTime,
    currentDate,
    dayName: parts.dayName,
    partOfDay,
    greeting,
  };
}

/**
 * Format the time context as a system-prompt block. Plain prose so it
 * survives the voice-mode markdown strip.
 */
export function formatTimeContextBlock(ctx: JarvisTimeContext): string {
  return [
    `TIME CONTEXT (computed per request from Tyler's local clock in ${ctx.timezone}):`,
    `- It is currently ${ctx.currentTime} on ${ctx.currentDate}.`,
    `- Part of day: ${ctx.partOfDay}.`,
    `- Greeting to use when one is appropriate: "${ctx.greeting}, Tyler."`,
    `Use these when greeting or referencing the time. Do not say "good morning" in the afternoon — match the part of day above.`,
  ].join("\n");
}
