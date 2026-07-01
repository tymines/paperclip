CREATE TABLE IF NOT EXISTS "skill_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"actor_type" text DEFAULT 'agent' NOT NULL,
	"actor_id" text,
	"agent_name" text,
	"context" text,
	"outcome" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_usage_events" ADD CONSTRAINT "skill_usage_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "skill_usage_events" ADD CONSTRAINT "skill_usage_events_skill_id_company_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."company_skills"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sue_skill_id_idx" ON "skill_usage_events" USING btree ("company_id","skill_id");
--> statement-breakpoint
CREATE INDEX "sue_company_idx" ON "skill_usage_events" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX "sue_created_at_idx" ON "skill_usage_events" USING btree ("company_id","skill_id","created_at");
