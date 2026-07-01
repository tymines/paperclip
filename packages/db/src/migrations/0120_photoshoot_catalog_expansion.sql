-- Expand the PhotoShoot catalog toward ZenCreator parity: +22 SFW categories on
-- Sidney SFW, and a multi-preview carousel column.
--
-- preview_image_paths (JSONB array) backs the per-card preview carousel; the UI
-- falls back to the single preview_image_path when the array is empty. Preview
-- PNGs are rendered via tymines/sidney-sfw and copied into the uploads dir
-- (attribute-previews/sfw/photoshoot/<key>.png), same convention as 0118.
-- Idempotent throughout.

ALTER TABLE "prompt_templates"
  ADD COLUMN IF NOT EXISTS "preview_image_paths" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint

INSERT INTO "prompt_templates"
  ("name","persona_id","template_text","attribute_preset","preview_image_path","category",
   "gender_targeting","default_lora_scale","default_steps","default_guidance","default_aspect_ratio","content_rating")
SELECT v."name", p."id", v."prompt", '{}'::jsonb, v."path", 'photoshoot', 'female', 1.0, 28, 3.5, '3:4', 'sfw'
FROM "image_providers" p
CROSS JOIN (VALUES
  ('Fashion','sidney_sfw, high fashion editorial pose, designer outfit, studio lighting, magazine cover aesthetic, photorealistic, high quality','attribute-previews/sfw/photoshoot/fashion.png'),
  ('Selfie','sidney_sfw, casual self-shot selfie, natural smile, soft daylight, indoor home setting, photorealistic, high quality','attribute-previews/sfw/photoshoot/selfie.png'),
  ('Casual','sidney_sfw, casual everyday outfit jeans and tee, relaxed pose, natural lighting, photorealistic, high quality','attribute-previews/sfw/photoshoot/casual.png'),
  ('Night Out','sidney_sfw, going out outfit fitted dress, downtown nightlife backdrop, neon and city lights, evening glamour, photorealistic, high quality','attribute-previews/sfw/photoshoot/night_out.png'),
  ('Street Style','sidney_sfw, street style fashion shot, layered urban outfit, candid mid-stride city sidewalk, golden hour, photorealistic, high quality','attribute-previews/sfw/photoshoot/street_style.png'),
  ('Cinematic','sidney_sfw, cinematic movie still, dramatic lighting, narrative composition, film grain texture, moody atmosphere, photorealistic, high quality','attribute-previews/sfw/photoshoot/cinematic.png'),
  ('Professional','sidney_sfw, professional headshot business attire, soft studio lighting, neutral background, confident expression, photorealistic, high quality','attribute-previews/sfw/photoshoot/professional.png'),
  ('Anime Style','sidney_sfw, anime aesthetic styling, vibrant colorful outfit, Tokyo street backdrop, soft anime-inspired lighting, photorealistic, high quality','attribute-previews/sfw/photoshoot/anime_style.png'),
  ('Cabaret','sidney_sfw, cabaret performer styling, vintage glam outfit and top hat, dim stage lighting, theatrical pose, photorealistic, high quality','attribute-previews/sfw/photoshoot/cabaret.png'),
  ('High Fashion','sidney_sfw, high fashion runway look, avant-garde designer piece, stark studio lighting, editorial composition, photorealistic, high quality','attribute-previews/sfw/photoshoot/high_fashion.png'),
  ('Old Money','sidney_sfw, old money aesthetic, tailored blazer and tennis skirt, country club setting, soft golden afternoon light, photorealistic, high quality','attribute-previews/sfw/photoshoot/old_money.png'),
  ('Japan Aesthetic','sidney_sfw, Japan-inspired styling, kimono-influenced outfit, traditional architecture or Tokyo neon backdrop, photorealistic, high quality','attribute-previews/sfw/photoshoot/japan_aesthetic.png'),
  ('Barbie','sidney_sfw, Barbie-core pink aesthetic, glossy pink outfit, pink studio backdrop, playful pose, photorealistic, high quality','attribute-previews/sfw/photoshoot/barbie.png'),
  ('Vintage Hollywood','sidney_sfw, vintage Hollywood glamour, classic black-and-white-inspired styling, satin gown, dramatic lighting, photorealistic, high quality','attribute-previews/sfw/photoshoot/vintage_hollywood.png'),
  ('Profile Photos','sidney_sfw, polished profile photo headshot, neutral clean background, soft studio lighting, professional expression, photorealistic, high quality','attribute-previews/sfw/photoshoot/profile_photos.png'),
  ('Superhero Cosplay','sidney_sfw, superhero cosplay outfit, dynamic action pose, city skyline backdrop, dramatic lighting, photorealistic, high quality','attribute-previews/sfw/photoshoot/superhero_cosplay.png'),
  ('Professions','sidney_sfw, professional uniform stewardess outfit, airplane cabin or office setting, soft daylight, photorealistic, high quality','attribute-previews/sfw/photoshoot/professions.png'),
  ('Carnival','sidney_sfw, carnival samba dancer costume feathered headpiece, vibrant outdoor festival lights, photorealistic, high quality','attribute-previews/sfw/photoshoot/carnival.png'),
  ('Circus','sidney_sfw, circus performer styling vintage red and white stripes, dramatic stage curtain backdrop, photorealistic, high quality','attribute-previews/sfw/photoshoot/circus.png'),
  ('Auto','sidney_sfw, automotive lifestyle shot, leaning on luxury car, golden hour, casual chic outfit, photorealistic, high quality','attribute-previews/sfw/photoshoot/auto_sfw.png'),
  ('With Animals','sidney_sfw, with a horse outdoor scenic mountains, casual cozy outfit, golden afternoon light, candid moment, photorealistic, high quality','attribute-previews/sfw/photoshoot/with_animals.png'),
  ('Birthday Girl','sidney_sfw, birthday girl celebration outfit, sparklers and pastel decor, indoor warm party lighting, joyful expression, photorealistic, high quality','attribute-previews/sfw/photoshoot/birthday_girl.png')
) AS v("name","prompt","path")
WHERE p."name" = 'Sidney SFW' AND p."type" = 'local_lora' AND p."company_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "prompt_templates" t WHERE t."name" = v."name" AND t."persona_id" = p."id");
