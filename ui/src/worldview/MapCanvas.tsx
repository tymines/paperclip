/**
 * World View  MapCanvas (TYL-131). The MapLibre engine.
 *
 * Owns one Map instance. 3D globe is the DEFAULT projection (Tyler's ruling);
 * `mercator` is the fallback toggle. Every registry layer is a GeoJSON source +
 * its declared MapLibre layers; data updates flow through source.setData() so all
 * entities render on the GPU, never as DOM markers. Clicks surface entity props to
 * the parent for the popover.
 */
import { useEffect, useRef } from "react";
import maplibregl, { type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { LAYERS, type LayerId, type LayerDef } from "./layerRegistry";
import { buildStyle, buildSatStyle } from "./mapStyle";
import { C } from "./theme";

export type Projection = "globe" | "mercator";
export type Basemap = "map" | "sat";
export type EntityProps = Record<string, unknown> & { kind?: string };

interface Props {
  geojsonByLayer: Partial<Record<LayerId, FeatureCollection>>;
  enabled: Set<LayerId>;
  projection: Projection;
  basemap: Basemap;
  onSelect: (props: EntityProps) => void;
  onReady?: (api: MapApi) => void;
}

export interface MapApi {
  resetView: () => void;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** A tiny GPU-friendly plane glyph for the flights symbol layer. */
function planeImage(): { width: number; height: number; data: Uint8ClampedArray } {
  const s = 24;
  const cv = document.createElement("canvas");
  cv.width = s; cv.height = s;
  const ctx = cv.getContext("2d")!;
  ctx.translate(s / 2, s / 2);
  ctx.fillStyle = C.green;
  ctx.beginPath();
  // simple upward-pointing triangle "aircraft"
  ctx.moveTo(0, -9);
  ctx.lineTo(6, 8);
  ctx.lineTo(0, 4);
  ctx.lineTo(-6, 8);
  ctx.closePath();
  ctx.fill();
  const img = ctx.getImageData(0, 0, s, s);
  return { width: s, height: s, data: img.data };
}

function styleFor(basemap: Basemap): StyleSpecification {
  return basemap === "sat" ? buildSatStyle() : buildStyle();
}

/** Add every registry layer's source + layers to the map (idempotent). */
function installLayers(map: MLMap, geojsonByLayer: Props["geojsonByLayer"], enabled: Set<LayerId>) {
  for (const layer of LAYERS as LayerDef[]) {
    const src = `wv-${layer.id}`;
    if (!map.getSource(src)) {
      map.addSource(src, { type: "geojson", data: geojsonByLayer[layer.id] || EMPTY });
    }
    for (const spec of layer.mapLayers(src)) {
      if (!map.getLayer(spec.id)) map.addLayer(spec);
      map.setLayoutProperty(spec.id, "visibility", enabled.has(layer.id) ? "visible" : "none");
    }
  }
}

export function MapCanvas({ geojsonByLayer, enabled, projection, basemap, onSelect, onReady }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const styledRef = useRef(false);

  // init once
  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: holder.current,
      style: styleFor(basemap),
      center: [10, 25],
      zoom: 1.6,
      attributionControl: { compact: true },
      maplibreLogo: false,
    });
    mapRef.current = map;

    map.on("style.load", () => {
      try {
        map.setProjection({ type: projection });
        if (projection === "globe") {
          map.setSky?.({
            "sky-color": "#04070B", "horizon-color": "#0A1420",
            "fog-color": "#05080d", "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.5,
            "fog-ground-blend": 0.7, "atmosphere-blend": 0.9,
          });
        }
      } catch { /* projection/sky unsupported  mercator fallback still renders */ }
      try {
        if (!map.hasImage("wv-plane")) map.addImage("wv-plane", planeImage(), { pixelRatio: 2 });
      } catch { /* noop */ }
      installLayers(map, geojsonByLayer, enabled);
      styledRef.current = true;
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    // one delegated click handler per registry layer's interactive layers
    const clickLayerIds: string[] = [];
    for (const layer of LAYERS as LayerDef[]) {
      for (const spec of layer.mapLayers(`wv-${layer.id}`)) {
        if (spec.type === "circle" || spec.type === "symbol") clickLayerIds.push(spec.id);
      }
    }
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: clickLayerIds.filter((id) => map.getLayer(id)) });
      if (feats.length) onSelect(feats[0].properties as EntityProps);
    };
    map.on("click", onClick);
    map.on("mousemove", (e) => {
      const feats = map.queryRenderedFeatures(e.point, { layers: clickLayerIds.filter((id) => map.getLayer(id)) });
      map.getCanvas().style.cursor = feats.length ? "pointer" : "";
    });

    onReady?.({
      resetView: () => map.flyTo({ center: [10, 25], zoom: 1.6, pitch: 0, bearing: 0 }),
      flyTo: (lon, lat, zoom = 4) => map.flyTo({ center: [lon, lat], zoom }),
    });

    return () => { map.remove(); mapRef.current = null; styledRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // data updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styledRef.current) return;
    for (const layer of LAYERS as LayerDef[]) {
      const src = map.getSource(`wv-${layer.id}`) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojsonByLayer[layer.id] || EMPTY);
    }
  }, [geojsonByLayer]);

  // enabled toggles
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styledRef.current) return;
    for (const layer of LAYERS as LayerDef[]) {
      for (const spec of layer.mapLayers(`wv-${layer.id}`)) {
        if (map.getLayer(spec.id)) {
          map.setLayoutProperty(spec.id, "visibility", enabled.has(layer.id) ? "visible" : "none");
        }
      }
    }
  }, [enabled]);

  // projection toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styledRef.current) return;
    try { map.setProjection({ type: projection }); } catch { /* noop */ }
  }, [projection]);

  // basemap toggle  full restyle, then reinstall layers on style.load
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styledRef.current) return;
    styledRef.current = false;
    map.setStyle(styleFor(basemap));
    map.once("style.load", () => {
      try { map.setProjection({ type: projection }); } catch { /* noop */ }
      try { if (!map.hasImage("wv-plane")) map.addImage("wv-plane", planeImage(), { pixelRatio: 2 }); } catch { /* noop */ }
      installLayers(map, geojsonByLayer, enabled);
      styledRef.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  return <div ref={holder} className="absolute inset-0 h-full w-full" style={{ background: C.ocean }} />;
}

export default MapCanvas;
