-- Gym Tab: skill proposals (self-evolution review queue)
-- Additive migration — does NOT drop or modify existing tables.
-- Backs the Gym's Proposed-Changes queue + Skill Evolution Timeline.
-- Proposals are SURFACED for Tyler's review; nothing auto-executes.

CREATE TABLE IF NOT EXISTS "skill_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_name" text,
  "target_type" text DEFAULT 'skill' NOT NULL,   -- skill | soul | workflow
  "target_name" text NOT NULL,
  "title" text NOT NULL,
  "detail" text,                                  -- improvement description / diff summary
  "rationale" text,
  "effort" text,                                  -- S | M | L
  "value_note" text,
  "confidence" text,                              -- source confidence (synthesized/automated/…)
  "source_type" text DEFAULT 'deep-dream' NOT NULL, -- deep-dream | handoff | manual
  "source_file" text,                             -- vault-relative path
  "source_ref" text,                              -- row id within the source (e.g. S1)
  "status" text DEFAULT 'pending' NOT NULL,       -- pending | approved | rejected
  "reviewed_at" timestamp with time zone,
  "reviewed_by" text,
  "review_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Dedupe generation: the same source row must not be inserted twice.
CREATE UNIQUE INDEX IF NOT EXISTS "skill_proposals_source_uniq"
  ON "skill_proposals" ("company_id", "source_file", "source_ref");
--> statement-breakpoint

-- Fast lookups for the queue (pending first) and per-company reads.
CREATE INDEX IF NOT EXISTS "skill_proposals_company_status_idx"
  ON "skill_proposals" ("company_id", "status", "created_at");
