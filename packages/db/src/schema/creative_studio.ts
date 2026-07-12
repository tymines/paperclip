import { pgTable, uuid, text, jsonb, integer, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Creative Studio (Fable spec 2026-07-12) — P0: one table.
// creative_jobs is the app-side job-metadata store: it indexes every generation
// dispatched to a provider (Higgsfield / OpenArt MCP per D1 ruling) so the Library
// grid and the Recreate/remix loop (spec L3) work without re-querying providers.
// Provider outputs stay on provider CDNs in P0 (urls in `outputs`); no blob store.
export const creativeJobs = pgTable(
  "creative_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    provider: text("provider").notNull(), // 'higgsfield' | 'openart' (| 'krea' P3)
    providerJobId: text("provider_job_id"),
    mode: text("mode").notNull(), // 'image' | 'video' | 'audio' | '3d'
    model: text("model").notNull(),
    prompt: text("prompt").notNull().default(""),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    refs: jsonb("refs").$type<Array<{ role: string; url: string }>>().notNull().default([]),
    status: text("status").notNull().default("pending"), // pending | running | completed | failed
    outputs: jsonb("outputs").$type<Array<{ url: string; kind: string; thumbUrl?: string }>>().notNull().default([]),
    costCredits: integer("cost_credits"),
    error: text("error"),
    folder: text("folder"),
    favorite: integer("favorite").notNull().default(0), // 0/1 (int for cheap toggling)
    createdBy: text("created_by").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("creative_jobs_company_idx").on(table.companyId),
    companyStatusIdx: index("creative_jobs_company_status_idx").on(table.companyId, table.status),
    companyCreatedIdx: index("creative_jobs_company_created_idx").on(table.companyId, table.createdAt),
  }),
);

export type CreativeJob = typeof creativeJobs.$inferSelect;
export type NewCreativeJob = typeof creativeJobs.$inferInsert;
