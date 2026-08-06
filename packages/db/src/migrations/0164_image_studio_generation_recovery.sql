-- Durable Image Studio submission recovery.
--
-- submission_eligible_at intentionally has no default. Existing queued rows
-- therefore remain NULL/ineligible after migration; enqueue routes explicitly
-- stamp only newly-created jobs once the repaired worker is live.
ALTER TABLE "generation_jobs" ADD COLUMN "submission_eligible_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "submission_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "submission_started_at" timestamp with time zone;--> statement-breakpoint
-- Historical AugiAI databases can predate the named status constraint even
-- though fresh databases contain it. Both shapes must migrate safely.
ALTER TABLE "generation_jobs" DROP CONSTRAINT IF EXISTS "generation_jobs_status_check";--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_status_check"
  CHECK ("status" IN ('queued','submitting','submitted','polling','succeeded','failed'));--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_submission_attempt_unique_idx"
  ON "generation_jobs" USING btree ("submission_attempt_id")
  WHERE "submission_attempt_id" IS NOT NULL;
