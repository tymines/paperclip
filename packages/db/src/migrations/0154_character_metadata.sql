-- Book Media round 2 (Fable, 2026-07-12) — story_bible_characters.metadata.
-- Root cause fix: the character-card image flow PATCHes { metadata: { imageUrl } }
-- but the table has no metadata column and the route drops it — icons never persist.
-- Additive migration — does NOT drop or modify existing data.
-- GATED: written but NOT applied/journaled (0145/0149/0150 pattern).
-- NUMBER CLAIM: 0154 verified free across ALL sibling branches at claim time
-- (0151 appdev p36, 0152 creative_brand_kits, 0153 book_annotations on live).

ALTER TABLE "story_bible_characters" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
