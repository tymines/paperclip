-- Persona prompt templates + generation jobs.
--
-- prompt_templates: reusable prompt recipes for a local_lora persona (or shared
--   when persona_id IS NULL). template_text may contain {variation:a|b|c}
--   placeholders that the generate endpoint cross-product-expands into a batch.
--
-- generation_jobs: one row per queued render. A batch (batch_id) is the set of
--   jobs produced by one generate request (prompt × variation expansion × count).
--   The replicate-generator worker submits each job to Replicate, polls every
--   15s, and on success downloads the PNG into the uploads dir + inserts a
--   persona_generations row so the image lands in the persona gallery.
--
-- content_rating is a LABEL only ('sfw'|'explicit'). 'explicit' flips
-- disable_safety_checker on at inference time for synthetic-character LoRAs —
-- the standard adult-content knob, wired as a normal config path. Idempotent.

CREATE TABLE IF NOT EXISTS "prompt_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  -- NULL persona_id = a shared template available to every persona.
  "persona_id" uuid REFERENCES "image_providers"("id") ON DELETE CASCADE,
  "template_text" text NOT NULL,
  "default_lora_scale" numeric(4, 2),
  "default_steps" integer,
  "default_guidance" numeric(4, 2),
  "default_aspect_ratio" text,
  "content_rating" text NOT NULL DEFAULT 'sfw'
    CHECK ("content_rating" IN ('sfw','explicit')),
  "tags" text[],
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "prompt_templates_persona_idx"
  ON "prompt_templates" ("persona_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "generation_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "persona_id" uuid NOT NULL REFERENCES "image_providers"("id") ON DELETE CASCADE,
  "prompt_template_id" uuid REFERENCES "prompt_templates"("id") ON DELETE SET NULL,
  "batch_id" uuid NOT NULL,
  "prompt_text" text NOT NULL,
  "lora_scale" numeric(4, 2),
  "steps" integer,
  "guidance" numeric(4, 2),
  "aspect_ratio" text,
  "seed" bigint,
  "status" text NOT NULL DEFAULT 'queued'
    CHECK ("status" IN ('queued','submitted','polling','succeeded','failed')),
  "replicate_prediction_id" text,
  "output_path" text,
  "content_rating" text NOT NULL DEFAULT 'sfw'
    CHECK ("content_rating" IN ('sfw','explicit')),
  "cost_usd" numeric(10, 4),
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "completed_at" timestamp with time zone
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "generation_jobs_persona_created_idx"
  ON "generation_jobs" ("persona_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_jobs_batch_idx"
  ON "generation_jobs" ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_jobs_status_idx"
  ON "generation_jobs" ("status");--> statement-breakpoint

-- Seed SFW prompt templates tied to Sidney SFW. NSFW templates are intentionally
-- NOT seeded — Tyler creates those through the UI. Idempotent on (name, persona_id).
INSERT INTO "prompt_templates"
  ("name","description","persona_id","template_text","default_lora_scale","default_steps","default_guidance","default_aspect_ratio","content_rating","tags")
SELECT v."name", v."description", p."id", v."template_text", 1.0, 28, 3.5, v."aspect_ratio", 'sfw', v."tags"
FROM "image_providers" p
CROSS JOIN (
  VALUES
    (
      'OOTD mirror selfie',
      'Outfit-of-the-day mirror selfie across rooms and styles.',
      'sidney_sfw, OOTD mirror selfie, {variation:bedroom|hallway|gym} mirror, {variation:casual|polished|athleisure} outfit, soft natural lighting, photorealistic, high quality',
      '3:4',
      ARRAY['ootd','mirror','selfie']
    ),
    (
      'Café aesthetic',
      'Cozy café scene with a latte in varied light.',
      'sidney_sfw, sitting at a café with a latte, {variation:morning|afternoon|golden hour} light, cozy outfit, warm tones, photorealistic, high quality',
      '4:3',
      ARRAY['cafe','lifestyle','cozy']
    ),
    (
      'Beach golden hour',
      'Golden-hour beach selfie with ocean backdrop.',
      'sidney_sfw, beach selfie at golden hour, {variation:summer dress|beachwear|cover-up}, ocean background, warm light, photorealistic, high quality',
      '3:4',
      ARRAY['beach','golden hour','summer']
    ),
    (
      'GRWM vanity',
      'Get-ready-with-me at a vanity under different lighting.',
      'sidney_sfw, getting ready with me at a vanity, {variation:soft pink|warm white|natural daylight} lighting, satin robe, photorealistic, high quality',
      '9:16',
      ARRAY['grwm','vanity','beauty']
    ),
    (
      'Cozy reading nook',
      'Relaxed reading-nook lifestyle shot.',
      'sidney_sfw, curled up in a cozy reading nook with a book, {variation:rainy day|fireplace|string lights} ambiance, oversized sweater, warm tones, photorealistic, high quality',
      '4:3',
      ARRAY['cozy','lifestyle','home']
    ),
    (
      'Studio portrait',
      'Clean studio portrait with controlled lighting.',
      'sidney_sfw, clean studio portrait, {variation:soft key light|rim light|butterfly lighting}, neutral backdrop, {variation:smart casual|monochrome|earth tones} outfit, photorealistic, high quality',
      '1:1',
      ARRAY['portrait','studio','headshot']
    )
) AS v("name","description","template_text","aspect_ratio","tags")
WHERE p."name" = 'Sidney SFW' AND p."type" = 'local_lora' AND p."company_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "prompt_templates" t
    WHERE t."name" = v."name" AND t."persona_id" = p."id"
  );
