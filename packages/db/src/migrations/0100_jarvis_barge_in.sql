ALTER TABLE "jarvis_conversations" ADD COLUMN "interrupted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "jarvis_conversations" ADD COLUMN "interrupted_at_chars" integer;
