ALTER TABLE "social_post_targets" ADD COLUMN "attempt_count" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_post_targets_idempotency_idx" ON "social_post_targets" ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_due_idx" ON "social_posts" ("status", "scheduled_at");
