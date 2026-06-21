-- Add the Raven persona (global built-in) to the Image Studio CMS.
--
-- Raven is a production-proven SFW persona: her LoRA (tymines/raven-sfw, trigger
-- 'ravenpersona') is trained, published, and rendering on Replicate, layered
-- with an XLabs realism LoRA (extra_lora_scale 0.6) for photoreal skin — the
-- proven "v6" pipeline. This wires that pipeline into Paperclip so Tyler can
-- generate Raven straight from the browser.
--
-- Maps onto the existing image_providers schema — NO new columns:
--   endpoint        → tymines/raven-sfw (the persona's own published model; the
--                     generator resolves its latest version SHA at submit time)
--   attributes      → trigger_word + identity defaults the prompt assembler
--                     pre-fills into the Generate panel
--   default_params  → locked generation config the generator auto-applies:
--                     positive/negative prompt templates, the realism extra-LoRA
--                     + scales, steps/guidance, content_rating.
--
-- replicate-generator.ts reads default_params.positive_template, extra_lora and
-- extra_lora_scale and folds them into every render. The negative_template is
-- stored for record / future portability but NOT sent to flux-dev-lora (that
-- model's input schema has no negative_prompt field — passing it would 422).
--
-- Idempotent on (name='Raven', type='local_lora', company_id IS NULL).
INSERT INTO "image_providers" (
  "name", "type", "provider_host", "endpoint", "model",
  "status", "status_detail", "bio", "attributes", "default_params",
  "avatar_path", "cost_per_unit", "sort_order"
)
SELECT
  'Raven',
  'local_lora',
  'replicate',
  'tymines/raven-sfw',
  'flux-dev',
  'ready',
  'LoRA trained — ready for generation.',
  'Raven is a gothic, edgy, dark-aesthetic AI persona. Jet-black glossy hair, pale fair skin, alternative high-fashion styling and a dark editorial mood.',
  jsonb_build_object(
    'gender', 'female',
    'hair_color', 'black',
    'default_hairstyle', 'long_straight',
    'brand_vibe', 'gothic / edgy / dark-aesthetic',
    'trigger_word', 'ravenpersona'
  ),
  jsonb_build_object(
    'content_rating', 'sfw',
    'lora_scale', 1.0,
    'extra_lora', 'huggingface.co/XLabs-AI/flux-RealismLora',
    'extra_lora_scale', 0.6,
    'steps', 28,
    'guidance', 3.5,
    'aspect_ratio', '1:1',
    'positive_template', '(photorealistic photograph, raw photo, candid photography, film grain, shot on 35mm:1.3), (jet black hair, deep black, glossy, uniform black:1.2), (large natural breasts, full D-cup natural bust, ample curves, voluptuous proportionate body, generous chest:1.2), (anatomically correct nipples, natural symmetric areolas, proportionate nipple size, realistic chest anatomy:1.1), (perfect hands, anatomically correct fingers, five fingers per hand, two arms, two legs, normal human anatomy:1.1)',
    'negative_template', 'purple hair, violet hair, magenta hair, ombre hair, two-tone hair, dyed tips, highlights, color variation in hair, small breasts, flat chest, A-cup, tiny breasts, AA-cup, boyish chest, undeveloped chest, fake breasts, plastic implants, comically large, exaggerated cartoon proportions, bimbo proportions, deformed nipples, malformed areolas, extra nipples, three nipples, asymmetric nipples, missing nipples, cartoonish nipples, weird nipples, blurry chest details, bad anatomy chest, smudged nipples, abstract nipples, extra fingers, three fingers, six fingers, fused fingers, mutated hands, deformed hands, missing fingers, badly drawn hands, malformed hands, extra limbs, extra arms, extra legs, missing limbs, deformed limbs, mutated limbs, malformed body, three arms, three legs, extra hands, four legs, multiple bodies, conjoined, tongue out, tongue between teeth, tongue visible, airbrushed skin, smooth plastic skin, CGI rendering, 3D render, doll-like skin, perfectly smooth skin, waxy skin, overly smooth, no skin texture, no pores, digital art, illustration, painting, AI-generated, beauty filter, instagram filter, heavy makeup, porcelain skin, plastic doll'
  ),
  'personas/raven/canonical.png',
  '0.000000',
  3
WHERE NOT EXISTS (
  SELECT 1 FROM "image_providers"
  WHERE "name" = 'Raven' AND "type" = 'local_lora' AND "company_id" IS NULL
);
