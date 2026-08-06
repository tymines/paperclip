-- Durable terminal handling for provider-success output landing.
ALTER TABLE "generation_jobs" ADD COLUMN "landing_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation_jobs" DROP CONSTRAINT "generation_jobs_status_check";--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_status_check"
  CHECK ("status" IN ('queued','submitting','submitted','polling','landing','succeeded','failed'));
