CREATE TABLE "passage_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"chapter_id" text NOT NULL,
	"chapter_number" integer NOT NULL,
	"span_start" integer NOT NULL,
	"span_end" integer NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manuscript_chapters" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "passage_locks" ADD CONSTRAINT "passage_locks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passage_locks" ADD CONSTRAINT "passage_locks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passage_locks" ADD CONSTRAINT "passage_locks_chapter_id_manuscript_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."manuscript_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passage_locks_book_idx" ON "passage_locks" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "passage_locks_chapter_idx" ON "passage_locks" USING btree ("chapter_id");