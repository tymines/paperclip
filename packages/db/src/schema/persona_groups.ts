import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * persona_groups — optional folders for organizing trained LoRA personas on the
 * Personas management surface. Company-scoped (null = a global/shared folder).
 */
export const personaGroups = pgTable(
  "persona_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Optional accent color (hex) for the folder chip.
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("persona_groups_company_idx").on(table.companyId),
  }),
);
