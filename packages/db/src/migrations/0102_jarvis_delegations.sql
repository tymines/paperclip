CREATE TABLE "jarvis_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"conversation_id" uuid,
	"agent" text NOT NULL,
	"task" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" text,
	"metadata" jsonb,
	"requested_by_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "jarvis_delegations" ADD CONSTRAINT "jarvis_delegations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jarvis_delegations" ADD CONSTRAINT "jarvis_delegations_conversation_id_jarvis_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jarvis_conversations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "jarvis_delegations_company_created_idx" ON "jarvis_delegations" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE INDEX "jarvis_delegations_status_idx" ON "jarvis_delegations" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "jarvis_delegations_conversation_idx" ON "jarvis_delegations" USING btree ("conversation_id");
