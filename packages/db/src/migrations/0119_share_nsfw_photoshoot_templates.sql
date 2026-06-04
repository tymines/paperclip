-- Make the NSFW PhotoShoot category templates shared (persona_id NULL) so the
-- inline workbench's 18+ toggle reveals them on any Sidney card — the SFW and
-- NSFW Sidney rows are the same subject (two LoRA tiers), so the spicy category
-- catalog should be discoverable from either. SFW-toggle still hides them.
-- Idempotent.
UPDATE "prompt_templates"
SET "persona_id" = NULL
WHERE "category" = 'photoshoot' AND "content_rating" = 'explicit' AND "persona_id" IS NOT NULL;
