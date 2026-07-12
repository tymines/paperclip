/**
 * World View  MapLibre basemap style (TYL-131).
 * Dark CARTO raster basemap served through the same-origin tile proxy
 * (/api/worldview/tiles?url=), mirroring OSIRIS's proxy-tiles approach. The
 * proxy allowlists *.basemaps.cartocdn.com and long-caches tiles.
 */
import type { StyleSpecification } from "maplibre-gl";
import { COLLECTOR, C } from "./theme";

const CARTO_DARK =
  "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

/** Wrap an upstream tile URL in the same-origin proxy. */
function proxied(url: string): string {
  // MapLibre substitutes {z}/{x}/{y} before requesting, so we must encode the
  // template as-is and let the proxy receive the concrete tile URL. We keep the
  // placeholders intact by encoding only once; the proxy validates the host.
  return `${COLLECTOR}/tiles?url=${encodeURIComponent(url)}`;
}

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    // Glyphs for symbol layers (labels/plane icons need a glyph source present).
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      carto: {
        type: "raster",
        tiles: [proxied(CARTO_DARK)],
        tileSize: 256,
        attribution: " CARTO  OpenStreetMap contributors",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": C.ocean } },
      { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.9 } },
    ],
  };
}

/** Satellite basemap (Esri World Imagery) for the SAT toggle. */
export function buildSatStyle(): StyleSpecification {
  const esri =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  return {
    version: 8,
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      esri: {
        type: "raster",
        tiles: [esri],
        tileSize: 256,
        attribution: " Esri, Maxar, Earthstar Geographics",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": C.ocean } },
      { id: "esri", type: "raster", source: "esri", paint: { "raster-opacity": 1 } },
    ],
  };
}
