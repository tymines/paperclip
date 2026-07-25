ALTER TABLE "manuscript_chapters"
  ADD COLUMN IF NOT EXISTS "locked" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "passage_locks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "book_id" uuid NOT NULL,
  "chapter_id" text NOT NULL,
  "chapter_number" integer NOT NULL,
  "span_start" integer NOT NULL,
  "span_end" integer NOT NULL,
  "content_hash" text DEFAULT '' NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "created_by_user_id" text DEFAULT 'board' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "book_revision_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "book_id" uuid NOT NULL,
  "chapter_id" text,
  "chapter_number" integer NOT NULL,
  "scope" text DEFAULT 'chapter' NOT NULL,
  "instruction" text DEFAULT '' NOT NULL,
  "base_content_hash" text DEFAULT '' NOT NULL,
  "proposed_content" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "rejection_reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_actor_type" text DEFAULT 'agent' NOT NULL,
  "created_by_actor_id" text DEFAULT 'unknown' NOT NULL,
  "decided_by_user_id" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "passage_locks" ADD CONSTRAINT "passage_locks_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "passage_locks" ADD CONSTRAINT "passage_locks_book_id_books_id_fk"
    FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "passage_locks" ADD CONSTRAINT "passage_locks_chapter_id_manuscript_chapters_id_fk"
    FOREIGN KEY ("chapter_id") REFERENCES "public"."manuscript_chapters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "book_revision_proposals" ADD CONSTRAINT "book_revision_proposals_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "book_revision_proposals" ADD CONSTRAINT "book_revision_proposals_book_id_books_id_fk"
    FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "book_revision_proposals" ADD CONSTRAINT "book_revision_proposals_chapter_id_manuscript_chapters_id_fk"
    FOREIGN KEY ("chapter_id") REFERENCES "public"."manuscript_chapters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passage_locks_book_chapter_idx" ON "passage_locks" ("book_id","chapter_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passage_locks_chapter_idx" ON "passage_locks" ("chapter_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_revision_proposals_book_status_idx" ON "book_revision_proposals" ("book_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_revision_proposals_chapter_idx" ON "book_revision_proposals" ("book_id","chapter_number");
