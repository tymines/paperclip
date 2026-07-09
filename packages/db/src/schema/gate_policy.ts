import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const gatePolicy = pgTable(
  "gate_policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    stageName: text("stage_name").notNull(),
    requiredEvidenceTypes: jsonb("required_evidence_types").notNull().default("[]"),
    minReviewers: text("min_reviewers").notNull().default("1"),
    autoApprove: boolean("auto_approve").notNull().default(false),
    config: jsonb("config"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStageIdx: index("gate_policy_company_stage_idx").on(table.companyId, table.stageName),
  }),
);
