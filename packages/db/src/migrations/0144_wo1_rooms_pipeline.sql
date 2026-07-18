-- WO-1: Pipeline runs, run stages, artifacts, gate policy, rooms.type constraint
-- Additive migration — does NOT drop or modify existing tables

-- 1. pipeline_runs: holds execution lifecycle of a pipeline through rooms
CREATE TABLE IF NOT EXISTS "pipeline_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "room_id" uuid,
  "name" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 2. run_stages: individual gates within a pipeline run (plan, critique, code, review, merge)
CREATE TABLE IF NOT EXISTS "run_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_run_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "stage_order" integer DEFAULT 0 NOT NULL,
  "assigned_agent_id" uuid,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 3. artifacts: immutable-on-freeze evidence artifacts for pipeline runs
CREATE TABLE IF NOT EXISTS "artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pipeline_run_id" uuid,
  "run_stage_id" uuid,
  "artifact_type" text NOT NULL,
  "name" text NOT NULL,
  "content" text,
  "file_path" text,
  "frozen" boolean DEFAULT false NOT NULL,
  "frozen_at" timestamp with time zone,
  "frozen_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 4. gate_policy: per-stage evidence requirements and reviewer counts
CREATE TABLE IF NOT EXISTS "gate_policy" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "stage_name" text NOT NULL,
  "required_evidence_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "min_reviewers" text DEFAULT '1' NOT NULL,
  "auto_approve" boolean DEFAULT false NOT NULL,
  "config" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 5. Constraints (idempotent — skip if already exist)
DO $$ BEGIN
  ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "run_stages" ADD CONSTRAINT "run_stages_pipeline_run_id_pipeline_runs_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "run_stages" ADD CONSTRAINT "run_stages_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_pipeline_run_id_pipeline_runs_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_stage_id_run_stages_id_fk" FOREIGN KEY ("run_stage_id") REFERENCES "public"."run_stages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "gate_policy" ADD CONSTRAINT "gate_policy_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- 6. rooms.type CHECK constraint — allow only known pipeline room types
DO $$ BEGIN
  ALTER TABLE "rooms" ADD CONSTRAINT "rooms_type_check" CHECK ("type" IN ('collaboration', 'war-room', 'brainstorm', 'team', 'pipeline-idea', 'pipeline-spec', 'pipeline-design', 'pipeline-architecture', 'pipeline-build', 'pipeline-review', 'pipeline-ship', 'pipeline-retro'));
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;--> statement-breakpoint

-- 7. Immutable-freeze trigger on artifacts: once frozen=true, no UPDATE/DELETE allowed
CREATE OR REPLACE FUNCTION enforce_artifact_freeze() RETURNS trigger AS $$
BEGIN
  IF OLD.frozen = true THEN
    RAISE EXCEPTION 'artifact % is frozen and cannot be modified or deleted', OLD.id;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.frozen = true THEN
    NEW.frozen_at = COALESCE(NEW.frozen_at, now());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DO $$ BEGIN
  CREATE TRIGGER artifact_freeze_trigger
    BEFORE UPDATE OR DELETE ON "artifacts"
    FOR EACH ROW EXECUTE FUNCTION enforce_artifact_freeze();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- 8. Indexes
CREATE INDEX IF NOT EXISTS "pipeline_runs_company_status_idx" ON "pipeline_runs" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_runs_room_idx" ON "pipeline_runs" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_stages_run_idx" ON "run_stages" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_stages_run_status_idx" ON "run_stages" USING btree ("pipeline_run_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_stages_agent_idx" ON "run_stages" USING btree ("assigned_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_run_idx" ON "artifacts" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_stage_idx" ON "artifacts" USING btree ("run_stage_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifacts_type_idx" ON "artifacts" USING btree ("artifact_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gate_policy_company_stage_idx" ON "gate_policy" USING btree ("company_id","stage_name");--> statement-breakpoint

-- 9. Seed gate_policy rows (skip if already seeded)
INSERT INTO "gate_policy" ("company_id", "stage_name", "required_evidence_types", "min_reviewers", "auto_approve", "config")
SELECT '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4', 'plan', '["plan_document"]'::jsonb, '1', false, '{"description":"Gate 1: Plan approval"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "gate_policy" WHERE "company_id" = '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4' AND "stage_name" = 'plan')
  AND EXISTS (SELECT 1 FROM "companies" WHERE "id" = '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4');
INSERT INTO "gate_policy" ("company_id", "stage_name", "required_evidence_types", "min_reviewers", "auto_approve", "config")
SELECT '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4', 'critique', '["critique_verdict"]'::jsonb, '1', false, '{"description":"Gate 2: Critique pass"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "gate_policy" WHERE "company_id" = '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4' AND "stage_name" = 'critique')
  AND EXISTS (SELECT 1 FROM "companies" WHERE "id" = '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4');
INSERT INTO "gate_policy" ("company_id", "stage_name", "required_evidence_types", "min_reviewers", "auto_approve", "config")
SELECT '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4', 'code', '["code_diff","test_output"]'::jsonb, '1', false, '{"description":"Gate 3: Code complete"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "gate_policy" WHERE "company_id" = '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4' AND "stage_name" = 'code')
  AND EXISTS (SELECT 1 FROM "companies" WHERE "id" = '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4');
INSERT INTO "gate_policy" ("company_id", "stage_name", "required_evidence_types", "min_reviewers", "auto_approve", "config")
SELECT '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4', 'review', '["review_verdict"]'::jsonb, '1', false, '{"description":"Gate 4: Review pass"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "gate_policy" WHERE "company_id" = '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4' AND "stage_name" = 'review')
  AND EXISTS (SELECT 1 FROM "companies" WHERE "id" = '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4');
INSERT INTO "gate_policy" ("company_id", "stage_name", "required_evidence_types", "min_reviewers", "auto_approve", "config")
SELECT '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4', 'merge', '["merge_sha"]'::jsonb, '1', false, '{"description":"Gate 5: Merge gate"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM "gate_policy" WHERE "company_id" = '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4' AND "stage_name" = 'merge')
  AND EXISTS (SELECT 1 FROM "companies" WHERE "id" = '7fdc9dc0-6d39-479d-b53a-fcff30f5c9d4');
