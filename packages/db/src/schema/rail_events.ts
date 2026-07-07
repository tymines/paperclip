import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { issues } from "./issues.js";
import { agents } from "./agents.js";

export const railEvents = pgTable(
  "rail_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => issues.id),
    agentId: uuid("agent_id").references(() => agents.id),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    taskTypeIdx: index("rail_events_task_type_idx").on(table.taskId, table.type),
    typeCreatedIdx: index("rail_events_type_created_idx").on(table.type, table.createdAt),
  }),
);
