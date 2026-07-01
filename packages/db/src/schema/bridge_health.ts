import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const bridgeHealth = pgTable("_bridge_health", {
  id: uuid("id").primaryKey().defaultRandom(),
  testMessage: text("test_message").notNull(),
  checksum: text("checksum").notNull(),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
