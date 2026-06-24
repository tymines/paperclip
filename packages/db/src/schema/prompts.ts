import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * prompt_categories — categories for the Prompts library tab.
 *
 * Built-in categories are global (company_id NULL); companies may add their
 * own. `key` is a stable slug used by prompts.category and the UI filters.
 */
export const promptCategories = pgTable(
  "prompt_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    keyUnique: uniqueIndex("prompt_categories_company_key_unique").on(
      table.companyId,
      table.key,
    ),
    sortIdx: index("prompt_categories_sort_idx").on(table.sortOrder),
  }),
);

/**
 * prompts — the reusable prompt library.
 *
 * Global seeds (curated fleet prompts + imported CC0 prompts.chat data) carry
 * company_id NULL; user-authored prompts carry their company_id. Nothing here
 * is fabricated: each row records its real `source`/`sourceUrl`/`license`.
 *
 *  - `body`     : the prompt / template text (may contain {{placeholders}}).
 *  - `variables`: placeholder names parsed from {{...}} in the body.
 *  - `isTemplate`: true when the body has at least one {{placeholder}}.
 *  - `tags`     : free-form tags for filtering.
 *  - `source`   : human attribution (e.g. "f/prompts.chat (CC0)", "Paperclip fleet").
 *  - `license`  : SPDX-ish license id (e.g. "CC0-1.0") for redistributable seeds.
 *  - `createdBy`: "seed" for seeded rows, otherwise the author user id.
 */
export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").notNull().default("misc"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    variables: jsonb("variables").$type<string[]>().notNull().default([]),
    isTemplate: boolean("is_template").notNull().default(false),
    source: text("source"),
    sourceUrl: text("source_url"),
    license: text("license"),
    createdBy: text("created_by").notNull().default("seed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyIdx: index("prompts_company_idx").on(table.companyId),
    categoryIdx: index("prompts_category_idx").on(table.category),
    // Natural key for idempotent seeding of global rows: (source, title).
    seedKeyUnique: uniqueIndex("prompts_seed_key_unique").on(
      table.source,
      table.title,
    ),
  }),
);

export type PromptCategory = typeof promptCategories.$inferSelect;
export type NewPromptCategory = typeof promptCategories.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
