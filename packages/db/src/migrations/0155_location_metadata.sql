-- Location images (Fable, 2026-07-12) — story_bible_world_locations.metadata.
-- Same root-cause fix as 0154 for characters: the location card's image flow
-- PATCHes { metadata: { imageUrl } } but the table has no metadata column and
-- drizzle silently drops the key — images never persist ("book writing isn't
-- letting me generate images for the locations").
-- Additive migration — does NOT drop or modify existing data.
-- Applied WITH this deploy (0154 pattern). NUMBER CLAIM: 0155 next-free on live.

ALTER TABLE "story_bible_world_locations" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
