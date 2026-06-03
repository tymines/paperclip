import { pgTable, uuid, text, numeric, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { imageProviders } from "./image_providers.js";

/**
 * persona_generations — one row per rendered image for a local_lora persona.
 *
 * Powers the Image Studio persona card gallery: a live preview / portfolio of
 * the images a persona's LoRA produces. `source` distinguishes hand-curated
 * 'test' previews from 'production' renders fired through the pipeline.
 *
 * `imagePath` / `thumbnailPath` are RELATIVE to the Paperclip uploads dir
 * (served at /api/uploads/...), e.g. 'personas/sidney-sfw/test-001.png'.
 *
 * `contentRating` mirrors the lora_training_jobs guard — 'explicit' rows can be
 * hard-rejected from SFW-only surfaces downstream.
 */
export const personaGenerations = pgTable(
  "persona_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => imageProviders.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("production"),
    prompt: text("prompt"),
    loraStrength: numeric("lora_strength", { precision: 4, scale: 2 }),
    model: text("model"),
    imagePath: text("image_path").notNull(),
    thumbnailPath: text("thumbnail_path"),
    generationMetadata: jsonb("generation_metadata").$type<Record<string, unknown>>(),
    replicatePredictionId: text("replicate_prediction_id"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    contentRating: text("content_rating").notNull().default("sfw"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    personaCreatedIdx: index("persona_generations_persona_created_idx").on(
      table.personaId,
      table.createdAt.desc(),
    ),
  }),
);

export type PersonaGeneration = typeof personaGenerations.$inferSelect;
export type NewPersonaGeneration = typeof personaGenerations.$inferInsert;
