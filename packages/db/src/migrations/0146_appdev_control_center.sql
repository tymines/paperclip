-- 0146_appdev_control_center.sql
-- App Dev Control Center — full appdev_* data model (Build Spec v1.1 CANONICAL, Part 2).
--
-- ██ GATED — DO NOT AUTO-APPLY ██
-- Deliberately NOT registered in meta/_journal.json, mirroring the 0145/Gym
-- holding pattern (journal reconciliation + MIGRATION_PROMPT=never still
-- pending Tyler's go). Server routes degrade gracefully (migrationPending)
-- while these tables are absent. Apply manually with psql on Tyler's approval,
-- then reconcile the journal in the same pass as 0145.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS throughout; safe to re-run.

CREATE TABLE IF NOT EXISTS "appdev_apps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "icon_asset_id" uuid,
  "phase" text DEFAULT 'idea' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "bundle_id" text,
  "platform" text DEFAULT 'web' NOT NULL,
  "repo_url" text,
  "sentry_project" text,
  "posthog_project" text,
  "asc_app_id" text,
  "spend_cap_usd_month" numeric,
  "legacy_registry_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "appdev_apps_company_slug_unique" ON "appdev_apps" ("company_id","slug");
CREATE INDEX IF NOT EXISTS "appdev_apps_company_idx" ON "appdev_apps" ("company_id");
CREATE INDEX IF NOT EXISTS "appdev_apps_phase_idx" ON "appdev_apps" ("company_id","phase");

CREATE TABLE IF NOT EXISTS "appdev_gates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "gate" text NOT NULL,
  "verdict" text DEFAULT 'pending' NOT NULL,
  "reviewer" text NOT NULL,
  "evidence" jsonb,
  "comments" text,
  "decided_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_gates_app_idx" ON "appdev_gates" ("app_id","created_at");
CREATE INDEX IF NOT EXISTS "appdev_gates_verdict_idx" ON "appdev_gates" ("company_id","verdict");

CREATE TABLE IF NOT EXISTS "appdev_work_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "code" text NOT NULL,
  "type" text NOT NULL,
  "lane" text NOT NULL,
  "objective" text NOT NULL,
  "acceptance_criteria" jsonb,
  "reference_pack_id" uuid,
  "touches_ui" boolean DEFAULT false NOT NULL,
  "size_class" text DEFAULT 's' NOT NULL,
  "plan" jsonb,
  "plan_status" text DEFAULT 'not_required' NOT NULL,
  "branch_point_sha" text,
  "proof_requirements" jsonb,
  "status" text DEFAULT 'draft' NOT NULL,
  "assigned_agent" text,
  "source_feedback_id" uuid,
  "cost_usd" numeric DEFAULT '0' NOT NULL,
  "max_steps" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  -- Part 4.2: UI-touching work orders MUST carry a reference pack (DB layer of
  -- the two-layer enforcement; the composer enforces at app layer too).
  CONSTRAINT "appdev_wo_ui_requires_refpack"
    CHECK ((touches_ui = false) OR (reference_pack_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "appdev_wo_company_code_unique" ON "appdev_work_orders" ("company_id","code");
CREATE INDEX IF NOT EXISTS "appdev_wo_app_idx" ON "appdev_work_orders" ("app_id","status");

CREATE TABLE IF NOT EXISTS "appdev_reference_packs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "name" text NOT NULL,
  "supersedes_id" uuid,
  "items" jsonb,
  "style_tokens" jsonb,
  "approved_by" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_refpacks_app_idx" ON "appdev_reference_packs" ("app_id");

CREATE TABLE IF NOT EXISTS "appdev_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "kind" text NOT NULL,
  "storage_path" text NOT NULL,
  "mime" text,
  "sha256" text,
  "source" text DEFAULT 'upload' NOT NULL,
  "chat_message_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_assets_app_idx" ON "appdev_assets" ("app_id");

CREATE TABLE IF NOT EXISTS "appdev_proof_bundles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "work_order_id" uuid REFERENCES "appdev_work_orders"("id"),
  "kind" text NOT NULL,
  "payload" jsonb,
  "screenshot_asset_ids" jsonb,
  "self_check" jsonb,
  "submitted_by" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_proof_wo_idx" ON "appdev_proof_bundles" ("work_order_id");

CREATE TABLE IF NOT EXISTS "appdev_visual_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "work_order_id" uuid REFERENCES "appdev_work_orders"("id"),
  "proof_bundle_id" uuid REFERENCES "appdev_proof_bundles"("id"),
  "reference_pack_id" uuid REFERENCES "appdev_reference_packs"("id"),
  "reviewer_lane" text NOT NULL,
  "reviewer_model" text,
  "rubric_scores" jsonb,
  "verdict" text NOT NULL,
  "worst_screen" text,
  "summary" text,
  "raw" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_vreview_wo_idx" ON "appdev_visual_reviews" ("work_order_id");

CREATE TABLE IF NOT EXISTS "appdev_feedback_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "source" text NOT NULL,
  "external_id" text,
  "severity" text DEFAULT 'p2' NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "raw" jsonb,
  "status" text DEFAULT 'new' NOT NULL,
  "converted_work_order_id" uuid,
  "cluster_key" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_feedback_app_idx" ON "appdev_feedback_items" ("app_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "appdev_feedback_dedup_unique" ON "appdev_feedback_items" ("app_id","source","external_id");

CREATE TABLE IF NOT EXISTS "appdev_chat_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "title" text NOT NULL,
  "forked_from_message_id" uuid,
  "lane" text DEFAULT 'design' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_chat_threads_app_idx" ON "appdev_chat_threads" ("app_id");

CREATE TABLE IF NOT EXISTS "appdev_chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL REFERENCES "appdev_chat_threads"("id"),
  "role" text NOT NULL,
  "content" text NOT NULL,
  "attachments" jsonb,
  "pinned" boolean DEFAULT false NOT NULL,
  "promoted_to" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_chat_msgs_thread_idx" ON "appdev_chat_messages" ("thread_id","created_at");

CREATE TABLE IF NOT EXISTS "appdev_screens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "screen_tag" text NOT NULL,
  "description" text,
  "launch_route" text,
  "baseline_asset_id" uuid,
  "comparison_mode" text DEFAULT 'strict' NOT NULL,
  "regions" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "appdev_screens_app_tag_unique" ON "appdev_screens" ("app_id","screen_tag");

CREATE TABLE IF NOT EXISTS "appdev_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "work_order_id" uuid REFERENCES "appdev_work_orders"("id"),
  "agent" text NOT NULL,
  "state" text DEFAULT 'planning' NOT NULL,
  "transcript_ref" text,
  "step_count" integer DEFAULT 0 NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "ended_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "appdev_sessions_app_idx" ON "appdev_sessions" ("app_id","state");

CREATE TABLE IF NOT EXISTS "appdev_releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "version" text NOT NULL,
  "build_number" integer,
  "status" text DEFAULT 'planned' NOT NULL,
  "code_freeze_at" timestamptz,
  "checklist" jsonb,
  "rollout_pct" integer DEFAULT 0 NOT NULL,
  "rollout_health" jsonb,
  "linked_flag_keys" jsonb,
  "deployment_id" uuid,
  "proof_bundle_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_releases_app_idx" ON "appdev_releases" ("app_id","status");

CREATE TABLE IF NOT EXISTS "appdev_skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "name" text NOT NULL,
  "slash_command" text NOT NULL,
  "description" text,
  "source_thread_id" uuid,
  "definition" jsonb,
  "run_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "appdev_skills_slash_unique" ON "appdev_skills" ("company_id","slash_command");

CREATE TABLE IF NOT EXISTS "appdev_deployments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "version" text NOT NULL,
  "build_number" integer,
  "channel" text NOT NULL,
  "asc_status" text,
  "deployed_at" timestamptz,
  "proof_bundle_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_deployments_app_idx" ON "appdev_deployments" ("app_id");

CREATE TABLE IF NOT EXISTS "appdev_retros" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "app_id" uuid NOT NULL REFERENCES "appdev_apps"("id"),
  "deployment_id" uuid,
  "doc" text,
  "lessons" jsonb,
  "fed_forward_ids" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_retros_app_idx" ON "appdev_retros" ("app_id");
