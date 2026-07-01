/**
 * attribute-catalog — loads the structured-control catalog (attribute_controls +
 * attribute_options) and maps it into the shape the pure prompt-assembler wants.
 *
 * The DB stores options keyed by integer control_id; the assembler works in
 * control *keys* ("hairstyle", "pose", …). This module bridges the two and is
 * the single load path used by the preview / generate / batch-generate routes.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { attributeControls, attributeOptions } from "@paperclipai/db";
import type { AssemblyCatalog } from "../prompt-assembler.js";

export type ControlRow = typeof attributeControls.$inferSelect;
export type OptionRow = typeof attributeOptions.$inferSelect;

export interface ControlWithOptions extends ControlRow {
  options: OptionRow[];
}

export interface LoadedCatalog {
  /** Controls with their options nested — what the GET endpoint returns. */
  controls: ControlWithOptions[];
  /** Flat shape for the pure assembler. */
  catalog: AssemblyCatalog;
  /** control key → human label, for conflict-warning copy. */
  controlLabels: Record<string, string>;
}

export interface CatalogFilter {
  category?: string;
  /** When 'sfw', explicit options are dropped (controls with no remaining
   *  options are still returned so the UI can show empty states). */
  contentRating?: "sfw" | "explicit";
}

/** Load the enabled catalog, optionally filtered, in stable sort order. */
export async function loadCatalog(db: Db, filter: CatalogFilter = {}): Promise<LoadedCatalog> {
  const controlWhere = filter.category
    ? and(eq(attributeControls.enabled, true), eq(attributeControls.category, filter.category))
    : eq(attributeControls.enabled, true);

  const controls = await db
    .select()
    .from(attributeControls)
    .where(controlWhere)
    .orderBy(asc(attributeControls.sortOrder), asc(attributeControls.id));

  const options = await db
    .select()
    .from(attributeOptions)
    .where(eq(attributeOptions.enabled, true))
    .orderBy(asc(attributeOptions.controlId), asc(attributeOptions.sortOrder));

  const keyById = new Map<number, string>();
  for (const c of controls) keyById.set(c.id, c.key);

  const optionsByControl = new Map<number, OptionRow[]>();
  for (const o of options) {
    if (o.controlId == null) continue;
    if (filter.contentRating === "sfw" && o.contentRating === "explicit") continue;
    const list = optionsByControl.get(o.controlId) ?? [];
    list.push(o);
    optionsByControl.set(o.controlId, list);
  }

  const controlsWithOptions: ControlWithOptions[] = controls.map((c) => ({
    ...c,
    options: optionsByControl.get(c.id) ?? [],
  }));

  const catalog: AssemblyCatalog = {
    controls: controls.map((c) => ({
      key: c.key,
      category: c.category,
      promptTemplate: c.promptTemplate,
      sortOrder: c.sortOrder,
    })),
    options: options
      .filter((o) => o.controlId != null && keyById.has(o.controlId))
      .map((o) => ({
        controlKey: keyById.get(o.controlId as number) as string,
        value: o.value,
        label: o.label,
        promptFragment: o.promptFragment,
        contentRating: o.contentRating,
      })),
  };

  const controlLabels: Record<string, string> = {};
  for (const c of controls) controlLabels[c.key] = c.label;

  return { controls: controlsWithOptions, catalog, controlLabels };
}
