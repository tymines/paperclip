import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { pipelineRuns } from "./pipeline_runs.js";
import { runStages } from "./run_stages.js";

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineRunId: uuid("pipeline_run_id").references(() => pipelineRuns.id, { onDelete: "set null" }),
    runStageId: uuid("run_stage_id").references(() => runStages.id, { onDelete: "set null" }),
    artifactType: text("artifact_type").notNull(),
    name: text("name").notNull(),
    content: text("content"),
    filePath: text("file_path"),
    frozen: boolean("frozen").notNull().default(false),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    frozenBy: text("frozen_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index("artifacts_run_idx").on(table.pipelineRunId),
    stageIdx: index("artifacts_stage_idx").on(table.runStageId),
    typeIdx: index("artifacts_type_idx").on(table.artifactType),
  }),
);
