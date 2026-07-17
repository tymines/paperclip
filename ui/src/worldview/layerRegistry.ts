/**
 * World View  layer registry (TYL-131). THE core abstraction.
 *
 * Each LayerDef describes a feed end-to-end: how to fetch it, how to turn its
 * items into GeoJSON, which MapLibre layers render it, its poll cadence, and its
 * data-honesty marker. Adding a feed = adding one entry here; MapCanvas and
 * LayerPanel are generic over this list. No per-layer logic lives in components.
 */
import type { LayerSpecification } from "maplibre-gl";
import type { FeatureCollection, Feature, Geometry } from "geojson";
import { C, SEVERITY_COLOR } from "./theme";
import {
  fetchQuakes, fetchQuakesDirect, fetchFires, fetchFlights, fetchVessels,
  fetchEonet, fetchSatellites, fetchConflicts, fetchCctv, fetchLiveNews,
} from "./fetchers";
import { propagate } from "./satellites/propagate";
import type {
  Quake, FireItem, Flight, Vessel, EonetEvent, SatTle, ConflictZone, Camera, NewsStation,
} from "./types";

export type LayerId =
  | "seismic" | "fires" | "flights" | "vessels" | "satellites"
  | "weather" | "conflicts" | "cctv" | "livenews";

export interface LayerDef<T = unknown> {
  id: LayerId;
  label: string;
  color: string;
  hotkey?: string;
  defaultOn: boolean;
  /** Fetch raw items. Some layers return {items}, normalized to T[] here. */
  fetch: () => Promise<T[]>;
  /** Poll interval (ms). Fast layers pause when the layer is off / tab hidden. */
  pollMs: number;
  /** Build a GeoJSON FeatureCollection from items (+ optional derived state). */
  toGeoJSON: (items: T[]) => FeatureCollection;
  /** MapLibre layer specs; `src` is the source id to bind. Order = paint order. */
  mapLayers: (src: string) => LayerSpecification[];
  /** data-honesty marker (mirrors product-spec convention). */
  marker: "REAL" | "NEEDS-ENDPOINT";
  /** Human sublabel for the panel. */
  provider: string;
}

//  helpers 
function fc(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}
function pt(lon: number, lat: number, props: Record<string, unknown>): Feature<Geometry> {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: props };
}
async function unwrap<T>(p: Promise<{ items: T[] }>): Promise<T[]> {
  return (await p).items;
}

//  seismic 
const seismic: LayerDef<Quake> = {
  id: "seismic", label: "Seismic M2.5+", color: C.cyan, hotkey: "e", defaultOn: true,
  provider: "USGS", marker: "REAL", pollMs: 120000,
  fetch: async () => {
    try { return await unwrap(fetchQuakes()); }
    catch { return fetchQuakesDirect(); }
  },
  toGeoJSON: (qs) => fc(qs.map((q) =>
    pt(q.lon, q.lat, { id: q.id, kind: "seismic", mag: q.mag, place: q.place, url: q.url, time: q.time }))),
  mapLayers: (src) => [
    { id: `${src}-glow`, type: "circle", source: src, paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 2.5, 6, 6, 34],
      "circle-color": ["step", ["get", "mag"], C.cyan, 4, C.amber, 5, C.red],
      "circle-opacity": 0.16, "circle-blur": 0.9 } },
    { id: `${src}-core`, type: "circle", source: src, paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 2.5, 1.6, 6, 6],
      "circle-color": ["step", ["get", "mag"], C.cyan, 4, C.amber, 5, C.red],
      "circle-stroke-width": 0.5, "circle-stroke-color": "#fff", "circle-stroke-opacity": 0.4 } },
  ],
};

//  fires 
const fires: LayerDef<FireItem> = {
  id: "fires", label: "Active Fires", color: C.amber, hotkey: "i", defaultOn: true,
  provider: "NASA FIRMS", marker: "REAL", pollMs: 300000,
  fetch: () => unwrap(fetchFires()),
  toGeoJSON: (fs) => fc(fs.map((f, i) =>
    pt(f.lon, f.lat, { id: `fire-${i}`, kind: "fire", frp: f.frp ?? 0, confidence: f.confidence,
      satellite: f.satellite, instrument: f.instrument }))),
  mapLayers: (src) => [
    { id: `${src}-heat`, type: "heatmap", source: src, maxzoom: 6, paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "frp"], 0, 0.1, 100, 1],
      "heatmap-intensity": 0.6, "heatmap-radius": 18,
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(0,0,0,0)", 0.3, "rgba(245,165,36,0.4)", 0.7, "rgba(255,77,77,0.7)", 1, "#ffdd55"],
      "heatmap-opacity": 0.7 } },
    { id: `${src}-pt`, type: "circle", source: src, minzoom: 3, paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "frp"], 0, 1.5, 80, 5],
      "circle-color": C.red, "circle-opacity": 0.85, "circle-blur": 0.3 } },
  ],
};

//  flights 
const flights: LayerDef<Flight> = {
  id: "flights", label: "Flights", color: C.green, hotkey: "f", defaultOn: false,
  provider: "OpenSky", marker: "REAL", pollMs: 20000,
  fetch: () => unwrap(fetchFlights()),
  toGeoJSON: (fl) => fc(fl.map((f) =>
    pt(f.lon, f.lat, { id: f.icao24, kind: "flight", callsign: f.callsign || f.icao24,
      heading: f.heading || 0, velocity: f.velocity ?? 0, altitude: f.altitude ?? 0, country: f.country }))),
  mapLayers: (src) => [
    { id: `${src}-icon`, type: "symbol", source: src, layout: {
      "icon-image": "wv-plane", "icon-size": 0.5, "icon-rotate": ["get", "heading"],
      "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true } },
  ],
};

//  vessels 
const vessels: LayerDef<Vessel> = {
  id: "vessels", label: "Vessels (AIS)", color: C.blue, hotkey: "v", defaultOn: false,
  provider: "AISStream", marker: "REAL", pollMs: 30000,
  fetch: () => unwrap(fetchVessels()),
  toGeoJSON: (vs) => fc(vs.map((v) =>
    pt(v.lon, v.lat, { id: v.mmsi, kind: "vessel", name: v.name || v.mmsi, sog: v.sog ?? 0,
      heading: v.heading ?? 0, type: v.type || "" }))),
  mapLayers: (src) => [
    { id: `${src}-pt`, type: "circle", source: src, paint: {
      "circle-radius": 2.2, "circle-color": C.blue, "circle-opacity": 0.85,
      "circle-stroke-width": 0.4, "circle-stroke-color": "#cfe4ff" } },
  ],
};

//  satellites (client-side propagation) 
const satellites: LayerDef<SatTle> = {
  id: "satellites", label: "Satellites", color: C.violet, hotkey: "s", defaultOn: false,
  provider: "CelesTrak", marker: "NEEDS-ENDPOINT", pollMs: 6 * 60 * 60 * 1000,
  fetch: () => unwrap(fetchSatellites()),
  toGeoJSON: (tles) => {
    const positions = propagate(tles);
    return fc(positions.map((s) =>
      pt(s.lon, s.lat, { id: s.name, kind: "satellite", name: s.name, group: s.group, altKm: Math.round(s.altKm) })));
  },
  mapLayers: (src) => [
    { id: `${src}-glow`, type: "circle", source: src, paint: {
      "circle-radius": 4, "circle-color": C.violet, "circle-opacity": 0.18, "circle-blur": 0.8 } },
    { id: `${src}-pt`, type: "circle", source: src, paint: {
      "circle-radius": ["match", ["get", "group"], "stations", 3, 1.6],
      "circle-color": ["match", ["get", "group"], "stations", "#fff", "gps-ops", C.green, C.violet],
      "circle-opacity": 0.9 } },
  ],
};

//  severe weather (EONET) 
const weather: LayerDef<EonetEvent> = {
  id: "weather", label: "Severe Weather", color: C.green, hotkey: "w", defaultOn: false,
  provider: "NASA EONET", marker: "NEEDS-ENDPOINT", pollMs: 600000,
  fetch: () => unwrap(fetchEonet()),
  toGeoJSON: (evs) => fc(evs.map((e) =>
    pt(e.lon, e.lat, { id: e.id, kind: "weather", title: e.title, category: e.category, icon: e.icon, url: e.url }))),
  mapLayers: (src) => [
    { id: `${src}-glow`, type: "circle", source: src, paint: {
      "circle-radius": 9, "circle-color": C.green, "circle-opacity": 0.14, "circle-blur": 0.7 } },
    { id: `${src}-pt`, type: "circle", source: src, paint: {
      "circle-radius": 3.2, "circle-color": C.green, "circle-opacity": 0.9,
      "circle-stroke-width": 0.5, "circle-stroke-color": "#eafff2" } },
  ],
};

//  conflict zones 
const conflicts: LayerDef<ConflictZone> = {
  id: "conflicts", label: "Conflict Zones", color: C.red, hotkey: "c", defaultOn: false,
  provider: "Curated (OSIRIS, MIT)", marker: "NEEDS-ENDPOINT", pollMs: 30 * 60 * 1000,
  fetch: () => unwrap(fetchConflicts()),
  toGeoJSON: (zs) => fc(zs.map((z) =>
    pt(z.lon, z.lat, { id: z.id, kind: "conflict", label: z.label, severity: z.severity,
      color: SEVERITY_COLOR[z.severity] || C.amber, description: z.description, sourceUrl: z.sourceUrl }))),
  mapLayers: (src) => [
    { id: `${src}-halo`, type: "circle", source: src, paint: {
      "circle-radius": ["match", ["get", "severity"], "war", 26, "high", 18, 12],
      "circle-color": ["get", "color"], "circle-opacity": 0.12, "circle-blur": 0.9 } },
    { id: `${src}-ring`, type: "circle", source: src, paint: {
      "circle-radius": ["match", ["get", "severity"], "war", 8, "high", 6, 4.5],
      "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 1.4, "circle-stroke-color": ["get", "color"],
      "circle-stroke-opacity": 0.85 } },
  ],
};

//  CCTV 
const cctv: LayerDef<Camera> = {
  id: "cctv", label: "CCTV", color: C.mut, hotkey: "k", defaultOn: false,
  provider: "TfL JamCams", marker: "NEEDS-ENDPOINT", pollMs: 30 * 60 * 1000,
  fetch: () => unwrap(fetchCctv()),
  toGeoJSON: (cs) => fc(cs.map((c) =>
    pt(c.lon, c.lat, { id: c.id, kind: "cctv", name: c.name, imageUrl: c.imageUrl,
      videoUrl: c.videoUrl, available: c.available, city: c.city }))),
  mapLayers: (src) => [
    { id: `${src}-pt`, type: "circle", source: src, minzoom: 4, paint: {
      "circle-radius": 2.4, "circle-color": C.mut, "circle-opacity": 0.8,
      "circle-stroke-width": 0.5, "circle-stroke-color": C.text } },
  ],
};

//  live news 
const livenews: LayerDef<NewsStation> = {
  id: "livenews", label: "Live News", color: C.cyan, hotkey: "n", defaultOn: false,
  provider: "Curated (OSIRIS, MIT)", marker: "NEEDS-ENDPOINT", pollMs: 24 * 60 * 60 * 1000,
  fetch: () => unwrap(fetchLiveNews()),
  toGeoJSON: (ns) => fc(ns.map((n) =>
    pt(n.lon, n.lat, { id: n.id, kind: "livenews", name: n.name, city: n.city, url: n.url,
      embed: n.embed, category: n.category }))),
  mapLayers: (src) => [
    { id: `${src}-glow`, type: "circle", source: src, paint: {
      "circle-radius": 8, "circle-color": C.cyan, "circle-opacity": 0.16, "circle-blur": 0.7 } },
    { id: `${src}-pt`, type: "circle", source: src, paint: {
      "circle-radius": 3, "circle-color": C.cyan, "circle-opacity": 0.95,
      "circle-stroke-width": 0.5, "circle-stroke-color": "#eafaff" } },
  ],
};

export const LAYERS: LayerDef[] = [
  seismic, fires, flights, vessels, satellites, weather, conflicts, cctv, livenews,
] as LayerDef[];

export const LAYER_BY_ID: Record<LayerId, LayerDef> =
  Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<LayerId, LayerDef>;
