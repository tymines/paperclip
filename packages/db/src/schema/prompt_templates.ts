import { pgTable, uuid, text, numeric, integer, timestamp, index } from "drizzle-orm/pg-core";
import { imageProviders } from "./image_providers.js";

/**
 * prompt_templates — reusable prompt recipes for the Image Studio composer.
 *
 * A template is either persona-specific (personaId → a local_lora persona) or
 * shared (personaId IS NULL, available to every persona). `templateText` may
 * embed {variation:a|b|c} placeholders the generate endpoint cross-product
 * expands into a batch. `contentRating` is a LABEL only ('sfw'|'explicit').
 */
export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    personaId: uuid("persona_id").references(() => imageProviders.id, { onDelete: "cascade" }),
    templateText: text("template_text").notNull(),
    defaultLoraScale: numeric("default_lora_scale", { precision: 4, scale: 2 }),
    defaultSteps: integer("default_steps"),
    defaultGuidance: numeric("default_guidance", { precision: 4, scale: 2 }),
    defaultAspectRatio: text("default_aspect_ratio"),
    contentRating: text("content_rating").notNull().default("sfw"),
    tags: text("tags").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    personaIdx: index("prompt_templates_persona_idx").on(table.personaId),
  }),
);

export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type NewPromptTemplate = typeof promptTemplates.$inferInsert;
