import type { CSSProperties } from "react";

/* -------------------------------------------------------------------------- */
/* Paperclip Design System v1.0 tokens (locked) — shared across the War Room.  */
/* Mirrors the token set defined in JarvisPage.tsx so the new Team Mode views   */
/* are self-contained and do not mutate global theme variables used by other    */
/* pages (same pattern the redesign uses). The parallel Designer task owns the  */
/* shared global theme + Home/Fleet; the War Room scopes its tokens locally.    */
/* -------------------------------------------------------------------------- */
export const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  border3: "#314158",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
} as const;

export const MONO =
  "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid rgba(255,255,255,0.06)`,
  borderRadius: 20,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

export type Tone = "success" | "warning" | "info" | "critical" | "muted";

/** Maps a semantic tone to a DS color (used by status chips). */
export function toneColor(tone: Tone): string {
  switch (tone) {
    case "success":
      return DS.success;
    case "warning":
      return DS.warning;
    case "critical":
      return DS.critical;
    case "info":
      return DS.primary;
    default:
      return DS.textMuted;
  }
}
