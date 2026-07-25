CREATE TABLE "book_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"chapter_id" text NOT NULL,
	"chapter_number" integer NOT NULL,
	"scope" text DEFAULT 'chapter' NOT NULL,
	"span_start" integer,
	"span_end" integer,
	"instruction" text DEFAULT '' NOT NULL,
	"source_note_id" text,
	"original_text" text DEFAULT '' NOT NULL,
	"proposed_text" text NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "book_revisions" ADD CONSTRAINT "book_revisions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_revisions" ADD CONSTRAINT "book_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_revisions" ADD CONSTRAINT "book_revisions_chapter_id_manuscript_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."manuscript_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_revisions_book_idx" ON "book_revisions" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "book_revisions_book_status_idx" ON "book_revisions" USING btree ("book_id","status");--> statement-breakpoint
CREATE INDEX "book_revisions_chapter_idx" ON "book_revisions" USING btree ("chapter_id");