-- Structured controls for the Image Studio Generate panel (ZenCreator parity).
--
-- Tyler wants click-to-build attribute controls (Pose / Hair / Body / Outfit /
-- Scene / Lighting) that compile into a Flux LoRA prompt under the hood, plus a
-- per-persona long-form bio that gets prepended as prompt context.
--
-- This migration is data-driven: the UI renders whatever lives in
-- attribute_controls + attribute_options, so new controls/options ship as rows,
-- not code. Idempotent throughout (IF NOT EXISTS / ON CONFLICT / NOT EXISTS).

-- ── Persona bio + structured attribute defaults ─────────────────────────────
ALTER TABLE "image_providers"
  ADD COLUMN IF NOT EXISTS "bio" text,
  ADD COLUMN IF NOT EXISTS "attributes" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint

-- ── Structured control catalog ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "attribute_controls" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text NOT NULL UNIQUE,
  "label" text NOT NULL,
  "control_type" text NOT NULL
    CHECK ("control_type" IN ('toggle','slider','swatch','card_grid')),
  "category" text NOT NULL
    CHECK ("category" IN ('identity','body','face','pose','wardrobe','scene','lighting')),
  "prompt_template" text NOT NULL,
  "helper_text" text,
  "sort_order" integer DEFAULT 0,
  "applicable_to" jsonb,
  "enabled" boolean DEFAULT TRUE
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "attribute_options" (
  "id" serial PRIMARY KEY NOT NULL,
  "control_id" integer REFERENCES "attribute_controls"("id") ON DELETE CASCADE,
  "value" text NOT NULL,
  "label" text NOT NULL,
  "prompt_fragment" text NOT NULL,
  "preview_image_path" text,
  "sort_order" integer DEFAULT 0,
  "enabled" boolean DEFAULT TRUE,
  "content_rating" text DEFAULT 'sfw'
    CHECK ("content_rating" IN ('sfw','explicit'))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_attribute_options_control"
  ON "attribute_options" ("control_id", "sort_order");--> statement-breakpoint

-- ── Extend prompt_templates for structured-attribute presets + library cats ──
ALTER TABLE "prompt_templates"
  ADD COLUMN IF NOT EXISTS "attribute_preset" jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "preview_image_path" text,
  ADD COLUMN IF NOT EXISTS "category" text,
  ADD COLUMN IF NOT EXISTS "gender_targeting" text DEFAULT 'any';--> statement-breakpoint

-- ── Seed: attribute_controls (6) ────────────────────────────────────────────
INSERT INTO "attribute_controls"
  ("key","label","control_type","category","prompt_template","helper_text","sort_order")
VALUES
  ('hairstyle','Hairstyle','card_grid','face','{value}',NULL,20),
  ('body_type','Body Type','card_grid','body','{value}',
    'Influences body proportions in the generation. The trained LoRA constrains the face — body type can still be styled.',10),
  ('pose','Pose','card_grid','pose','{value}',NULL,30),
  ('outfit','Outfit','card_grid','wardrobe','{value}',NULL,40),
  ('scene','Setting','card_grid','scene','{value}',NULL,50),
  ('lighting','Lighting','swatch','lighting','{value}',NULL,60)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- ── Seed: attribute_options (42 = 7+6+8+8+7+6) ──────────────────────────────
-- Hairstyle (7)
INSERT INTO "attribute_options" ("control_id","value","label","prompt_fragment","sort_order","content_rating")
SELECT c."id", v."value", v."label", v."frag", v."ord", 'sfw'
FROM "attribute_controls" c
CROSS JOIN (VALUES
  ('wavy_long',    'Long Wavy',     'long wavy hair flowing past her shoulders', 10),
  ('ponytail',     'Ponytail',      'hair pulled back in a high ponytail',       20),
  ('bun',          'Bun',           'hair tied up in a casual messy bun',        30),
  ('braid',        'Braid',         'hair in a single side braid',               40),
  ('straight_long','Long Straight', 'long straight hair, sleek and polished',    50),
  ('short_bob',    'Short Bob',     'short bob cut, chin-length',                60),
  ('space_buns',   'Space Buns',    'hair in playful double buns',               70)
) AS v("value","label","frag","ord")
WHERE c."key" = 'hairstyle'
  AND NOT EXISTS (SELECT 1 FROM "attribute_options" o WHERE o."control_id" = c."id" AND o."value" = v."value");--> statement-breakpoint

-- Body Type (6)
INSERT INTO "attribute_options" ("control_id","value","label","prompt_fragment","sort_order","content_rating")
SELECT c."id", v."value", v."label", v."frag", v."ord", 'sfw'
FROM "attribute_controls" c
CROSS JOIN (VALUES
  ('slim',     'Slim',      'slim, slender build',                  10),
  ('athletic', 'Athletic',  'fit athletic build with visible tone', 20),
  ('average',  'Average',   'average natural body proportions',     30),
  ('curvy',    'Curvy',     'curvy hourglass figure',               40),
  ('thick',    'Thick',     'thick curvy build with fuller hips',   50),
  ('plus',     'Plus Size', 'plus size, fuller figure',             60)
) AS v("value","label","frag","ord")
WHERE c."key" = 'body_type'
  AND NOT EXISTS (SELECT 1 FROM "attribute_options" o WHERE o."control_id" = c."id" AND o."value" = v."value");--> statement-breakpoint

-- Pose (8)
INSERT INTO "attribute_options" ("control_id","value","label","prompt_fragment","sort_order","content_rating")
SELECT c."id", v."value", v."label", v."frag", v."ord", 'sfw'
FROM "attribute_controls" c
CROSS JOIN (VALUES
  ('standing',      'Standing',        'standing confidently facing the camera',           10),
  ('sitting',       'Sitting',         'sitting casually, relaxed posture',                20),
  ('lying_side',    'Lying on Side',   'lying on her side, propped on one elbow',          30),
  ('over_shoulder', 'Over Shoulder',   'looking back over her shoulder at the camera',     40),
  ('mirror_selfie', 'Mirror Selfie',   'taking a mirror selfie with her phone',            50),
  ('walking',       'Walking',         'caught mid-stride walking, candid motion',         60),
  ('leaning_wall',  'Leaning on Wall', 'leaning against a wall, hip cocked',               70),
  ('hands_in_hair', 'Hands in Hair',   'hands running through her hair, head tilted back', 80)
) AS v("value","label","frag","ord")
WHERE c."key" = 'pose'
  AND NOT EXISTS (SELECT 1 FROM "attribute_options" o WHERE o."control_id" = c."id" AND o."value" = v."value");--> statement-breakpoint

-- Outfit (8 — last two rated explicit)
INSERT INTO "attribute_options" ("control_id","value","label","prompt_fragment","sort_order","content_rating")
SELECT c."id", v."value", v."label", v."frag", v."ord", v."rating"
FROM "attribute_controls" c
CROSS JOIN (VALUES
  ('casual_jeans',    'Jeans + Tank',    'fitted jeans and a cropped tank top',              10, 'sfw'),
  ('athleisure',      'Athleisure',      'matching athleisure set, sports bra and leggings', 20, 'sfw'),
  ('sundress',        'Sundress',        'flowing summer sundress',                          30, 'sfw'),
  ('going_out_dress', 'Going-out Dress', 'fitted black mini dress, going-out aesthetic',     40, 'sfw'),
  ('cozy_sweater',    'Cozy Sweater',    'oversized cozy knit sweater',                      50, 'sfw'),
  ('bikini',          'Bikini',          'matching bikini set',                              60, 'sfw'),
  ('lingerie',        'Lingerie',        'satin lingerie set',                               70, 'explicit'),
  ('robe',            'Robe',            'silk robe loosely tied',                           80, 'explicit')
) AS v("value","label","frag","ord","rating")
WHERE c."key" = 'outfit'
  AND NOT EXISTS (SELECT 1 FROM "attribute_options" o WHERE o."control_id" = c."id" AND o."value" = v."value");--> statement-breakpoint

-- Scene (7)
INSERT INTO "attribute_options" ("control_id","value","label","prompt_fragment","sort_order","content_rating")
SELECT c."id", v."value", v."label", v."frag", v."ord", 'sfw'
FROM "attribute_controls" c
CROSS JOIN (VALUES
  ('bedroom',     'Bedroom',     'in a sunlit bedroom',                10),
  ('gym',         'Gym',         'in a modern boutique gym',           20),
  ('beach',       'Beach',       'on a beach at golden hour',          30),
  ('cafe',        'Café',        'sitting at a cozy café table',       40),
  ('street',      'Street',      'on a city street, urban backdrop',   50),
  ('rooftop',     'Rooftop',     'on a rooftop overlooking a skyline', 60),
  ('mirror_room', 'Mirror Room', 'in front of a full-length mirror',   70)
) AS v("value","label","frag","ord")
WHERE c."key" = 'scene'
  AND NOT EXISTS (SELECT 1 FROM "attribute_options" o WHERE o."control_id" = c."id" AND o."value" = v."value");--> statement-breakpoint

-- Lighting (6)
INSERT INTO "attribute_options" ("control_id","value","label","prompt_fragment","sort_order","content_rating")
SELECT c."id", v."value", v."label", v."frag", v."ord", 'sfw'
FROM "attribute_controls" c
CROSS JOIN (VALUES
  ('soft_natural', 'Soft Natural', 'soft natural daylight',         10),
  ('golden_hour',  'Golden Hour',  'warm golden hour light',        20),
  ('studio',       'Studio',       'clean studio lighting',         30),
  ('neon_night',   'Neon Night',   'moody neon nightlife lighting', 40),
  ('window_light', 'Window Light', 'window light streaming in',     50),
  ('candlelit',    'Candlelit',    'warm candlelit ambiance',       60)
) AS v("value","label","frag","ord")
WHERE c."key" = 'lighting'
  AND NOT EXISTS (SELECT 1 FROM "attribute_options" o WHERE o."control_id" = c."id" AND o."value" = v."value");--> statement-breakpoint

-- ── Seed: 8 SFW structured starter templates (attribute_preset populated) ────
-- Tied to the Sidney SFW persona, mirroring 0115's seed pattern. NSFW templates
-- are intentionally NOT seeded — Tyler creates those through the UI. Each row's
-- attribute_preset references seeded attribute_options values; the assembler
-- compiles them at generate time. Idempotent on (name, persona_id).
INSERT INTO "prompt_templates"
  ("name","description","persona_id","template_text","attribute_preset","category",
   "gender_targeting","default_lora_scale","default_steps","default_guidance",
   "default_aspect_ratio","content_rating","tags")
SELECT v."name", v."description", p."id", v."template_text", v."attribute_preset"::jsonb,
       v."category", 'female', 1.0, 28, 3.5, v."aspect_ratio", 'sfw', v."tags"
FROM "image_providers" p
CROSS JOIN (
  VALUES
    ('Mirror Selfie','Classic phone mirror selfie in a sunlit bedroom.',
     'taking a mirror selfie with her phone, fitted jeans and a cropped tank top, in a sunlit bedroom, window light streaming in',
     '{"pose":"mirror_selfie","outfit":"casual_jeans","scene":"bedroom","lighting":"window_light"}',
     'mirror','3:4', ARRAY['mirror','selfie','ootd']),
    ('OOTD','Outfit-of-the-day full-length look.',
     'standing confidently facing the camera, fitted black mini dress, going-out aesthetic, in front of a full-length mirror, soft natural daylight',
     '{"pose":"standing","outfit":"going_out_dress","scene":"mirror_room","lighting":"soft_natural"}',
     'ootd','3:4', ARRAY['ootd','fashion']),
    ('Café','Cozy café moment with a latte.',
     'sitting casually, relaxed posture, oversized cozy knit sweater, sitting at a cozy café table, soft natural daylight',
     '{"pose":"sitting","outfit":"cozy_sweater","scene":"cafe","lighting":"soft_natural"}',
     'cafe','4:3', ARRAY['cafe','lifestyle','cozy']),
    ('Beach','Golden-hour beach walk in a bikini.',
     'caught mid-stride walking, candid motion, matching bikini set, on a beach at golden hour, warm golden hour light',
     '{"pose":"walking","outfit":"bikini","scene":"beach","lighting":"golden_hour"}',
     'beach','3:4', ARRAY['beach','summer','golden hour']),
    ('Gym','Boutique-gym athleisure shot.',
     'standing confidently facing the camera, matching athleisure set, sports bra and leggings, in a modern boutique gym, clean studio lighting',
     '{"pose":"standing","outfit":"athleisure","scene":"gym","lighting":"studio"}',
     'gym','3:4', ARRAY['gym','fitness','athleisure']),
    ('GRWM','Get-ready-with-me at the mirror.',
     'hands running through her hair, head tilted back, long wavy hair flowing past her shoulders, in front of a full-length mirror, soft natural daylight',
     '{"hairstyle":"wavy_long","pose":"hands_in_hair","scene":"mirror_room","lighting":"soft_natural"}',
     'grwm','9:16', ARRAY['grwm','beauty']),
    ('Cozy Home','Candlelit cozy-home evening.',
     'sitting casually, relaxed posture, oversized cozy knit sweater, in a sunlit bedroom, warm candlelit ambiance',
     '{"pose":"sitting","outfit":"cozy_sweater","scene":"bedroom","lighting":"candlelit"}',
     'cozy','4:3', ARRAY['cozy','home','lifestyle']),
    ('Going Out','Neon-lit going-out night look.',
     'leaning against a wall, hip cocked, fitted black mini dress, going-out aesthetic, on a city street, urban backdrop, moody neon nightlife lighting',
     '{"pose":"leaning_wall","outfit":"going_out_dress","scene":"street","lighting":"neon_night"}',
     'going_out','3:4', ARRAY['going out','night','fashion'])
) AS v("name","description","template_text","attribute_preset","category","aspect_ratio","tags")
WHERE p."name" = 'Sidney SFW' AND p."type" = 'local_lora' AND p."company_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "prompt_templates" t WHERE t."name" = v."name" AND t."persona_id" = p."id"
  );--> statement-breakpoint

-- ── Sync Sidney's bio + structured attribute defaults (one-time data migration) ──
-- Merged bio: physical description from the ZenCreator walkthrough (consistent
-- visual outputs) + age/brand positioning from the Paperclip persona file (22,
-- thirst-trap-coded but cute). attributes pre-fill the Generate panel controls.
UPDATE "image_providers"
SET
  "bio" = 'Sidney is a 22-year-old lifestyle and swimwear model based in Miami, originally from Savannah, Georgia. She has long honey-blonde wavy beach-textured hair with sun-kissed highlights, striking blue-green eyes, golden tanned skin with light natural freckles across her nose and cheeks, and an athletic, slim-toned body. She has full natural pink lips, a defined jawline, and high cheekbones, and wears minimal jewelry — small gold stud earrings and a thin delicate gold chain necklace. Her aesthetic is thirst-trap-coded but cute: aspirational, sun-soaked, and effortlessly glamorous, leaning into beach days, rooftop golden hours, and cozy at-home moments rather than a campus vibe. She reads as the girl-next-door turned influencer — confident, warm, and a little flirty, always polished but never trying too hard.',
  "attributes" = jsonb_build_object(
    'gender','female','age',22,'ethnicity','european','body_type','athletic',
    'hair_color','honey_blonde','default_hairstyle','wavy_long','eye_color','blue',
    'trigger_word','sidney_sfw'
  )
WHERE "name" = 'Sidney SFW' AND "type" = 'local_lora' AND "company_id" IS NULL;--> statement-breakpoint

UPDATE "image_providers"
SET
  "bio" = 'Sidney is a 22-year-old lifestyle and swimwear model based in Miami, originally from Savannah, Georgia. She has long honey-blonde wavy beach-textured hair with sun-kissed highlights, striking blue-green eyes, golden tanned skin with light natural freckles across her nose and cheeks, and an athletic, slim-toned body. She has full natural pink lips, a defined jawline, and high cheekbones, and wears minimal jewelry — small gold stud earrings and a thin delicate gold chain necklace. Her aesthetic is thirst-trap-coded but cute: aspirational, sun-soaked, and effortlessly glamorous, leaning into beach days, rooftop golden hours, and cozy at-home moments rather than a campus vibe. She reads as the girl-next-door turned influencer — confident, warm, and a little flirty, always polished but never trying too hard.',
  "attributes" = jsonb_build_object(
    'gender','female','age',22,'ethnicity','european','body_type','athletic',
    'hair_color','honey_blonde','default_hairstyle','wavy_long','eye_color','blue',
    'trigger_word','sidney_nsfw'
  )
WHERE "name" = 'Sidney NSFW' AND "type" = 'local_lora' AND "company_id" IS NULL;
