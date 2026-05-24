CREATE TABLE "social_app_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_encrypted" jsonb NOT NULL,
	"client_secret_last4" text,
	"redirect_uri" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_validated_at" timestamp with time zone,
	"last_validation_status" text,
	"last_validation_message" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "social_app_credentials_platform_uniq" ON "social_app_credentials" USING btree ("platform");
--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "oauth_access_token_encrypted" jsonb;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "oauth_refresh_token_encrypted" jsonb;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "connect_method" text;
