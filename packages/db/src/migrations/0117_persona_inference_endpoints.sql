-- Point each Sidney persona at its published Replicate inference model.
--
-- Sidney's trained LoRAs are published as standalone inference-ready models (the
-- LoRA baked into Flux dev) — `tymines/sidney-sfw` / `tymines/sidney-nsfw` — NOT
-- weights to be loaded into a separate base model. The batch generator reads
-- `image_providers.endpoint` as the prediction target (falling back to
-- <account-username>/<persona-slug> when null). Setting it explicitly makes the
-- target visible + stable. Idempotent: only fills a null endpoint.

UPDATE "image_providers"
SET "endpoint" = 'tymines/sidney-sfw'
WHERE "name" = 'Sidney SFW' AND "type" = 'local_lora' AND "company_id" IS NULL
  AND "endpoint" IS NULL;--> statement-breakpoint

UPDATE "image_providers"
SET "endpoint" = 'tymines/sidney-nsfw'
WHERE "name" = 'Sidney NSFW' AND "type" = 'local_lora' AND "company_id" IS NULL
  AND "endpoint" IS NULL;
