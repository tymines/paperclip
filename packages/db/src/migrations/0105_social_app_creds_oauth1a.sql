ALTER TABLE "social_app_credentials" ADD COLUMN "consumer_key" text;--> statement-breakpoint
ALTER TABLE "social_app_credentials" ADD COLUMN "consumer_secret_encrypted" jsonb;--> statement-breakpoint
ALTER TABLE "social_app_credentials" ADD COLUMN "consumer_secret_last4" text;--> statement-breakpoint
ALTER TABLE "social_app_credentials" ADD COLUMN "bearer_token_encrypted" jsonb;--> statement-breakpoint
ALTER TABLE "social_app_credentials" ADD COLUMN "bearer_token_last4" text;--> statement-breakpoint
ALTER TABLE "social_app_credentials" ADD COLUMN "default_scopes" jsonb;
