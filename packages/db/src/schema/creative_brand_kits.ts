import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Creative Studio P2 Ad Studio (Fable spec §3.3) — brand kits: name + product URL +
// visual identity fields folded into ad prompts. Migration 0151 (gated).
export const creativeBrandKits = pgTable(
  "creative_brand_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    productUrl: text("product_url"),
    logoUrl: text("logo_url"),
    colors: jsonb("colors").$type<string[]>().notNull().default([]),
    tone: text("tone"),
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("creative_brand_kits_company_idx").on(table.companyId),
  }),
);

export type CreativeBrandKit = typeof creativeBrandKits.$inferSelect;
export type NewCreativeBrandKit = typeof creativeBrandKits.$inferInsert;
