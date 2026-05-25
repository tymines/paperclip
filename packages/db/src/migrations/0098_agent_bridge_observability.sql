CREATE TABLE IF NOT EXISTS "_bridge_health" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "test_message" text NOT NULL,
  "checksum" text NOT NULL,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_bridge_reply_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "room_id" uuid,
  "agent_id" uuid,
  "content_length" integer DEFAULT 0 NOT NULL,
  "outcome" text NOT NULL,
  "error_detail" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_bridge_reply_attempts_agent_created_idx"
  ON "agent_bridge_reply_attempts" USING btree ("agent_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_bridge_reply_attempts_company_created_idx"
  ON "agent_bridge_reply_attempts" USING btree ("company_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_bridge_reply_attempts_outcome_idx"
  ON "agent_bridge_reply_attempts" USING btree ("outcome");
