-- Persona CMS: folders + per-persona cover/favorite for the Personas management
-- surface (<company>/personas — name, create, organize trained LoRA personas).
--
-- persona_groups  — optional folders to organize personas once a company has
--   more than a handful. uuid PK + company scoping, matching every other
--   Paperclip table (the request's SERIAL/INT sketch predated that convention).
-- image_providers gains:
--   group_id     — FK into a folder (null = ungrouped).
--   avatar_path  — uploads-relative cover image (a gallery shot or an uploaded
--                  face reference); UI falls back to initials when null.
--   is_favorite  — pin to the top of every persona picker.
-- sort_order already exists (0112), so it is intentionally not re-added.

CREATE TABLE IF NOT EXISTS "persona_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "color" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "persona_groups_company_idx" ON "persona_groups" ("company_id");--> statement-breakpoint

ALTER TABLE "image_providers"
  ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "persona_groups"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "avatar_path" text,
  ADD COLUMN IF NOT EXISTS "is_favorite" boolean NOT NULL DEFAULT false;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "image_providers_group_idx" ON "image_providers" ("group_id");--> statement-breakpoint

-- Backfill cover images: each trained persona's most recent gallery image becomes
-- its default avatar. A persona's generations share its own content rating, so
-- the SFW persona naturally gets an SFW cover and the NSFW one an NSFW cover.
-- Personas with no generations stay null (UI renders initials). Idempotent.
UPDATE "image_providers" AS p
  SET "avatar_path" = g."image_path"
  FROM (
    SELECT DISTINCT ON ("persona_id") "persona_id", "image_path"
    FROM "persona_generations"
    ORDER BY "persona_id", "created_at" DESC
  ) AS g
  WHERE g."persona_id" = p."id"
    AND p."type" = 'local_lora'
    AND p."avatar_path" IS NULL;
