ALTER TABLE "story_bible_chat_messages" ADD COLUMN "dispatch_attempt_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_dispatch_attempt_unique_idx" ON "story_bible_chat_messages" USING btree ("dispatch_attempt_id");
