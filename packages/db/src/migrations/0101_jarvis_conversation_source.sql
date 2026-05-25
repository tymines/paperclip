ALTER TABLE "jarvis_conversations" ADD COLUMN "source" text;
--> statement-breakpoint
CREATE INDEX "jarvis_conversations_source_created_idx" ON "jarvis_conversations" USING btree ("source","created_at");
