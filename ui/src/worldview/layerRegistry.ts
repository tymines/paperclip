/** Quiet Globe signature-layer registry. Geometry remains GPU-rendered in MapLibre. */
import type { Feature, FeatureCollection } from "geojson";
import type { LayerSpecification as MapLayerSpecification } from "maplibre-gl";
import { C } from "./theme";
import { fetchEonet, fetchEonetDirect, fetchFires, fetchFlights, fetchQuakes, fetchQuakesDirect, fetchSatellites, fetchSatellitesDirect } from "./fetchers";
import { groundTrack, propagate } from "./satellites/propagate";
import { terminatorGeoJSON } from "./time";
import type { EonetEvent, FireItem, Flight, Quake, SatTle } from "./types";

export type LayerId = "flights" | "seismic" | "fires" | "terminator" | "satellites" | "weather";
export type FeedState = "live" | "fallback" | "needs_key" | "offline";

export interface LayerFetch<T> {
  items: T[];
  source: string;
  state: FeedState;
  note?: string | null;
}

export interface LayerDef<T = unknown> {
  id: LayerId;
  label: string;
  provider: string;
  historyKey?: "quakes" | "firms" | "eonet";
  pollMs: number;
  fetch: () => Promise<LayerFetch<T>>;
  toGeoJSON: (items: T[], at?: Date) => FeatureCollection;
  mapLayers: (source: string) => MapLayerSpecification[];
}

const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const pt = (lon: number, lat: number, properties: Record<string, unknown>): Feature => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });

async function collector<T>(request: Promise<{ items: T[]; source?: string; status: string; note?: string | null }>, provider: string): Promise<LayerFetch<T>> {
  const payload = await request;
  const state: FeedState = payload.status === "needs_key" ? "needs_key" : payload.status === "error" ? "offline" : "live";
  return { items: payload.items || [], source: payload.source || provider, state, note: payload.note };
}

async function withDirectFallback<T>(primary: () => Promise<LayerFetch<T>>, direct: () => Promise<T[]>, provider: string): Promise<LayerFetch<T>> {
  try {
    const value = await primary();
    if (value.state !== "offline") return value;
  } catch { /* direct path below */ }
  return { items: await direct(), source: `${provider} · direct`, state: "fallback", note: "collector unavailable; browser direct feed" };
}

function destination(lon: number, lat: number, bearing: number, km: number): [number, number] {
  const radius = 6371;
  const d = km / radius;
  const b = bearing * Math.PI / 180;
  const p = lat * Math.PI / 180;
  const l = lon * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(b));
  const l2 = l + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p), Math.cos(d) - Math.sin(p) * Math.sin(p2));
  return [((l2 * 180 / Math.PI + 540) % 360) - 180, p2 * 180 / Math.PI];
}

const flights: LayerDef<Flight> = {
  id: "flights", label: "Flights", provider: "OpenSky", pollMs: 20_000,
  fetch: () => collector(fetchFlights(), "OpenSky"),
  toGeoJSON: (items, at = new Date()) => fc(items.flatMap((flight) => {
    const props = { id: flight.icao24, kind: "flight", callsign: flight.callsign || flight.icao24, heading: flight.heading || 0, velocity: flight.velocity || 0, altitude: flight.altitude || 0, country: flight.country, source: "OpenSky", observedAt: at.toISOString() };
    const back = destination(flight.lon, flight.lat, (flight.heading || 0) + 180, Math.max(2, (flight.velocity || 0) * 0.09));
    return [
      { type: "Feature", geometry: { type: "LineString", coordinates: [back, [flight.lon, flight.lat]] }, properties: props } as Feature,
      pt(flight.lon, flight.lat, props),
    ];
  })),
  mapLayers: (source) => [
    { id: `${source}-trail`, type: "line", source, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": C.amber, "line-width": 0.8, "line-opacity": 0.2 } },
    { id: `${source}-icon`, type: "symbol", source, filter: ["==", ["geometry-type"], "Point"], layout: { "icon-image": "wv-plane", "icon-size": 0.46, "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true }, paint: { "icon-opacity": 0.86 } },
  ],
};

const seismic: LayerDef<Quake> = {
  id: "seismic", label: "Seismic", provider: "USGS", historyKey: "quakes", pollMs: 120_000,
  fetch: () => withDirectFallback(() => collector(fetchQuakes(), "USGS"), fetchQuakesDirect, "USGS"),
  toGeoJSON: (items) => fc(items.map((quake) => pt(quake.lon, quake.lat, { id: quake.id, kind: "seismic", mag: quake.mag, place: quake.place, url: quake.url, time: quake.time, source: "USGS", observedAt: quake.time }))),
  mapLayers: (source) => [
    { id: `${source}-glow`, type: "circle", source, paint: { "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 2.5, 7, 6, 34], "circle-color": ["step", ["get", "mag"], C.cyan, 4, C.amber, 5, C.red], "circle-opacity": 0.16, "circle-blur": 0.85 } },
    { id: `${source}-pulse`, type: "circle", source, filter: [">=", ["get", "mag"], 5], paint: { "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 5, 13, 7, 31], "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": C.red, "circle-stroke-width": 1, "circle-stroke-opacity": 0.34 } },
    { id: `${source}-core`, type: "circle", source, paint: { "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 2.5, 1.8, 6, 6], "circle-color": ["step", ["get", "mag"], C.cyan, 4, C.amber, 5, C.red], "circle-stroke-width": 0.5, "circle-stroke-color": "#fff", "circle-stroke-opacity": 0.5 } },
  ],
};

const fires: LayerDef<FireItem> = {
  id: "fires", label: "Fires", provider: "NASA FIRMS", historyKey: "firms", pollMs: 300_000,
  fetch: () => collector(fetchFires(), "NASA FIRMS"),
  toGeoJSON: (items) => fc(items.map((fire, index) => pt(fire.lon, fire.lat, { id: `fire-${index}`, kind: "fire", frp: fire.frp || 0, confidence: fire.confidence, satellite: fire.satellite, instrument: fire.instrument, source: "NASA FIRMS", observedAt: fire.acq_date ? `${fire.acq_date}T${String(fire.acq_time || "0000").padStart(4, "0").slice(0, 2)}:${String(fire.acq_time || "0000").padStart(4, "0").slice(2)}:00Z` : null }))),
  mapLayers: (source) => [
    { id: `${source}-heat`, type: "heatmap", source, maxzoom: 7, paint: { "heatmap-weight": ["interpolate", ["linear"], ["get", "frp"], 0, 0.08, 100, 1], "heatmap-intensity": 0.8, "heatmap-radius": 22, "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.25, "rgba(245,165,36,.25)", 0.65, "rgba(255,77,45,.72)", 1, "#fff0a4"], "heatmap-opacity": 0.78 } },
    { id: `${source}-core`, type: "circle", source, minzoom: 2.5, paint: { "circle-radius": ["interpolate", ["linear"], ["get", "frp"], 0, 1.2, 100, 4.8], "circle-color": "#ff7043", "circle-opacity": 0.8, "circle-blur": 0.25 } },
  ],
};

const terminator: LayerDef<Date> = {
  id: "terminator", label: "Day / night", provider: "Solar ephemeris", pollMs: 60_000,
  fetch: async () => ({ items: [new Date()], source: "Solar ephemeris", state: "live" }),
  toGeoJSON: (_items, at = new Date()) => terminatorGeoJSON(at),
  mapLayers: (source) => [
    { id: `${source}-night`, type: "fill", source, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#01040a", "fill-opacity": 0.42 } },
    { id: `${source}-edge`, type: "line", source, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#6b84a0", "line-opacity": 0.16, "line-width": 1.2, "line-blur": 1.5 } },
  ],
};

const satellites: LayerDef<SatTle> = {
  id: "satellites", label: "Satellites", provider: "CelesTrak", pollMs: 6 * 3600_000,
  fetch: () => withDirectFallback(() => collector(fetchSatellites(), "CelesTrak"), fetchSatellitesDirect, "CelesTrak"),
  toGeoJSON: (items, at = new Date()) => {
    const positions = propagate(items, at);
    const byName = new Map(positions.map((position) => [position.name, position]));
    const tracks = items.map((tle) => ({ type: "Feature", geometry: { type: "LineString", coordinates: groundTrack(tle) }, properties: { id: `${tle.name}-track`, kind: "orbit", name: tle.name, source: "CelesTrak", observedAt: at.toISOString() } } as Feature));
    const points = items.flatMap((tle) => { const position = byName.get(tle.name); return position ? [pt(position.lon, position.lat, { id: tle.name, kind: "satellite", name: tle.name, group: tle.group, altKm: Math.round(position.altKm), iss: /ISS \(ZARYA\)/i.test(tle.name), source: "CelesTrak", observedAt: at.toISOString() })] : []; });
    return fc([...tracks, ...points]);
  },
  mapLayers: (source) => [
    { id: `${source}-orbit`, type: "line", source, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": C.violet, "line-width": 0.8, "line-opacity": 0.28 } },
    { id: `${source}-glow`, type: "circle", source, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": ["case", ["get", "iss"], 8, 4], "circle-color": C.violet, "circle-opacity": 0.18, "circle-blur": 0.8 } },
    { id: `${source}-point`, type: "circle", source, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": ["case", ["get", "iss"], 4, 1.7], "circle-color": ["case", ["get", "iss"], "#ffffff", C.violet], "circle-opacity": 0.92, "circle-stroke-width": ["case", ["get", "iss"], 1, 0], "circle-stroke-color": C.amber } },
  ],
};

const weather: LayerDef<EonetEvent> = {
  id: "weather", label: "Severe weather", provider: "NASA EONET", historyKey: "eonet", pollMs: 600_000,
  fetch: () => withDirectFallback(() => collector(fetchEonet(), "NASA EONET"), fetchEonetDirect, "NASA EONET"),
  toGeoJSON: (items) => fc(items.flatMap((event) => {
    const props = { id: event.id, kind: "weather", title: event.title, category: event.category, url: event.url, source: "NASA EONET", observedAt: event.date };
    const line = event.track && event.track.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: event.track.map((point) => [point.lon, point.lat]) }, properties: props } as Feature] : [];
    return [...line, pt(event.lon, event.lat, props)];
  })),
  mapLayers: (source) => [
    { id: `${source}-track`, type: "line", source, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": C.cyan, "line-width": 1.2, "line-opacity": 0.42 } },
    { id: `${source}-glow`, type: "circle", source, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 13, "circle-color": C.cyan, "circle-opacity": 0.13, "circle-blur": 0.78 } },
    { id: `${source}-point`, type: "circle", source, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 3.4, "circle-color": C.cyan, "circle-opacity": 0.9, "circle-stroke-width": 0.7, "circle-stroke-color": "#d9f8ff" } },
  ],
};

export const LAYERS: LayerDef<any>[] = [flights, seismic, fires, terminator, satellites, weather];
export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((layer) => [layer.id, layer])) as Record<LayerId, LayerDef<any>>;
