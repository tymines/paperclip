import { pgTable, uuid, text, numeric, integer, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { personaGroups } from "./persona_groups.js";

export const imageProviders = pgTable(
  "image_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("external_api"),
    // Hosted inference host (0125 multi-provider): 'replicate' | 'atlascloud' |
    // 'wavespeedai'. Distinct from `providerKey` (a free-form label) and `type`
    // (local_lora vs external_api).
    providerHost: text("provider_host").notNull().default("replicate"),
    providerKey: text("provider_key"),
    endpoint: text("endpoint"),
    model: text("model"),
    defaultParams: jsonb("default_params").$type<Record<string, unknown>>(),
    // Long-form persona bio, prepended as prompt context by the assembler.
    bio: text("bio"),
    // Structured attribute defaults (gender/age/body_type/hair/etc + trigger_word)
    // that pre-fill the Generate panel's controls. See prompt-assembler.ts.
    attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}),
    costPerUnit: numeric("cost_per_unit", { precision: 10, scale: 6 }).notNull().default("0"),
    status: text("status"),
    statusDetail: text("status_detail"),
    // Replicate cloud LoRA training: whether this provider can run training
    // jobs, and the hosted trainer model it uses (e.g. ostris/flux-dev-lora-trainer).
    trainingCapable: boolean("training_capable").notNull().default(false),
    trainingModel: text("training_model"),
    sortOrder: integer("sort_order").notNull().default(0),
    // Persona CMS (0123): folder, cover image (uploads-relative), pin flag.
    groupId: uuid("group_id").references(() => personaGroups.id, { onDelete: "set null" }),
    avatarPath: text("avatar_path"),
    isFavorite: boolean("is_favorite").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("image_providers_company_idx").on(table.companyId),
    typeIdx: index("image_providers_type_idx").on(table.type),
    sortOrderIdx: index("image_providers_sort_order_idx").on(table.companyId, table.sortOrder),
    groupIdx: index("image_providers_group_idx").on(table.groupId),
  }),
);
