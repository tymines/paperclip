import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { jarvisDelegations } from "./jarvis_delegations.js";

/**
 * AgentOperation run-log (ADDITIVE — Team Mode).
 *
 * Today the bridge posts a typed `agent.work` event per turn to
 * `POST /agent-bridge/work`; the server validates it and re-broadcasts it on
 * the company WS channel (`publishLiveEvent({ type: "agent.work" })`) but never
 * persists it — the proof-of-work vanishes the moment it is broadcast. This
 * table is the durable run-log for those events so the War Room "Team Mode"
 * board can show *what each worker actually did* (per-turn tool calls + the
 * structural proof-of-work `mutated` flag) instead of re-parsing prose.
 *
 * The shape is a 1:1 mirror of the `/agent-bridge/work` payload
 * (agentId, roomId, turnId, kind, outcome, tool) plus an optional link to the
 * directed assignment (`delegationId`) that produced the turn.
 *
 * Population is intentionally OFF by default and gated behind
 * `TEAM_MODE_OPLOG=1` so the live ingestion path is byte-for-byte unchanged
 * until enabled (see server/src/routes/agent-bridge.ts). The read-only Team
 * Mode slice renders the existing live `agent.work` WS stream + heartbeat-run
 * history directly; this table is the forward-looking persistence layer.
 *
 * Discriminator: `kind` ∈ turn.started | tool.call | tool.result | turn.completed.
 */
export const agentOperations = pgTable(
  "agent_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    /** The worker that emitted the turn event. */
    agentId: uuid("agent_id").references(() => agents.id),
    /**
     * Directed assignment this turn belongs to, when the turn was produced in
     * service of a Hermes→Ares→worker delegation. Nullable: ad-hoc/issue-path
     * turns have no delegation parent.
     */
    delegationId: uuid("delegation_id").references(() => jarvisDelegations.id),
    /** Transport room the turn was dispatched through (free-form, bridge-supplied). */
    roomId: text("room_id"),
    /** Bridge-supplied turn correlation id (groups the 4 lifecycle events). */
    turnId: text("turn_id").notNull(),
    /** turn.started | tool.call | tool.result | turn.completed */
    kind: text("kind").notNull(),
    /** Tool name for tool.call / tool.result events (null otherwise). */
    toolName: text("tool_name"),
    /**
     * Structural proof-of-work: true when the turn fired a mutating tool event.
     * A turn that completes with mutated=false is definitionally a non-change.
     */
    mutated: boolean("mutated"),
    /** Discriminated outcome.artifact (commit sha, file path, post id, …). */
    artifact: jsonb("artifact").$type<Record<string, unknown>>(),
    /** Full opaque outcome bag passed through from the bridge. */
    outcome: jsonb("outcome").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("agent_operations_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    agentCreatedIdx: index("agent_operations_agent_created_idx").on(
      table.agentId,
      table.createdAt,
    ),
    delegationIdx: index("agent_operations_delegation_idx").on(table.delegationId),
    turnIdx: index("agent_operations_turn_idx").on(table.turnId),
  }),
);

export type AgentOperation = typeof agentOperations.$inferSelect;
export type NewAgentOperation = typeof agentOperations.$inferInsert;
