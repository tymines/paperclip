/**
 * World View — map-area diagnostic overlay (TYL-131 fix).
 *
 * A black void is not a data-honest failure state. When the basemap can't load
 * or the collector is unreachable, this surfaces a clear diagnostic ON the map
 * area (not just tiny ERR chips), so the operator always knows what's wrong and
 * what still works. Non-blocking: pointer-events pass through except the card.
 */
import { AlertTriangle, Wifi, WifiOff, Globe2 } from "lucide-react";
import { C } from "./theme";
import type { BasemapStatus } from "./MapCanvas";

interface Props {
  basemap: BasemapStatus;
  collectorOnline: boolean | null;
  feedsLive: number;
  feedsTotal: number;
}

export function MapDiagnostic({ basemap, collectorOnline, feedsLive, feedsTotal }: Props) {
  const basemapBad = basemap === "failed";
  const collectorBad = collectorOnline === false;
  if (!basemapBad && !collectorBad) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="pointer-events-auto max-w-[420px]"
        style={{ background: "rgba(6,8,11,0.94)", border: `1px solid ${C.amber}55`, backdropFilter: "blur(4px)" }}>
        <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
          <AlertTriangle className="h-4 w-4" style={{ color: C.amber }} />
          <span className="text-[12px] font-semibold uppercase tracking-[0.16em]" style={{ color: C.text }}>
            Partial Signal
          </span>
        </div>
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <Row
            ok={!basemapBad}
            icon={<Globe2 className="h-3.5 w-3.5" />}
            label="Basemap"
            good="rendering"
            bad="UNREACHABLE — tiles failed to load (network / tile host). Layers still render over a blank globe."
          />
          <Row
            ok={!collectorBad}
            icon={collectorBad ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
            label="Collector"
            good={`live — ${feedsLive}/${feedsTotal} feeds`}
            bad={`OFFLINE — ${feedsLive}/${feedsTotal} feeds. Seismic still live via USGS-direct. Start worldview-collector (:8788) or set WORLDVIEW_COLLECTOR_URL on this instance.`}
          />
        </div>
      </div>
    </div>
  );
}

function Row({ ok, icon, label, good, bad }: {
  ok: boolean; icon: React.ReactNode; label: string; good: string; bad: string;
}) {
  const col = ok ? C.green : C.red;
  return (
    <div className="flex items-start gap-2">
      <span style={{ color: col }}>{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.text }}>{label}: </span>
        <span className="text-[11px]" style={{ color: ok ? C.mut : C.text }}>{ok ? good : bad}</span>
      </div>
    </div>
  );
}
