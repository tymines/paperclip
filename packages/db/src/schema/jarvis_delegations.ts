import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { jarvisConversations } from "./jarvis_conversations.js";

/**
 * Peer-agent delegation tracking. Every time Jarvis hands a task off to a
 * peer (Hermes, August, Codex, content, social, researcher, or a spawned
 * Claude Code subagent), a row lands here so Tyler can see what's in flight
 * + collect the result when it lands.
 *
 * Lifecycle:
 *   queued    — bridge accepted the request, peer hasn't started yet
 *   running   — peer reported it picked up the work (optional, some peers skip)
 *   completed — result row populated, conversation gets an auto-follow-up
 *   failed    — bridge unreachable, peer threw, or timed out (24h wallclock)
 */
export const jarvisDelegations = pgTable(
  "jarvis_delegations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    /**
     * Conversation this delegation belongs to. The follow-up reply (when
     * the peer completes) gets appended to the same conversation so the
     * chat panel shows it in-line. Nullable because the API endpoint can
     * be hit without an active conversation (CLI / cron).
     */
    conversationId: uuid("conversation_id").references(() => jarvisConversations.id),
    /** Peer identity: hermes, august, codex, content, social, researcher, claude-code. */
    agent: text("agent").notNull(),
    /** The actual task text Jarvis dispatched. */
    task: text("task").notNull(),
    /** queued | running | completed | failed */
    status: text("status").notNull().default("queued"),
    /** Final result text (peer's reply). Populated when status flips to completed. */
    result: text("result"),
    /** Free-form payload — bridge messageId, urgency, depth, cwd, error detail, etc. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    /** Identity actor (user or agent) that triggered the delegation. */
    requestedByActorId: text("requested_by_actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    companyCreatedIdx: index("jarvis_delegations_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    statusIdx: index("jarvis_delegations_status_idx").on(table.status),
    conversationIdx: index("jarvis_delegations_conversation_idx").on(table.conversationId),
  }),
);
