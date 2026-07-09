import type { Db } from "@paperclipai/db";
import { roomsRailConfig, roomTransitions } from "@paperclipai/db";
import { eq } from "drizzle-orm";

// ponytail: SHADOW mode — always returns false. Flip config row when going live.
export async function isRailEnabled(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ value: roomsRailConfig.value })
    .from(roomsRailConfig)
    .where(eq(roomsRailConfig.key, "enabled"))
    .limit(1);
  if (!row) return false;
  return row.value === true || (typeof row.value === "string" && row.value === "true");
}

export async function processRoomTransition(
  db: Db,
  roomId: string,
  fromStage: string,
  toStage: string,
  triggeredBy?: string,
): Promise<void> {
  if (!(await isRailEnabled(db))) return;

  await db.insert(roomTransitions).values({
    roomId,
    fromStage,
    toStage,
    triggeredBy: triggeredBy ?? null,
  });
}
