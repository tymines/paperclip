CREATE TABLE IF NOT EXISTS "webhook_event_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "processed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_event_log_source_created_idx"
  ON "webhook_event_log" USING btree ("source", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_event_log_event_type_idx"
  ON "webhook_event_log" USING btree ("event_type");
