/**
 * Client-side mirror of server/src/services/prompt-assembler.ts so the Generate
 * panel can show a live prompt preview instantly on every click — no round-trip.
 * The server re-assembles authoritatively at generate time; this just has to
 * agree with it. Keep the two in sync.
 */
import type {
  AttributeControl,
  ImageProvider,
  Selections,
  PromptConflict,
} from "@/api/imageStudio";

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

function categoryRank(category: string): number {
  const idx = (CATEGORY_ORDER as readonly string[]).indexOf(category);
  return idx === -1 ? CATEGORY_ORDER.length : idx;
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

/** Effective value for a control: explicit selection, else persona default. */
export function resolveControlValue(
  controlKey: string,
  selections: Selections,
  persona?: Pick<ImageProvider, "attributes"> | null,
): string | null {
  const picked = asString(selections[controlKey]);
  if (picked) return picked;
  const attrs = persona?.attributes ?? null;
  if (attrs) return asString(attrs[controlKey]) ?? asString(attrs[`default_${controlKey}`]);
  return null;
}

export function assemblePrompt(
  persona: Pick<ImageProvider, "bio" | "attributes"> | null | undefined,
  selections: Selections,
  freeText: string,
  controls: AttributeControl[],
): string {
  const fragments: string[] = [];
  const trigger = asString(persona?.attributes?.["trigger_word"]);
  if (trigger) fragments.push(trigger);
  const bio = asString(persona?.bio);
  if (bio) fragments.push(bio.replace(/\s+/g, " ").trim());

  const ordered = [...controls].sort((a, b) => {
    const ca = categoryRank(a.category);
    const cb = categoryRank(b.category);
    if (ca !== cb) return ca - cb;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  for (const control of ordered) {
    const value = resolveControlValue(control.key, selections, persona);
    if (!value) continue;
    const option = control.options.find((o) => o.value === value);
    if (!option?.promptFragment) continue;
    const template = control.promptTemplate || "{value}";
    fragments.push(template.replace(/\{value\}/g, option.promptFragment).trim());
  }

  const free = asString(freeText);
  if (free) fragments.push(free);
  fragments.push(QUALITY_BOILERPLATE);
  return fragments.filter((f) => f.length > 0).join(", ");
}

export function detectConflicts(
  selections: Selections,
  freeText: string,
  controls: AttributeControl[],
): PromptConflict[] {
  const free = asString(freeText)?.toLowerCase();
  if (!free) return [];
  const conflicts: PromptConflict[] = [];
  for (const control of controls) {
    const selectedValue = selections[control.key];
    if (!asString(selectedValue)) continue;
    const selected = control.options.find((o) => o.value === selectedValue);
    if (!selected) continue;
    const mentionsSelected =
      free.includes(selected.label.toLowerCase()) ||
      free.includes(selected.value.replace(/_/g, " "));
    if (mentionsSelected) continue;
    for (const other of control.options) {
      if (other.value === selectedValue) continue;
      const terms = [other.label.toLowerCase(), other.value.replace(/_/g, " ")];
      if (terms.some((t) => t.length >= 3 && free.includes(t))) {
        conflicts.push({
          controlKey: control.key,
          controlLabel: control.label,
          selectedValue,
          selectedLabel: selected.label,
          conflictingLabel: other.label,
        });
        break;
      }
    }
  }
  return conflicts;
}

/** Randomize every control to one of its (rating-filtered) options. */
export function randomizeSelections(
  controls: AttributeControl[],
  showExplicit: boolean,
): Selections {
  const out: Selections = {};
  for (const control of controls) {
    const pool = control.options.filter(
      (o) => o.enabled && (showExplicit || o.contentRating !== "explicit"),
    );
    if (pool.length === 0) continue;
    // Index varies by control key length + option count — deterministic enough
    // for a "surprise me" without Math.random (which is fine in the browser, but
    // we keep it simple and varied per click via a salt).
    const idx = Math.floor(Math.random() * pool.length);
    out[control.key] = pool[idx].value;
  }
  return out;
}
