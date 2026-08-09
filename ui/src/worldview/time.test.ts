import { describe, expect, it } from "vitest";
import { formatRelativeTime, solarSubpoint, terminatorGeoJSON } from "./time";

describe("Quiet Globe time model", () => {
  it("computes a bounded solar subpoint", () => {
    const point = solarSubpoint(new Date("2026-06-21T12:00:00Z"));
    expect(point.lon).toBeGreaterThanOrEqual(-180);
    expect(point.lon).toBeLessThanOrEqual(180);
    expect(point.lat).toBeGreaterThan(20);
    expect(point.lat).toBeLessThan(25);
  });

  it("builds WebGL-ready terminator geometry", () => {
    const geo = terminatorGeoJSON(new Date("2026-07-28T12:00:00Z"));
    expect(geo.features.map((f) => f.geometry.type)).toEqual(["Polygon", "LineString"]);
    expect((geo.features[1].geometry as GeoJSON.LineString).coordinates.length).toBeGreaterThan(100);
    const ring = (geo.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90)).toBe(true);
    for (let index = 1; index < ring.length; index += 1) {
      expect(Math.abs(ring[index][0] - ring[index - 1][0])).toBeLessThanOrEqual(10);
    }
  });

  it("formats live and historical offsets without pretending precision", () => {
    expect(formatRelativeTime(0)).toBe("LIVE");
    expect(formatRelativeTime(14 * 3600_000 + 22 * 60_000)).toBe("−14h 22m");
  });
});
