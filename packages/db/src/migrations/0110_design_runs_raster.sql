ALTER TABLE "design_runs" ADD COLUMN IF NOT EXISTS "png_paths" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "design_runs" ADD COLUMN IF NOT EXISTS "mp4_path" text;--> statement-breakpoint
ALTER TABLE "design_runs" ADD COLUMN IF NOT EXISTS "raster_status" text NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "design_runs" ADD COLUMN IF NOT EXISTS "raster_error" text;--> statement-breakpoint
ALTER TABLE "design_runs" ADD COLUMN IF NOT EXISTS "preset_run_id" uuid;--> statement-breakpoint
ALTER TABLE "design_runs" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_runs_preset_run_idx" ON "design_runs" ("preset_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "design_runs_idem_unique"
  ON "design_runs" ("company_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "design_preset_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "preset_slug" text NOT NULL,
  "brief" text NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "child_run_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "result_summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error" text,
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "completed_at" timestamp with time zone
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_preset_runs_company_created_idx"
  ON "design_preset_runs" ("company_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_preset_runs_slug_idx"
  ON "design_preset_runs" ("preset_slug");
