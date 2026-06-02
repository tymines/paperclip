CREATE TABLE IF NOT EXISTS "image_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text NOT NULL DEFAULT 'external_api',
  "provider_key" text,
  "endpoint" text,
  "model" text,
  "default_params" jsonb,
  "cost_per_unit" numeric(10, 6) NOT NULL DEFAULT 0,
  "status" text,
  "status_detail" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "image_providers_company_idx" ON "image_providers" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_providers_type_idx" ON "image_providers" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_providers_sort_order_idx" ON "image_providers" ("company_id", "sort_order");--> statement-breakpoint

-- Ensure only one global row per persona name (company_id IS NULL for defaults)
CREATE UNIQUE INDEX IF NOT EXISTS "image_providers_global_persona_name_idx"
  ON "image_providers" ("name", "type")
  WHERE "company_id" IS NULL AND "type" = 'local_lora';--> statement-breakpoint

-- Built-in personas (global — company_id IS NULL means available to all companies)
INSERT INTO "image_providers" ("name", "type", "model", "status", "status_detail", "cost_per_unit", "sort_order")
SELECT 'Sidney SFW', 'local_lora', 'flux-dev-lora-sidney-sfw', 'training', 'training...', '0.000000', 1
WHERE NOT EXISTS (SELECT 1 FROM "image_providers" WHERE "name" = 'Sidney SFW' AND "type" = 'local_lora' AND "company_id" IS NULL);--> statement-breakpoint

INSERT INTO "image_providers" ("name", "type", "model", "status", "status_detail", "cost_per_unit", "sort_order")
SELECT 'Sidney NSFW', 'local_lora', 'flux-dev-lora-sidney-nsfw', 'needs_photos', 'needs 11 more photos', '0.000000', 2
WHERE NOT EXISTS (SELECT 1 FROM "image_providers" WHERE "name" = 'Sidney NSFW' AND "type" = 'local_lora' AND "company_id" IS NULL);--> statement-breakpoint

-- Built-in external providers (global — company_id IS NULL)
INSERT INTO "image_providers" ("name", "type", "model", "provider_key", "endpoint", "cost_per_unit", "sort_order")
SELECT 'Nano Banana', 'external_api', 'gemini-2.5-flash-image', 'google_gemini', 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent', '0.000000', 10
WHERE NOT EXISTS (SELECT 1 FROM "image_providers" WHERE "name" = 'Nano Banana' AND "type" = 'external_api' AND "company_id" IS NULL);--> statement-breakpoint

INSERT INTO "image_providers" ("name", "type", "model", "provider_key", "endpoint", "cost_per_unit", "sort_order")
SELECT 'OpenAI', 'external_api', 'gpt-image-2', 'openai', 'https://api.openai.com/v1/images/generations', '0.040000', 20
WHERE NOT EXISTS (SELECT 1 FROM "image_providers" WHERE "name" = 'OpenAI' AND "type" = 'external_api' AND "company_id" IS NULL);--> statement-breakpoint

INSERT INTO "image_providers" ("name", "type", "model", "provider_key", "endpoint", "cost_per_unit", "sort_order")
SELECT 'BFL Flux', 'external_api', 'flux-pro-1.1', 'replicate', 'https://api.replicate.com/v1/models/black-forest-labs/flux-pro/predictions', '0.050000', 30
WHERE NOT EXISTS (SELECT 1 FROM "image_providers" WHERE "name" = 'BFL Flux' AND "type" = 'external_api' AND "company_id" IS NULL);--> statement-breakpoint

INSERT INTO "image_providers" ("name", "type", "model", "provider_key", "endpoint", "cost_per_unit", "sort_order")
SELECT 'Recraft v3', 'external_api', 'recraft-v3', 'recraft', 'https://external.api.recraft.ai/v1/generate', '0.040000', 40
WHERE NOT EXISTS (SELECT 1 FROM "image_providers" WHERE "name" = 'Recraft v3' AND "type" = 'external_api' AND "company_id" IS NULL);--> statement-breakpoint

INSERT INTO "image_providers" ("name", "type", "model", "provider_key", "endpoint", "cost_per_unit", "sort_order")
SELECT 'Ideogram v2', 'external_api', 'ideogram-v2', 'ideogram', 'https://api.ideogram.ai/generate', '0.050000', 50
WHERE NOT EXISTS (SELECT 1 FROM "image_providers" WHERE "name" = 'Ideogram v2' AND "type" = 'external_api' AND "company_id" IS NULL);
