import { pgTable, uuid, text, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

// 1. gym_eval_suites
export const gymEvalSuites = pgTable(
  "gym_eval_suites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    description: text("description"),
    testCases: jsonb("test_cases").$type<Array<{
      id: string;
      prompt: string;
      expectedResponse: string;
      rubric: string;
      weight: number;
    }>>().notNull().default([]),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("gym_eval_suites_company_idx").on(table.companyId),
    companyNameUnique: uniqueIndex("gym_eval_suites_company_name_unique").on(table.companyId, table.name),
  }),
);

// 2. gym_eval_runs
export const gymEvalRuns = pgTable(
  "gym_eval_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    suiteId: uuid("suite_id").notNull().references(() => gymEvalSuites.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    scores: jsonb("scores").$type<Array<{
      testCaseId: string;
      score: number;
      reasoning: string;
      latencyMs: number;
    }>>(),
    overallScore: integer("overall_score"),
    modelUsed: text("model_used").notNull().default("gemini-2.5-flash"),
    promptCandidateId: uuid("prompt_candidate_id").references(() => gymPromptCandidates.id, { onDelete: "set null" }),
    agentProfileId: uuid("agent_profile_id").references(() => gymAgentProfiles.id, { onDelete: "set null" }),
    durationMs: integer("duration_ms"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySuiteIdx: index("gym_eval_runs_company_suite_idx").on(table.companyId, table.suiteId),
    suiteIdx: index("gym_eval_runs_suite_idx").on(table.suiteId),
  }),
);

// 3. gym_prompt_candidates
export const gymPromptCandidates = pgTable(
  "gym_prompt_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    userPromptTemplate: text("user_prompt_template"),
    model: text("model").notNull().default("gemini-2.5-flash"),
    temperature: integer("temperature").notNull().default(70),
    version: integer("version").notNull().default(1),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("gym_prompt_candidates_company_idx").on(table.companyId),
    companyNameUnique: uniqueIndex("gym_prompt_candidates_company_name_unique").on(table.companyId, table.name),
  }),
);

// 4. gym_agent_profiles
export const gymAgentProfiles = pgTable(
  "gym_agent_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    promptCandidateId: uuid("prompt_candidate_id").references(() => gymPromptCandidates.id, { onDelete: "set null" }),
    totalRuns: integer("total_runs").notNull().default(0),
    averageScore: integer("average_score"),
    bestScore: integer("best_score"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("gym_agent_profiles_company_idx").on(table.companyId),
    agentIdx: index("gym_agent_profiles_agent_idx").on(table.agentId),
  }),
);
