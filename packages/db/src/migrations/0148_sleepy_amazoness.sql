CREATE TABLE "council_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"position" text,
	"vote" text,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "council_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"consensus_protocol" text DEFAULT 'majority' NOT NULL,
	"status" text DEFAULT 'deliberating' NOT NULL,
	"deadline_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "room_bosses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_type" text NOT NULL,
	"boss_agent_id" uuid,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_bosses_room_type_unique" UNIQUE("room_type")
);
--> statement-breakpoint
CREATE TABLE "room_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"from_stage" text NOT NULL,
	"to_stage" text NOT NULL,
	"triggered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms_rail_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rail_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rail_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"agent_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "council_participants" ADD CONSTRAINT "council_participants_session_id_council_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_participants" ADD CONSTRAINT "council_participants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_sessions" ADD CONSTRAINT "council_sessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuscript_chapters" ADD CONSTRAINT "manuscript_chapters_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_bosses" ADD CONSTRAINT "room_bosses_boss_agent_id_agents_id_fk" FOREIGN KEY ("boss_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_events" ADD CONSTRAINT "rail_events_task_id_issues_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rail_events" ADD CONSTRAINT "rail_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "council_participants_session_idx" ON "council_participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "council_participants_agent_idx" ON "council_participants" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "council_sessions_room_idx" ON "council_sessions" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manuscript_chapters_book_chapter_unique_idx" ON "manuscript_chapters" USING btree ("book_id","chapter_number");--> statement-breakpoint
CREATE INDEX "room_bosses_room_type_idx" ON "room_bosses" USING btree ("room_type");--> statement-breakpoint
CREATE INDEX "rail_events_task_type_idx" ON "rail_events" USING btree ("task_id","type");--> statement-breakpoint
CREATE INDEX "rail_events_type_created_idx" ON "rail_events" USING btree ("type","created_at");