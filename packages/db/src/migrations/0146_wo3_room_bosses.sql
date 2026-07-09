-- WO-3: Boss/Worker Topology — room_bosses table
-- SHADOW: rooms_rail.enabled=false, table created but registry is dormant until wiring

CREATE TABLE "room_bosses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "room_type" text NOT NULL,
  "boss_agent_id" uuid,
  "config" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "room_bosses" ADD CONSTRAINT "room_bosses_boss_agent_id_agents_id_fk" FOREIGN KEY ("boss_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "room_bosses" ADD CONSTRAINT "room_bosses_room_type_unique" UNIQUE("room_type");
--> statement-breakpoint

CREATE INDEX "room_bosses_room_type_idx" ON "room_bosses" USING btree ("room_type");
--> statement-breakpoint

-- Seed boss assignments (agents must already exist — find by name)
INSERT INTO "room_bosses" ("room_type", "boss_agent_id", "config")
SELECT 'pipeline-idea', id, '{}'::jsonb FROM "agents" WHERE "name" = 'Zeus'
UNION ALL
SELECT 'pipeline-spec', NULL, '{}'::jsonb
UNION ALL
SELECT 'pipeline-design', id, '{}'::jsonb FROM "agents" WHERE "name" = 'Hermes Designer'
UNION ALL
SELECT 'pipeline-build', NULL, '{}'::jsonb
UNION ALL
SELECT 'pipeline-review', id, '{}'::jsonb FROM "agents" WHERE "name" = 'Ares'
UNION ALL
SELECT 'pipeline-ship', NULL, '{}'::jsonb
UNION ALL
SELECT 'brainstorm', id, '{}'::jsonb FROM "agents" WHERE "name" = 'Zeus Critic';
