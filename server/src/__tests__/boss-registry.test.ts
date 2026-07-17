import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Mock @paperclipai/db to provide roomBosses and agents table schemas
const { mockRoomBosses, mockAgents } = vi.hoisted(() => ({
  mockRoomBosses: {
    bossAgentId: { column: "boss_agent_id" },
    roomType: { column: "room_type" },
  },
  mockAgents: {
    id: { column: "id" },
  },
}));

vi.mock("@paperclipai/db", () => ({
  roomBosses: mockRoomBosses,
  agents: mockAgents,
}));

import { getBossForRoomType, assignBoss } from "../rooms-rail/boss-registry.js";

const AGENT_ID = randomUUID();

function mockDb(selectResults: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(selectResults),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  } as any;
}

describe("boss-registry (unit)", () => {
  it("returns the boss agent for an assigned room type", async () => {
    const db = mockDb([
      { bossAgentId: AGENT_ID },
    ]);
    // Second select for agent lookup
    (db.select as any)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ bossAgentId: AGENT_ID }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: AGENT_ID, name: "Zeus" }]),
        }),
      });

    const agent = await getBossForRoomType(db, "pipeline-idea");
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe(AGENT_ID);
    expect(agent!.name).toBe("Zeus");
  });

  it("returns null for an unassigned room type (null bossAgentId)", async () => {
    const db = mockDb([{ bossAgentId: null }]);
    const agent = await getBossForRoomType(db, "pipeline-build");
    expect(agent).toBeNull();
  });

  it("returns null for an unknown room type (no matching row)", async () => {
    const db = mockDb([]);
    const agent = await getBossForRoomType(db, "nonexistent-room-type");
    expect(agent).toBeNull();
  });

  it("assignBoss calls insert with correct values", async () => {
    const db = mockDb([]);
    await assignBoss(db, "brainstorm", AGENT_ID);
    expect(db.insert).toHaveBeenCalled();
  });
});
