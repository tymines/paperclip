import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySkills } from "./company_skills.js";

/**
 * Skill usage events — real audit trail of every skill invocation.
 *
 * Written by Hermes agents (or any adapter) when they load/invoke a skill.
 * Each row records who used which skill, when, for what purpose, and what
 * happened. The 30-day usage stats on the Skills catalog are computed by
 * aggregating rows here; no synthetic or backfilled numbers.
 */
export const skillUsageEvents = pgTable(
  "skill_usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => companySkills.id),
    actorType: text("actor_type").notNull().default("agent"),
    actorId: text("actor_id"),
    agentName: text("agent_name"),
    context: text("context"),
    outcome: text("outcome").notNull().default("info"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skillIdx: index("sue_skill_id_idx").on(table.companyId, table.skillId),
    companyIdx: index("sue_company_idx").on(table.companyId),
    createdAtIdx: index("sue_created_at_idx").on(table.companyId, table.skillId, table.createdAt),
  }),
);

export type SkillUsageEvent = typeof skillUsageEvents.$inferSelect;
export type NewSkillUsageEvent = typeof skillUsageEvents.$inferInsert;
