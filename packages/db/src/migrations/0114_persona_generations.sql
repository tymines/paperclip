-- Persona generations gallery.
--
-- Each row is one rendered image produced for a local_lora persona — either a
-- 'test' render (hand-curated previews Tyler eyeballs before going live) or a
-- 'production' render fired through the inference pipeline. The Image Studio
-- persona card renders these as a live preview / portfolio grid.
--
-- image_path / thumbnail_path are RELATIVE to the Paperclip uploads dir
-- (served at /api/uploads/...), e.g. 'personas/sidney-sfw/test-001.png'.
--
-- content_rating mirrors the lora_training_jobs guard: 'explicit' rows can be
-- hard-rejected from SFW-only surfaces downstream. Fully idempotent.

CREATE TABLE IF NOT EXISTS "persona_generations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- The local_lora persona this image was generated for.
  "persona_id" uuid NOT NULL REFERENCES "image_providers"("id") ON DELETE CASCADE,
  "source" text NOT NULL DEFAULT 'production'
    CHECK ("source" IN ('test','production')),
  "prompt" text,
  "lora_strength" numeric(4, 2),
  "model" text,
  -- Relative path under the uploads dir (served via /api/uploads/...).
  "image_path" text NOT NULL,
  "thumbnail_path" text,
  "generation_metadata" jsonb,
  "replicate_prediction_id" text,
  "cost_usd" numeric(10, 4),
  "content_rating" text NOT NULL DEFAULT 'sfw'
    CHECK ("content_rating" IN ('sfw','explicit')),
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "persona_generations_persona_created_idx"
  ON "persona_generations" ("persona_id", "created_at" DESC);
