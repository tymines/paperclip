/**
 * World View — MapLibre basemap style (TYL-131; fixed on fable/worldview-fixes).
 *
 * Dark CARTO raster basemap loaded DIRECTLY from cartocdn (CORS-open, keyless,
 * free with attribution). We previously routed tiles through the same-origin
 * `/api/worldview/tiles` proxy, but that path `encodeURIComponent`'d the tile
 * template — percent-encoding the `{z}/{x}/{y}` placeholders so MapLibre could no
 * longer substitute them, so every tile 404'd and the map rendered as a black
 * void. Direct tiles remove that failure mode and the dependency on the collector
 * host being reachable. The proxy route still exists server-side for optional
 * caching, but the basemap no longer depends on it.
 */
import type { StyleSpecification } from "maplibre-gl";
import { C } from "./theme";

// CARTO dark basemap — subdomains a–d for request parallelism.
const CARTO_DARK = [
  "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
];

export function buildStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      carto: {
        type: "raster",
        tiles: CARTO_DARK,
        tileSize: 256,
        attribution: "© CARTO © OpenStreetMap contributors",
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
  const esri = [
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  ];
  return {
    version: 8,
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      esri: {
        type: "raster",
        tiles: esri,
        tileSize: 256,
        attribution: "© Esri, Maxar, Earthstar Geographics",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": C.ocean } },
      { id: "esri", type: "raster", source: "esri", paint: { "raster-opacity": 1 } },
    ],
  };
}
