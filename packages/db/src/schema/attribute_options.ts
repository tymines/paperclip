import { pgTable, serial, text, integer, boolean, index } from "drizzle-orm/pg-core";
import { attributeControls } from "./attribute_controls.js";

/**
 * attribute_options — the selectable values for an attribute_control (e.g. the
 * 'bun' / 'ponytail' / 'braid' options under the 'hairstyle' control).
 *
 * `promptFragment` is the exact wording inserted into the assembled prompt for
 * that option. `contentRating` ('sfw' | 'explicit') lets NSFW options (lingerie,
 * robe, …) be hidden behind the panel's SFW/Explicit toggle. `previewImagePath`
 * is the thumbnail shown on the option card (uploads-relative, optional).
 */
export const attributeOptions = pgTable(
  "attribute_options",
  {
    id: serial("id").primaryKey(),
    controlId: integer("control_id").references(() => attributeControls.id, {
      onDelete: "cascade",
    }),
    value: text("value").notNull(),
    label: text("label").notNull(),
    promptFragment: text("prompt_fragment").notNull(),
    previewImagePath: text("preview_image_path"),
    sortOrder: integer("sort_order").default(0),
    enabled: boolean("enabled").default(true),
    contentRating: text("content_rating").default("sfw"),
  },
  (table) => ({
    controlIdx: index("idx_attribute_options_control").on(table.controlId, table.sortOrder),
  }),
);

export type AttributeOption = typeof attributeOptions.$inferSelect;
export type NewAttributeOption = typeof attributeOptions.$inferInsert;
