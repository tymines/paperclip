CREATE TABLE "company_jarvis_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"auto_brief_on_load" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_jarvis_settings" ADD CONSTRAINT "company_jarvis_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "company_jarvis_settings_company_idx" ON "company_jarvis_settings" USING btree ("company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "company_jarvis_settings_company_uq" ON "company_jarvis_settings" USING btree ("company_id");
