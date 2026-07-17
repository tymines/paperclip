/**
 * World View  shared design tokens (TYL-131).
 *
 * Palette RESOLVED by Tyler 2026-07-12: pure-black OSIRIS command-center idiom,
 * a sanctioned exception to Design System v1.0 for this tab. Carried over from
 * the v1 WorldView token set (already the right genre) with a few additions for
 * the richer layer set.
 */
export const C = {
  bg: "#000000",
  panel: "#070809",
  panel2: "#0A0C0E",
  inset: "#0E1114",
  line: "#1A1D22",
  line2: "#262B31",
  text: "#E7EBF0",
  mut: "#9AA2AD",
  faint: "#5A626D",
  green: "#3DE17E",
  amber: "#F5A524",
  red: "#FF4D4D",
  cyan: "#36C5F0",
  blue: "#5B8DEF",
  violet: "#A56EFF",
  ocean: "#04070B",
  land: "#141A21",
  landStroke: "#28323D",
  grid: "#10161C",
} as const;

export const MONO = "'JetBrains Mono','SF Mono',ui-monospace,Menlo,Consolas,monospace";

/** Severity  color for conflict zones. */
export const SEVERITY_COLOR: Record<string, string> = {
  war: C.red,
  high: C.amber,
  elevated: C.cyan,
  moderate: C.blue,
};

/** Earthquake magnitude  signal color. */
export function magColor(m: number): string {
  return m >= 5 ? C.red : m >= 4 ? C.amber : C.cyan;
}

/** Collector base URL (same-origin proxy by default). */
export const COLLECTOR =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WORLDVIEW_API_URL) ||
  "/api/worldview";
