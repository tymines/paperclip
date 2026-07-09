-- WO-4: Council Rooms — multi-boss deliberation rooms
-- ALL SHADOW (rooms_rail.enabled=false)

BEGIN;

-- 1. Drop old rooms.type CHECK and re-add with 'council'
ALTER TABLE "rooms" DROP CONSTRAINT IF EXISTS "rooms_type_check";
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_type_check" CHECK ("type" IN (
  'collaboration', 'war-room', 'brainstorm', 'team',
  'pipeline-idea', 'pipeline-spec', 'pipeline-design', 'pipeline-architecture',
  'pipeline-build', 'pipeline-review', 'pipeline-ship', 'pipeline-retro',
  'council'
));

-- 2. council_sessions table
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

-- 3. council_participants table
CREATE TABLE "council_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "position" text,
  "vote" text,
  "submitted_at" timestamp with time zone
);

-- 4. Foreign keys
ALTER TABLE "council_sessions" ADD CONSTRAINT "council_sessions_room_id_fk"
  FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "council_participants" ADD CONSTRAINT "council_participants_session_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."council_sessions"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "council_participants" ADD CONSTRAINT "council_participants_agent_id_fk"
  FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id")
  ON DELETE cascade ON UPDATE no action;

-- 5. Indexes
CREATE INDEX "council_sessions_room_idx" ON "council_sessions" ("room_id");
CREATE INDEX "council_participants_session_idx" ON "council_participants" ("session_id");
CREATE INDEX "council_participants_agent_idx" ON "council_participants" ("agent_id");

COMMIT;
