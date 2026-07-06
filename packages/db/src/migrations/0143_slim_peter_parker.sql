CREATE TABLE "gym_agent_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"prompt_candidate_id" uuid,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"average_score" integer,
	"best_score" integer,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"suite_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scores" jsonb,
	"overall_score" integer,
	"model_used" text DEFAULT 'gemini-2.5-flash' NOT NULL,
	"prompt_candidate_id" uuid,
	"agent_profile_id" uuid,
	"duration_ms" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_eval_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"test_cases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gym_prompt_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text NOT NULL,
	"user_prompt_template" text,
	"model" text DEFAULT 'gemini-2.5-flash' NOT NULL,
	"temperature" integer DEFAULT 70 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manuscript_chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" uuid NOT NULL,
	"chapter_number" integer NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_agent_profiles" ADD CONSTRAINT "gym_agent_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_agent_profiles" ADD CONSTRAINT "gym_agent_profiles_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_agent_profiles" ADD CONSTRAINT "gym_agent_profiles_prompt_candidate_id_gym_prompt_candidates_id_fk" FOREIGN KEY ("prompt_candidate_id") REFERENCES "public"."gym_prompt_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_eval_runs" ADD CONSTRAINT "gym_eval_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_eval_runs" ADD CONSTRAINT "gym_eval_runs_suite_id_gym_eval_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."gym_eval_suites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_eval_runs" ADD CONSTRAINT "gym_eval_runs_prompt_candidate_id_gym_prompt_candidates_id_fk" FOREIGN KEY ("prompt_candidate_id") REFERENCES "public"."gym_prompt_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_eval_runs" ADD CONSTRAINT "gym_eval_runs_agent_profile_id_gym_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."gym_agent_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_eval_suites" ADD CONSTRAINT "gym_eval_suites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_prompt_candidates" ADD CONSTRAINT "gym_prompt_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_chapters" ADD CONSTRAINT "manuscript_chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_agent_profiles_company_idx" ON "gym_agent_profiles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "gym_agent_profiles_agent_idx" ON "gym_agent_profiles" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "gym_eval_runs_company_suite_idx" ON "gym_eval_runs" USING btree ("company_id","suite_id");--> statement-breakpoint
CREATE INDEX "gym_eval_runs_suite_idx" ON "gym_eval_runs" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "gym_eval_suites_company_idx" ON "gym_eval_suites" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_eval_suites_company_name_unique" ON "gym_eval_suites" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "gym_prompt_candidates_company_idx" ON "gym_prompt_candidates" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_prompt_candidates_company_name_unique" ON "gym_prompt_candidates" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "manuscript_chapters_book_chapter_unique_idx" ON "manuscript_chapters" USING btree ("book_id","chapter_number");