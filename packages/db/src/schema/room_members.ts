import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { rooms } from "./rooms.js";
import { agents } from "./agents.js";

export const roomMembers = pgTable(
  "room_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    userId: uuid("user_id"),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomIdx: index("room_members_room_idx").on(table.roomId),
    roomAgentIdx: index("room_members_room_agent_idx").on(table.roomId, table.agentId),
    roomUserIdx: index("room_members_room_user_idx").on(table.roomId, table.userId),
  }),
);
