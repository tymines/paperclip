import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { DossierCard } from "../worldview/DossierCard";
import { fetchHistory } from "../worldview/fetchers";
import { useLayerData, type HistoricalOverride, type LayerData } from "../worldview/hooks/useLayerData";
import { LAYERS, type FeedState, type LayerDef, type LayerId } from "../worldview/layerRegistry";
import { MapCanvas, type BasemapStatus, type EntityProps, type MapApi, type Projection } from "../worldview/MapCanvas";
import { layersForMode, modeIsCustomized, type ModeId } from "../worldview/modes";
import { Timeline } from "../worldview/Timeline";
import { TopStrip } from "../worldview/TopStrip";
import { C, MONO } from "../worldview/theme";
import { useWorldClock } from "../worldview/hooks/useWorldClock";

const DAY = 24 * 3600_000;

export function WorldView() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "World View" }]); }, [setBreadcrumbs]);
  const { zulu } = useWorldClock();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapApi = useRef<MapApi | null>(null);
  const [mode, setMode] = useState<ModeId>("pulse");
  const [enabled, setEnabled] = useState<Set<LayerId>>(() => layersForMode("pulse"));
  const [modeOpen, setModeOpen] = useState(false);
  const [selected, setSelected] = useState<EntityProps | null>(null);
  const [projection, setProjection] = useState<Projection>("globe");
  const [basemap, setBasemap] = useState<BasemapStatus>("loading");
  const [offsetMs, setOffsetMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [lastInteraction, setLastInteraction] = useState(() => Date.now());
  const [nowTick, setNowTick] = useState(() => Date.now());

  const historicalAt = useMemo(() => new Date(Date.now() - offsetMs), [offsetMs]);
  const history = useQuery({
    queryKey: ["worldview", "history", Math.floor(historicalAt.getTime() / 300_000)],
    queryFn: () => fetchHistory(historicalAt),
    enabled: offsetMs > 0,
    staleTime: 60_000,
    retry: 0,
  });

  const historicalOverride = useCallback((layer: LayerDef): HistoricalOverride | undefined => {
    if (!offsetMs) return undefined;
    if (layer.id === "flights") return { items: [], source: "OpenSky", state: "fallback", note: "Flights are live-only; no history invented.", at: historicalAt };
    if (layer.id === "terminator") return { items: [historicalAt], source: "Solar ephemeris", state: "live", at: historicalAt };
    if (!layer.historyKey) return undefined;
    const feed = history.data?.feeds[layer.historyKey];
    if (!feed) return { items: [], source: layer.provider, state: "offline", note: history.isLoading ? "loading collector memory" : "history gap", at: historicalAt };
    const state: FeedState = feed.status === "gap" ? "offline" : "live";
    return { items: feed.items || [], source: feed.source || layer.provider, state, note: feed.note, at: historicalAt };
  }, [historicalAt, history.data, history.isLoading, offsetMs]);

  const data = {} as Record<LayerId, LayerData>;
  for (const layer of LAYERS) {
    // Registry order is stable; one hook per signature layer.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    data[layer.id] = useLayerData(layer, enabled.has(layer.id), historicalOverride(layer));
  }

  const dependency = LAYERS.map((layer) => data[layer.id].geojson);
  const geojsonByLayer = useMemo(() => Object.fromEntries(LAYERS.map((layer) => [layer.id, data[layer.id].geojson])) as Record<LayerId, FeatureCollection>, dependency); // eslint-disable-line react-hooks/exhaustive-deps
  const customized = modeIsCustomized(mode, enabled);
  const autoRotate = mode === "pulse" && offsetMs === 0 && nowTick - lastInteraction >= 60_000;

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!playing || offsetMs <= 0) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - previous;
      previous = now;
      setOffsetMs((value) => Math.max(0, value - elapsed * 60));
    }, 250);
    return () => window.clearInterval(timer);
  }, [playing, offsetMs]);

  useEffect(() => { if (offsetMs === 0) setPlaying(false); }, [offsetMs]);

  const interact = useCallback(() => { setSelected(null); setLastInteraction(Date.now()); }, []);
  const chooseMode = useCallback((next: ModeId) => { setMode(next); setEnabled(layersForMode(next)); setModeOpen(false); setSelected(null); setLastInteraction(Date.now()); }, []);
  const resetMode = useCallback(() => { setEnabled(layersForMode(mode)); setModeOpen(false); }, [mode]);
  const toggleLayer = useCallback((id: LayerId) => { setEnabled((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }, []);

  const answer = useMemo(() => {
    if (mode === "storms") return `${data.weather.count} weather events · ${data.fires.count} fire detections`;
    if (mode === "space") return `${data.satellites.count} tracked objects · 45-minute ground tracks`;
    return `${data.flights.count} aircraft · ${data.fires.count} fire detections · ${data.seismic.count} seismic events`;
  }, [mode, data.weather.count, data.fires.count, data.satellites.count, data.flights.count, data.seismic.count]);

  const degradation = useMemo(() => {
    if (basemap === "failed") return "basemap · reconnecting · phenomena remain available";
    const affected = LAYERS.filter((layer) => enabled.has(layer.id) && ["fallback", "needs_key", "offline"].includes(data[layer.id].status));
    if (!affected.length) return null;
    return affected.map((layer) => `${layer.label.toLowerCase()} · ${data[layer.id].status === "fallback" ? "direct feed" : data[layer.id].status === "needs_key" ? "awaiting feed access" : "reconnecting"}`).join("   ");
  }, [basemap, enabled, data]);

  const relatedCount = selected ? geojsonByLayer[String(selected.kind) === "fire" ? "fires" : String(selected.kind) === "flight" ? "flights" : String(selected.kind) === "seismic" ? "seismic" : String(selected.kind) === "satellite" ? "satellites" : "weather"].features.length : 0;

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSelected(null); setModeOpen(false); setShowHelp(false); }
      if (event.key.toLowerCase() === "r") mapApi.current?.resetView();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  }, []);

  return (
    <div ref={rootRef} data-pp-page-v4="world-view-quiet-globe" className="relative min-h-[620px] w-full overflow-hidden" style={{ height: "calc(100dvh - 52px)", background: C.bg, color: C.text, fontFamily: MONO }}>
      <MapCanvas geojsonByLayer={geojsonByLayer} enabled={enabled} projection={projection} mode={mode} autoRotate={autoRotate} historical={offsetMs > 0} onSelect={(entity) => { setSelected(entity); setModeOpen(false); }} onInteraction={interact} onReady={(api) => { mapApi.current = api; }} onBasemapStatus={setBasemap} />
      {offsetMs > 0 && <div className="pointer-events-none absolute inset-0 z-10" style={{ background: "rgba(35,72,92,.08)", mixBlendMode: "screen" }} />}
      <TopStrip mode={mode} customized={customized} modeOpen={modeOpen} enabled={enabled} data={data} answer={answer} degradation={degradation} zulu={zulu} offsetMs={offsetMs} projection={projection} onModeOpen={() => setModeOpen((value) => !value)} onMode={chooseMode} onModeReset={resetMode} onToggle={toggleLayer} onProjection={() => setProjection((value) => value === "globe" ? "mercator" : "globe")} onFullscreen={fullscreen} onHelp={() => setShowHelp((value) => !value)} />
      {selected && <DossierCard entity={selected} relatedCount={relatedCount} onClose={() => setSelected(null)} />}
      {showHelp && <div className="absolute right-3 top-14 z-40 w-[min(310px,calc(100vw-24px))] rounded-sm p-4 text-[10px] leading-relaxed" style={{ background: "rgba(4,8,13,.96)", border: `1px solid ${C.line2}`, color: C.mut }}><strong className="mb-2 block uppercase tracking-[.16em]" style={{ color: C.text }}>Quiet Globe</strong>Choose a scene at top left. Hover any phenomenon for source and age; click for its dossier. Drag the lower hairline to revisit collector memory. Flights fade in history because no trail is invented. Press Esc to close.</div>}
      <Timeline offsetMs={offsetMs} playing={playing} gaps={history.data?.gaps || (history.isError ? ["collector offline"] : [])} onOffset={(value) => { setOffsetMs(Math.min(DAY, value)); setPlaying(false); setSelected(null); }} onPlay={() => setPlaying((value) => !value)} onLive={() => { setOffsetMs(0); setPlaying(false); }} />
      <div className="pointer-events-none absolute bottom-2 left-3 z-20 hidden text-[8px] uppercase tracking-[.12em] sm:block" style={{ color: C.faint }}>CARTO · OpenStreetMap · live sources stamped per entity</div>
    </div>
  );
}

export default WorldView;
