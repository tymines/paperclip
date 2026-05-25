import { boolean, index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * Per-company Jarvis configuration. Holds opt-in toggles that don't fit
 * naturally on the conversation row or persona file — things Tyler can flip
 * from the gear-icon panel on /TYL/jarvis.
 *
 * autoBriefOnLoad: when false (default), opening /TYL/jarvis never fires
 * the Daddy's Home briefing automatically. Tyler invoked this fix after
 * the auto-fire fired three times back-to-back on a single page load
 * (client double-mount + 4hr-debounce hole between sources). Manual
 * "Brief me" + Mac-wake + scheduled cron remain the supported triggers.
 */
export const companyJarvisSettings = pgTable(
  "company_jarvis_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    autoBriefOnLoad: boolean("auto_brief_on_load").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("company_jarvis_settings_company_idx").on(table.companyId),
    companyUq: uniqueIndex("company_jarvis_settings_company_uq").on(table.companyId),
  }),
);
