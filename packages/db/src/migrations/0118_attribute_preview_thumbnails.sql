-- Wire curated preview thumbnails onto every structured-control option + seed
-- the NSFW (and remaining SFW) PhotoShoot category templates.
--
-- The PNGs themselves live under the instance uploads dir
-- (<uploads>/attribute-previews/<sfw|nsfw>/<category>/<value>.png), served at
-- /api/uploads/... — same convention as persona gallery images. Paths stored
-- here are RELATIVE to the uploads root (the UI prepends /api/uploads/). Note
-- the disk folder differs from the control key for two controls: hairstyle→hair,
-- body_type→body. Idempotent throughout.

-- ── 1. attribute_options.preview_image_path (42 options) ────────────────────
UPDATE "attribute_options" o SET "preview_image_path" = 'attribute-previews/sfw/hair/' || o."value" || '.png'
FROM "attribute_controls" c WHERE o."control_id" = c."id" AND c."key" = 'hairstyle';--> statement-breakpoint
UPDATE "attribute_options" o SET "preview_image_path" = 'attribute-previews/sfw/body/' || o."value" || '.png'
FROM "attribute_controls" c WHERE o."control_id" = c."id" AND c."key" = 'body_type';--> statement-breakpoint
UPDATE "attribute_options" o SET "preview_image_path" = 'attribute-previews/sfw/pose/' || o."value" || '.png'
FROM "attribute_controls" c WHERE o."control_id" = c."id" AND c."key" = 'pose';--> statement-breakpoint
UPDATE "attribute_options" o SET "preview_image_path" = 'attribute-previews/sfw/scene/' || o."value" || '.png'
FROM "attribute_controls" c WHERE o."control_id" = c."id" AND c."key" = 'scene';--> statement-breakpoint
UPDATE "attribute_options" o SET "preview_image_path" = 'attribute-previews/sfw/lighting/' || o."value" || '.png'
FROM "attribute_controls" c WHERE o."control_id" = c."id" AND c."key" = 'lighting';--> statement-breakpoint
-- Outfit: SFW options live under sfw/outfit, explicit (lingerie/robe) under nsfw/outfit.
UPDATE "attribute_options" o SET "preview_image_path" = 'attribute-previews/sfw/outfit/' || o."value" || '.png'
FROM "attribute_controls" c WHERE o."control_id" = c."id" AND c."key" = 'outfit' AND o."content_rating" = 'sfw';--> statement-breakpoint
UPDATE "attribute_options" o SET "preview_image_path" = 'attribute-previews/nsfw/outfit/' || o."value" || '.png'
FROM "attribute_controls" c WHERE o."control_id" = c."id" AND c."key" = 'outfit' AND o."content_rating" = 'explicit';--> statement-breakpoint

-- ── 2. Update the 7 SFW starter templates that have a PhotoShoot preview ─────
UPDATE "prompt_templates" t SET "preview_image_path" = v."path"
FROM "image_providers" p, (VALUES
  ('OOTD','attribute-previews/sfw/photoshoot/ootd.png'),
  ('Café','attribute-previews/sfw/photoshoot/cafe.png'),
  ('Beach','attribute-previews/sfw/photoshoot/beach.png'),
  ('GRWM','attribute-previews/sfw/photoshoot/grwm_vanity.png'),
  ('Gym','attribute-previews/sfw/photoshoot/gym_fit.png'),
  ('Going Out','attribute-previews/sfw/photoshoot/going_out.png'),
  ('Cozy Home','attribute-previews/sfw/photoshoot/cozy_home.png')
) AS v("name","path")
WHERE t."name" = v."name" AND t."persona_id" = p."id"
  AND p."name" = 'Sidney SFW' AND p."type" = 'local_lora' AND p."company_id" IS NULL;--> statement-breakpoint

-- ── 3. Insert 3 new SFW PhotoShoot category templates (Sidney SFW) ───────────
INSERT INTO "prompt_templates"
  ("name","persona_id","template_text","attribute_preset","preview_image_path","category",
   "gender_targeting","default_lora_scale","default_steps","default_guidance","default_aspect_ratio","content_rating")
SELECT v."name", p."id", v."prompt", '{}'::jsonb, v."path", 'photoshoot', 'female', 1.0, 28, 3.5, '3:4', 'sfw'
FROM "image_providers" p
CROSS JOIN (VALUES
  ('Portrait','sidney_sfw, soft natural portrait close-up, minimal makeup, gentle smile, soft daylight, plain background, photorealistic, high quality','attribute-previews/sfw/photoshoot/portrait.png'),
  ('Travel','sidney_sfw, candid travel shot at a scenic overlook, casual layered outfit, golden hour, photorealistic, high quality','attribute-previews/sfw/photoshoot/travel.png'),
  ('Winter','sidney_sfw, winter scene with snow, cream chunky knit sweater and boots, golden afternoon light, photorealistic, high quality','attribute-previews/sfw/photoshoot/winter.png')
) AS v("name","prompt","path")
WHERE p."name" = 'Sidney SFW' AND p."type" = 'local_lora' AND p."company_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "prompt_templates" t WHERE t."name" = v."name" AND t."persona_id" = p."id");--> statement-breakpoint

-- ── 4. Insert 12 NSFW PhotoShoot category templates (Sidney NSFW) ────────────
INSERT INTO "prompt_templates"
  ("name","persona_id","template_text","attribute_preset","preview_image_path","category",
   "gender_targeting","default_lora_scale","default_steps","default_guidance","default_aspect_ratio","content_rating")
SELECT v."name", p."id", v."prompt", '{}'::jsonb, v."path", 'photoshoot', 'female', 1.0, 28, 3.5, '1:1', 'explicit'
FROM "image_providers" p
CROSS JOIN (VALUES
  ('Cosplay','sidney_nsfw, posing in cosplay costume, anime character inspired style, playful expression, studio lighting, photorealistic, high quality','attribute-previews/nsfw/cosplay/cosplay.png'),
  ('Beach & Pool','sidney_nsfw, at poolside wearing stylish bikini, sunny resort setting, turquoise water background, photorealistic, high quality','attribute-previews/nsfw/beach_pool/beach_pool.png'),
  ('Bikini','sidney_nsfw, wearing a fashionable bikini, beach at golden hour, full body shot, soft sunset lighting, photorealistic, high quality','attribute-previews/nsfw/bikini/bikini.png'),
  ('Maid','sidney_nsfw, wearing a french maid outfit, elegant pose in bedroom, soft dim lighting, photorealistic, high quality','attribute-previews/nsfw/maid/maid.png'),
  ('Dark Aesthetics','sidney_nsfw, gothic aesthetic, dark leather and lace, moody dim lighting, dramatic shadows, intense expression, photorealistic, high quality','attribute-previews/nsfw/dark_aesthetics/dark_aesthetics.png'),
  ('Leather','sidney_nsfw, wearing tight leather outfit, edgy pose, dark studio background, dramatic spotlight, photorealistic, high quality','attribute-previews/nsfw/leather/leather.png'),
  ('Outdoor Tease','sidney_nsfw, in secluded garden setting, suggestive pose, natural sunlight filtering through trees, photorealistic, high quality','attribute-previews/nsfw/outdoor_tease/outdoor_tease.png'),
  ('Office','sidney_nsfw, office setting, secretary aesthetic, desk with papers, business attire, professional lighting, photorealistic, high quality','attribute-previews/nsfw/office/office.png'),
  ('Pure Nude','sidney_nsfw, artistic nude study, clean minimalist aesthetic, soft diffused lighting, tasteful composition, photorealistic, high quality','attribute-previews/nsfw/pure_nude/pure_nude.png'),
  ('Tease','sidney_nsfw, suggestive pose on bed, partially clothed, flirtatious expression, bedroom setting, warm lighting, photorealistic, high quality','attribute-previews/nsfw/tease/tease.png'),
  ('Sensual Touch','sidney_nsfw, intimate boudoir close-up, sensual touch, soft warm lighting, cropped composition, photorealistic, high quality','attribute-previews/nsfw/sensual_touch/sensual_touch.png'),
  ('Boudoir','sidney_nsfw, classic boudoir shoot on satin sheets, intimate setting, warm golden lighting, soft focus, photorealistic, high quality','attribute-previews/nsfw/boudoir/boudoir.png')
) AS v("name","prompt","path")
WHERE p."name" = 'Sidney NSFW' AND p."type" = 'local_lora' AND p."company_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "prompt_templates" t WHERE t."name" = v."name" AND t."persona_id" = p."id");
