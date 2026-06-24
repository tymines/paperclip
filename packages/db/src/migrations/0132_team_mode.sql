-- Team Mode (AionUi port) — ADDITIVE. Nothing dropped, no backfill.
-- 1) agent_operations: durable run-log for the broadcast-only `agent.work` events.
-- 2) team_task_dependencies: blocks / blocked-by edge set for the task board.
-- 3) jarvis_delegations: two nullable columns (worker_status, team_run_id).
CREATE TABLE IF NOT EXISTS "agent_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid,
	"delegation_id" uuid,
	"room_id" text,
	"turn_id" text NOT NULL,
	"kind" text NOT NULL,
	"tool_name" text,
	"mutated" boolean,
	"artifact" jsonb,
	"outcome" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"delegation_id" uuid NOT NULL,
	"depends_on_delegation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jarvis_delegations" ADD COLUMN IF NOT EXISTS "worker_status" text;--> statement-breakpoint
ALTER TABLE "jarvis_delegations" ADD COLUMN IF NOT EXISTS "team_run_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_operations" ADD CONSTRAINT "agent_operations_delegation_id_jarvis_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."jarvis_delegations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_task_dependencies" ADD CONSTRAINT "team_task_dependencies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_task_dependencies" ADD CONSTRAINT "team_task_dependencies_delegation_id_jarvis_delegations_id_fk" FOREIGN KEY ("delegation_id") REFERENCES "public"."jarvis_delegations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_task_dependencies" ADD CONSTRAINT "team_task_dependencies_depends_on_delegation_id_jarvis_delegations_id_fk" FOREIGN KEY ("depends_on_delegation_id") REFERENCES "public"."jarvis_delegations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_company_created_idx" ON "agent_operations" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_agent_created_idx" ON "agent_operations" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_delegation_idx" ON "agent_operations" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_operations_turn_idx" ON "agent_operations" USING btree ("turn_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_task_dependencies_edge_unique" ON "team_task_dependencies" USING btree ("delegation_id","depends_on_delegation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_task_dependencies_company_idx" ON "team_task_dependencies" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_task_dependencies_delegation_idx" ON "team_task_dependencies" USING btree ("delegation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_task_dependencies_depends_on_idx" ON "team_task_dependencies" USING btree ("depends_on_delegation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jarvis_delegations_team_run_idx" ON "jarvis_delegations" USING btree ("team_run_id");
