ALTER TABLE "company_skills" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_skills" ADD COLUMN "icon_key" text;
