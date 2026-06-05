-- Backfill the built-in Sidney personas to status='ready'.
--
-- Both LoRAs are trained, published, and rendering in production
-- (tymines/sidney-sfw + tymines/sidney-nsfw, verified live on Replicate), but
-- their image_providers.status rows were left at the seed values ('training'
-- for SFW, 'needs_photos' for NSFW). The Image Studio derives readiness from the
-- published endpoint and shows them as working, while the /personas page reads
-- the raw status column and misleadingly shows "training…" / "needs photos".
--
-- Sync the raw status to the real state. Scoped to the global (company_id IS
-- NULL) built-ins and gated on the published endpoint being present so we never
-- flip a genuinely-untrained row to ready. Idempotent.
UPDATE "image_providers"
SET "status" = 'ready',
    "status_detail" = 'LoRA trained — ready for generation.',
    "updated_at" = now()
WHERE "type" = 'local_lora'
  AND "company_id" IS NULL
  AND "name" IN ('Sidney SFW', 'Sidney NSFW')
  AND "endpoint" IS NOT NULL
  AND "endpoint" <> ''
  AND "status" IS DISTINCT FROM 'ready';
