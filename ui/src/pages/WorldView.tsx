/**
 * World View  global situational-awareness tab for Paperclip (TYL-131).
 *
 * OSIRIS-style rebuild (spec: 10 - Apps/Paperclip/Studios/World View). A full-bleed
 * MapLibre GL globe (3D default per Tyler's ruling; 2D fallback toggle) renders
 * every feed as a GPU layer via the declarative layer registry. HUD panels float
 * over the map: status bar, layer panel, intel drawer, alerts ticker, entity
 * popover, sources board.
 *
 * Data honesty: only real upstream feeds through the same-origin collector proxy
 * (/api/worldview/*). Layers whose providers need a key we don't have surface an
 * honest status in the Sources board  never fabricated rows. The seismic layer
 * falls back to USGS-direct so the centerpiece is real even with no backend.
 *
 * Provenance: layer design, curated conflict-zone + live-news lists, and the
 * tile-proxy pattern are ported from OSIRIS (github.com/simplifaisoul/osiris,
 * MIT) with attribution. Map data: CARTO basemaps  OpenStreetMap contributors.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { C, MONO } from "../worldview/theme";
import { LAYERS, type LayerId, type LayerDef } from "../worldview/layerRegistry";
import { useLayerData, type LayerData } from "../worldview/hooks/useLayerData";
import { useWorldClock } from "../worldview/hooks/useWorldClock";
import { fetchSwpc } from "../worldview/fetchers";
import { MapCanvas, type MapApi, type Projection, type Basemap, type EntityProps } from "../worldview/MapCanvas";
import { StatusBar } from "../worldview/StatusBar";
import { LayerPanel } from "../worldview/LayerPanel";
import { IntelFeed } from "../worldview/IntelFeed";
import { EntityPopover } from "../worldview/EntityPopover";
import { AlertsTicker, type Alert } from "../worldview/AlertsTicker";
import { SourcesBoard } from "../worldview/SourcesBoard";

const DEFAULT_ON = new Set<LayerId>(
  (LAYERS as LayerDef[]).filter((l) => l.defaultOn).map((l) => l.id));

export function WorldView() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "World View" }]); }, [setBreadcrumbs]);

  const { zulu } = useWorldClock();
  const [enabled, setEnabled] = useState<Set<LayerId>>(() => new Set(DEFAULT_ON));
  const [projection, setProjection] = useState<Projection>("globe");
  const [basemap, setBasemap] = useState<Basemap>("map");
  const [selected, setSelected] = useState<EntityProps | null>(null);
  const [intelOpen, setIntelOpen] = useState(true);
  const [showSources, setShowSources] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const apiRef = useRef<MapApi | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const toggle = useCallback((id: LayerId) => {
    setEnabled((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  // One data hook per registry layer (LAYERS is a module constant  stable order).
  const data = {} as Record<LayerId, LayerData>;
  for (const layer of LAYERS as LayerDef[]) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    data[layer.id] = useLayerData(layer, enabled.has(layer.id));
  }

  const layerGeojsons = (LAYERS as LayerDef[]).map((l) => data[l.id].geojson);
  const geojsonByLayer = useMemo(() => {
    const out: Partial<Record<LayerId, FeatureCollection>> = {};
    for (const layer of LAYERS as LayerDef[]) out[layer.id] = data[layer.id].geojson;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, layerGeojsons);

  const swpc = useQuery({ queryKey: ["worldview", "swpc"], queryFn: fetchSwpc, refetchInterval: 300000, retry: 0 });

  //  derived status 
  const feedsLive = (LAYERS as LayerDef[]).filter((l) => enabled.has(l.id) && data[l.id].status === "live").length;
  const feedsTotal = LAYERS.length;

  const quakeGeo = data.seismic.geojson;
  const maxMag = useMemo(() =>
    quakeGeo.features.reduce((m, f) => Math.max(m, Number((f.properties as { mag?: number })?.mag ?? 0)), 0),
    [quakeGeo]);
  const seismic = maxMag >= 6 ? { label: "ELEVATED", color: C.red }
    : maxMag >= 5 ? { label: "WATCH", color: C.amber }
    : { label: "NOMINAL", color: C.green };

  //  alerts ticker (derived from live layers) 
  const conflictGeo = data.conflicts.geojson;
  const alerts: Alert[] = useMemo(() => {
    const out: Alert[] = [];
    for (const f of quakeGeo.features) {
      const p = f.properties as { id?: string; mag?: number; place?: string };
      if ((p?.mag ?? 0) >= 5) out.push({ id: `q-${p.id}`, color: C.red, text: `M${p.mag?.toFixed(1)}  ${p.place}` });
    }
    if (enabled.has("conflicts")) {
      for (const f of conflictGeo.features.slice(0, 6)) {
        const p = f.properties as { id?: string; label?: string; color?: string };
        out.push({ id: `c-${p.id}`, color: p.color || C.amber, text: String(p.label) });
      }
    }
    return out.slice(0, 24);
  }, [quakeGeo, enabled, conflictGeo]);

  //  hotkeys 
  useEffect(() => {
    const byKey = new Map((LAYERS as LayerDef[]).filter((l) => l.hotkey).map((l) => [l.hotkey!, l.id]));
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (k === "escape") { setSelected(null); setShowSources(false); setShowShortcuts(false); return; }
      if (k === "r") { apiRef.current?.resetView(); return; }
      if (k === "?") { setShowShortcuts((v) => !v); return; }
      if (byKey.has(k)) { e.preventDefault(); toggle(byKey.get(k)!); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const onFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }, []);

  return (
    <div ref={rootRef} className="flex min-h-full flex-col" style={{ background: C.bg, fontFamily: MONO, color: C.text }}
      data-pp-page-v4="world-view">
      <StatusBar
        zulu={zulu} feedsLive={feedsLive} feedsTotal={feedsTotal} seismic={seismic} swpc={swpc.data ?? null}
        projection={projection} basemap={basemap}
        onProjection={setProjection} onBasemap={setBasemap}
        onReset={() => apiRef.current?.resetView()} onFullscreen={onFullscreen}
        onShortcuts={() => setShowShortcuts((v) => !v)}
      />

      <div className="relative min-h-0 flex-1" style={{ height: "calc(100vh - 96px)" }}>
        <MapCanvas
          geojsonByLayer={geojsonByLayer} enabled={enabled} projection={projection} basemap={basemap}
          onSelect={setSelected} onReady={(api) => { apiRef.current = api; }}
        />

        {/* layers overlay (top-left) */}
        <div className="absolute left-2 top-2 z-10">
          <LayerPanel enabled={enabled} data={data} onToggle={toggle} />
        </div>

        {/* intel drawer (right) */}
        <div className="absolute right-0 top-0 bottom-0 z-10">
          <IntelFeed open={intelOpen} onToggle={() => setIntelOpen((v) => !v)} />
        </div>

        {/* sources trigger (bottom-left) */}
        <button onClick={() => setShowSources((v) => !v)}
          className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5 px-2 py-1 text-[9px] uppercase tracking-wider"
          style={{ background: "rgba(5,7,10,0.86)", border: `1px solid ${C.line2}`, color: C.mut }}>
          Sources  {feedsLive}/{feedsTotal} live
        </button>

        {/* attribution note (bottom-center) */}
        <div className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 px-3 py-1 text-[9px] uppercase tracking-wider"
          style={{ background: "rgba(5,7,10,0.7)", color: C.faint }}>
          Layers + curation: <span style={{ color: C.green }}>simplifaisoul/osiris</span> (MIT)  CARTO  OSM
        </div>

        {selected && <EntityPopover entity={selected} onClose={() => setSelected(null)} />}
        {showSources && <SourcesBoard onClose={() => setShowSources(false)} />}
        {showShortcuts && <ShortcutsCard onClose={() => setShowShortcuts(false)} />}
      </div>

      <AlertsTicker alerts={alerts} />
    </div>
  );
}

function ShortcutsCard({ onClose }: { onClose: () => void }) {
  const rows = (LAYERS as LayerDef[]).filter((l) => l.hotkey).map((l) => [l.hotkey!.toUpperCase(), l.label] as const);
  return (
    <div className="absolute left-1/2 top-1/2 z-30 w-[280px] -translate-x-1/2 -translate-y-1/2"
      style={{ background: "rgba(6,8,11,0.97)", border: `1px solid ${C.line2}` }} onClick={onClose}>
      <div className="px-3 py-2" style={{ borderBottom: `1px solid ${C.line}` }}>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: C.text }}>Shortcuts</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2">
        {rows.map(([k, label]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-[10px]" style={{ color: C.mut }}>{label}</span>
            <kbd className="px-1 text-[9px]" style={{ border: `1px solid ${C.line2}`, color: C.text }}>{k}</kbd>
          </div>
        ))}
        <div className="flex items-center justify-between"><span className="text-[10px]" style={{ color: C.mut }}>Reset view</span><kbd className="px-1 text-[9px]" style={{ border: `1px solid ${C.line2}`, color: C.text }}>R</kbd></div>
        <div className="flex items-center justify-between"><span className="text-[10px]" style={{ color: C.mut }}>Close</span><kbd className="px-1 text-[9px]" style={{ border: `1px solid ${C.line2}`, color: C.text }}>ESC</kbd></div>
      </div>
    </div>
  );
}

export default WorldView;
