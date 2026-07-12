/** Paperclip Design System v1.0 tokens (locked) — shared by the App Dev
 * Control Center pages. Mirrors the local block in pages/AppDev.tsx. */
import type { CSSProperties } from "react";

export const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
  automation: "#A56EFF",
  analytics: "#31D9FF",
} as const;

export const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

export const cardBorder = `1px solid rgba(255,255,255,0.06)`;

export const PHASE_LABELS: Record<string, string> = {
  idea: "Idea",
  spec: "Spec",
  design: "Design",
  build: "Build",
  qc: "QC",
  tyler_gate: "Tyler Gate",
  implement: "Implement",
  verify: "Verify",
  retro: "Retro",
  live: "Live",
};

export const PHASE_ORDER = [
  "idea",
  "spec",
  "design",
  "build",
  "qc",
  "tyler_gate",
  "implement",
  "verify",
  "retro",
  "live",
];

/** Gate that moves an app OUT of a given phase. */
export const GATE_FROM_PHASE: Record<string, string> = {
  idea: "idea_to_spec",
  spec: "spec_to_design",
  design: "design_to_build",
  build: "build_to_qc",
  qc: "qc_to_tyler",
  tyler_gate: "tyler_to_implement",
  implement: "implement_to_verify",
  verify: "verify_to_retro",
  retro: "retro_to_live",
};
