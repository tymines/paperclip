CREATE TABLE IF NOT EXISTS "creator_flows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "persona_id" uuid NOT NULL REFERENCES "image_providers"("id"),
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "creator_flows_status_check" CHECK ("status" IN ('draft', 'active', 'archived'))
);

CREATE INDEX IF NOT EXISTS "creator_flows_company_persona_idx" ON "creator_flows" ("company_id", "persona_id");
CREATE INDEX IF NOT EXISTS "creator_flows_company_status_idx" ON "creator_flows" ("company_id", "status");

CREATE TABLE IF NOT EXISTS "creator_flow_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "flow_id" uuid NOT NULL REFERENCES "creator_flows"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "name" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "creator_flow_steps_position_check" CHECK ("position" >= 0),
  CONSTRAINT "creator_flow_steps_flow_position_uq" UNIQUE ("flow_id", "position")
);

CREATE TABLE IF NOT EXISTS "creator_flow_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "persona_id" uuid NOT NULL REFERENCES "image_providers"("id"),
  "flow_id" uuid NOT NULL REFERENCES "creator_flows"("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "error_message" text,
  "idempotency_key" text NOT NULL,
  "created_by" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "creator_flow_runs_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT "creator_flow_runs_flow_idempotency_uq" UNIQUE ("flow_id", "idempotency_key")
);

CREATE INDEX IF NOT EXISTS "creator_flow_runs_company_created_idx" ON "creator_flow_runs" ("company_id", "created_at");

CREATE TABLE IF NOT EXISTS "creator_flow_run_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "creator_flow_runs"("id") ON DELETE CASCADE,
  "flow_step_id" uuid REFERENCES "creator_flow_steps"("id") ON DELETE SET NULL,
  "step_name" text NOT NULL,
  "config_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "position" integer NOT NULL,
  "attempt" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'pending',
  "generation_job_id" uuid REFERENCES "generation_jobs"("id"),
  "error_message" text,
  "retry_idempotency_key" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "creator_flow_run_steps_status_check" CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')),
  CONSTRAINT "creator_flow_run_steps_run_position_attempt_uq" UNIQUE ("run_id", "position", "attempt"),
  CONSTRAINT "creator_flow_run_steps_retry_idempotency_uq" UNIQUE ("run_id", "retry_idempotency_key")
);

CREATE INDEX IF NOT EXISTS "creator_flow_run_steps_run_position_idx" ON "creator_flow_run_steps" ("run_id", "position");

CREATE TABLE IF NOT EXISTS "creator_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "persona_id" uuid NOT NULL REFERENCES "image_providers"("id"),
  "name" text NOT NULL,
  "description" text,
  "channels" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "creator_campaigns_status_check" CHECK ("status" IN ('draft', 'active', 'archived'))
);

CREATE INDEX IF NOT EXISTS "creator_campaigns_company_persona_idx" ON "creator_campaigns" ("company_id", "persona_id");
CREATE INDEX IF NOT EXISTS "creator_campaigns_company_status_idx" ON "creator_campaigns" ("company_id", "status");

CREATE TABLE IF NOT EXISTS "creator_campaign_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "campaign_id" uuid NOT NULL REFERENCES "creator_campaigns"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "reference_id" uuid NOT NULL,
  "created_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "creator_campaign_items_kind_check" CHECK ("kind" IN ('flow', 'flow_run', 'generation', 'asset', 'review_request', 'social_draft')),
  CONSTRAINT "creator_campaign_items_reference_uq" UNIQUE ("campaign_id", "kind", "reference_id")
);

CREATE INDEX IF NOT EXISTS "creator_campaign_items_campaign_idx" ON "creator_campaign_items" ("campaign_id", "created_at");

CREATE TABLE IF NOT EXISTS "creator_review_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "persona_id" uuid NOT NULL REFERENCES "image_providers"("id"),
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "feedback" text,
  "requested_by" text,
  "decided_by" text,
  "decided_at" timestamptz,
  "supersedes_request_id" uuid REFERENCES "creator_review_requests"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "creator_review_requests_source_check" CHECK ("source_type" IN ('generation', 'asset', 'social_draft')),
  CONSTRAINT "creator_review_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS "creator_reviews_company_persona_status_idx" ON "creator_review_requests" ("company_id", "persona_id", "status");
CREATE INDEX IF NOT EXISTS "creator_reviews_source_idx" ON "creator_review_requests" ("source_type", "source_id", "created_at");
