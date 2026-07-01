import { describe, expect, it } from "vitest";
import {
  buildTimeContext,
  formatTimeContextBlock,
  greetingForPartOfDay,
  partOfDayForHour,
} from "../services/jarvis-time-context.js";

/**
 * Locks the greeting → partOfDay mapping per Tyler's spec:
 *   05–11 → morning      ("Good morning")
 *   12–16 → afternoon    ("Good afternoon")
 *   17–21 → evening      ("Good evening")
 *   22–04 → late_night   ("Burning the midnight oil")
 *
 * The "8am → Good morning, 2pm → Good afternoon, 7pm → Good evening" test
 * is the canonical contract for the time-aware greeting. Boundaries are
 * pinned to America/New_York since Tyler lives on the Florida east coast.
 */
describe("jarvis-time-context", () => {
  it("maps 8am ET to 'Good morning'", () => {
    // 12:00 UTC on May 25 2026 is 08:00 EDT — May has DST, so EDT not EST.
    const now = new Date("2026-05-25T12:00:00Z");
    const ctx = buildTimeContext({ now, timezone: "America/New_York" });
    expect(ctx.hour).toBe(8);
    expect(ctx.partOfDay).toBe("morning");
    expect(ctx.greeting).toBe("Good morning");
    expect(ctx.currentTime).toMatch(/^8:00 AM$/);
    expect(ctx.dayName).toBe("Monday");
  });

  it("maps 2pm ET to 'Good afternoon'", () => {
    // 18:00 UTC on May 25 2026 is 14:00 EDT.
    const now = new Date("2026-05-25T18:00:00Z");
    const ctx = buildTimeContext({ now, timezone: "America/New_York" });
    expect(ctx.hour).toBe(14);
    expect(ctx.partOfDay).toBe("afternoon");
    expect(ctx.greeting).toBe("Good afternoon");
    expect(ctx.currentTime).toMatch(/^2:00 PM$/);
  });

  it("maps 7pm ET to 'Good evening'", () => {
    // 23:00 UTC May 25 2026 is 19:00 EDT May 25.
    const now = new Date("2026-05-25T23:00:00Z");
    const ctx = buildTimeContext({ now, timezone: "America/New_York" });
    expect(ctx.hour).toBe(19);
    expect(ctx.partOfDay).toBe("evening");
    expect(ctx.greeting).toBe("Good evening");
    expect(ctx.currentTime).toMatch(/^7:00 PM$/);
  });

  it("maps 11pm ET to late_night with midnight-oil greeting", () => {
    // 03:00 UTC May 26 2026 is 23:00 EDT May 25.
    const now = new Date("2026-05-26T03:00:00Z");
    const ctx = buildTimeContext({ now, timezone: "America/New_York" });
    expect(ctx.hour).toBe(23);
    expect(ctx.partOfDay).toBe("late_night");
    expect(ctx.greeting).toBe("Burning the midnight oil");
  });

  it("maps 2am ET to late_night", () => {
    // 06:00 UTC May 26 2026 is 02:00 EDT May 26.
    const now = new Date("2026-05-26T06:00:00Z");
    const ctx = buildTimeContext({ now, timezone: "America/New_York" });
    expect(ctx.hour).toBe(2);
    expect(ctx.partOfDay).toBe("late_night");
    expect(ctx.greeting).toBe("Burning the midnight oil");
  });

  it("locks the partOfDay band boundaries from the spec", () => {
    // 5am → morning, 11am → morning, 12pm → afternoon, 4pm → afternoon,
    // 5pm → evening, 9pm → evening, 10pm → late_night, 4am → late_night.
    expect(partOfDayForHour(5)).toBe("morning");
    expect(partOfDayForHour(11)).toBe("morning");
    expect(partOfDayForHour(12)).toBe("afternoon");
    expect(partOfDayForHour(16)).toBe("afternoon");
    expect(partOfDayForHour(17)).toBe("evening");
    expect(partOfDayForHour(21)).toBe("evening");
    expect(partOfDayForHour(22)).toBe("late_night");
    expect(partOfDayForHour(4)).toBe("late_night");
  });

  it("formats a TIME CONTEXT block with all four fields rendered", () => {
    const now = new Date("2026-05-25T12:00:00Z");
    const ctx = buildTimeContext({ now, timezone: "America/New_York" });
    const block = formatTimeContextBlock(ctx);
    expect(block).toContain("TIME CONTEXT");
    expect(block).toContain("America/New_York");
    expect(block).toContain("8:00 AM");
    expect(block).toContain("Monday, May 25");
    expect(block).toContain("morning");
    expect(block).toContain('"Good morning, Tyler."');
  });

  it("greetingForPartOfDay returns the on-brand phrase for each band", () => {
    expect(greetingForPartOfDay("morning")).toBe("Good morning");
    expect(greetingForPartOfDay("afternoon")).toBe("Good afternoon");
    expect(greetingForPartOfDay("evening")).toBe("Good evening");
    expect(greetingForPartOfDay("late_night")).toBe("Burning the midnight oil");
  });

  it("uses America/New_York as the default timezone when none supplied", () => {
    const now = new Date("2026-05-25T12:00:00Z");
    const ctx = buildTimeContext({ now });
    expect(ctx.timezone).toBe("America/New_York");
    expect(ctx.hour).toBe(8);
  });
});
