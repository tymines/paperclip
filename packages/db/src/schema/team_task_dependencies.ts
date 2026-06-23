import {
  pgTable,
  uuid,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { jarvisDelegations } from "./jarvis_delegations.js";

/**
 * Team Mode task-board dependency graph (ADDITIVE).
 *
 * AionUi's Team Mode task board carries a blocks / blocked-by dependency graph
 * between teammate tasks. Paperclip's directed assignments already live in
 * `jarvis_delegations` (one row = one worker task); this table adds the missing
 * edge set so the board can render a real dependency graph.
 *
 * An edge means: `delegationId` is BLOCKED BY `dependsOnDelegationId`
 * (i.e. the prerequisite must reach a terminal state first). Both endpoints are
 * real delegation rows; the table is purely additive and starts empty —
 * the read-only board honestly shows "no dependencies recorded" until edges are
 * written by the (later) Ares distribution path. No fabricated edges.
 */
export const teamTaskDependencies = pgTable(
  "team_task_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    /** The dependent task (the one that is blocked). */
    delegationId: uuid("delegation_id")
      .notNull()
      .references(() => jarvisDelegations.id),
    /** The prerequisite task (must finish first). */
    dependsOnDelegationId: uuid("depends_on_delegation_id")
      .notNull()
      .references(() => jarvisDelegations.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    edgeUnique: uniqueIndex("team_task_dependencies_edge_unique").on(
      table.delegationId,
      table.dependsOnDelegationId,
    ),
    companyIdx: index("team_task_dependencies_company_idx").on(table.companyId),
    delegationIdx: index("team_task_dependencies_delegation_idx").on(
      table.delegationId,
    ),
    dependsOnIdx: index("team_task_dependencies_depends_on_idx").on(
      table.dependsOnDelegationId,
    ),
  }),
);

export type TeamTaskDependency = typeof teamTaskDependencies.$inferSelect;
export type NewTeamTaskDependency = typeof teamTaskDependencies.$inferInsert;
