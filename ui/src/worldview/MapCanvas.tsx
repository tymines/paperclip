import { useEffect, useRef } from "react";
import maplibregl, { type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { LAYERS, type LayerDef, type LayerId } from "./layerRegistry";
import { buildStyle } from "./mapStyle";
import { MODES, type ModeId } from "./modes";
import { ageLabel } from "./time";
import { C } from "./theme";

export type Projection = "globe" | "mercator";
export type BasemapStatus = "loading" | "ok" | "failed";
export type EntityProps = Record<string, unknown> & { kind?: string };

interface Props {
  geojsonByLayer: Partial<Record<LayerId, FeatureCollection>>;
  enabled: ReadonlySet<LayerId>;
  projection: Projection;
  mode: ModeId;
  autoRotate: boolean;
  historical: boolean;
  onSelect: (props: EntityProps) => void;
  onInteraction: () => void;
  onReady?: (api: MapApi) => void;
  onBasemapStatus?: (status: BasemapStatus) => void;
}

export interface MapApi {
  resetView: () => void;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const RENDER_ORDER = [...LAYERS].sort((a, b) => Number(b.id === "terminator") - Number(a.id === "terminator"));

function planeImage(): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  context.translate(size / 2, size / 2);
  context.fillStyle = C.amber;
  context.shadowColor = C.amber;
  context.shadowBlur = 5;
  context.beginPath();
  context.moveTo(0, -12); context.lineTo(3, -2); context.lineTo(11, 3); context.lineTo(10, 6); context.lineTo(2, 4); context.lineTo(2, 10); context.lineTo(5, 12); context.lineTo(0, 11); context.lineTo(-5, 12); context.lineTo(-2, 10); context.lineTo(-2, 4); context.lineTo(-10, 6); context.lineTo(-11, 3); context.lineTo(-3, -2); context.closePath();
  context.fill();
  const image = context.getImageData(0, 0, size, size);
  return { width: size, height: size, data: image.data };
}

function installLayers(map: MLMap, data: Props["geojsonByLayer"], enabled: ReadonlySet<LayerId>) {
  for (const layer of RENDER_ORDER as LayerDef[]) {
    const sourceId = `wv-${layer.id}`;
    if (!map.getSource(sourceId)) map.addSource(sourceId, { type: "geojson", data: data[layer.id] || EMPTY });
    for (const spec of layer.mapLayers(sourceId)) {
      if (!map.getLayer(spec.id)) map.addLayer(spec);
      map.setLayoutProperty(spec.id, "visibility", enabled.has(layer.id) ? "visible" : "none");
    }
  }
}

function interactiveLayerIds(map: MLMap): string[] {
  return RENDER_ORDER.flatMap((layer) => layer.mapLayers(`wv-${layer.id}`)).filter((spec) => (spec.type === "circle" || spec.type === "symbol") && map.getLayer(spec.id)).map((spec) => spec.id);
}

export function MapCanvas({ geojsonByLayer, enabled, projection, mode, autoRotate, historical, onSelect, onInteraction, onReady, onBasemapStatus }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const latestData = useRef(geojsonByLayer);
  const latestEnabled = useRef(enabled);
  const callbacks = useRef({ onSelect, onInteraction, onBasemapStatus });
  latestData.current = geojsonByLayer;
  latestEnabled.current = enabled;
  callbacks.current = { onSelect, onInteraction, onBasemapStatus };

  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: holder.current, style: buildStyle() as StyleSpecification, center: MODES.pulse.camera.center, zoom: MODES.pulse.camera.zoom, attributionControl: { compact: true }, maplibreLogo: false, fadeDuration: 600 });
    mapRef.current = map;
    callbacks.current.onBasemapStatus?.("loading");
    let tileLoaded = false;
    let tileErrors = 0;
    let tooltip: maplibregl.Popup | null = null;

    map.on("data", (event: maplibregl.MapSourceDataEvent) => {
      if (event.sourceId === "carto" && (event as { tile?: unknown }).tile) {
        tileLoaded = true;
        callbacks.current.onBasemapStatus?.("ok");
      }
    });
    map.on("error", (event: maplibregl.ErrorEvent & { sourceId?: string }) => {
      if (event.sourceId === "carto" || /tile|cartocdn/i.test(String(event.error?.message || ""))) {
        tileErrors += 1;
        if (!tileLoaded && tileErrors >= 4) callbacks.current.onBasemapStatus?.("failed");
      }
    });
    const watchdog = window.setTimeout(() => { if (!tileLoaded) callbacks.current.onBasemapStatus?.("failed"); }, 9000);

    map.on("style.load", () => {
      try {
        map.setProjection({ type: "globe" });
        map.setSky({ "sky-color": "#02060c", "horizon-color": "#101d2b", "fog-color": "#050a10", "sky-horizon-blend": 0.35, "horizon-fog-blend": 0.55, "fog-ground-blend": 0.65, "atmosphere-blend": 0.95 });
      } catch { /* mercator remains a designed fallback */ }
      if (!map.hasImage("wv-plane")) map.addImage("wv-plane", planeImage(), { pixelRatio: 2 });
      installLayers(map, latestData.current, latestEnabled.current);
      ready.current = true;

      const onPointer = (event: maplibregl.MapMouseEvent) => {
        const features = map.queryRenderedFeatures(event.point, { layers: interactiveLayerIds(map) });
        map.getCanvas().style.cursor = features.length ? "pointer" : "grab";
        const feature = features[0];
        if (!feature) { tooltip?.remove(); tooltip = null; return; }
        const properties = feature.properties as EntityProps;
        const source = String(properties.source || "source unknown");
        const label = String(properties.callsign || properties.title || properties.place || properties.name || properties.kind || "entity");
        const html = `<div style="font:10px ui-monospace;color:#d9e1ea"><b>${label.replace(/[<>]/g, "")}</b><br><span style="color:#7f8b98">${source.replace(/[<>]/g, "")} · ${ageLabel(properties.observedAt)}</span></div>`;
        if (!tooltip) tooltip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "wv-tooltip" });
        tooltip.setLngLat(event.lngLat).setHTML(html).addTo(map);
      };
      map.on("mousemove", onPointer);
      map.on("click", (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: interactiveLayerIds(map) })[0];
        if (feature) callbacks.current.onSelect(feature.properties as EntityProps);
      });
    });

    const interaction = () => callbacks.current.onInteraction();
    map.on("dragstart", interaction); map.on("zoomstart", interaction); map.on("rotatestart", interaction); map.on("pitchstart", interaction);
    onReady?.({ resetView: () => map.easeTo({ ...MODES.pulse.camera, duration: 1200 }), flyTo: (lon, lat, zoom = 4) => map.easeTo({ center: [lon, lat], zoom, duration: 1200 }) });
    return () => { window.clearTimeout(watchdog); tooltip?.remove(); map.remove(); mapRef.current = null; ready.current = false; };
    // MapLibre owns one map for this component lifetime; callbacks are held in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    for (const layer of LAYERS) {
      const source = map.getSource(`wv-${layer.id}`) as maplibregl.GeoJSONSource | undefined;
      source?.setData(geojsonByLayer[layer.id] || EMPTY);
    }
  }, [geojsonByLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    for (const layer of LAYERS) {
      for (const spec of layer.mapLayers(`wv-${layer.id}`)) if (map.getLayer(spec.id)) map.setLayoutProperty(spec.id, "visibility", enabled.has(layer.id) ? "visible" : "none");
    }
  }, [enabled]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    try { map.setProjection({ type: projection }); } catch { /* fallback already visible */ }
  }, [projection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    map.easeTo({ ...MODES[mode].camera, duration: 1200, easing: (t) => t * t * (3 - 2 * t) });
    try { map.setSky({ "sky-color": mode === "space" ? "#00030a" : "#02060c", "horizon-color": mode === "space" ? "#111329" : "#101d2b", "fog-color": "#050a10", "sky-horizon-blend": mode === "space" ? 0.18 : 0.35, "horizon-fog-blend": 0.55, "fog-ground-blend": 0.65, "atmosphere-blend": 0.95 }); } catch { /* optional */ }
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !autoRotate || historical) return;
    let frame = 0;
    let previous = performance.now();
    const rotate = (now: number) => {
      if (now - previous > 32) { map.setBearing(map.getBearing() + (now - previous) * 0.00032); previous = now; }
      frame = requestAnimationFrame(rotate);
    };
    frame = requestAnimationFrame(rotate);
    return () => cancelAnimationFrame(frame);
  }, [autoRotate, historical]);

  return <div ref={holder} className="absolute inset-0 h-full w-full" style={{ background: "radial-gradient(circle at 50% 45%,#091522,#010308 72%)" }} />;
}

export default MapCanvas;
