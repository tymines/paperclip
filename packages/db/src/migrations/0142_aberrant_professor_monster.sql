CREATE TABLE "rail_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rail_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"agent_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "gate_class" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "last_artifact_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "stall_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "release_sha" text;--> statement-breakpoint
ALTER TABLE "rail_events" ADD CONSTRAINT "rail_events_task_id_issues_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_events" ADD CONSTRAINT "rail_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rail_events_task_type_idx" ON "rail_events" USING btree ("task_id","type");--> statement-breakpoint
CREATE INDEX "rail_events_type_created_idx" ON "rail_events" USING btree ("type","created_at");