import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function normalizeLon(lon: number): number {
  return ((lon + 540) % 360) - 180;
}

/** Low-cost solar subpoint accurate enough for an ambient terminator. */
export function solarSubpoint(at = new Date()): { lon: number; lat: number } {
  const days = (at.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400_000;
  const meanLongitude = normalizeLon(280.46 + 0.9856474 * days);
  const anomaly = normalizeLon(357.528 + 0.9856003 * days) * DEG;
  const ecliptic = normalizeLon(meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * days) * DEG;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic)) * RAD;
  const gmst = normalizeLon(280.46061837 + 360.98564736629 * days);
  return { lon: normalizeLon(rightAscension - gmst), lat: declination * RAD };
}

/** Night polygon plus the astronomical terminator line; both render in WebGL. */
export function terminatorGeoJSON(at = new Date()): FeatureCollection<Polygon | LineString> {
  const sun = solarSubpoint(at);
  const boundary: [number, number][] = [];
  // Solar altitude is zero where tan(latitude) =
  // -cos(declination) * cos(hour angle) / sin(declination). Sampling by
  // longitude keeps the polygon planar-valid across the antimeridian. The
  // previous bearing ring was angle-sorted in lon/lat space, which introduced
  // self-intersections and could stall MapLibre's polygon triangulation.
  const declination = (Math.abs(sun.lat) < 0.01 ? Math.sign(sun.lat || 1) * 0.01 : sun.lat) * DEG;
  for (let lon = -180; lon <= 180; lon += 2) {
    const hourAngle = normalizeLon(lon - sun.lon) * DEG;
    const lat = Math.atan((-Math.cos(declination) * Math.cos(hourAngle)) / Math.sin(declination)) * RAD;
    boundary.push([lon, lat]);
  }
  const nightPole = sun.lat >= 0 ? -90 : 90;
  const poleEdge: [number, number][] = [];
  for (let lon = 180; lon >= -180; lon -= 10) poleEdge.push([lon, nightPole]);
  const ring = [...boundary, ...poleEdge, boundary[0]];
  const night: Feature<Polygon> = { type: "Feature", properties: { kind: "terminator", source: "Solar ephemeris", observedAt: at.toISOString() }, geometry: { type: "Polygon", coordinates: [ring] } };
  const line: Feature<LineString> = { type: "Feature", properties: { kind: "terminator-line", source: "Solar ephemeris", observedAt: at.toISOString() }, geometry: { type: "LineString", coordinates: boundary } };
  return { type: "FeatureCollection", features: [night, line] };
}

export function formatRelativeTime(offsetMs: number): string {
  if (offsetMs < 60_000) return "LIVE";
  const totalMinutes = Math.floor(offsetMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `−${hours}h${minutes ? ` ${minutes}m` : ""}`;
}

export function ageLabel(value: unknown, now = Date.now()): string {
  const at = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(at)) return "age unknown";
  const sec = Math.max(0, Math.floor((now - at) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}
