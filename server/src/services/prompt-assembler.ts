/**
 * prompt-assembler — compiles the Image Studio structured-control selections into
 * a single Flux LoRA prompt string.
 *
 * This is a PURE module: no DB, no IO. The route loads the attribute catalog
 * (controls + options) and the persona, then calls assemblePrompt(). Keeping it
 * pure makes the prompt-assembly logic exhaustively unit-testable and keeps the
 * one place that decides "what does a click compile to" out of the request path.
 *
 * Assembly order (stable, per spec section C):
 *   trigger word → bio → identity → body → face → pose → wardrobe → scene →
 *   lighting → free-text → quality boilerplate
 *
 * Each clicked attribute resolves to its option's prompt_fragment (interpolated
 * into the control's prompt_template, normally "{value}"). When a control has no
 * explicit selection, the persona's stored default is used (attributes[key] or
 * attributes["default_"+key]) — so opening Generate on Sidney pre-fills her
 * hair/body/etc without any clicks.
 */

/** Stable category ordering. Anything not listed sorts last, alphabetically. */
export const CATEGORY_ORDER = [
  "identity",
  "body",
  "face",
  "pose",
  "wardrobe",
  "scene",
  "lighting",
] as const;

export const QUALITY_BOILERPLATE = "photorealistic, high quality";

export interface AssemblyControl {
  key: string;
  category: string;
  /** Snippet the option fragment is interpolated into, normally "{value}". */
  promptTemplate: string;
  sortOrder?: number | null;
}

export interface AssemblyOption {
  controlKey: string;
  value: string;
  label: string;
  promptFragment: string;
  contentRating?: string | null;
}

export interface AssemblyCatalog {
  controls: AssemblyControl[];
  options: AssemblyOption[];
}

export interface PersonaForAssembly {
  bio?: string | null;
  attributes?: Record<string, unknown> | null;
}

export type Selections = Record<string, string>;

function categoryRank(category: string): number {
  const idx = (CATEGORY_ORDER as readonly string[]).indexOf(category);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

/** Resolve a string-ish attribute value, ignoring empties. */
function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

/**
 * Resolve the effective value for a control: an explicit selection wins, else
 * the persona's stored default (attributes[key] or attributes["default_"+key]).
 */
export function resolveControlValue(
  controlKey: string,
  selections: Selections,
  persona?: PersonaForAssembly | null,
): string | null {
  const picked = asString(selections[controlKey]);
  if (picked) return picked;
  const attrs = persona?.attributes ?? null;
  if (attrs) {
    return asString(attrs[controlKey]) ?? asString(attrs[`default_${controlKey}`]);
  }
  return null;
}

/**
 * Assemble the final prompt from a persona, the user's structured selections, and
 * an optional free-text override. Pure — same inputs always yield the same string.
 */
export function assemblePrompt(
  persona: PersonaForAssembly | null | undefined,
  selections: Selections | null | undefined,
  freeText: string | null | undefined,
  catalog: AssemblyCatalog,
): string {
  const sel = selections ?? {};
  const fragments: string[] = [];

  // 1. Trigger word always leads.
  const trigger = asString(persona?.attributes?.["trigger_word"]);
  if (trigger) fragments.push(trigger);

  // 2. Bio context (collapsed to a single line).
  const bio = asString(persona?.bio);
  if (bio) fragments.push(bio.replace(/\s+/g, " ").trim());

  // 3. Structured attributes in stable category → sort_order order.
  const optionIndex = new Map<string, AssemblyOption>();
  for (const o of catalog.options) optionIndex.set(`${o.controlKey}::${o.value}`, o);

  const orderedControls = [...catalog.controls].sort((a, b) => {
    const ca = categoryRank(a.category);
    const cb = categoryRank(b.category);
    if (ca !== cb) return ca - cb;
    const sa = a.sortOrder ?? 0;
    const sb = b.sortOrder ?? 0;
    if (sa !== sb) return sa - sb;
    return a.key.localeCompare(b.key);
  });

  for (const control of orderedControls) {
    const value = resolveControlValue(control.key, sel, persona);
    if (!value) continue;
    const option = optionIndex.get(`${control.key}::${value}`);
    if (!option?.promptFragment) continue;
    const template = control.promptTemplate || "{value}";
    fragments.push(template.replace(/\{value\}/g, option.promptFragment).trim());
  }

  // 4. Free-text override appends after structured fragments.
  const free = asString(freeText);
  if (free) fragments.push(free);

  // 5. Quality boilerplate always closes.
  fragments.push(QUALITY_BOILERPLATE);

  return fragments.filter((f) => f.length > 0).join(", ");
}

export interface FreeTextConflict {
  controlKey: string;
  controlLabel: string;
  /** The option the user has selected for this control. */
  selectedValue: string;
  selectedLabel: string;
  /** The conflicting option whose terms appear in the free text. */
  conflictingLabel: string;
}

/**
 * Detect soft conflicts where the free-text mentions a DIFFERENT option for a
 * control the user has already selected (e.g. Hair=Bun but free-text says
 * "ponytail"). Returns warnings, never blocks — the UI surfaces them inline.
 */
export function detectFreeTextConflicts(
  selections: Selections | null | undefined,
  freeText: string | null | undefined,
  catalog: AssemblyCatalog,
  controlLabels: Record<string, string> = {},
): FreeTextConflict[] {
  const free = asString(freeText)?.toLowerCase();
  const sel = selections ?? {};
  if (!free) return [];

  const conflicts: FreeTextConflict[] = [];
  const optionsByControl = new Map<string, AssemblyOption[]>();
  for (const o of catalog.options) {
    const list = optionsByControl.get(o.controlKey) ?? [];
    list.push(o);
    optionsByControl.set(o.controlKey, list);
  }

  for (const [controlKey, selectedValue] of Object.entries(sel)) {
    if (!asString(selectedValue)) continue;
    const options = optionsByControl.get(controlKey);
    if (!options) continue;
    const selected = options.find((o) => o.value === selectedValue);
    if (!selected) continue;

    for (const other of options) {
      if (other.value === selectedValue) continue;
      // Match on the option's label words and value token (e.g. "ponytail").
      const terms = [other.label.toLowerCase(), other.value.replace(/_/g, " ")];
      const hit = terms.some((t) => t.length >= 3 && free.includes(t));
      // Don't warn if the free text also mentions the selected option (user is
      // intentionally describing both).
      const mentionsSelected =
        free.includes(selected.label.toLowerCase()) ||
        free.includes(selected.value.replace(/_/g, " "));
      if (hit && !mentionsSelected) {
        conflicts.push({
          controlKey,
          controlLabel: controlLabels[controlKey] ?? controlKey,
          selectedValue,
          selectedLabel: selected.label,
          conflictingLabel: other.label,
        });
        break; // one conflict per control is enough signal
      }
    }
  }
  return conflicts;
}
