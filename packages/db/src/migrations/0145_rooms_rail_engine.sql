-- WO-2: Rooms Rail Engine — SHADOW mode (enabled=false)
-- Deterministic daemon that drives pipeline room transitions

CREATE TABLE "rooms_rail_config" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
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

CREATE INDEX "room_transitions_room_idx" ON "room_transitions" USING btree ("room_id");
--> statement-breakpoint

-- Seed: rail is disabled by default
INSERT INTO "rooms_rail_config" ("key", "value") VALUES
  ('enabled', 'false'::jsonb);
