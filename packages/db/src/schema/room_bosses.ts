import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";

export const roomBosses = pgTable(
  "room_bosses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomType: text("room_type").notNull().unique(),
    bossAgentId: uuid("boss_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    config: jsonb("config").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    roomTypeIdx: index("room_bosses_room_type_idx").on(table.roomType),
  }),
);
