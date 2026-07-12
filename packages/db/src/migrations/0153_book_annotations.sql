-- Book Studio annotations (Fable, 2026-07-12) — span-anchored review annotations
-- + review runs (Dispatch Build Spec §4/§6). Additive migration — does NOT drop
-- or modify existing data.
-- GATED: written + journaled but NOT applied (0149/0150 pattern). Until applied,
-- server code degrades to the books.metadata.reviewNotes jsonb path and reports
-- `available: false` ("annotations table pending migration 0151").

CREATE TABLE IF NOT EXISTS "book_review_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "book_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "lens" text DEFAULT 'prose' NOT NULL,
  "reviewer" text DEFAULT 'reviewer-lane' NOT NULL,
  "model" text DEFAULT '' NOT NULL,
  "scope" text DEFAULT '' NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "book_annotations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "book_id" uuid NOT NULL,
  "chapter_id" text NOT NULL,
  "chapter_number" integer NOT NULL,
  "review_run_id" uuid,
  "span_start" integer,
  "span_end" integer,
  "content_hash" text DEFAULT '' NOT NULL,
  "kind" text DEFAULT 'note' NOT NULL,
  "body" text NOT NULL,
  "author" text DEFAULT 'user' NOT NULL,
  "resolved" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "book_review_runs" ADD CONSTRAINT "book_review_runs_book_id_books_id_fk"
    FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "book_review_runs" ADD CONSTRAINT "book_review_runs_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "book_annotations" ADD CONSTRAINT "book_annotations_book_id_books_id_fk"
    FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "book_annotations" ADD CONSTRAINT "book_annotations_chapter_id_manuscript_chapters_id_fk"
    FOREIGN KEY ("chapter_id") REFERENCES "public"."manuscript_chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "book_annotations" ADD CONSTRAINT "book_annotations_review_run_id_book_review_runs_id_fk"
    FOREIGN KEY ("review_run_id") REFERENCES "public"."book_review_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_review_runs_book_idx" ON "book_review_runs" ("book_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_review_runs_book_created_idx" ON "book_review_runs" ("book_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_annotations_book_idx" ON "book_annotations" ("book_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_annotations_chapter_idx" ON "book_annotations" ("chapter_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_annotations_book_resolved_idx" ON "book_annotations" ("book_id","resolved");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_annotations_review_run_idx" ON "book_annotations" ("review_run_id");
