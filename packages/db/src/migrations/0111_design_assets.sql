CREATE TABLE IF NOT EXISTS "design_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "run_id" uuid NOT NULL REFERENCES "design_runs"("id") ON DELETE CASCADE,
  "kind" text NOT NULL DEFAULT 'image',
  "path" text NOT NULL,
  "url" text,
  "width" integer,
  "height" integer,
  "duration_ms" integer,
  "slide_index" integer NOT NULL DEFAULT 0,
  "skill" text,
  "prompt" text,
  "agent_id" text,
  "persona" text,
  "favorited" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_assets_company_created_idx" ON "design_assets" ("company_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_assets_run_id_idx" ON "design_assets" ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_assets_kind_idx" ON "design_assets" ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_assets_favorited_idx" ON "design_assets" ("favorited");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_assets_skill_idx" ON "design_assets" ("skill");
