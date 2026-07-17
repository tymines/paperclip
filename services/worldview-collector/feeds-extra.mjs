/**
 * feeds-extra.mjs — World View collector, OSIRIS-parity feed wave (TYL-131).
 *
 * Self-contained module (zero npm deps, Node >= 18 built-ins + global fetch),
 * registered by server.mjs. Adds the keyless feeds the OSIRIS rebuild needs:
 *
 *   GET /api/quakes      -> USGS M2.5+ / 24h earthquakes (keyless)
 *   GET /api/eonet       -> NASA EONET v3 open natural-hazard events (keyless)
 *   GET /api/swpc        -> NOAA SWPC space weather: planetary Kp + alerts (keyless)
 *   GET /api/cve         -> NVD recent HIGH/CRITICAL CVEs (keyless, rate-limited)
 *   GET /api/satellites  -> CelesTrak TLE sets (stations/visual/gps-ops, keyless);
 *                           client-side propagation via satellite.js
 *   GET /api/conflicts   -> curated conflict/tension zones (static; zone list
 *                           ported from simplifaisoul/osiris, MIT — attributed)
 *   GET /api/cctv        -> TfL JamCams (keyless public API, ~900 London cams)
 *   GET /api/live-news   -> curated 24/7 broadcaster streams (static; station
 *                           list ported from simplifaisoul/osiris, MIT)
 *   GET /api/radar       -> RainViewer weather-radar frame catalog (keyless)
 *
 * Data honesty: every payload is a real upstream response or an explicitly
 * curated static list labelled as such. No fabricated rows. Failed fetches
 * degrade to stale (previous items) or error with a note — never invented data.
 *
 * Attribution: conflict-zone and live-news curated lists are ported from
 * OSIRIS (github.com/simplifaisoul/osiris), MIT License, (c) simplifaisoul.
 */

// ---- tiny self-contained cache + http helpers (mirrors server.mjs pattern) --
const cache = new Map(); // key -> { status, source, items, note, fetchedAt }
function setC(key, payload) {
  cache.set(key, { ...payload, fetchedAt: new Date().toISOString() });
}
function getC(key) { return cache.get(key) || null; }

async function getJson(url, opts = {}) {
  const r = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "paperclip-worldview-collector", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeoutMs || 15000),
  });
  if (!r.ok) throw new Error(`${url.split("?")[0]} -> HTTP ${r.status}`);
  return r.json();
}
async function getText(url, opts = {}) {
  const r = await fetch(url, {
    headers: { "user-agent": "paperclip-worldview-collector", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeoutMs || 15000),
  });
  if (!r.ok) throw new Error(`${url.split("?")[0]} -> HTTP ${r.status}`);
  return r.text();
}

/** Degrade helper: keep previous items as "stale" on failure, honest note. */
function degrade(key, source, err) {
  const prev = getC(key);
  setC(key, {
    status: prev?.items?.length ? "stale" : "error",
    source,
    items: prev?.items || [],
    note: String(err?.message || err),
  });
}

// ---- 1. USGS earthquakes (keyless) ------------------------------------------
async function refreshQuakes() {
  const src = "USGS M2.5+ / 24h (no key)";
  try {
    const j = await getJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson");
    const items = (j.features || []).map((f) => ({
      id: f.id,
      mag: f.properties?.mag ?? 0,
      place: f.properties?.place || "",
      time: f.properties?.time || 0,
      url: f.properties?.url || "",
      lon: f.geometry?.coordinates?.[0] ?? 0,
      lat: f.geometry?.coordinates?.[1] ?? 0,
      depthKm: f.geometry?.coordinates?.[2] ?? null,
      tsunami: f.properties?.tsunami === 1,
    }));
    setC("quakes", { status: "live", source: src, items, note: null });
  } catch (e) { degrade("quakes", src, e); }
}

// ---- 2. NASA EONET v3 natural events (keyless) -------------------------------
const EONET_ICONS = {
  wildfires: "fire", severeStorms: "storm", volcanoes: "volcano", seaLakeIce: "ice",
  earthquakes: "quake", floods: "flood", landslides: "landslide", snow: "snow",
  drought: "drought", dustHaze: "dust", manmade: "manmade", waterColor: "water",
  tempExtremes: "temp",
};
async function refreshEonet() {
  const src = "NASA EONET v3 (no key)";
  try {
    const j = await getJson("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=10");
    const items = [];
    for (const ev of j.events || []) {
      const cat = ev.categories?.[0];
      // latest point geometry
      const geoms = (ev.geometry || []).filter((g) => g.type === "Point");
      const g = geoms[geoms.length - 1];
      if (!g) continue;
      items.push({
        id: ev.id,
        title: ev.title,
        category: cat?.id || "unknown",
        icon: EONET_ICONS[cat?.id] || "event",
        lon: g.coordinates[0],
        lat: g.coordinates[1],
        date: g.date || null,
        url: ev.sources?.[0]?.url || ev.link || "",
        magnitude: g.magnitudeValue ?? null,
        magnitudeUnit: g.magnitudeUnit || null,
      });
    }
    setC("eonet", { status: "live", source: src, items, note: null });
  } catch (e) { degrade("eonet", src, e); }
}

// ---- 3. NOAA SWPC space weather (keyless) ------------------------------------
async function refreshSwpc() {
  const src = "NOAA SWPC (no key)";
  try {
    const [kpRows, alerts] = await Promise.all([
      getJson("https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"),
      getJson("https://services.swpc.noaa.gov/products/alerts.json").catch(() => []),
    ]);
    const latest = Array.isArray(kpRows) && kpRows.length ? kpRows[kpRows.length - 1] : null;
    const kp = latest ? Number(latest.kp_index ?? latest.estimated_kp ?? 0) : null;
    const level = kp == null ? "unknown" : kp >= 7 ? "severe" : kp >= 5 ? "storm" : kp >= 4 ? "active" : "quiet";
    const recentAlerts = (Array.isArray(alerts) ? alerts : []).slice(0, 8).map((a) => ({
      product: a.product_id || "", issued: a.issue_datetime || "",
      message: String(a.message || "").split("\r\n").filter(Boolean).slice(0, 3).join(" · ").slice(0, 240),
    }));
    setC("swpc", {
      status: "live", source: src,
      items: [{ kp, level, time: latest?.time_tag || null, alerts: recentAlerts }],
      note: null,
    });
  } catch (e) { degrade("swpc", src, e); }
}

// ---- 4. NVD recent high/critical CVEs (keyless, 1h throttle) -----------------
async function refreshCve() {
  const src = "NVD CVE 2.0 (no key, rate-limited)";
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 3 * 24 * 3600 * 1000);
    const fmt = (d) => d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const url =
      "https://services.nvd.nist.gov/rest/json/cves/2.0?noRejected" +
      `&pubStartDate=${encodeURIComponent(fmt(start))}&pubEndDate=${encodeURIComponent(fmt(end))}` +
      "&resultsPerPage=200";
    const j = await getJson(url, { timeoutMs: 25000 });
    const items = (j.vulnerabilities || [])
      .map((v) => {
        const c = v.cve;
        const metrics = c?.metrics?.cvssMetricV31 || c?.metrics?.cvssMetricV30 || [];
        const score = metrics[0]?.cvssData?.baseScore ?? null;
        const severity = metrics[0]?.cvssData?.baseSeverity || "UNKNOWN";
        return {
          id: c?.id,
          published: c?.published,
          score, severity,
          summary: (c?.descriptions?.find((d) => d.lang === "en")?.value || "").slice(0, 220),
          url: `https://nvd.nist.gov/vuln/detail/${c?.id}`,
        };
      })
      .filter((x) => x.id && (x.severity === "CRITICAL" || x.severity === "HIGH"))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 40);
    setC("cve", { status: "live", source: src, items, note: null });
  } catch (e) { degrade("cve", src, e); }
}

// ---- 5. CelesTrak TLEs (keyless, 6h refresh) ---------------------------------
const TLE_GROUPS = [
  ["stations", 30],   // ISS, CSS, crewed
  ["visual", 120],    // 100 brightest
  ["gps-ops", 32],    // GPS constellation
];
function parseTle(text, group, cap) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const sats = [];
  for (let i = 0; i + 2 < lines.length + 1 && sats.length < cap; i += 3) {
    const name = (lines[i] || "").trim();
    const l1 = lines[i + 1] || "";
    const l2 = lines[i + 2] || "";
    if (!l1.startsWith("1 ") || !l2.startsWith("2 ")) continue;
    sats.push({ name, l1, l2, group });
  }
  return sats;
}
async function refreshSatellites() {
  const src = "CelesTrak GP TLE (no key)";
  try {
    const results = await Promise.allSettled(
      TLE_GROUPS.map(([g]) =>
        getText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, { timeoutMs: 25000 })),
    );
    const items = [];
    const failed = [];
    results.forEach((r, idx) => {
      const [g, cap] = TLE_GROUPS[idx];
      if (r.status === "fulfilled") items.push(...parseTle(r.value, g, cap));
      else failed.push(g);
    });
    if (!items.length) throw new Error("all TLE groups failed: " + failed.join(","));
    setC("satellites", {
      status: "live", source: src, items,
      note: failed.length ? "groups unavailable: " + failed.join(",") : null,
    });
  } catch (e) { degrade("satellites", src, e); }
}

// ---- 6. Conflict / tension zones (curated static, ported from OSIRIS · MIT) --
// Zone list (ids, labels, severities, anchors, descriptions) ported from
// github.com/simplifaisoul/osiris src/app/api/conflicts/route.ts (MIT).
const CONFLICT_ZONES = [
  { id: "ukraine", label: "UKRAINE WAR", severity: "war", lat: 48.5, lon: 31.2, description: "Ongoing Russian invasion of Ukraine — active frontlines across eastern and southern regions.", sourceUrl: "https://liveuamap.com/" },
  { id: "gaza", label: "GAZA CONFLICT", severity: "war", lat: 31.35, lon: 34.35, description: "Active military operations and humanitarian crisis in Gaza Strip.", sourceUrl: "https://israelpalestine.liveuamap.com/" },
  { id: "lebanon", label: "LEBANON BORDER", severity: "high", lat: 33.377, lon: 35.483, description: "Active cross-border military operations in southern Lebanon.", sourceUrl: "https://lebanon.liveuamap.com/" },
  { id: "sudan", label: "SUDAN CIVIL WAR", severity: "war", lat: 15.0, lon: 30.0, description: "Armed conflict between SAF and RSF factions across Sudan.", sourceUrl: "https://sudan.liveuamap.com/" },
  { id: "myanmar", label: "MYANMAR CONFLICT", severity: "war", lat: 19.5, lon: 96.5, description: "Internal conflict — military junta vs opposition forces.", sourceUrl: "https://myanmar.liveuamap.com/" },
  { id: "yemen", label: "YEMEN WAR", severity: "war", lat: 15.5, lon: 48.0, description: "Houthi militant operations, Red Sea maritime threats, and coalition strikes.", sourceUrl: "https://yemen.liveuamap.com/" },
  { id: "syria", label: "SYRIA", severity: "high", lat: 35.0, lon: 38.5, description: "Ongoing civil conflict and localized insurgencies.", sourceUrl: "https://syria.liveuamap.com/" },
  { id: "drc", label: "DRC EASTERN CONFLICT", severity: "war", lat: -1.0, lon: 28.5, description: "M23 rebel offensive and regional instability in eastern Congo.", sourceUrl: "https://drc.liveuamap.com/" },
  { id: "red-sea", label: "RED SEA THREAT", severity: "high", lat: 16.0, lon: 40.0, description: "Houthi anti-ship missile and drone attacks on maritime traffic.", sourceUrl: "https://yemen.liveuamap.com/" },
  { id: "taiwan-strait", label: "TAIWAN STRAIT", severity: "elevated", lat: 24.0, lon: 119.5, description: "Elevated military drills and regional tension.", sourceUrl: "https://china.liveuamap.com/" },
  { id: "korean-dmz", label: "KOREAN DMZ", severity: "elevated", lat: 38.3, lon: 127.0, description: "Ongoing cross-border tension and military posturing.", sourceUrl: "https://liveuamap.com/" },
  { id: "sahel", label: "SAHEL INSTABILITY", severity: "high", lat: 14.0, lon: 5.0, description: "Insurgencies and military coups across Mali, Burkina Faso, Niger.", sourceUrl: "https://africa.liveuamap.com/" },
  { id: "somalia", label: "SOMALIA", severity: "high", lat: 5.0, lon: 46.0, description: "Al-Shabaab insurgency and counter-terrorism operations.", sourceUrl: "https://africa.liveuamap.com/" },
  { id: "iraq", label: "IRAQ INSTABILITY", severity: "elevated", lat: 33.3, lon: 44.4, description: "Ongoing militia activity and counter-terrorism operations.", sourceUrl: "https://iraq.liveuamap.com/" },
  { id: "ethiopia", label: "ETHIOPIA", severity: "elevated", lat: 9.0, lon: 38.7, description: "Ethnic tensions and regional conflicts across multiple regions.", sourceUrl: "https://africa.liveuamap.com/" },
];
function conflictsPayload() {
  return {
    status: "live",
    source: "Curated OSINT zone list (ported from simplifaisoul/osiris, MIT)",
    items: CONFLICT_ZONES,
    note: "Static curation — zones, not live event detection.",
    fetchedAt: new Date().toISOString(),
  };
}

// ---- 7. CCTV — TfL JamCams (keyless public API) ------------------------------
async function refreshCctv() {
  const src = "TfL JamCams (no key)";
  try {
    const j = await getJson("https://api.tfl.gov.uk/Place/Type/JamCam", { timeoutMs: 25000 });
    const items = (Array.isArray(j) ? j : [])
      .map((p) => {
        const props = Object.fromEntries((p.additionalProperties || []).map((a) => [a.key, a.value]));
        return {
          id: p.id,
          name: (p.commonName || "").replace(/^JamCams?\s*[-:]?\s*/i, ""),
          lat: p.lat, lon: p.lon,
          imageUrl: props.imageUrl || "",
          videoUrl: props.videoUrl || "",
          available: props.available !== "false",
          operator: "TfL",
          city: "London",
        };
      })
      .filter((c) => c.lat && c.lon && (c.imageUrl || c.videoUrl));
    setC("cctv", { status: "live", source: src, items, note: `London JamCams only in v1 — more networks are curation work (see spec §6 #17).` });
  } catch (e) { degrade("cctv", src, e); }
}

// ---- 8. Live news stations (curated static, ported from OSIRIS · MIT) --------
// Station list (coords, stream URLs, embed flags) ported from
// github.com/simplifaisoul/osiris src/app/api/live-news/route.ts (MIT).
const LIVE_NEWS = [
  { id: "nbcnews", name: "NBC News NOW", city: "New York", country: "US", lat: 40.759, lon: -73.98, url: "https://www.youtube.com/channel/UCeY0bbntWzzVIaj2z3QigXg/live", embed: false, category: "mainstream" },
  { id: "cbsnews", name: "CBS News 24/7", city: "New York", country: "US", lat: 40.764, lon: -73.973, url: "https://www.youtube.com/channel/UC8p1vwvWtl6T73JiExfWs1g/live", embed: false, category: "mainstream" },
  { id: "abcnews", name: "ABC News Live", city: "New York", country: "US", lat: 40.763, lon: -73.979, url: "https://www.youtube.com/channel/UCBi2mrWuNuyYy4gbM6fU18Q/live", embed: false, category: "mainstream" },
  { id: "bloomberg", name: "Bloomberg TV", city: "New York", country: "US", lat: 40.756, lon: -73.988, url: "https://www.youtube.com/channel/UC_vQ72b7v5n2938v9d5c80w/live", embed: false, category: "finance" },
  { id: "cspan", name: "C-SPAN", city: "Washington DC", country: "US", lat: 38.897, lon: -77.036, url: "https://www.youtube.com/channel/UCb--64Gl51jIEVE-GLDAVTg/live", embed: false, category: "government" },
  { id: "cbc", name: "CBC News", city: "Toronto", country: "CA", lat: 43.644, lon: -79.387, url: "https://www.youtube.com/channel/UCKy1dAqELon0zgzZPOz9SVw/live", embed: false, category: "mainstream" },
  { id: "skynews", name: "Sky News", city: "London", country: "GB", lat: 51.5, lon: -0.118, url: "https://www.youtube.com/embed/live_stream?channel=UCoMdktPbSTixAyNGwb-UYkQ&autoplay=1&mute=1", embed: true, category: "mainstream" },
  { id: "france24en", name: "France 24 EN", city: "Paris", country: "FR", lat: 48.83, lon: 2.28, url: "https://www.youtube.com/embed/live_stream?channel=UCQfwfsi5VrQ8yKZ-UWmAEFg&autoplay=1&mute=1", embed: true, category: "mainstream" },
  { id: "dwnews", name: "DW News", city: "Berlin", country: "DE", lat: 52.508, lon: 13.376, url: "https://www.youtube.com/embed/live_stream?channel=UCknLrEdhRCp1aegoMqRaCZg&autoplay=1&mute=1", embed: true, category: "mainstream" },
  { id: "aljazeera", name: "Al Jazeera EN", city: "Doha", country: "QA", lat: 25.286, lon: 51.534, url: "https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg&autoplay=1&mute=1", embed: true, category: "mainstream" },
  { id: "nhkworld", name: "NHK World", city: "Tokyo", country: "JP", lat: 35.69, lon: 139.692, url: "https://www.youtube.com/embed/live_stream?channel=UCSPEjw8F2nQDtmUKPFNF7_A&autoplay=1&mute=1", embed: true, category: "mainstream" },
  { id: "cna", name: "CNA 24/7", city: "Singapore", country: "SG", lat: 1.29, lon: 103.852, url: "https://www.youtube.com/embed/live_stream?channel=UC83jt4dlz1Gjl58fzQrrKZg&autoplay=1&mute=1", embed: true, category: "mainstream" },
  { id: "wion", name: "WION", city: "New Delhi", country: "IN", lat: 28.614, lon: 77.209, url: "https://www.youtube.com/embed/live_stream?channel=UC_gUM8rL-Lrg6O3adPW9K1g&autoplay=1&mute=1", embed: true, category: "mainstream" },
  { id: "cgtn", name: "CGTN", city: "Beijing", country: "CN", lat: 39.904, lon: 116.407, url: "https://www.youtube.com/channel/UCgrNz-aDmcr2uuto8_DL2jg/live", embed: false, category: "state" },
  { id: "rt", name: "RT News", city: "Moscow", country: "RU", lat: 55.755, lon: 37.617, url: "https://rumble.com/c/RTNewsEN", embed: false, category: "state" },
];
function liveNewsPayload() {
  return {
    status: "live",
    source: "Curated 24/7 broadcasters (ported from simplifaisoul/osiris, MIT)",
    items: LIVE_NEWS,
    note: "Static curation — stream availability depends on the broadcaster.",
    fetchedAt: new Date().toISOString(),
  };
}

// ---- 9. RainViewer weather-radar frames (keyless) ----------------------------
async function refreshRadar() {
  const src = "RainViewer weather-maps (no key)";
  try {
    const j = await getJson("https://api.rainviewer.com/public/weather-maps.json");
    const frames = [...(j.radar?.past || []), ...(j.radar?.nowcast || [])].map((f) => ({
      time: f.time, path: f.path,
    }));
    setC("radar", {
      status: "live", source: src,
      items: [{ host: j.host || "https://tilecache.rainviewer.com", frames }],
      note: null,
    });
  } catch (e) { degrade("radar", src, e); }
}

// ---- refresh orchestration (self-throttled per feed) -------------------------
const MIN_INTERVAL_MS = {
  quakes: 2 * 60 * 1000,
  eonet: 10 * 60 * 1000,
  swpc: 5 * 60 * 1000,
  cve: 60 * 60 * 1000,
  satellites: 6 * 60 * 60 * 1000,
  cctv: 30 * 60 * 1000,
  radar: 5 * 60 * 1000,
};
const REFRESHERS = {
  quakes: refreshQuakes,
  eonet: refreshEonet,
  swpc: refreshSwpc,
  cve: refreshCve,
  satellites: refreshSatellites,
  cctv: refreshCctv,
  radar: refreshRadar,
};
const lastRun = new Map();

/** Called by server.mjs on every poll cycle; each feed self-throttles. */
export async function refreshExtras() {
  const due = Object.keys(REFRESHERS).filter((k) => {
    const last = lastRun.get(k) || 0;
    return Date.now() - last >= MIN_INTERVAL_MS[k];
  });
  for (const k of due) lastRun.set(k, Date.now());
  await Promise.allSettled(due.map((k) => REFRESHERS[k]()));
}

// ---- routing hook ------------------------------------------------------------
const ROUTES = {
  "/api/quakes": () => getC("quakes") || { status: "pending", items: [] },
  "/api/eonet": () => getC("eonet") || { status: "pending", items: [] },
  "/api/swpc": () => getC("swpc") || { status: "pending", items: [] },
  "/api/cve": () => getC("cve") || { status: "pending", items: [] },
  "/api/satellites": () => getC("satellites") || { status: "pending", items: [] },
  "/api/conflicts": conflictsPayload,
  "/api/cctv": () => getC("cctv") || { status: "pending", items: [] },
  "/api/live-news": liveNewsPayload,
  "/api/radar": () => getC("radar") || { status: "pending", items: [] },
};

/** Returns a payload for extra-feed paths, or null if the path isn't ours. */
export function extrasHandle(path) {
  const fn = ROUTES[path];
  return fn ? fn() : null;
}

export const EXTRA_ENDPOINTS = Object.keys(ROUTES);

/** Freshness rows for /health. */
export function extrasFreshness() {
  const out = {};
  for (const k of Object.keys(REFRESHERS)) {
    const c = getC(k);
    out[k] = c ? { status: c.status, fetchedAt: c.fetchedAt, count: c.items.length } : { status: "pending" };
  }
  out.conflicts = { status: "live", count: CONFLICT_ZONES.length, static: true };
  out["live-news"] = { status: "live", count: LIVE_NEWS.length, static: true };
  return out;
}

/** Source-catalog rows (all keyless) for /api/sources. */
export const EXTRA_SOURCE_ROWS = [
  { panel: "Earthquakes", provider: "USGS", key: null, status: "live", notes: "M2.5+ / 24h GeoJSON, no key." },
  { panel: "Natural Events", provider: "NASA EONET", key: null, status: "live", notes: "Open events, v3 API, no key." },
  { panel: "Space Weather", provider: "NOAA SWPC", key: null, status: "live", notes: "Planetary Kp + alerts, no key." },
  { panel: "Vulnerabilities (CVE)", provider: "NVD", key: null, status: "live", notes: "Recent HIGH/CRITICAL, keyless rate limits." },
  { panel: "Satellites", provider: "CelesTrak", key: null, status: "live", notes: "TLE groups: stations, visual, gps-ops. Client-side propagation." },
  { panel: "Conflict Zones", provider: "Curated (OSIRIS, MIT)", key: null, status: "live", notes: "Static zone curation, not live event detection." },
  { panel: "CCTV", provider: "TfL JamCams", key: null, status: "live", notes: "London traffic cams, public API." },
  { panel: "Live News Streams", provider: "Curated (OSIRIS, MIT)", key: null, status: "live", notes: "24/7 broadcaster streams, static list." },
  { panel: "Weather Radar", provider: "RainViewer", key: null, status: "live", notes: "Radar frame catalog + tile host, no key." },
];
