// Creative Studio — designed keyed-off / empty states (Tyler design pass 2026-07-12).
// Honesty stays absolute (nothing mocked); these make the honest state look intentional:
// compact centered composition instead of a bare amber wall.
import type { CSSProperties, ReactNode } from "react";
import { Plug } from "lucide-react";

export const CDS = {
  canvas: "#06090F", surface: "#0D131D", surface2: "#111926", surface3: "#172131",
  border: "#1C2635", border2: "#263246", text: "#F5F8FF", textMuted: "#A3B0C2",
  textFaint: "#68758A", primary: "#3B82FF", success: "#2FE38A", critical: "#FF5B5B",
  amber: "#F4B940",
} as const;

export const CMONO = "'IBM Plex Mono', monospace";

export function EnvChip({ children }: { children: ReactNode }) {
  return (
    <code style={{
      fontFamily: CMONO, fontSize: 10, color: CDS.textMuted, background: CDS.surface3,
      border: `1px solid ${CDS.border2}`, borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap",
    }}>
      {children}
    </code>
  );
}

/** Compact, designed keyed-off card for sub-surfaces (Presets / Ad Studio / Edit). */
export function SurfaceKeyedOff({ icon, title, promise, envVars }: {
  icon: ReactNode;
  title: string;
  promise: string;
  envVars: string[];
}) {
  const wrap: CSSProperties = {
    background: CDS.surface, border: "1px solid rgba(255,255,255,.06)", borderRadius: 16,
    padding: "36px 24px", display: "flex", flexDirection: "column", alignItems: "center",
    textAlign: "center", gap: 10,
  };
  return (
    <div style={wrap}>
      <div style={{
        width: 40, height: 40, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(59,130,255,.08)", border: `1px solid ${CDS.border2}`, color: CDS.primary,
      }}>
        {icon}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: CDS.text }}>{title}</div>
      <div style={{ fontSize: 12, color: CDS.textMuted, maxWidth: 420, lineHeight: 1.5 }}>{promise}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap", justifyContent: "center" }}>
        <Plug size={11} color={CDS.textFaint} />
        <span style={{ fontSize: 10, color: CDS.textFaint, textTransform: "uppercase", letterSpacing: ".05em" }}>connects via</span>
        {envVars.map((v) => <EnvChip key={v}>{v}</EnvChip>)}
      </div>
      <div style={{ fontSize: 10, color: CDS.textFaint }}>Nothing on this surface is mocked — it lights up when the provider is keyed.</div>
    </div>
  );
}
