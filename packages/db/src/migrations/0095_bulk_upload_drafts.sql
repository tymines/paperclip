CREATE TABLE "bulk_upload_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text,
	"step" text DEFAULT 'upload' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"strategy" text,
	"strategy_config" jsonb,
	"metadata" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bulk_upload_drafts" ADD CONSTRAINT "bulk_upload_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bulk_upload_drafts_company_status_idx" ON "bulk_upload_drafts" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX "bulk_upload_drafts_company_updated_idx" ON "bulk_upload_drafts" USING btree ("company_id","updated_at");
--> statement-breakpoint
CREATE TABLE "bulk_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"draft_id" uuid,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"detected_type" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"caption" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_suggested_caption" text,
	"scheduled_post_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bulk_uploads" ADD CONSTRAINT "bulk_uploads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bulk_uploads" ADD CONSTRAINT "bulk_uploads_draft_id_bulk_upload_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."bulk_upload_drafts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bulk_uploads" ADD CONSTRAINT "bulk_uploads_scheduled_post_id_social_posts_id_fk" FOREIGN KEY ("scheduled_post_id") REFERENCES "public"."social_posts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bulk_uploads_company_idx" ON "bulk_uploads" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "bulk_uploads_draft_idx" ON "bulk_uploads" USING btree ("draft_id");
--> statement-breakpoint
CREATE INDEX "bulk_uploads_draft_order_idx" ON "bulk_uploads" USING btree ("draft_id","order_index");
