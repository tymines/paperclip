CREATE TABLE "jarvis_learned_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_actor_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source_message_id" uuid,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jarvis_learned_preferences" ADD CONSTRAINT "jarvis_learned_preferences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "jarvis_learned_preferences" ADD CONSTRAINT "jarvis_learned_preferences_source_message_id_jarvis_conversations_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."jarvis_conversations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "jarvis_learned_preferences_actor_key_uq" ON "jarvis_learned_preferences" USING btree ("company_id","user_actor_id","key");
--> statement-breakpoint
CREATE INDEX "jarvis_learned_preferences_actor_confidence_idx" ON "jarvis_learned_preferences" USING btree ("company_id","user_actor_id","confidence");
--> statement-breakpoint
-- Seed the three known-from-memory preferences for every actor that has
-- already had a conversation in Tyler's company (issue_prefix = 'TYL').
-- Idempotent via the unique (company_id, user_actor_id, key) index.
INSERT INTO "jarvis_learned_preferences" ("company_id", "user_actor_id", "key", "value", "confidence")
SELECT DISTINCT c."id", jc."user_actor_id", v."key", v."value", v."confidence"
FROM "companies" c
JOIN "jarvis_conversations" jc ON jc."company_id" = c."id"
CROSS JOIN (VALUES
  ('briefing_focus', 'work_first_not_revenue', 1.0::real),
  ('length_budget', 'tight_no_book', 1.0::real),
  ('voice_provider', 'elevenlabs_adam', 0.9::real)
) AS v("key", "value", "confidence")
WHERE c."issue_prefix" = 'TYL'
ON CONFLICT ("company_id", "user_actor_id", "key") DO NOTHING;
