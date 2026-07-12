/** World View  feed fetchers (TYL-131). All go through the same-origin proxy. */
import { COLLECTOR } from "./theme";
import type {
  FeedResp, NewsItem, GeoItem, SourceRow, Quake, FireItem, Flight, Vessel,
  EonetEvent, Cve, SatTle, ConflictZone, Camera, NewsStation, SwpcState, RadarState,
} from "./types";

const TIMEOUT = 12000;

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${COLLECTOR}${path}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`worldview ${path}  ${r.status}`);
  return r.json();
}

async function getItems<T>(path: string): Promise<FeedResp<T>> {
  const j = await get<FeedResp<T>>(path);
  return { status: j.status || "ok", source: j.source, items: j.items || [], note: j.note ?? null };
}

export const fetchNews = () => getItems<NewsItem>("/news");
export const fetchGeo = () => getItems<GeoItem>("/geopolitical");
export const fetchQuakes = () => getItems<Quake>("/quakes");
export const fetchFires = () => getItems<FireItem>("/firms");
export const fetchFlights = () => getItems<Flight>("/opensky");
export const fetchVessels = () => getItems<Vessel>("/ais");
export const fetchEonet = () => getItems<EonetEvent>("/eonet");
export const fetchCve = () => getItems<Cve>("/cve");
export const fetchSatellites = () => getItems<SatTle>("/satellites");
export const fetchConflicts = () => getItems<ConflictZone>("/conflicts");
export const fetchCctv = () => getItems<Camera>("/cctv");
export const fetchLiveNews = () => getItems<NewsStation>("/live-news");

export async function fetchSources(): Promise<{ sources: SourceRow[] }> {
  const j = await get<{ sources: SourceRow[] }>("/sources");
  return { sources: j.sources || [] };
}

export async function fetchSwpc(): Promise<SwpcState | null> {
  const j = await getItems<SwpcState>("/swpc");
  return j.items[0] || null;
}

export async function fetchRadar(): Promise<RadarState | null> {
  const j = await getItems<RadarState>("/radar");
  return j.items[0] || null;
}

/** Direct USGS fallback so the map centerpiece is real even if the collector is down. */
export async function fetchQuakesDirect(): Promise<Quake[]> {
  const r = await fetch(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
    { signal: AbortSignal.timeout(TIMEOUT) },
  );
  if (!r.ok) throw new Error(`USGS ${r.status}`);
  const j = await r.json();
  return (j.features || []).map((f: {
    id: string;
    properties: { mag: number; place: string; time: number; url: string };
    geometry: { coordinates: number[] };
  }) => ({
    id: f.id, mag: f.properties.mag, place: f.properties.place, time: f.properties.time,
    url: f.properties.url, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
  }));
}

// ── collector health (TYL-131 fix) — for the map-area diagnostic overlay ──────
export async function fetchHealth(): Promise<{ ok: boolean }> {
  try {
    const r = await fetch(`${COLLECTOR}/health`, { signal: AbortSignal.timeout(6000) });
    return { ok: r.ok };
  } catch {
    return { ok: false };
  }
}
