CREATE TABLE IF NOT EXISTS "prompt_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"category" text DEFAULT 'misc' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"source" text,
	"source_url" text,
	"license" text,
	"created_by" text DEFAULT 'seed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompt_categories" ADD CONSTRAINT "prompt_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "prompts" ADD CONSTRAINT "prompts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prompt_categories_company_key_unique" ON "prompt_categories" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompt_categories_sort_idx" ON "prompt_categories" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompts_company_idx" ON "prompts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prompts_category_idx" ON "prompts" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prompts_seed_key_unique" ON "prompts" USING btree ("source","title");--> statement-breakpoint
-- Seed built-in prompt categories (global; company_id NULL). Idempotent.
INSERT INTO "prompt_categories" ("company_id","key","label","description","icon","sort_order")
SELECT v.company_id, v.key, v.label, v.description, v.icon, v.sort_order
FROM (VALUES
	(NULL::uuid, 'patterns',     'Superpowers Patterns',    'Reusable agent workflow patterns — brainstorming, planning, TDD.', 'sparkles',       0),
	(NULL::uuid, 'agents',       'Agent Roles',             'System prompts that define a fleet agent''s role and behavior.',   'bot',            1),
	(NULL::uuid, 'coding',       'Coding & Dev',            'Programming, debugging, code review and developer tooling.',       'code',           2),
	(NULL::uuid, 'research',     'Research & Analysis',     'Investigation, synthesis, comparison and fact-checking.',          'search',         3),
	(NULL::uuid, 'writing',      'Writing & Content',       'Drafting, editing, summarizing and content creation.',             'pen-line',       4),
	(NULL::uuid, 'productivity', 'Productivity & Planning', 'Task planning, decision docs, prioritization and workflows.',      'target',         5),
	(NULL::uuid, 'business',     'Business & Marketing',    'Strategy, marketing, sales and customer communications.',          'briefcase',      6),
	(NULL::uuid, 'learning',     'Learning & Teaching',     'Tutoring, explanations and study aids.',                           'graduation-cap', 7),
	(NULL::uuid, 'roleplay',     'Personas & Roleplay',     'Character, persona and "act as" style prompts.',                   'drama',          8),
	(NULL::uuid, 'misc',         'Other',                   'Uncategorized and general-purpose prompts.',                       'shapes',         9)
) AS v(company_id, key, label, description, icon, sort_order)
WHERE NOT EXISTS (
	SELECT 1 FROM "prompt_categories" c
	WHERE c."company_id" IS NULL AND c."key" = v.key
);
