-- 0151_appdev_studio_p36.sql
-- App Dev Studio Phases 3–6: versioned screen baselines for VFG-R.
--
-- ██ GATED — DO NOT AUTO-APPLY ██
-- Same holding pattern as 0145/0146/0149/0150: file-level only, NOT registered
-- in meta/_journal.json, apply manually with psql on Tyler's go.
-- Number claim: 0151 (checked all local branches 2026-07-12; 0140–0150 taken).
-- Depends on: 0146_appdev_control_center.sql (appdev_screens, companies).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "appdev_screen_baselines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "screen_id" uuid NOT NULL REFERENCES "appdev_screens"("id"),
  "asset_id" uuid NOT NULL,
  "commit_sha" text,
  "approved_by" text NOT NULL,
  "approved_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "appdev_screen_baselines_screen_idx"
  ON "appdev_screen_baselines" ("screen_id","approved_at");
