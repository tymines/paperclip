import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const designRuns = pgTable(
  "design_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    agentId: text("agent_id").notNull().default("claude"),
    designSystemId: text("design_system_id"),
    prompt: text("prompt").notNull(),
    params: jsonb("params").notNull().default({}),
    outputType: text("output_type").notNull().default("html"),
    status: text("status").notNull().default("pending"),
    odRunId: text("od_run_id"),
    odProjectId: text("od_project_id"),
    assetPath: text("asset_path"),
    assetUrl: text("asset_url"),
    previewUrl: text("preview_url"),
    error: text("error"),
    tokenCostUsd: numeric("token_cost_usd", { precision: 12, scale: 6 }),
    renderCostUsd: numeric("render_cost_usd", { precision: 12, scale: 6 }),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (table) => ({
    companyCreatedIdx: index("design_runs_company_created_idx").on(table.companyId, table.createdAt),
    statusIdx: index("design_runs_status_idx").on(table.status),
    skillIdx: index("design_runs_skill_idx").on(table.skill),
  }),
);

export type DesignRun = typeof designRuns.$inferSelect;
export type NewDesignRun = typeof designRuns.$inferInsert;
