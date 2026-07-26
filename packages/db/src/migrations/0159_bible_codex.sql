CREATE TABLE "bible_factions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bible_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"entity_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"known_as_of" integer DEFAULT 1 NOT NULL,
	"source_chapter" integer,
	"source_scene" text DEFAULT '' NOT NULL,
	"provenance" text DEFAULT 'authored' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bible_glossary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"term" text DEFAULT '' NOT NULL,
	"definition" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bible_lore" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bible_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bible_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"from_entity_type" text NOT NULL,
	"from_entity_id" uuid NOT NULL,
	"to_entity_type" text NOT NULL,
	"to_entity_id" uuid NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"arc_stage" text DEFAULT '' NOT NULL,
	"meter" smallint DEFAULT 0 NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bible_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bible_themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bible_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payoff_state" text DEFAULT 'open' NOT NULL,
	"payoff_chapter" integer
);
--> statement-breakpoint
CREATE TABLE "bible_timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'authored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"chapter_number" integer,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bible_factions" ADD CONSTRAINT "bible_factions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_facts" ADD CONSTRAINT "bible_facts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_glossary" ADD CONSTRAINT "bible_glossary_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_lore" ADD CONSTRAINT "bible_lore_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_objects" ADD CONSTRAINT "bible_objects_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_relationships" ADD CONSTRAINT "bible_relationships_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_systems" ADD CONSTRAINT "bible_systems_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_themes" ADD CONSTRAINT "bible_themes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_threads" ADD CONSTRAINT "bible_threads_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_timeline_events" ADD CONSTRAINT "bible_timeline_events_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bible_facts_book_known_idx" ON "bible_facts" USING btree ("book_id","known_as_of");--> statement-breakpoint
CREATE INDEX "bible_relationships_book_idx" ON "bible_relationships" USING btree ("book_id");--> statement-breakpoint
-- Spec v1 §4.1②: relationship meter is bounded −100…+100 (arc rules are gate constraints).
ALTER TABLE "bible_relationships" ADD CONSTRAINT "bible_relationships_meter_range" CHECK ("meter" BETWEEN -100 AND 100);