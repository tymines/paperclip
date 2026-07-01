import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
    pngPaths: jsonb("png_paths").$type<string[]>().notNull().default([]),
    mp4Path: text("mp4_path"),
    rasterStatus: text("raster_status").notNull().default("pending"),
    rasterError: text("raster_error"),
    presetRunId: uuid("preset_run_id"),
    idempotencyKey: text("idempotency_key"),
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
    presetRunIdx: index("design_runs_preset_run_idx").on(table.presetRunId),
    idemUnique: uniqueIndex("design_runs_idem_unique")
      .on(table.companyId, table.idempotencyKey)
      .where(sql`"idempotency_key" IS NOT NULL`),
  }),
);

export const designPresetRuns = pgTable(
  "design_preset_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    presetSlug: text("preset_slug").notNull(),
    brief: text("brief").notNull(),
    status: text("status").notNull().default("running"),
    childRunIds: jsonb("child_run_ids").$type<string[]>().notNull().default([]),
    resultSummary: jsonb("result_summary").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    companyCreatedIdx: index("design_preset_runs_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    slugIdx: index("design_preset_runs_slug_idx").on(table.presetSlug),
  }),
);

export type DesignRun = typeof designRuns.$inferSelect;
export type NewDesignRun = typeof designRuns.$inferInsert;
export type DesignPresetRun = typeof designPresetRuns.$inferSelect;
export type NewDesignPresetRun = typeof designPresetRuns.$inferInsert;
