-- Multi-provider image/video generation.
--
-- The Image Studio inference surface now fans out across three hosted
-- providers (Replicate · Atlas Cloud · WaveSpeed AI) so Tyler can A/B which
-- produces the best results for a persona. Each row records which host it ran
-- on; existing rows are all Replicate.
--
-- `provider_host`: 'replicate' | 'atlascloud' | 'wavespeedai'.
-- generation_jobs also gains a `model` (the provider-native model id actually
-- fired — needed to make the A/B comparison meaningful) and split cost columns
-- (estimate at enqueue, actual after the render lands).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded backfill.

ALTER TABLE "image_providers"
  ADD COLUMN IF NOT EXISTS "provider_host" text NOT NULL DEFAULT 'replicate';

ALTER TABLE "generation_jobs"
  ADD COLUMN IF NOT EXISTS "provider_host" text NOT NULL DEFAULT 'replicate',
  ADD COLUMN IF NOT EXISTS "model" text,
  ADD COLUMN IF NOT EXISTS "cost_estimate_usd" numeric(10, 4),
  ADD COLUMN IF NOT EXISTS "actual_cost_usd" numeric(10, 4);

ALTER TABLE "persona_generations"
  ADD COLUMN IF NOT EXISTS "provider_host" text;

-- Backfill: every pre-existing render was Replicate.
UPDATE "persona_generations" SET "provider_host" = 'replicate' WHERE "provider_host" IS NULL;

-- Index for grouping a compare batch's jobs by provider.
CREATE INDEX IF NOT EXISTS "generation_jobs_provider_host_idx"
  ON "generation_jobs" ("provider_host");
