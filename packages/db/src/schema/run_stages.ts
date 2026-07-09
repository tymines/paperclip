import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { pipelineRuns } from "./pipeline_runs.js";
import { agents } from "./agents.js";

export const runStages = pgTable(
  "run_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineRunId: uuid("pipeline_run_id").notNull().references(() => pipelineRuns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("pending"),
    stageOrder: integer("stage_order").notNull().default(0),
    assignedAgentId: uuid("assigned_agent_id").references(() => agents.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdIdx: index("run_stages_run_idx").on(table.pipelineRunId),
    runStatusIdx: index("run_stages_run_status_idx").on(table.pipelineRunId, table.status),
    agentIdx: index("run_stages_agent_idx").on(table.assignedAgentId),
  }),
);
