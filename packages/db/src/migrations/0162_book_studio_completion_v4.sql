ALTER TABLE "story_bible_chat_messages" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "story_bible_chat_messages" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "story_bible_chat_messages" ADD COLUMN "retryable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "story_bible_chat_messages" ADD COLUMN "authorization" jsonb;--> statement-breakpoint
ALTER TABLE "story_bible_chat_messages" ADD COLUMN "action_result" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_book_turn_role_unique_idx" ON "story_bible_chat_messages" USING btree ("book_id","turn_id","role");
