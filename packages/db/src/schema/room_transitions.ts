import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const roomTransitions = pgTable("room_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  roomId: uuid("room_id").notNull(),
  fromStage: text("from_stage").notNull(),
  toStage: text("to_stage").notNull(),
  triggeredBy: text("triggered_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
