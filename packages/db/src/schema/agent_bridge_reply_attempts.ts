import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const agentBridgeReplyAttempts = pgTable(
  "agent_bridge_reply_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id"),
    roomId: uuid("room_id"),
    agentId: uuid("agent_id"),
    contentLength: integer("content_length").notNull().default(0),
    outcome: text("outcome").notNull(),
    errorDetail: text("error_detail"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentCreatedIdx: index("agent_bridge_reply_attempts_agent_created_idx").on(
      table.agentId,
      table.createdAt,
    ),
    companyCreatedIdx: index("agent_bridge_reply_attempts_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    outcomeIdx: index("agent_bridge_reply_attempts_outcome_idx").on(table.outcome),
  }),
);
