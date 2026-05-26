-- Restore dm.read / dm.write to the stored default scopes for X. We dropped
-- them in 0105 because the X dev app was Read+Write only; Tyler has now
-- flipped App permissions to "Read and write and Direct messages" so the
-- consent screen will accept them again.
UPDATE "social_app_credentials"
   SET "default_scopes" = '["tweet.read","tweet.write","users.read","offline.access","dm.read","dm.write"]'::jsonb,
       "updated_at" = NOW()
 WHERE "platform" = 'x';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "social_dms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "social_account_id" uuid NOT NULL REFERENCES "social_accounts"("id") ON DELETE CASCADE,
  "platform" text NOT NULL,
  "thread_id" text NOT NULL,
  "message_id" text NOT NULL,
  "direction" text NOT NULL,
  "sender_platform_user_id" text,
  "sender_handle" text,
  "sender_display_name" text,
  "sender_avatar_url" text,
  "sender_verified" boolean NOT NULL DEFAULT false,
  "sender_is_first_contact" boolean NOT NULL DEFAULT false,
  "text" text,
  "media_urls" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sent_at" timestamp with time zone NOT NULL,
  "read_at" timestamp with time zone,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "social_dms_account_sent_idx" ON "social_dms" ("social_account_id", "sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_dms_thread_idx" ON "social_dms" ("social_account_id", "thread_id", "sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_dms_unread_idx" ON "social_dms" ("social_account_id", "read_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_dms_platform_message_uniq" ON "social_dms" ("platform", "message_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "jarvis_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid,
  "source" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "ref_type" text,
  "ref_id" text,
  "metadata" jsonb,
  "severity" text NOT NULL DEFAULT 'info',
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "seen_at" timestamp with time zone,
  "dismissed_at" timestamp with time zone
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "jarvis_alerts_company_created_idx" ON "jarvis_alerts" ("company_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jarvis_alerts_source_idx" ON "jarvis_alerts" ("source", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jarvis_alerts_pending_idx" ON "jarvis_alerts" ("dismissed_at", "created_at");
