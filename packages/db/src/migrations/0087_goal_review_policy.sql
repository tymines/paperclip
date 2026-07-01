ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "review_policy" text DEFAULT 'owner' NOT NULL;
