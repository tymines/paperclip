import { describe, expect, it, vi } from "vitest";
import {
  isRailEnabled,
  processRoomTransition,
} from "../rooms-rail/rail-engine.js";

// Mock drizzle-orm eq to return a simple predicate object
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, _eq: true }),
}));

function mockDb(returnRows: unknown[]) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue(returnRows),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn(),
  } as any;
}

describe("rooms-rail engine (SHADOW mode)", () => {
  it("isRailEnabled returns false when config is disabled", async () => {
    const db = mockDb([{ value: false }]);
    const result = await isRailEnabled(db);
    expect(result).toBe(false);
  });

  it("isRailEnabled returns false when config row is missing", async () => {
    const db = mockDb([]);
    const result = await isRailEnabled(db);
    expect(result).toBe(false);
  });

  it("processRoomTransition is a no-op when rail is disabled", async () => {
    const db = mockDb([{ value: false }]);
    await processRoomTransition(db, "room-1", "active", "archived", "test");
    // insert().values() should never be called
    expect(db.insert).not.toHaveBeenCalled();
  });
});
