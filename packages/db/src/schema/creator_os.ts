import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { imageProviders } from "./image_providers.js";
import { generationJobs } from "./generation_jobs.js";

export const creatorFlows = pgTable(
  "creator_flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    personaId: uuid("persona_id").notNull().references(() => imageProviders.id),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyPersonaIdx: index("creator_flows_company_persona_idx").on(table.companyId, table.personaId),
    companyStatusIdx: index("creator_flows_company_status_idx").on(table.companyId, table.status),
  }),
);

export const creatorFlowSteps = pgTable(
  "creator_flow_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flowId: uuid("flow_id").notNull().references(() => creatorFlows.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    flowPositionUq: uniqueIndex("creator_flow_steps_flow_position_uq").on(table.flowId, table.position),
  }),
);

export const creatorFlowRuns = pgTable(
  "creator_flow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    personaId: uuid("persona_id").notNull().references(() => imageProviders.id),
    flowId: uuid("flow_id").notNull().references(() => creatorFlows.id),
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: text("created_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    flowIdempotencyUq: uniqueIndex("creator_flow_runs_flow_idempotency_uq").on(table.flowId, table.idempotencyKey),
    companyCreatedIdx: index("creator_flow_runs_company_created_idx").on(table.companyId, table.createdAt),
  }),
);

export const creatorFlowRunSteps = pgTable(
  "creator_flow_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => creatorFlowRuns.id, { onDelete: "cascade" }),
    flowStepId: uuid("flow_step_id").references(() => creatorFlowSteps.id, { onDelete: "set null" }),
    stepName: text("step_name").notNull(),
    configSnapshot: jsonb("config_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    position: integer("position").notNull(),
    attempt: integer("attempt").notNull().default(1),
    status: text("status").notNull().default("pending"),
    generationJobId: uuid("generation_job_id").references(() => generationJobs.id),
    errorMessage: text("error_message"),
    retryIdempotencyKey: text("retry_idempotency_key"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runPositionAttemptUq: uniqueIndex("creator_flow_run_steps_run_position_attempt_uq").on(table.runId, table.position, table.attempt),
    retryIdempotencyUq: uniqueIndex("creator_flow_run_steps_retry_idempotency_uq").on(table.runId, table.retryIdempotencyKey),
    runPositionIdx: index("creator_flow_run_steps_run_position_idx").on(table.runId, table.position),
  }),
);

export const creatorCampaigns = pgTable(
  "creator_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    personaId: uuid("persona_id").notNull().references(() => imageProviders.id),
    name: text("name").notNull(),
    description: text("description"),
    channels: jsonb("channels").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyPersonaIdx: index("creator_campaigns_company_persona_idx").on(table.companyId, table.personaId),
    companyStatusIdx: index("creator_campaigns_company_status_idx").on(table.companyId, table.status),
  }),
);

export const creatorCampaignItems = pgTable(
  "creator_campaign_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    campaignId: uuid("campaign_id").notNull().references(() => creatorCampaigns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    referenceId: uuid("reference_id").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    referenceUq: uniqueIndex("creator_campaign_items_reference_uq").on(table.campaignId, table.kind, table.referenceId),
    campaignIdx: index("creator_campaign_items_campaign_idx").on(table.campaignId, table.createdAt),
  }),
);

export const creatorReviewRequests = pgTable(
  "creator_review_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    personaId: uuid("persona_id").notNull().references(() => imageProviders.id),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    status: text("status").notNull().default("pending"),
    feedback: text("feedback"),
    requestedBy: text("requested_by"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    supersedesRequestId: uuid("supersedes_request_id").references((): AnyPgColumn => creatorReviewRequests.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyPersonaStatusIdx: index("creator_reviews_company_persona_status_idx").on(table.companyId, table.personaId, table.status),
    sourceIdx: index("creator_reviews_source_idx").on(table.sourceType, table.sourceId, table.createdAt),
  }),
);

export type CreatorFlow = typeof creatorFlows.$inferSelect;
export type CreatorFlowStep = typeof creatorFlowSteps.$inferSelect;
export type CreatorFlowRun = typeof creatorFlowRuns.$inferSelect;
export type CreatorFlowRunStep = typeof creatorFlowRunSteps.$inferSelect;
export type CreatorCampaign = typeof creatorCampaigns.$inferSelect;
export type CreatorCampaignItem = typeof creatorCampaignItems.$inferSelect;
export type CreatorReviewRequest = typeof creatorReviewRequests.$inferSelect;
