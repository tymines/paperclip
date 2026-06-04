/**
 * Image Studio tool registry — the surfaces a template can target. Drives the
 * Tool dropdown in the template-click picker. `built` tools are routable today;
 * not-yet-built ones still appear as options (so templates advertise where
 * they'll work) but apply shows a "coming soon" notice instead of navigating.
 */
export interface ToolDef {
  key: string;
  label: string;
  built: boolean;
  /** Standalone route (company-prefixed at navigate time), if any. */
  route?: string;
  needsPersona: boolean;
}

export const TOOLS: ToolDef[] = [
  { key: "persona_generate", label: "Generate (Persona)", built: true, needsPersona: true },
  { key: "photoshoot", label: "PhotoShoot", built: true, needsPersona: true },
  { key: "external_image_gen", label: "External Image Gen", built: true, needsPersona: false },
  { key: "variations", label: "Variations", built: false, needsPersona: true },
  { key: "image_to_image", label: "Image-To-Image", built: false, needsPersona: true },
];

export function toolDef(key: string): ToolDef | undefined {
  return TOOLS.find((t) => t.key === key);
}

export function toolLabel(key: string): string {
  return toolDef(key)?.label ?? key;
}
