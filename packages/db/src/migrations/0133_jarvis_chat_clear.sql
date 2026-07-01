-- Soft-hide support for the War Room chat "Clear chat" control.
-- ADDITIVE + NON-DESTRUCTIVE: cleared_at flags a row as hidden from the
-- on-screen transcript ONLY. No rows are ever deleted. The Jarvis brain's
-- continuity query (fetchRecentTurns) intentionally does NOT filter on
-- cleared_at, so Hermes keeps full conversational memory after a clear.
-- The external memory layer (OpenViking / memory-core / QMD) is a separate
-- system and is untouched by this column.
ALTER TABLE "jarvis_conversations" ADD COLUMN "cleared_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "jarvis_conversations_company_actor_cleared_idx" ON "jarvis_conversations" USING btree ("company_id","user_actor_id","cleared_at");
