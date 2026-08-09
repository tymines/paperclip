/** World View  feed fetchers (TYL-131). All go through the same-origin proxy. */
import { COLLECTOR } from "./theme";
import type {
  FeedResp, NewsItem, GeoItem, SourceRow, Quake, FireItem, Flight, Vessel,
  EonetEvent, Cve, SatTle, ConflictZone, Camera, NewsStation, SwpcState, RadarState, HistoryFrame,
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
export const fetchHistory = (at: Date) => get<HistoryFrame>(`/history?at=${encodeURIComponent(at.toISOString())}`);

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

/** Keyless CORS-open EONET safety net. Track history is provider geometry only. */
export async function fetchEonetDirect(): Promise<EonetEvent[]> {
  const r = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=10", { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`EONET ${r.status}`);
  const j = await r.json() as { events?: Array<{ id: string; title: string; link?: string; categories?: Array<{ id: string }>; sources?: Array<{ url: string }>; geometry?: Array<{ type: string; coordinates: number[]; date?: string; magnitudeValue?: number; magnitudeUnit?: string }> }> };
  return (j.events || []).flatMap((event) => {
    const points = (event.geometry || []).filter((g) => g.type === "Point" && g.coordinates.length >= 2);
    const latest = points.at(-1);
    if (!latest) return [];
    return [{
      id: event.id, title: event.title, category: event.categories?.[0]?.id || "unknown", icon: "event",
      lon: latest.coordinates[0], lat: latest.coordinates[1], date: latest.date || null,
      url: event.sources?.[0]?.url || event.link || "", magnitude: latest.magnitudeValue ?? null,
      magnitudeUnit: latest.magnitudeUnit ?? null,
      track: points.map((p) => ({ lon: p.coordinates[0], lat: p.coordinates[1], date: p.date || null })),
    }];
  });
}

function parseTle(text: string, group: string, cap: number): SatTle[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const out: SatTle[] = [];
  for (let i = 0; i + 2 < lines.length && out.length < cap; i += 3) {
    if (lines[i + 1].startsWith("1 ") && lines[i + 2].startsWith("2 ")) out.push({ name: lines[i], l1: lines[i + 1], l2: lines[i + 2], group });
  }
  return out;
}

/** CelesTrak direct fallback; partial groups remain honestly usable. */
export async function fetchSatellitesDirect(): Promise<SatTle[]> {
  const groups: Array<[string, number]> = [["stations", 30], ["visual", 120], ["gps-ops", 32]];
  const settled = await Promise.allSettled(groups.map(async ([group, cap]) => {
    const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!r.ok) throw new Error(`CelesTrak ${group} ${r.status}`);
    return parseTle(await r.text(), group, cap);
  }));
  const rows = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!rows.length) throw new Error("CelesTrak direct groups unavailable");
  return rows;
}

/** GDELT direct fallback retained for outage safety; news dots stay Wave 3. */
export async function fetchNewsDirect(): Promise<NewsItem[]> {
  const url = "https://api.gdeltproject.org/api/v2/doc/doc?query=" + encodeURIComponent("(conflict OR sanctions OR military OR diplomacy OR election)") + "&mode=artlist&format=json&maxrecords=30&sort=datedesc&timespan=24h";
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`GDELT ${r.status}`);
  const j = await r.json() as { articles?: Array<{ title: string; url: string; domain?: string; seendate?: string; sourcecountry?: string }> };
  return (j.articles || []).map((a) => ({ title: a.title, url: a.url, source: a.domain || "GDELT", published: a.seendate, country: a.sourcecountry }));
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
