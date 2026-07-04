CREATE TABLE "manuscript_chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_number" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manuscript_chapters" ADD CONSTRAINT "manuscript_chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manuscript_chapters_book_chapter_unique_idx" ON "manuscript_chapters" USING btree ("book_id","chapter_number");