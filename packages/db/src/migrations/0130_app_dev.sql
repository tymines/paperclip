CREATE TABLE IF NOT EXISTS "app_dev_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"kind" text DEFAULT 'app' NOT NULL,
	"feedback_origin_id" text,
	"repo" text,
	"owner_agent_id" uuid,
	"accent" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_dev_blueprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"starter_stack" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_dev_apps" ADD CONSTRAINT "app_dev_apps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_dev_apps" ADD CONSTRAINT "app_dev_apps_owner_agent_id_agents_id_fk" FOREIGN KEY ("owner_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_dev_blueprints" ADD CONSTRAINT "app_dev_blueprints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_dev_apps_company_key_unique" ON "app_dev_apps" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_dev_apps_company_idx" ON "app_dev_apps" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_dev_blueprints_category_idx" ON "app_dev_blueprints" USING btree ("category","sort_order");--> statement-breakpoint
-- Seed built-in blueprint templates (global; company_id NULL). Idempotent.
INSERT INTO "app_dev_blueprints" ("company_id","category","name","description","icon","starter_stack","sort_order")
SELECT v.company_id, v.category, v.name, v.description, v.icon, v.starter_stack::jsonb, v.sort_order
FROM (VALUES
	(NULL::uuid, 'lifestyle',   'Habit & Focus Companion', 'Daily planner, streaks, reminders and a focus timer.', 'heart',      '["Expo / React Native","Local notifications","SQLite","Health data opt-in"]', 0),
	(NULL::uuid, 'lifestyle',   'Wellness Journal',        'Mood, sleep and gratitude logging with weekly insights.', 'heart',     '["Expo / React Native","Charts","On-device storage"]', 1),
	(NULL::uuid, 'dashboard',   'Operator Command Center', 'Internal metrics, health checks and agent controls.', 'layout-grid', '["React + Vite","Tailwind","Recharts","REST/SSE"]', 0),
	(NULL::uuid, 'dashboard',   'Analytics Cockpit',       'KPI tiles, time-series and drill-downs for a team.', 'layout-grid',  '["Next.js","Postgres","Drizzle","Charting"]', 1),
	(NULL::uuid, 'marketplace', 'Multi-vendor Marketplace','Listings, carts, checkout and vendor payouts.', 'shopping-bag',      '["Next.js","Stripe Connect","Postgres","Search"]', 0),
	(NULL::uuid, 'marketplace', 'Booking & Reservations',  'Availability, scheduling and payment holds.', 'shopping-bag',        '["React Native","Calendar","Stripe","Webhooks"]', 1),
	(NULL::uuid, 'social',      'Community & Feed',         'Profiles, posts, follows and a ranked feed.', 'users',               '["Expo / React Native","Feed ranking","Push","Media"]', 0),
	(NULL::uuid, 'social',      'Group Messaging',          'Rooms, DMs and presence with realtime delivery.', 'users',           '["WebSockets","Presence","E2E option","Media"]', 1)
) AS v(company_id, category, name, description, icon, starter_stack, sort_order)
WHERE NOT EXISTS (
	SELECT 1 FROM "app_dev_blueprints" b
	WHERE b."company_id" IS NULL AND b."name" = v.name AND b."category" = v.category
);
