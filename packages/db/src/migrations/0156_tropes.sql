ALTER TABLE "story_bible_style" ADD COLUMN IF NOT EXISTS "tropes" jsonb DEFAULT '[]'::jsonb NOT NULL;
