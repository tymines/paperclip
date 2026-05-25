import { pgTable, uuid, text, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
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
