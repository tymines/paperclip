CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"username" text,
	"avatar_url" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'connected' NOT NULL,
	"metadata" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"post_type" text DEFAULT 'text' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"media_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_post_id" text,
	"platform_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"error_message" text,
	"published_at" timestamp with time zone,
	"analytics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_post_id_social_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_account_id_social_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_accounts_company_platform_idx" ON "social_accounts" USING btree ("company_id","platform");--> statement-breakpoint
CREATE INDEX "social_accounts_company_status_idx" ON "social_accounts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "social_accounts_platform_account_idx" ON "social_accounts" USING btree ("platform","platform_account_id");--> statement-breakpoint
CREATE INDEX "social_posts_company_status_idx" ON "social_posts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "social_posts_company_scheduled_idx" ON "social_posts" USING btree ("company_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "social_posts_company_created_idx" ON "social_posts" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "social_post_targets_post_idx" ON "social_post_targets" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "social_post_targets_account_idx" ON "social_post_targets" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "social_post_targets_status_idx" ON "social_post_targets" USING btree ("status");
