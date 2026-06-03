import { pgTable, uuid, text, numeric, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { imageProviders } from "./image_providers.js";

/**
 * lora_training_jobs — one row per cloud LoRA training run.
 *
 * Tracks a Replicate (`ostris/flux-dev-lora-trainer`) training job end to end:
 * pending → uploading → training → downloading → ready (or failed). On success
 * the `.safetensors` output is installed into ComfyUI's loras directory and
 * `output_lora_path` is recorded.
 *
 * `contentRating` is the NSFW guard: jobs trained with a `sidney_nsfw` trigger
 * word are tagged 'explicit' so SFW-only schedulers (IG / TikTok) can reject
 * the resulting persona output. See server image-studio/nsfw-guard.ts.
 */
export const loraTrainingJobs = pgTable(
  "lora_training_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    // The local_lora persona being trained.
    personaId: uuid("persona_id")
      .notNull()
      .references(() => imageProviders.id, { onDelete: "cascade" }),
    // The trainer provider (e.g. Replicate).
    providerId: uuid("provider_id")
      .notNull()
      .references(() => imageProviders.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    contentRating: text("content_rating").notNull().default("sfw"),
    externalJobId: text("external_job_id"),
    trainingZipPath: text("training_zip_path"),
    outputLoraPath: text("output_lora_path"),
    triggerWord: text("trigger_word"),
    progress: integer("progress").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    errorMessage: text("error_message"),
    hyperparams: jsonb("hyperparams").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    personaIdx: index("lora_training_jobs_persona_idx").on(table.personaId),
    statusIdx: index("lora_training_jobs_status_idx").on(table.status),
    externalIdx: index("lora_training_jobs_external_idx").on(table.externalJobId),
    companyIdx: index("lora_training_jobs_company_idx").on(table.companyId),
  }),
);

export type LoraTrainingJob = typeof loraTrainingJobs.$inferSelect;
export type NewLoraTrainingJob = typeof loraTrainingJobs.$inferInsert;
