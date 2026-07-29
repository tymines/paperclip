import { ExternalLink, X } from "lucide-react";
import type { EntityProps } from "./MapCanvas";
import { ageLabel } from "./time";
import { C } from "./theme";

function title(entity: EntityProps): string {
  if (entity.kind === "seismic") return `M${Number(entity.mag || 0).toFixed(1)} · ${entity.place || "Earthquake"}`;
  if (entity.kind === "flight") return String(entity.callsign || "Flight");
  if (entity.kind === "fire") return "Active fire";
  if (entity.kind === "satellite") return String(entity.name || "Satellite");
  if (entity.kind === "weather") return String(entity.title || "Severe weather");
  return "World event";
}

const OMIT = new Set(["id", "kind", "source", "observedAt", "url", "sourceUrl", "iss"]);

export function DossierCard({ entity, relatedCount, onClose }: { entity: EntityProps; relatedCount: number; onClose: () => void }) {
  const link = entity.url ? String(entity.url) : entity.sourceUrl ? String(entity.sourceUrl) : null;
  return (
    <aside aria-label="Entity dossier" className="absolute bottom-12 right-3 top-14 z-30 w-[min(330px,calc(100vw-24px))] overflow-auto rounded-sm px-4 py-3" style={{ background: "linear-gradient(145deg,rgba(5,9,14,.96),rgba(2,5,9,.9))", border: `1px solid ${C.line2}`, boxShadow: "0 24px 80px rgba(0,0,0,.55)" }}>
      <div className="flex items-start gap-3">
        <div className="mt-1 h-2 w-2 rounded-full" style={{ background: C.amber, boxShadow: `0 0 13px ${C.amber}` }} />
        <div className="min-w-0 flex-1"><div className="text-[9px] uppercase tracking-[.22em]" style={{ color: C.faint }}>Dossier</div><h2 className="mt-1 text-sm font-medium leading-snug" style={{ color: C.text }}>{title(entity)}</h2></div>
        <button aria-label="Close dossier" onClick={onClose} style={{ color: C.faint }}><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-5 space-y-2">
        {Object.entries(entity).filter(([key, value]) => !OMIT.has(key) && value != null && value !== "").slice(0, 8).map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-4 border-b pb-1.5" style={{ borderColor: C.line }}><span className="text-[9px] uppercase tracking-[.14em]" style={{ color: C.faint }}>{key}</span><span className="max-w-[190px] text-right text-[10px]" style={{ color: C.mut }}>{String(value)}</span></div>
        ))}
      </div>
      <div className="mt-5 rounded-sm px-3 py-2" style={{ background: "rgba(255,255,255,.025)", border: `1px solid ${C.line}` }}>
        <div className="text-[9px] uppercase tracking-[.18em]" style={{ color: C.faint }}>Provenance</div>
        <div className="mt-1 text-[10px]" style={{ color: C.text }}>{String(entity.source || "Unknown source")} · {ageLabel(entity.observedAt)}</div>
        <div className="mt-1 text-[9px]" style={{ color: C.faint }}>{relatedCount} related visible {relatedCount === 1 ? "event" : "events"}</div>
      </div>
      {link && <a href={link} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-1.5 text-[10px] uppercase tracking-[.14em]" style={{ color: C.cyan }}><ExternalLink className="h-3 w-3" /> Open source</a>}
    </aside>
  );
}
