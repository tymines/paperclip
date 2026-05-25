import { integer, pgTable, uuid, text, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const jarvisConversations = pgTable(
  "jarvis_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    userActorId: text("user_actor_id").notNull(),
    userTranscript: text("user_transcript").notNull(),
    agentReply: text("agent_reply").notNull(),
    voiceTier: text("voice_tier").notNull().default("browser-native"),
    llmProvider: text("llm_provider"),
    llmModel: text("llm_model"),
    /**
     * Content-hash version of the persona that was active when this reply
     * was generated. Lets us track how persona tunings affect reply
     * quality — invaluable for prompt iteration.
     */
    personaVersion: text("persona_version"),
    /** quick | standard | briefing | detailed — drives the length budget. */
    responseType: text("response_type"),
    /** True when the API layer truncated the model output to fit the budget. */
    truncated: boolean("truncated").default(false),
    /** Snapshot of the context briefing fed to the LLM — supports replay + audit. */
    contextSnapshot: jsonb("context_snapshot").$type<Record<string, unknown>>(),
    latencyMs: text("latency_ms"),
    /**
     * Set when Tyler barges in mid-reply. NULL means the reply played to
     * completion. When non-null, this is the wall-clock moment the
     * client paused TTS playback in response to detected user speech.
     */
    interruptedAt: timestamp("interrupted_at", { withTimezone: true }),
    /**
     * Number of characters of `agent_reply` that were actually spoken
     * before barge-in cut the playback. Lets us replay or resume the
     * truncated portion later if Tyler asks "where were you?".
     */
    interruptedAtChars: integer("interrupted_at_chars"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("jarvis_conversations_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    personaVersionIdx: index("jarvis_conversations_persona_version_idx").on(
      table.personaVersion,
    ),
  }),
);
