CREATE TABLE "jarvis_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_actor_id" text NOT NULL,
	"user_transcript" text NOT NULL,
	"agent_reply" text NOT NULL,
	"voice_tier" text DEFAULT 'browser-native' NOT NULL,
	"llm_provider" text,
	"llm_model" text,
	"context_snapshot" jsonb,
	"latency_ms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jarvis_conversations" ADD CONSTRAINT "jarvis_conversations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "jarvis_conversations_company_created_idx" ON "jarvis_conversations" USING btree ("company_id","created_at");
