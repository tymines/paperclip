import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const webhookEventLog = pgTable(
  "webhook_event_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    processed: boolean("processed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => ({
    sourceCreatedIdx: index("webhook_event_log_source_created_idx").on(
      table.source,
      table.createdAt,
    ),
    eventTypeIdx: index("webhook_event_log_event_type_idx").on(table.eventType),
  }),
);
