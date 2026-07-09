import { describe, expect, it, vi } from "vitest";

// Mock @paperclipai/db first so rail-engine receives real-looking drizzle schema objects
vi.mock("@paperclipai/db", () => ({
  roomsRailConfig: { value: {}, key: {} },
  roomTransitions: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, _eq: true }),
}));

import {
  isRailEnabled,
  processRoomTransition,
} from "../rooms-rail/rail-engine.js";

// ponytail: simple chainable mock — each method returns `this` or a value
function mockDb(returnRows: unknown[]) {
  const insert = vi.fn().mockReturnThis();
  const values = vi.fn();
  const db: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue(returnRows),
    insert: () => ({ values }),
  };
  // Bind all chained methods to return `db` so select().from().where() chains.
  for (const k of ["select", "from", "where"]) {
    const orig = db[k];
    db[k] = vi.fn(() => db);
  }
  // Spy: capture insert call for assertions
  db._insert = insert;
  db._values = values;
  return db;
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
    // insert should never be called (rail disabled)
    expect(db._values).not.toHaveBeenCalled();
  });
});
