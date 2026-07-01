-- Replicate cloud LoRA training integration.
--
-- Tyler is pivoting Sidney persona training off the local 16 GB Mac mini
-- FluxTrainer (6-12 hr runs, RAM thrashing) onto Replicate's hosted
-- `ostris/flux-dev-lora-trainer` (~30 min on an H100, ~$3/run).
--
-- This migration (a) marks providers that can run training jobs, (b) seeds
-- Replicate as a training-capable provider, and (c) adds a job table that
-- tracks each cloud training run end to end (upload → train → download →
-- install into ComfyUI). Fully idempotent so it is safe to re-run.

-- ── image_providers: training capability ────────────────────────────────────
ALTER TABLE "image_providers"
  ADD COLUMN IF NOT EXISTS "training_capable" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "image_providers"
  ADD COLUMN IF NOT EXISTS "training_model" text;--> statement-breakpoint

-- Seed Replicate as a global (company_id IS NULL) training-capable provider.
-- It doubles as a general image-gen entry in the External providers list.
-- NB: dedup on name (not provider_key) — the existing 'BFL Flux' row already
-- uses provider_key='replicate' for the hosted flux-pro endpoint.
INSERT INTO "image_providers"
  ("name", "type", "provider_key", "endpoint", "model", "training_capable", "training_model", "status", "cost_per_unit", "sort_order")
SELECT 'Replicate', 'external_api', 'replicate', 'https://api.replicate.com/v1', 'ostris/flux-dev-lora-trainer', true, 'ostris/flux-dev-lora-trainer', 'ready', '3.000000', 60
WHERE NOT EXISTS (
  SELECT 1 FROM "image_providers"
  WHERE "name" = 'Replicate' AND "type" = 'external_api' AND "company_id" IS NULL
);--> statement-breakpoint

-- ── lora_training_jobs ──────────────────────────────────────────────────────
-- One row per cloud training run. persona_id points at the local_lora persona
-- being trained; provider_id points at the trainer (e.g. Replicate).
--
-- content_rating is the NSFW guard: rows produced for a sidney_nsfw trigger
-- word are tagged 'explicit' so downstream schedulers can hard-reject the
-- resulting LoRA from SFW-only surfaces (IG / TikTok). See
-- server/src/services/image-studio/nsfw-guard.ts.
CREATE TABLE IF NOT EXISTS "lora_training_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "persona_id" uuid NOT NULL REFERENCES "image_providers"("id") ON DELETE CASCADE,
  "provider_id" uuid NOT NULL REFERENCES "image_providers"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending'
    CHECK ("status" IN ('pending','uploading','training','downloading','ready','failed')),
  "content_rating" text NOT NULL DEFAULT 'sfw'
    CHECK ("content_rating" IN ('sfw','explicit')),
  "external_job_id" text,
  "training_zip_path" text,
  "output_lora_path" text,
  "trigger_word" text,
  "progress" integer NOT NULL DEFAULT 0,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "cost_usd" numeric(10, 4),
  "error_message" text,
  "hyperparams" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "lora_training_jobs_persona_idx" ON "lora_training_jobs" ("persona_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lora_training_jobs_status_idx" ON "lora_training_jobs" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lora_training_jobs_external_idx" ON "lora_training_jobs" ("external_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lora_training_jobs_company_idx" ON "lora_training_jobs" ("company_id");
