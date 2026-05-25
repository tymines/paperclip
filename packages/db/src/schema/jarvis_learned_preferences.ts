import {
  index,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { jarvisConversations } from "./jarvis_conversations.js";

/**
 * Learned preferences for a (companyId, userActorId) pair. The Jarvis brain
 * loads the top-confidence rows on every reply and surfaces them in the
 * system prompt as a "LEARNED PREFERENCES" block, so the model adapts to
 * Tyler over time without persona-file edits.
 *
 * Rows are upserted either:
 *   - at seed time (initial known prefs from feedback memory)
 *   - by the fire-and-forget LLM observer pass that runs after each reply
 *     ships ("did the user signal a new preference in this exchange?").
 *
 * Keys are free-form so the observer can coin its own slugs (e.g.
 * "briefing_focus", "length_budget", "voice_provider", "mobile_brevity").
 * Confidence is 0..1; higher rows are surfaced first.
 */
export const jarvisLearnedPreferences = pgTable(
  "jarvis_learned_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Same identity field the conversations table uses. */
    userActorId: text("user_actor_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    /** 0..1 — how confident the observer is. Seeded rows ship at 0.9–1.0. */
    confidence: real("confidence").notNull().default(0.5),
    /** Conversation row whose user transcript triggered the upsert. */
    sourceMessageId: uuid("source_message_id").references(
      () => jarvisConversations.id,
      { onDelete: "set null" },
    ),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    actorKeyUq: uniqueIndex("jarvis_learned_preferences_actor_key_uq").on(
      table.companyId,
      table.userActorId,
      table.key,
    ),
    actorConfidenceIdx: index(
      "jarvis_learned_preferences_actor_confidence_idx",
    ).on(table.companyId, table.userActorId, table.confidence),
  }),
);
