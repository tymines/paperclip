import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const roomsRailConfig = pgTable("rooms_rail_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
