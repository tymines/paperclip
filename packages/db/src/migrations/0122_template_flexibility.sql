-- Template flexibility: a single prompt_template can target multiple tools and
-- hint which models its prompt is known to work well on.
--
-- applicable_tools  — which Image Studio tools a template shows up in
--   ('photoshoot' | 'persona_generate' | 'external_image_gen' | future tools).
-- compatible_models — model ids (see ui models.ts) the prompt works well on;
--   used to rank "Recommended" first in the template-click model picker. A hint,
--   not a gate. Idempotent.

ALTER TABLE "prompt_templates"
  ADD COLUMN IF NOT EXISTS "applicable_tools" text[] DEFAULT ARRAY['photoshoot']::text[],
  ADD COLUMN IF NOT EXISTS "compatible_models" text[] DEFAULT ARRAY[]::text[];--> statement-breakpoint

-- Structured templates (non-empty attribute_preset) also drive the persona
-- Generate composer, so they belong to both tools.
UPDATE "prompt_templates"
  SET "applicable_tools" = ARRAY['persona_generate','photoshoot']
  WHERE "attribute_preset" IS NOT NULL AND "attribute_preset" <> '{}'::jsonb
    AND NOT ('persona_generate' = ANY("applicable_tools"));--> statement-breakpoint

-- All existing templates are Sidney-LoRA prompts → recommend the persona LoRA
-- ("general" model) by default.
UPDATE "prompt_templates"
  SET "compatible_models" = ARRAY['general']
  WHERE "compatible_models" IS NULL OR "compatible_models" = ARRAY[]::text[];--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_templates_applicable_tools"
  ON "prompt_templates" USING GIN ("applicable_tools");
