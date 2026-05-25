ALTER TABLE "jarvis_conversations" ADD COLUMN "persona_version" text;
--> statement-breakpoint
ALTER TABLE "jarvis_conversations" ADD COLUMN "response_type" text;
--> statement-breakpoint
ALTER TABLE "jarvis_conversations" ADD COLUMN "truncated" boolean DEFAULT false;
--> statement-breakpoint
CREATE INDEX "jarvis_conversations_persona_version_idx" ON "jarvis_conversations" USING btree ("persona_version");
