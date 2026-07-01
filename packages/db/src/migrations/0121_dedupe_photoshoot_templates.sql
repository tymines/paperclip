-- Self-healing dedupe for PhotoShoot category templates.
--
-- 0118 seeds the NSFW categories scoped to the Sidney NSFW persona (NOT EXISTS
-- guard keyed on persona_id); 0119 then nulls their persona_id to share them.
-- If 0118 re-runs after 0119 (migrations replayed), its guard no longer matches
-- the now-NULL rows and it re-inserts → duplicate cards. Running this LAST in the
-- chain collapses any (name, content_rating, persona_id) duplicates to the
-- lowest id. Idempotent: a second run finds nothing to delete.
DELETE FROM "prompt_templates" a
USING "prompt_templates" b
WHERE a."category" = 'photoshoot'
  AND b."category" = 'photoshoot'
  AND a."name" = b."name"
  AND a."content_rating" = b."content_rating"
  AND a."persona_id" IS NOT DISTINCT FROM b."persona_id"
  AND a."id" > b."id";
