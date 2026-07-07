import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const railConfig = pgTable(
  "rail_config",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
