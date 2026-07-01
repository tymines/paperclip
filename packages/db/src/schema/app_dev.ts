import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * app_dev_apps — first-class registry of the apps surfaced in the App Dev page.
 *
 * Rows are self-provisioned by the App Dev apps endpoint from REAL signals:
 *  - a "cockpit" row (key=missioncontrol) per company, and
 *  - one "app" row per distinct app-feedback originId (e.g. bailysapp).
 * `feedbackOriginId` links a row to its real inbound feedback (issues.origin_id).
 */
export const appDevApps = pgTable(
  "app_dev_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    kind: text("kind").notNull().default("app"), // 'cockpit' | 'app'
    feedbackOriginId: text("feedback_origin_id"),
    repo: text("repo"),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id),
    accent: text("accent"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyKeyUnique: uniqueIndex("app_dev_apps_company_key_unique").on(
      table.companyId,
      table.key,
    ),
    companyIdx: index("app_dev_apps_company_idx").on(table.companyId),
  }),
);

/**
 * app_dev_blueprints — catalog of real app starter templates by category.
 * Built-ins are global (company_id NULL); companies may add their own later.
 */
export const appDevBlueprints = pgTable(
  "app_dev_blueprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id),
    category: text("category").notNull(), // lifestyle | dashboard | marketplace | social
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    starterStack: jsonb("starter_stack").$type<string[]>(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    categoryIdx: index("app_dev_blueprints_category_idx").on(
      table.category,
      table.sortOrder,
    ),
  }),
);
