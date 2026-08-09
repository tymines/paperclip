ALTER TABLE "books" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "story_bible_characters" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "story_bible_world_locations" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "story_bible_style" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "story_bible_outline" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bible_lore" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bible_factions" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bible_objects" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bible_systems" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bible_timeline_events" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bible_threads" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bible_themes" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bible_glossary" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bible_relationships" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bible_facts" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;

CREATE OR REPLACE FUNCTION "book_studio_advance_revision"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."revision" := OLD."revision" + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "books_advance_revision" BEFORE UPDATE ON "books" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "story_bible_characters_advance_revision" BEFORE UPDATE ON "story_bible_characters" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "story_bible_world_locations_advance_revision" BEFORE UPDATE ON "story_bible_world_locations" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "story_bible_style_advance_revision" BEFORE UPDATE ON "story_bible_style" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "story_bible_outline_advance_revision" BEFORE UPDATE ON "story_bible_outline" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "bible_lore_advance_revision" BEFORE UPDATE ON "bible_lore" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "bible_factions_advance_revision" BEFORE UPDATE ON "bible_factions" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "bible_objects_advance_revision" BEFORE UPDATE ON "bible_objects" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "bible_systems_advance_revision" BEFORE UPDATE ON "bible_systems" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "bible_timeline_events_advance_revision" BEFORE UPDATE ON "bible_timeline_events" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "bible_threads_advance_revision" BEFORE UPDATE ON "bible_threads" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "bible_themes_advance_revision" BEFORE UPDATE ON "bible_themes" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "bible_glossary_advance_revision" BEFORE UPDATE ON "bible_glossary" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "bible_relationships_advance_revision" BEFORE UPDATE ON "bible_relationships" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
CREATE TRIGGER "bible_facts_advance_revision" BEFORE UPDATE ON "bible_facts" FOR EACH ROW EXECUTE FUNCTION "book_studio_advance_revision"();
