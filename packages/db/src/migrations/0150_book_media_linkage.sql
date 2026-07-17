-- Book Studio media extension (Fable, 2026-07-12) — link creative_jobs to books/chapters.
-- Additive migration — does NOT drop or modify existing data.
-- GATED: written but NOT applied/journaled (0145/0149 pattern). Depends on 0149
-- (creative_jobs table). 0150/0151 verified free across all sibling branches.

ALTER TABLE "creative_jobs" ADD COLUMN IF NOT EXISTS "book_id" uuid;
--> statement-breakpoint
ALTER TABLE "creative_jobs" ADD COLUMN IF NOT EXISTS "chapter_id" text;
--> statement-breakpoint
ALTER TABLE "creative_jobs" ADD COLUMN IF NOT EXISTS "purpose" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "creative_jobs" ADD CONSTRAINT "creative_jobs_book_id_books_id_fk"
    FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_jobs_book_idx" ON "creative_jobs" ("book_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_jobs_book_purpose_idx" ON "creative_jobs" ("book_id","purpose");
