CREATE TABLE IF NOT EXISTS "design_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "skill" text NOT NULL,
  "agent_id" text NOT NULL DEFAULT 'claude',
  "design_system_id" text,
  "prompt" text NOT NULL,
  "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output_type" text NOT NULL DEFAULT 'html',
  "status" text NOT NULL DEFAULT 'pending',
  "od_run_id" text,
  "od_project_id" text,
  "asset_path" text,
  "asset_url" text,
  "preview_url" text,
  "error" text,
  "token_cost_usd" numeric(12,6),
  "render_cost_usd" numeric(12,6),
  "tokens_in" integer,
  "tokens_out" integer,
  "created_by" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "completed_at" timestamp with time zone,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "design_runs_company_created_idx" ON "design_runs" ("company_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_runs_status_idx" ON "design_runs" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "design_runs_skill_idx" ON "design_runs" ("skill");
