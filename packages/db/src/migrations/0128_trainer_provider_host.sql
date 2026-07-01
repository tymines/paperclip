-- Multi-provider LoRA training: record which hosted provider ran each job so
-- the poller/cancel routes can route to the right API (Replicate vs WaveSpeed).
--
-- provider_id (the trainer provider ROW) is no longer required — host-based
-- training resolves the provider from provider_host directly, so make it
-- nullable. Existing rows are Replicate.
ALTER TABLE "lora_training_jobs"
  ADD COLUMN IF NOT EXISTS "provider_host" text NOT NULL DEFAULT 'replicate';

ALTER TABLE "lora_training_jobs"
  ADD COLUMN IF NOT EXISTS "trainer_model" text;

ALTER TABLE "lora_training_jobs"
  ALTER COLUMN "provider_id" DROP NOT NULL;
