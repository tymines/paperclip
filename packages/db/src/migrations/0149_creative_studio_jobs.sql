-- Creative Studio P0 (Fable spec 2026-07-12) — creative_jobs job-metadata store.
-- Additive migration — does NOT drop or modify existing tables.
-- GATED: written but NOT applied/journaled (0145 pattern). Apply via the merge-queue
-- durability session. 0146/0147/0148 taken on sibling branches — 0149 is next free.

CREATE TABLE IF NOT EXISTS "creative_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "provider_job_id" text,
  "mode" text NOT NULL,
  "model" text NOT NULL,
  "prompt" text DEFAULT '' NOT NULL,
  "params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "cost_credits" integer,
  "error" text,
  "folder" text,
  "favorite" integer DEFAULT 0 NOT NULL,
  "created_by" text DEFAULT 'unknown' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "creative_jobs" ADD CONSTRAINT "creative_jobs_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_jobs_company_idx" ON "creative_jobs" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_jobs_company_status_idx" ON "creative_jobs" ("company_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_jobs_company_created_idx" ON "creative_jobs" ("company_id","created_at");
