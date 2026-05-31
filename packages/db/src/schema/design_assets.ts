import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { designRuns } from "./design_runs.js";
import { companies } from "./companies.js";

export const designAssets = pgTable(
  "design_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => designRuns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("image"), // "image" | "video"
    path: text("path").notNull(),
    url: text("url"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    slideIndex: integer("slide_index").notNull().default(0),
    skill: text("skill"),
    prompt: text("prompt"),
    agentId: text("agent_id"),
    persona: text("persona"),
    favorited: boolean("favorited").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("design_assets_company_created_idx").on(
      table.companyId,
      table.createdAt,
    ),
    runIdIdx: index("design_assets_run_id_idx").on(table.runId),
    kindIdx: index("design_assets_kind_idx").on(table.kind),
    favoritedIdx: index("design_assets_favorited_idx").on(table.favorited),
    skillIdx: index("design_assets_skill_idx").on(table.skill),
  }),
);

export type DesignAsset = typeof designAssets.$inferSelect;
export type NewDesignAsset = typeof designAssets.$inferInsert;
