-- Regenerate low-quality / mismatched SFW PhotoShoot preview thumbnails.
--
-- A visual audit of the unified Image Studio surface flagged three SFW
-- PhotoShoot category cards whose preview did not represent the category:
--   • Cinematic    — original render showed a male figure as the dominant
--                    subject; Sidney was barely visible.
--   • Circus       — original render was an empty red stage curtain with no
--                    subject at all.
--   • Mirror Selfie — never had a preview (preview_image_path was NULL), so the
--                    card rendered a gradient placeholder.
--
-- Each was re-fired against the persona's own published Replicate model
-- (tymines/sidney-sfw) at 28 inference steps / 1024x1024 with a "sole subject"
-- anchor, and the result saved alongside the original as <key>_v2.png under
-- <uploads>/attribute-previews/sfw/photoshoot/. This migration repoints the DB
-- at the v2 assets. The PNGs themselves are delivered out-of-band (uploads dir /
-- ingest-photoshoot-previews.mjs), matching how 0118/0120 seeded the originals.
--
-- Scoped to content_rating = 'sfw' so the NSFW lane (owned separately) is
-- untouched. Idempotent: a second run rewrites the same paths.
UPDATE "prompt_templates"
   SET "preview_image_path" = 'attribute-previews/sfw/photoshoot/cinematic_v2.png'
 WHERE "name" = 'Cinematic' AND "content_rating" = 'sfw';

UPDATE "prompt_templates"
   SET "preview_image_path" = 'attribute-previews/sfw/photoshoot/circus_v2.png'
 WHERE "name" = 'Circus' AND "content_rating" = 'sfw';

UPDATE "prompt_templates"
   SET "preview_image_path" = 'attribute-previews/sfw/photoshoot/mirror_selfie_v2.png'
 WHERE "name" = 'Mirror Selfie' AND "content_rating" = 'sfw';
