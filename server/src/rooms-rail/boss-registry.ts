import { eq } from "drizzle-orm";
import { type Db, agents, roomBosses } from "@paperclipai/db";

/**
 * Get the boss agent assigned to a room type.
 * Returns the agent row or null if no boss is assigned (e.g. pipeline-build).
 *
 * SHADOW: rooms_rail.enabled=false — nothing calls this yet.
 * Wiring happens in WO-2's rail engine when enabled.
 */
export async function getBossForRoomType(db: Db, roomType: string) {
  const [row] = await db
    .select({
      bossAgentId: roomBosses.bossAgentId,
    })
    .from(roomBosses)
    .where(eq(roomBosses.roomType, roomType));

  if (!row?.bossAgentId) return null;

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, row.bossAgentId));

  return agent ?? null;
}

/**
 * Upsert a boss assignment for a room type.
 * Set bossAgentId to null to clear the assignment.
 */
export async function assignBoss(
  db: Db,
  roomType: string,
  bossAgentId: string | null,
) {
  await db
    .insert(roomBosses)
    .values({
      roomType,
      bossAgentId,
      config: {},
    })
    .onConflictDoUpdate({
      target: roomBosses.roomType,
      set: { bossAgentId, config: {} },
    });
}
