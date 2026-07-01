import { pgTable, uuid, text, numeric, integer, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { imageProviders } from "./image_providers.js";
import { promptTemplates } from "./prompt_templates.js";

/**
 * generation_jobs — one row per queued render fired from the Image Studio
 * batch-generate composer.
 *
 * A `batchId` groups every job produced by a single generate request (prompt ×
 * variation expansion × count). The replicate-generator worker submits each job
 * to Replicate, polls it, and on success downloads the PNG into the uploads dir
 * + inserts a persona_generations row so the image lands in the persona gallery.
 *
 * status: queued → submitted → polling → succeeded | failed.
 * `contentRating` ('sfw'|'explicit') drives disable_safety_checker at inference.
 */
export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => imageProviders.id, { onDelete: "cascade" }),
    promptTemplateId: uuid("prompt_template_id").references(() => promptTemplates.id, {
      onDelete: "set null",
    }),
    batchId: uuid("batch_id").notNull(),
    // Which hosted inference provider this job runs on (0125 multi-provider):
    // 'replicate' | 'atlascloud' | 'wavespeedai'.
    providerHost: text("provider_host").notNull().default("replicate"),
    // Provider-native model id actually fired (e.g. 'bytedance/seedream-v5.0-lite').
    // Null = the provider's default persona/image model. Recorded so the A/B
    // compare across providers is meaningful.
    model: text("model"),
    promptText: text("prompt_text").notNull(),
    loraScale: numeric("lora_scale", { precision: 4, scale: 2 }),
    steps: integer("steps"),
    guidance: numeric("guidance", { precision: 4, scale: 2 }),
    aspectRatio: text("aspect_ratio"),
    seed: bigint("seed", { mode: "number" }),
    status: text("status").notNull().default("queued"),
    replicatePredictionId: text("replicate_prediction_id"),
    outputPath: text("output_path"),
    contentRating: text("content_rating").notNull().default("sfw"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    // Split cost tracking (0125): estimate at enqueue, actual once landed.
    costEstimateUsd: numeric("cost_estimate_usd", { precision: 10, scale: 4 }),
    actualCostUsd: numeric("actual_cost_usd", { precision: 10, scale: 4 }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    personaCreatedIdx: index("generation_jobs_persona_created_idx").on(
      table.personaId,
      table.createdAt.desc(),
    ),
    batchIdx: index("generation_jobs_batch_idx").on(table.batchId),
    statusIdx: index("generation_jobs_status_idx").on(table.status),
    providerHostIdx: index("generation_jobs_provider_host_idx").on(table.providerHost),
  }),
);

export type GenerationJob = typeof generationJobs.$inferSelect;
export type NewGenerationJob = typeof generationJobs.$inferInsert;
