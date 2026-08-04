ALTER TABLE "story_bible_chat_messages" ADD COLUMN "turn_id" uuid;--> statement-breakpoint
ALTER TABLE "story_bible_chat_messages" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "story_bible_chat_messages" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "story_bible_chat_messages" ADD COLUMN "delegation_id" uuid;--> statement-breakpoint
ALTER TABLE "story_bible_chat_messages" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "story_bible_chat_messages" ADD COLUMN "archived_at" timestamp with time zone;