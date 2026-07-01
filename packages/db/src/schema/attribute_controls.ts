import { pgTable, serial, text, integer, jsonb, boolean, index } from "drizzle-orm/pg-core";

/**
 * attribute_controls — the data-driven catalog of structured controls that power
 * the Image Studio Generate panel (Pose / Hair / Body / Outfit / Scene /
 * Lighting). The UI renders whatever lives here, so new controls ship as rows,
 * not code.
 *
 * `controlType` picks the UI primitive ('toggle' | 'slider' | 'swatch' |
 * 'card_grid'); `category` drives the stable assembly order (identity → body →
 * face → pose → wardrobe → scene → lighting). `promptTemplate` is the snippet
 * the chosen option's fragment is interpolated into (currently always '{value}').
 * `applicableTo` optionally scopes a control to certain persona types.
 */
export const attributeControls = pgTable(
  "attribute_controls",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull().unique(),
    label: text("label").notNull(),
    controlType: text("control_type").notNull(),
    category: text("category").notNull(),
    promptTemplate: text("prompt_template").notNull(),
    helperText: text("helper_text"),
    sortOrder: integer("sort_order").default(0),
    applicableTo: jsonb("applicable_to").$type<string[] | null>(),
    enabled: boolean("enabled").default(true),
  },
  (table) => ({
    categoryIdx: index("attribute_controls_category_idx").on(table.category),
  }),
);

export type AttributeControl = typeof attributeControls.$inferSelect;
export type NewAttributeControl = typeof attributeControls.$inferInsert;
