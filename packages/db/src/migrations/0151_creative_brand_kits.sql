-- Creative Studio P2 Ad Studio (Fable, 2026-07-12) — brand kits + ad batch grouping.
-- Additive migration — does NOT drop or modify existing data.
-- GATED: written but NOT applied/journaled (0145/0149/0150 pattern).
-- NUMBER CLAIM: 0151 verified free across ALL sibling branches at claim time
-- (0146 appdev/rooms, 0147 council, 0148 gate-policy, 0149/0150 creative/book-media).

CREATE TABLE IF NOT EXISTS "creative_brand_kits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "product_url" text,
  "logo_url" text,
  "colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tone" text,
  "description" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by" text DEFAULT 'unknown' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "creative_brand_kits" ADD CONSTRAINT "creative_brand_kits_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_brand_kits_company_idx" ON "creative_brand_kits" ("company_id");
--> statement-breakpoint
-- ad batches group variant jobs; batch_id lives on creative_jobs
ALTER TABLE "creative_jobs" ADD COLUMN IF NOT EXISTS "batch_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_jobs_batch_idx" ON "creative_jobs" ("batch_id");
