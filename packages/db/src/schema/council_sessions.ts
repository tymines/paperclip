import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { rooms } from "./rooms.js";

export const councilSessions = pgTable(
  "council_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    consensusProtocol: text("consensus_protocol").notNull().default("majority"),
    status: text("status").notNull().default("deliberating"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    roomIdx: index("council_sessions_room_idx").on(table.roomId),
  }),
);
