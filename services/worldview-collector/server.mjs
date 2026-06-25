#!/usr/bin/env node
/**
 * World View Collector — separable, host-portable data backend for the
 * Paperclip "World View" tab.
 *
 * Clean-room reimplementation inspired by koala73/worldmonitor (AGPL-3.0,
 * (C) Elie Habib). NO worldmonitor source is copied here; this is an
 * independent, dependency-free aggregator written for Paperclip. See
 * services/worldview-collector/README.md for the attribution + license note.
 *
 * Design goals (per architecture decision):
 *   - Runs as its own process. Can live on Box 1 (localhost) today or move to
 *     Box 2 (augibot2 tailnet) later WITHOUT touching the Paperclip web app —
 *     the tab just points VITE_WORLDVIEW_API_URL at wherever this runs.
 *   - Zero npm dependencies: Node >=18 built-ins + global fetch only. No
 *     node_modules, so it is trivially host-portable (`node server.mjs`).
 *   - Data-honest: only real upstream feeds. If a feed needs a key we do not
 *     have, the endpoint reports status:"needs_key" and serves NO fabricated
 *     rows.
 *
 * Endpoints (all JSON, CORS-open for the Paperclip browser tab):
 *   GET /health           -> liveness + per-source freshness
 *   GET /api/news         -> global news (GDELT DOC 2.0, no key)
 *   GET /api/geopolitical -> geopolitical headlines (public RSS, no key)
 *   GET /api/firms        -> satellite active-fire detections (NASA FIRMS, key)
 *   GET /api/sources      -> catalog of every feed + which API key it needs
 */
import http from "node:http";

const PORT = Number(process.env.WORLDVIEW_PORT || 8788);
const POLL_MS = Number(process.env.WORLDVIEW_POLL_MS || 5 * 60 * 1000); // 5 min
const UA = "PaperclipWorldView/1.0 (+collector; contact augi)";

// ---- NASA FIRMS config (satellite active-fire / thermal anomalies) ----------
// Free MAP_KEY from https://firms.modaps.eosdis.nasa.gov/api/area/. Without a
// key the panel honestly reports needs_key and serves NO rows.
const FIRMS_KEY = process.env.NASA_FIRMS_API_KEY || "";
const FIRMS_SOURCE = process.env.FIRMS_SOURCE || "VIIRS_SNPP_NRT";
const FIRMS_AREA = process.env.FIRMS_AREA || "-180,-90,180,90"; // whole globe: W,S,E,N
// Day range (1–10). Default 2: the most recent NRT day is still being processed
// and is near-empty globally, so 1 often yields zero rows. 2 covers that latency.
const FIRMS_DAYS = process.env.FIRMS_DAYS || "2";
const FIRMS_MAX_ROWS = Number(process.env.FIRMS_MAX_ROWS || 500);

// ---- in-memory cache (no DB; LRU not needed, fixed small key set) ----------
const cache = new Map(); // key -> { status, source, fetchedAt, items, note }
const setCache = (k, v) => cache.set(k, { ...v, fetchedAt: new Date().toISOString() });
const getCache = (k) => cache.get(k) || null;

// ---- tiny helpers ----------------------------------------------------------
async function getJson(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function getText(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/rss+xml,application/xml,text/xml" }, signal: ctl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
const stripTags = (s = "") => s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function parseRss(xml, sourceName) {
  const items = [];
  const blocks = xml.split(/<item[ >]/i).slice(1);
  for (const b of blocks) {
    const get = (tag) => {
      const m = b.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i"));
      return m ? stripTags(m[1]) : "";
    };
    const title = get("title");
    const link = (b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [,""])[1].trim();
    if (!title) continue;
    items.push({
      title,
      url: stripTags(link),
      summary: get("description").slice(0, 280),
      published: get("pubDate") || get("dc:date") || "",
      source: sourceName,
    });
    if (items.length >= 12) break;
  }
  return items;
}

// ---- real sources ----------------------------------------------------------
const RSS_FEEDS = [
  ["BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml"],
  ["Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"],
  ["UN News", "https://news.un.org/feed/subscribe/en/news/all/rss.xml"],
  ["Deutsche Welle", "https://rss.dw.com/rdf/rss-en-world"],
];

async function refreshNews() {
  // Primary: GDELT DOC 2.0 — global news index, no API key required.
  const url = "https://api.gdeltproject.org/api/v2/doc/doc?query=" +
    encodeURIComponent("(conflict OR sanctions OR military OR diplomacy OR election)") +
    "&mode=artlist&format=json&maxrecords=30&sort=datedesc&timespan=24h";
  try {
    const j = await getJson(url);
    const items = (j.articles || []).map((a) => ({
      title: a.title, url: a.url, source: a.domain || a.sourcecountry || "GDELT",
      published: a.seendate || "", language: a.language || "", country: a.sourcecountry || "",
    }));
    if (items.length) { setCache("news", { status: "ok", source: "GDELT DOC 2.0 (no key)", items, note: null }); return; }
    throw new Error("GDELT returned 0 rows");
  } catch (e) {
    // Fallback: Google News RSS — also real, also no key. Honestly labelled.
    try {
      const xml = await getText("https://news.google.com/rss/search?q=" +
        encodeURIComponent("conflict OR sanctions OR military OR diplomacy when:1d") + "&hl=en-US&gl=US&ceid=US:en");
      const items = parseRss(xml, "Google News").map((it) => ({ ...it, summary: undefined }));
      setCache("news", { status: items.length ? "ok" : "error",
        source: "Google News RSS (no key) — GDELT fallback",
        items, note: "GDELT unavailable (" + e.message + "); serving Google News RSS instead" });
    } catch (e2) {
      const prev = getCache("news");
      setCache("news", { status: prev?.items?.length ? "stale" : "error",
        source: "GDELT DOC 2.0 (no key)", items: prev?.items || [],
        note: "Both GDELT and Google News failed: " + e.message + " / " + e2.message });
    }
  }
}

async function refreshGeopolitical() {
  const all = [];
  const failures = [];
  await Promise.all(RSS_FEEDS.map(async ([name, url]) => {
    try { all.push(...parseRss(await getText(url), name)); }
    catch (e) { failures.push(name + ": " + e.message); }
  }));
  all.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));
  setCache("geopolitical", {
    status: all.length ? "ok" : "error",
    source: "Public RSS: " + RSS_FEEDS.map((f) => f[0]).join(", ") + " (no key)",
    items: all.slice(0, 40),
    note: failures.length ? "Some feeds unreachable: " + failures.join(" | ") : null,
  });
}

// ---- NASA FIRMS: satellite active-fire detections (key-gated) --------------
function parseFirmsCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const li = idx("latitude"), loi = idx("longitude"), bi = idx("bright_ti4"),
    ci = idx("confidence"), fi = idx("frp"), di = idx("acq_date"), ti = idx("acq_time"),
    si = idx("satellite"), ii = idx("instrument"), dn = idx("daynight");
  const items = [];
  for (let r = 1; r < lines.length; r++) {
    const c = lines[r].split(",");
    if (c.length < 2) continue;
    const lat = parseFloat(c[li]), lon = parseFloat(c[loi]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    items.push({
      lat, lon,
      brightness: bi >= 0 ? parseFloat(c[bi]) : null, // bright_ti4 (Kelvin)
      confidence: ci >= 0 ? c[ci] : "",               // VIIRS: l / n / h
      frp: fi >= 0 ? parseFloat(c[fi]) : null,        // fire radiative power (MW)
      acq_date: di >= 0 ? c[di] : "",
      acq_time: ti >= 0 ? c[ti] : "",
      satellite: si >= 0 ? c[si] : "",
      instrument: ii >= 0 ? c[ii] : "",
      daynight: dn >= 0 ? c[dn] : "",
    });
  }
  return items;
}

async function refreshFirms() {
  // Key-gated: serve an honest needs_key state (no rows) when no MAP_KEY is set.
  if (!FIRMS_KEY) {
    setCache("firms", {
      status: "needs_key",
      source: "NASA FIRMS " + FIRMS_SOURCE,
      items: [],
      note: "Set NASA_FIRMS_API_KEY to enable. No data served without a key.",
    });
    return;
  }
  // Area CSV API: /api/area/csv/{MAP_KEY}/{SOURCE}/{W,S,E,N}/{DAY_RANGE}
  const url = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/" +
    encodeURIComponent(FIRMS_KEY) + "/" + FIRMS_SOURCE + "/" + FIRMS_AREA + "/" + FIRMS_DAYS;
  try {
    const csv = await getText(url);
    // FIRMS returns plain-text errors with HTTP 200 (bad/over-limit key, bad source).
    const head = csv.slice(0, 200);
    if (!/^latitude/i.test(csv.trimStart()) &&
        /invalid|error|map_key|exceeded|too many|not a valid/i.test(head)) {
      throw new Error(csv.split(/\r?\n/)[0].slice(0, 160));
    }
    const all = parseFirmsCsv(csv);
    // Surface the most intense fires first (highest fire radiative power) so the
    // capped panel shows the significant detections rather than an arbitrary slice.
    all.sort((a, b) => (b.frp ?? -1) - (a.frp ?? -1));
    const items = all.slice(0, FIRMS_MAX_ROWS);
    setCache("firms", {
      status: "live",
      source: "NASA FIRMS " + FIRMS_SOURCE + " area CSV (key)",
      items,
      note: all.length
        ? (all.length > FIRMS_MAX_ROWS ? "Top " + FIRMS_MAX_ROWS + " of " + all.length + " detections by FRP." : null)
        : "Key valid; no active fire detections in window/area.",
    });
  } catch (e) {
    const prev = getCache("firms");
    setCache("firms", {
      status: prev?.items?.length ? "stale" : "error",
      source: "NASA FIRMS " + FIRMS_SOURCE + " area CSV (key)",
      items: prev?.items || [],
      note: "FIRMS fetch failed: " + e.message,
    });
  }
}

// ---- source catalog: honest map of what the full experience needs ----------
const SOURCE_CATALOG = [
  { panel: "Global News", provider: "GDELT DOC 2.0", key: null, status: "live", notes: "No key. Global news index." },
  { panel: "Geopolitical Monitor", provider: "Public RSS (BBC/AlJazeera/UN/DW)", key: null, status: "live", notes: "No key." },
  { panel: "Seismic & Natural Hazards", provider: "USGS Earthquakes", key: null, status: "live (read direct in browser)", notes: "No key, CORS-open. Fetched client-side." },
  { panel: "Conflict & Protest Events", provider: "ACLED", key: "ACLED_EMAIL/PASSWORD", status: "needs_key" },
  { panel: "Conflict Events", provider: "UCDP", key: "UCDP_ACCESS_TOKEN", status: "needs_key" },
  { panel: "Satellite Fire Detection", provider: "NASA FIRMS", key: "NASA_FIRMS_API_KEY", status: "needs_key" },
  { panel: "Live Flights", provider: "AviationStack", key: "AVIATIONSTACK_API", status: "needs_key" },
  { panel: "Vessel / AIS Tracking", provider: "AISStream", key: "AISSTREAM_API_KEY", status: "needs_key" },
  { panel: "Aircraft Tracking", provider: "OpenSky Network", key: "OPENSKY_CLIENT_ID/SECRET", status: "needs_key (anon ratelimited)" },
  { panel: "Markets / Finance Radar", provider: "Finnhub", key: "FINNHUB_API_KEY", status: "needs_key" },
  { panel: "Energy", provider: "EIA", key: "EIA_API_KEY", status: "needs_key" },
  { panel: "Economic Data", provider: "FRED", key: "FRED_API_KEY", status: "needs_key" },
  { panel: "Air Quality", provider: "OpenAQ", key: "OPENAQ_API_KEY", status: "needs_key" },
  { panel: "Internet Outages", provider: "Cloudflare Radar", key: "CLOUDFLARE_API_TOKEN", status: "needs_key" },
  { panel: "AI Brief Synthesis", provider: "Groq / OpenRouter / Anthropic", key: "GROQ_API_KEY (or Paperclip's own LLM provider)", status: "needs_key" },
];

// ---- http server -----------------------------------------------------------
function send(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (path === "/health") {
    const freshness = {};
    for (const k of ["news", "geopolitical", "firms"]) {
      const c = getCache(k);
      freshness[k] = c ? { status: c.status, fetchedAt: c.fetchedAt, count: c.items.length } : { status: "pending" };
    }
    return send(res, 200, { ok: true, service: "worldview-collector", pollMs: POLL_MS, freshness });
  }
  if (path === "/api/news") return send(res, 200, getCache("news") || { status: "pending", items: [] });
  if (path === "/api/geopolitical") return send(res, 200, getCache("geopolitical") || { status: "pending", items: [] });
  if (path === "/api/firms") return send(res, 200, getCache("firms") || { status: "pending", items: [] });
  if (path === "/api/sources") {
    // Overlay the live FIRMS status (from cache) onto its static catalog row so
    // the panel flips needs_key -> live once the key is set and a fetch succeeds.
    const firms = getCache("firms");
    const sources = SOURCE_CATALOG.map((s) =>
      s.provider === "NASA FIRMS"
        ? { ...s, status: firms ? firms.status : s.status, notes: firms?.note ?? s.notes, count: firms?.items?.length }
        : s);
    return send(res, 200, { sources, fetchedAt: new Date().toISOString() });
  }
  return send(res, 404, { error: "not found", endpoints: ["/health", "/api/news", "/api/geopolitical", "/api/firms", "/api/sources"] });
});

async function refreshAll() {
  await Promise.allSettled([refreshNews(), refreshGeopolitical(), refreshFirms()]);
}
server.listen(PORT, () => {
  console.log("[worldview-collector] listening on :" + PORT + " (poll " + POLL_MS + "ms)");
  refreshAll();
  setInterval(refreshAll, POLL_MS);
});
