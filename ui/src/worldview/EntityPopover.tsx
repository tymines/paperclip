/** World View  entity detail popover (TYL-131). One popover, per-kind renderers. */
import { X, ExternalLink } from "lucide-react";
import { C, magColor, SEVERITY_COLOR } from "./theme";
import type { EntityProps } from "./MapCanvas";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>{k}</span>
      <span className="text-[10px]" style={{ color: C.text }}>{v}</span>
    </div>
  );
}

export function EntityPopover({ entity, onClose }: { entity: EntityProps; onClose: () => void }) {
  const kind = String(entity.kind || "");
  const num = (x: unknown) => (typeof x === "number" ? x : Number(x));

  let title = "Entity";
  let accent: string = C.green;
  const rows: { k: string; v: React.ReactNode }[] = [];
  let link: { url: string; label: string } | null = null;

  if (kind === "seismic") {
    const mag = num(entity.mag);
    title = `M${mag.toFixed(1)} Earthquake`; accent = magColor(mag);
    rows.push({ k: "Location", v: String(entity.place || "") });
    if (entity.time) rows.push({ k: "Time", v: new Date(num(entity.time)).toUTCString() });
    if (entity.url) link = { url: String(entity.url), label: "USGS detail" };
  } else if (kind === "fire") {
    title = "Active Fire"; accent = C.red;
    rows.push({ k: "FRP", v: `${num(entity.frp).toFixed(1)} MW` });
    rows.push({ k: "Confidence", v: String(entity.confidence || "") });
    rows.push({ k: "Sensor", v: String(entity.satellite || "") });
  } else if (kind === "flight") {
    title = String(entity.callsign || "Flight"); accent = C.green;
    rows.push({ k: "Heading", v: `${num(entity.heading).toFixed(0)} deg` });
    if (entity.velocity) rows.push({ k: "Speed", v: `${(num(entity.velocity) * 1.94384).toFixed(0)} kt` });
    if (entity.altitude) rows.push({ k: "Altitude", v: `${(num(entity.altitude) * 3.281).toFixed(0)} ft` });
    rows.push({ k: "Origin", v: String(entity.country || "") });
  } else if (kind === "vessel") {
    title = String(entity.name || "Vessel"); accent = C.blue;
    if (entity.sog) rows.push({ k: "Speed", v: `${num(entity.sog).toFixed(1)} kt` });
    if (entity.type) rows.push({ k: "Type", v: String(entity.type) });
  } else if (kind === "satellite") {
    title = String(entity.name || "Satellite"); accent = C.violet;
    rows.push({ k: "Group", v: String(entity.group || "") });
    rows.push({ k: "Altitude", v: `${num(entity.altKm)} km` });
  } else if (kind === "weather") {
    title = String(entity.title || "Event"); accent = C.green;
    rows.push({ k: "Category", v: String(entity.category || "") });
    if (entity.url) link = { url: String(entity.url), label: "EONET source" };
  } else if (kind === "conflict") {
    title = String(entity.label || "Zone"); accent = SEVERITY_COLOR[String(entity.severity)] || C.amber;
    rows.push({ k: "Severity", v: String(entity.severity || "").toUpperCase() });
    rows.push({ k: "Brief", v: String(entity.description || "") });
    if (entity.sourceUrl) link = { url: String(entity.sourceUrl), label: "Live map" };
  } else if (kind === "cctv") {
    title = String(entity.name || "Camera"); accent = C.mut;
    rows.push({ k: "City", v: String(entity.city || "") });
    rows.push({ k: "Status", v: entity.available ? "Available" : "Offline" });
    if (entity.imageUrl) link = { url: String(entity.imageUrl), label: "Open camera" };
  } else if (kind === "livenews") {
    title = String(entity.name || "Broadcast"); accent = C.cyan;
    rows.push({ k: "City", v: String(entity.city || "") });
    rows.push({ k: "Category", v: String(entity.category || "") });
    if (entity.url) link = { url: String(entity.url), label: "Watch live" };
  }

  return (
    <div className="absolute right-2 bottom-10 z-20 w-[240px]"
      style={{ background: "rgba(6,8,11,0.96)", border: `1px solid ${accent}66`, backdropFilter: "blur(4px)" }}>
      <div className="flex items-center gap-2 px-2.5 py-1.5" style={{ borderBottom: `1px solid ${C.line}` }}>
        <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
        <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.text }}>{title}</span>
        <button onClick={onClose} style={{ color: C.faint }}><X className="h-3 w-3" /></button>
      </div>
      <div className="px-2.5 py-1.5">
        {rows.map((r, i) => <Row key={i} k={r.k} v={r.v} />)}
        {link && (
          <a href={link.url} target="_blank" rel="noreferrer"
            className="mt-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wider" style={{ color: accent }}>
            <ExternalLink className="h-3 w-3" /> {link.label}
          </a>
        )}
      </div>
    </div>
  );
}
