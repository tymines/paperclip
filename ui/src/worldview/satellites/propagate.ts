/**
 * World View  satellite propagation (TYL-131).
 * Turns CelesTrak TLE sets into current lon/lat/alt via satellite.js (SGP4).
 * Runs on the main thread; groups are capped small (stations/visual/gps-ops)
 * so per-frame cost stays trivial. If the set grows, move to a Web Worker.
 */
import * as satellite from "satellite.js";
import type { SatTle, SatPosition } from "../types";

const RAD2DEG = 180 / Math.PI;

/** Propagate a TLE set to positions at time `when` (default now). */
export function propagate(tles: SatTle[], when: Date = new Date()): SatPosition[] {
  const gmst = satellite.gstime(when);
  const out: SatPosition[] = [];
  for (const t of tles) {
    try {
      const rec = satellite.twoline2satrec(t.l1, t.l2);
      const pv = satellite.propagate(rec, when);
      const eci = pv && typeof pv.position === "object" ? pv.position : null;
      if (!eci) continue;
      const geo = satellite.eciToGeodetic(eci, gmst);
      const lat = geo.latitude * RAD2DEG;
      const lon = normalizeLon(geo.longitude * RAD2DEG);
      const altKm = geo.height;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push({ name: t.name, group: t.group, lon, lat, altKm });
    } catch {
      // skip malformed element sets
    }
  }
  return out;
}

/** Ground-track arc: the next `minutes` of sub-satellite path as [lon,lat] pairs. */
export function groundTrack(tle: SatTle, minutes = 45, stepSec = 60): [number, number][] {
  const rec = satellite.twoline2satrec(tle.l1, tle.l2);
  const pts: [number, number][] = [];
  const start = Date.now();
  for (let s = 0; s <= minutes * 60; s += stepSec) {
    const when = new Date(start + s * 1000);
    try {
      const pv = satellite.propagate(rec, when);
      const eci = pv && typeof pv.position === "object" ? pv.position : null;
      if (!eci) continue;
      const geo = satellite.eciToGeodetic(eci, satellite.gstime(when));
      pts.push([normalizeLon(geo.longitude * RAD2DEG), geo.latitude * RAD2DEG]);
    } catch {
      /* skip */
    }
  }
  return pts;
}

function normalizeLon(lon: number): number {
  let l = lon;
  while (l > 180) l -= 360;
  while (l < -180) l += 360;
  return l;
}
