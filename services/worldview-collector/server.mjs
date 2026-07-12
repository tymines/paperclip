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
 *   GET /api/finnhub      -> markets / finance radar quotes (Finnhub, key)
 *   GET /api/openaq       -> air-quality PM2.5 radar for major cities (OpenAQ, key)
 *   GET /api/waqi         -> air-quality index (AQI) for major cities (WAQI, token)
 *   GET /api/opensky      -> live aircraft state vectors (OpenSky, OAuth2 client-creds)
 *   GET /api/aviationstack -> live / scheduled flight data (AviationStack, key)
 *   GET /api/ais          -> live vessel AIS positions (AISStream, WebSocket key)
*   GET /api/cloudflare   -> internet outages + traffic/attack/quality trends (Cloudflare Radar, token)
 *   GET /api/brief        -> AI situational brief synthesized from our own feeds (Groq, key)
 *   GET /api/fred         -> US economic indicator series (FRED API, key)
 *   GET /api/sources      -> catalog of every feed + which API key it needs
 */
import http from "node:http";
import {
  refreshExtras,
  extrasHandle,
  extrasFreshness,
  EXTRA_ENDPOINTS,
  EXTRA_SOURCE_ROWS,
} from "./feeds-extra.mjs";

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
// ---- FRED config (US economic indicators) -------------------------------------
// Free API key from https://fred.stlouisfed.org/docs/api/api_key.html. Without a key
// the panel honestly reports needs_key and serves NO rows. Override the series set
// via FRED_SERIES="SERIES1:Label1,SERIES2:Label2".
const FRED_KEY = process.env.FRED_API_KEY || "";
const FRED_SERIES = (process.env.FRED_SERIES
  ? process.env.FRED_SERIES.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
      const [id, label] = p.split(":");
      return [id.trim(), (label || id.trim()).trim()];
    })
  : [
      ["GDPC1", "Real GDP"],
      ["UNRATE", "Unemployment Rate"],
      ["CPIAUCSL", "CPI (All Urban)"],
      ["FEDFUNDS", "Fed Funds Rate"],
      ["DGS10", "10Y Treasury Yield"],
      ["UMCSENT", "Consumer Sentiment"],
      ["T10YIE", "10Y Breakeven Inflation"],
      ["PCEPI", "PCE Price Index"],
      ["ICSA", "Initial Jobless Claims"],
      ["HOUST", "Housing Starts"],
    ]);
const FRED_BASE = "https://api.stlouisfed.org/fred";



async function refreshFred() {
  // Key-gated: serve honest needs_key with no rows when FRED_API_KEY is unset.
  if (!FRED_KEY) {
    setCache("fred", {
      status: "needs_key",
      source: "FRED series/observations",
      items: [],
      note: "Set FRED_API_KEY to enable. No data served without a key.",
    });
    return;
  }
  const results = [];
  const failures = [];
  for (const [seriesId, label] of FRED_SERIES) {
    try {
      const url = FRED_BASE + "/series/observations?series_id=" +
        encodeURIComponent(seriesId) +
        "&api_key=" + encodeURIComponent(FRED_KEY) +
        "&file_type=json&sort_order=desc&limit=2";
      const j = await getJson(url);
      const obs = j.observations || [];
      // Latest non-. observation
      const latest = obs.find((o) => o.value !== ".");
      if (latest) {
        results.push({
          series: seriesId,
          label: label,
          value: String(latest.value),
          date: latest.date,
          units: j.units || j.units_short || "",
          notes: j.notes || "",
        });
      } else {
        failures.push(seriesId + ": no valid observation");
      }
    } catch (e) {
      failures.push(seriesId + ": " + e.message);
    }
  }
  if (results.length) {
    setCache("fred", {
      status: "live",
      source: "FRED /series/observations (key)",
      items: results,
      note: failures.length ? "Some series unavailable: " + failures.join(" | ") : null,
    });
  } else {
    const prev = getCache("fred");
    setCache("fred", {
      status: prev?.items?.length ? "stale" : "error",
      source: "FRED /series/observations (key)",
      items: prev?.items || [],
      note: "FRED fetch failed for all series: " + failures.join(" | "),
    });
  }
}


// ---- Finnhub config (markets / finance radar) ------------------------------
// Free token from https://finnhub.io/. Without a key the panel honestly reports
// needs_key and serves NO rows. Override the radar via
// FINNHUB_SYMBOLS="SYM:Label,SYM:Label" (label optional, defaults to symbol).
const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
const FINNHUB_SYMBOLS = (process.env.FINNHUB_SYMBOLS
  ? process.env.FINNHUB_SYMBOLS.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
      const [sym, ...rest] = p.split(":");
      return [sym.trim(), rest.join(":").trim() || sym.trim()];
    })
  : [
      ["SPY", "S&P 500 (SPY)"],
      ["QQQ", "Nasdaq 100 (QQQ)"],
      ["DIA", "Dow 30 (DIA)"],
      ["IWM", "Russell 2000 (IWM)"],
      ["GLD", "Gold (GLD)"],
      ["USO", "Crude Oil (USO)"],
      ["TLT", "20Y Treasuries (TLT)"],
      ["AAPL", "Apple"],
      ["MSFT", "Microsoft"],
      ["NVDA", "Nvidia"],
    ]);
const FINNHUB_BASE = "https://finnhub.io/api/v1";

// ---- OpenAQ config (air quality) -------------------------------------------
// Free key from https://openaq.org/. OpenAQ v3 authenticates with an X-API-Key
// header. Without a key the panel honestly reports needs_key and serves NO rows.
// Override the city set via OPENAQ_CITIES="Name:lat:lon,Name:lat:lon".
const OPENAQ_KEY = process.env.OPENAQ_API_KEY || "";
const OPENAQ_BASE = "https://api.openaq.org/v3";
const OPENAQ_PM25 = 2; // OpenAQ parameters_id for PM2.5
const OPENAQ_RADIUS_M = Number(process.env.OPENAQ_RADIUS_M || 25000);
const OPENAQ_MAX_AGE_MS = Number(process.env.OPENAQ_MAX_AGE_DAYS || 7) * 24 * 3600 * 1000;
const OPENAQ_CITIES = (process.env.OPENAQ_CITIES
  ? process.env.OPENAQ_CITIES.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
      const [name, lat, lon] = p.split(":").map((x) => x.trim());
      return [name, Number(lat), Number(lon)];
    })
  : [
      ["Delhi", 28.6139, 77.2090],
      ["Beijing", 39.9042, 116.4074],
      ["London", 51.5074, -0.1278],
      ["Los Angeles", 34.0522, -118.2437],
      ["New York", 40.7128, -74.0060],
      ["Paris", 48.8566, 2.3522],
      ["Tokyo", 35.6762, 139.6503],
      ["Sao Paulo", -23.5505, -46.6333],
      ["Mexico City", 19.4326, -99.1332],
      ["Jakarta", -6.2088, 106.8456],
    ]);

// ---- WAQI config (World Air Quality Index — aqicn.org) ---------------------
// Free token from https://aqicn.org/data-platform/token/ (NON-COMMERCIAL use).
// WAQI authenticates with a ?token=... query param. Without a token the panel
// honestly reports needs_key and serves NO rows. We read the nearest station to
// each curated city via /feed/geo:{lat};{lon}/ and surface its overall AQI plus
// WAQI's dominant pollutant. Override the city set via
// WAQI_CITIES="Name:lat:lon,Name:lat:lon".
const WAQI_TOKEN = process.env.WAQI_TOKEN || "";
const WAQI_BASE = "https://api.waqi.info";
const WAQI_CITIES = (process.env.WAQI_CITIES
  ? process.env.WAQI_CITIES.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
      const [name, lat, lon] = p.split(":").map((x) => x.trim());
      return [name, Number(lat), Number(lon)];
    })
  : [
      ["Beijing", 39.9042, 116.4074],
      ["Delhi", 28.6139, 77.2090],
      ["Shanghai", 31.2304, 121.4737],
      ["London", 51.5074, -0.1278],
      ["Paris", 48.8566, 2.3522],
      ["Los Angeles", 34.0522, -118.2437],
      ["New York", 40.7128, -74.0060],
      ["Tokyo", 35.6762, 139.6503],
      ["Moscow", 55.7558, 37.6173],
      ["Dubai", 25.2048, 55.2708],
    ]);
// US-EPA AQI category bands (the scale WAQI reports its overall AQI on).
function aqiCategory(aqi) {
  if (aqi == null || !Number.isFinite(aqi)) return "";
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

// ---- AviationStack: live / scheduled flight data (key-gated, tiny free tier) -
// AviationStack authenticates with a ?access_key=... query param. The FREE plan
// is HTTP-only (https is blocked) and capped at a low monthly request count
// (~100/mo), so we poll VERY conservatively: refreshAll runs every POLL_MS, but
// this collector only actually calls the API when the cached row is older than
// AVIATIONSTACK_MIN_INTERVAL_MS (default 8h) — otherwise it serves the cache
// untouched. That keeps us comfortably under the free cap (~3 fetches/day). We
// surface a capped sample of flights (callsign, airline, route, status, and live
// position when airborne) plus the provider's total result count. Honest
// needs_key / 0 rows when AVIATIONSTACK_API_KEY is unset. Override the flight
// query via AVIATIONSTACK_PARAMS (raw query appended, e.g. "flight_status=active").
const AVIATIONSTACK_KEY = process.env.AVIATIONSTACK_API_KEY || "";
const AVIATIONSTACK_BASE = (process.env.AVIATIONSTACK_BASE || "http://api.aviationstack.com/v1").replace(/\/+$/, "");
const AVIATIONSTACK_LIMIT = Number(process.env.AVIATIONSTACK_LIMIT || 100);
const AVIATIONSTACK_MAX_ROWS = Number(process.env.AVIATIONSTACK_MAX_ROWS || 25);
const AVIATIONSTACK_PARAMS = process.env.AVIATIONSTACK_PARAMS || "";
// Free tier ~100 req/month -> default to at most one live fetch every 8 hours
// (~90/month). Raise AVIATIONSTACK_MIN_INTERVAL_MS for a stricter cap, lower it
// only on a paid plan.
const AVIATIONSTACK_MIN_INTERVAL_MS = Number(process.env.AVIATIONSTACK_MIN_INTERVAL_MS || 8 * 60 * 60 * 1000);

// ---- OpenSky Network: live aircraft state vectors (OAuth2 client-creds) ----
// OpenSky's current API authenticates with an OAuth2 *client-credentials* flow:
// POST client_id+client_secret to the Keycloak token endpoint for a ~30-min
// bearer token, then call /states/all with Authorization: Bearer <token>. We
// bound each poll to a few busy-airspace bounding boxes (lamin,lomin,lamax,lomax)
// to keep payloads small and stay well within rate limits. Honest needs_key with
// no rows when either OPENSKY_CLIENT_ID or OPENSKY_CLIENT_SECRET is unset.
// Override the regions via OPENSKY_REGIONS="Name:lamin:lomin:lamax:lomax,...".
const OPENSKY_CLIENT_ID = process.env.OPENSKY_CLIENT_ID || "";
const OPENSKY_CLIENT_SECRET = process.env.OPENSKY_CLIENT_SECRET || "";
const OPENSKY_TOKEN_URL = process.env.OPENSKY_TOKEN_URL ||
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const OPENSKY_BASE = (process.env.OPENSKY_BASE || "https://opensky-network.org/api").replace(/\/+$/, "");
const OPENSKY_MAX_ROWS = Number(process.env.OPENSKY_MAX_ROWS || 500);
const OPENSKY_REGIONS = (process.env.OPENSKY_REGIONS
  ? process.env.OPENSKY_REGIONS.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
      const [name, lamin, lomin, lamax, lomax] = p.split(":").map((x) => x.trim());
      return [name, Number(lamin), Number(lomin), Number(lamax), Number(lomax)];
    })
  : [
      ["Europe", 35, -15, 60, 30],
      ["North America", 24, -125, 49, -66],
      ["East Asia", 20, 100, 46, 146],
    ]);
// OAuth2 token cache: a single token is reused across polls/regions until ~60s
// before it expires, then transparently refreshed. Token/secret are never logged.
let openskyTokenCache = { token: "", exp: 0 };
async function getOpenskyToken() {
  const now = Date.now();
  if (openskyTokenCache.token && now < openskyTokenCache.exp) return openskyTokenCache.token;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(OPENSKY_TOKEN_URL, {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: OPENSKY_CLIENT_ID,
        client_secret: OPENSKY_CLIENT_SECRET,
      }),
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error("token HTTP " + r.status);
    const j = await r.json();
    if (!j.access_token) throw new Error("token response missing access_token");
    const ttlMs = (Number(j.expires_in) || 1800) * 1000;
    openskyTokenCache = { token: j.access_token, exp: now + ttlMs - 60000 };
    return openskyTokenCache.token;
  } finally { clearTimeout(t); }
}

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
async function getJsonHeaders(url, headers = {}, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", ...headers }, signal: ctl.signal });
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

// ---- Finnhub: markets / finance radar (key-gated) --------------------------
// Uses the REST /quote endpoint (real-time-ish US quotes on the free tier) across
// a curated set of index ETFs, macro proxies and mega-caps so the radar shows
// broad market direction rather than a single ticker. Honest needs_key with no
// rows when FINNHUB_API_KEY is unset.
async function refreshFinnhub() {
  if (!FINNHUB_KEY) {
    setCache("finnhub", {
      status: "needs_key",
      source: "Finnhub /quote",
      items: [],
      note: "Set FINNHUB_API_KEY to enable. No data served without a key.",
    });
    return;
  }
  const results = [];
  const failures = [];
  for (const [symbol, label] of FINNHUB_SYMBOLS) {
    try {
      const q = await getJson(
        FINNHUB_BASE + "/quote?symbol=" + encodeURIComponent(symbol) +
          "&token=" + encodeURIComponent(FINNHUB_KEY)
      );
      // Finnhub returns {c,d,dp,h,l,o,pc,t}. c===0 with no pc => unknown symbol.
      if (q && Number.isFinite(q.c) && (q.c !== 0 || q.pc)) {
        results.push({
          symbol, label,
          price: q.c, change: q.d, changePct: q.dp,
          high: q.h, low: q.l, open: q.o, prevClose: q.pc,
          t: q.t ? new Date(q.t * 1000).toISOString() : "",
        });
      } else {
        failures.push(symbol + ": no quote");
      }
    } catch (e) {
      failures.push(symbol + ": " + e.message);
    }
  }
  if (results.length) {
    setCache("finnhub", {
      status: "live",
      source: "Finnhub /quote (key)",
      items: results,
      note: failures.length ? "Some symbols unavailable: " + failures.join(" | ") : null,
    });
  } else {
    const prev = getCache("finnhub");
    setCache("finnhub", {
      status: prev?.items?.length ? "stale" : "error",
      source: "Finnhub /quote (key)",
      items: prev?.items || [],
      note: "Finnhub fetch failed for all symbols: " + failures.join(" | "),
    });
  }
}

// ---- OpenAQ: air-quality PM2.5 radar for major cities (key-gated) ----------
// For each city, find nearby PM2.5 monitoring locations, then read each
// location's latest sensor values and surface the freshest PM2.5 reading. Many
// OpenAQ stations report sporadically, so we prefer a reading inside the
// freshness window (OPENAQ_MAX_AGE_DAYS) and fall back to the most recent
// available, flagging it stale. Honest needs_key with no rows when unset.
async function refreshOpenaq() {
  if (!OPENAQ_KEY) {
    setCache("openaq", {
      status: "needs_key",
      source: "OpenAQ v3 /locations + /latest",
      items: [],
      note: "Set OPENAQ_API_KEY to enable. No data served without a key.",
    });
    return;
  }
  const H = { "X-API-Key": OPENAQ_KEY };
  const results = [];
  const failures = [];
  for (const [city, lat, lon] of OPENAQ_CITIES) {
    try {
      const locs = await getJsonHeaders(
        OPENAQ_BASE + "/locations?coordinates=" + lat + "," + lon +
          "&radius=" + OPENAQ_RADIUS_M + "&parameters_id=" + OPENAQ_PM25 + "&limit=5", H);
      let best = null;
      for (const loc of (locs.results || [])) {
        const smap = new Map((loc.sensors || []).map((sn) => [sn.id, sn.parameter]));
        const latest = await getJsonHeaders(OPENAQ_BASE + "/locations/" + loc.id + "/latest", H);
        for (const m of (latest.results || [])) {
          const p = smap.get(m.sensorsId);
          if (!p || p.name !== "pm25") continue;
          const when = m?.datetime?.utc || "";
          const age = Date.now() - (Date.parse(when) || 0);
          const cand = {
            city,
            location: loc.name,
            country: loc.country?.code || "",
            parameter: "pm25",
            value: m.value,
            unit: p.units,
            lat: m.coordinates?.latitude ?? loc.coordinates?.latitude ?? null,
            lon: m.coordinates?.longitude ?? loc.coordinates?.longitude ?? null,
            observedAt: when,
            stale: age > OPENAQ_MAX_AGE_MS,
            _age: age,
          };
          if (!best || age < best._age) best = cand;
          if (age <= OPENAQ_MAX_AGE_MS) break;
        }
        if (best && best._age <= OPENAQ_MAX_AGE_MS) break;
      }
      if (best) { delete best._age; results.push(best); }
      else failures.push(city + ": no pm25 reading");
    } catch (e) {
      failures.push(city + ": " + e.message);
    }
  }
  if (results.length) {
    const staleCount = results.filter((r) => r.stale).length;
    setCache("openaq", {
      status: "live",
      source: "OpenAQ v3 /locations + /latest (key)",
      items: results,
      note: (failures.length || staleCount)
        ? [failures.length ? failures.length + " city(ies) unavailable: " + failures.join(" | ") : null,
           staleCount ? staleCount + " reading(s) older than freshness window" : null].filter(Boolean).join("; ")
        : null,
    });
  } else {
    const prev = getCache("openaq");
    setCache("openaq", {
      status: prev?.items?.length ? "stale" : "error",
      source: "OpenAQ v3 /locations + /latest (key)",
      items: prev?.items || [],
      note: "OpenAQ fetch failed for all cities: " + failures.join(" | "),
    });
  }
}

// ---- WAQI: air-quality index (AQI) radar for major cities (token-gated) ----
// For each curated city we query WAQI's nearest-station feed by geo, surfacing
// the station's overall AQI (US-EPA scale) and dominant pollutant. WAQI returns
// {status:"ok",data:{aqi,dominentpol,city,time,...}} on success and
// {status:"error",data:"Invalid key"} (or "Over quota") on auth/limit problems,
// so a bad token degrades to an honest error with no fabricated rows.
async function refreshWaqi() {
  if (!WAQI_TOKEN) {
    setCache("waqi", {
      status: "needs_key",
      source: "WAQI /feed/geo",
      items: [],
      note: "Set WAQI_TOKEN to enable. No data served without a token.",
    });
    return;
  }
  const results = [];
  const failures = [];
  for (const [city, lat, lon] of WAQI_CITIES) {
    try {
      const j = await getJson(
        WAQI_BASE + "/feed/geo:" + lat + ";" + lon + "/?token=" + encodeURIComponent(WAQI_TOKEN)
      );
      if (j && j.status === "ok" && j.data && typeof j.data === "object") {
        const d = j.data;
        const aqi = Number(d.aqi);
        const geo = Array.isArray(d.city?.geo) ? d.city.geo : null;
        results.push({
          city,
          station: d.city?.name || "",
          aqi: Number.isFinite(aqi) ? aqi : null,
          dominantPollutant: d.dominentpol || "",   // WAQI spells it "dominentpol"
          category: aqiCategory(Number.isFinite(aqi) ? aqi : null),
          lat: geo ? geo[0] : lat,
          lon: geo ? geo[1] : lon,
          observedAt: d.time?.iso || d.time?.s || "",
        });
      } else {
        // WAQI puts the reason (e.g. "Invalid key", "Over quota") in data on error.
        failures.push(city + ": " + (typeof j?.data === "string" ? j.data : (j?.status || "no data")));
      }
    } catch (e) {
      failures.push(city + ": " + e.message);
    }
  }
  if (results.length) {
    setCache("waqi", {
      status: "live",
      source: "WAQI /feed/geo (token)",
      items: results,
      note: failures.length ? "Some cities unavailable: " + failures.join(" | ") : null,
    });
  } else {
    const prev = getCache("waqi");
    setCache("waqi", {
      status: prev?.items?.length ? "stale" : "error",
      source: "WAQI /feed/geo (token)",
      items: prev?.items || [],
      note: "WAQI fetch failed for all cities: " + failures.join(" | "),
    });
  }
}

// ---- OpenSky Network: live aircraft tracking (OAuth2-gated) ----------------
// Aggregates live state vectors across the configured regions, surfacing the
// aircraft count plus a capped sample of flights (callsign, origin country,
// position, altitude, speed, heading). OpenSky returns each aircraft as a
// positional "state vector" array; we map the indices we display. Honest
// needs_key with no rows when credentials are unset.
function parseOpenskyStates(states, region) {
  const out = [];
  for (const s of states || []) {
    const lat = s[6], lon = s[5];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      icao24: (s[0] || "").trim(),
      callsign: (s[1] || "").trim(),
      origin: s[2] || "",                // origin_country
      lat, lon,
      altitude: s[13] ?? s[7] ?? null,   // geo_altitude, fallback baro_altitude (m)
      velocity: s[9] ?? null,            // m/s
      heading: s[10] ?? null,            // true_track (deg)
      verticalRate: s[11] ?? null,       // m/s
      onGround: !!s[8],
      squawk: s[14] || "",
      region,
    });
  }
  return out;
}

async function refreshOpensky() {
  // OAuth2-gated: serve an honest needs_key state (no rows) when creds are unset.
  if (!OPENSKY_CLIENT_ID || !OPENSKY_CLIENT_SECRET) {
    setCache("opensky", {
      status: "needs_key",
      source: "OpenSky Network /states/all",
      items: [],
      note: "Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET to enable. No data served without credentials.",
    });
    return;
  }
  let token;
  try {
    token = await getOpenskyToken();
  } catch (e) {
    const prev = getCache("opensky");
    setCache("opensky", {
      status: prev?.items?.length ? "stale" : "error",
      source: "OpenSky Network OAuth2 (client-credentials)",
      items: prev?.items || [],
      note: "OpenSky token exchange failed: " + e.message,
    });
    return;
  }
  const all = [];
  const failures = [];
  let total = 0;
  for (const [name, lamin, lomin, lamax, lomax] of OPENSKY_REGIONS) {
    try {
      const j = await getJsonHeaders(
        OPENSKY_BASE + "/states/all?lamin=" + lamin + "&lomin=" + lomin +
          "&lamax=" + lamax + "&lomax=" + lomax,
        { authorization: "Bearer " + token }
      );
      const parsed = parseOpenskyStates(j.states, name);
      total += parsed.length;
      all.push(...parsed);
    } catch (e) {
      failures.push(name + ": " + e.message);
    }
  }
  if (all.length) {
    // Surface airborne flights first, fastest first, so the capped panel shows
    // significant traffic rather than an arbitrary slice.
    all.sort((a, b) => (Number(a.onGround) - Number(b.onGround)) || ((b.velocity ?? -1) - (a.velocity ?? -1)));
    const items = all.slice(0, OPENSKY_MAX_ROWS);
    setCache("opensky", {
      status: "live",
      source: "OpenSky Network /states/all (OAuth2) — regions: " + OPENSKY_REGIONS.map((r) => r[0]).join(", "),
      items,
      note: [
        total > OPENSKY_MAX_ROWS ? "Top " + OPENSKY_MAX_ROWS + " of " + total + " live aircraft by speed." : null,
        failures.length ? failures.length + " region(s) unavailable: " + failures.join(" | ") : null,
      ].filter(Boolean).join("; ") || null,
    });
  } else if (failures.length) {
    const prev = getCache("opensky");
    setCache("opensky", {
      status: prev?.items?.length ? "stale" : "error",
      source: "OpenSky Network /states/all (OAuth2)",
      items: prev?.items || [],
      note: "OpenSky fetch failed for all regions: " + failures.join(" | "),
    });
  } else {
    setCache("opensky", {
      status: "live",
      source: "OpenSky Network /states/all (OAuth2)",
      items: [],
      note: "Credentials valid; no aircraft currently in configured regions.",
    });
  }
}

// ---- AviationStack: live / scheduled flight data (key-gated) ----------------
// Conservatively polled to respect the tiny free-tier monthly cap (see config).
// Honest needs_key / 0 rows when the key is unset.
async function refreshAviationstack() {
  if (!AVIATIONSTACK_KEY) {
    setCache("aviationstack", {
      status: "needs_key",
      source: "AviationStack /flights",
      items: [],
      note: "Set AVIATIONSTACK_API_KEY to enable. No data served without a key.",
    });
    return;
  }
  // Tiny free-tier cap: only hit the API if our cached row is older than the
  // configured minimum interval; otherwise keep the cache untouched. Also gates
  // error retries so a quota/HTTP failure does not hammer the monthly budget.
  const prev = getCache("aviationstack");
  if (prev && prev.status !== "needs_key" && prev.fetchedAt) {
    const age = Date.now() - Date.parse(prev.fetchedAt);
    if (Number.isFinite(age) && age < AVIATIONSTACK_MIN_INTERVAL_MS) return;
  }
  try {
    const qs =
      "?access_key=" + encodeURIComponent(AVIATIONSTACK_KEY) +
      "&limit=" + AVIATIONSTACK_LIMIT +
      (AVIATIONSTACK_PARAMS ? "&" + AVIATIONSTACK_PARAMS.replace(/^[?&]/, "") : "");
    const j = await getJson(AVIATIONSTACK_BASE + "/flights" + qs);
    // AviationStack errors come back as { error: { code, message, type } }.
    if (j && j.error) {
      throw new Error(j.error.message || j.error.info || j.error.code || j.error.type || "api error");
    }
    const data = Array.isArray(j && j.data) ? j.data : [];
    const total = Number(j && j.pagination && j.pagination.total);
    const items = data.slice(0, AVIATIONSTACK_MAX_ROWS).map((f) => {
      const dep = f.departure || {}, arr = f.arrival || {}, fl = f.flight || {}, al = f.airline || {};
      const live = f.live || null;
      return {
        flight: fl.iata || fl.icao || fl.number || "",
        callsign: fl.icao || fl.iata || "",
        airline: al.name || "",
        status: f.flight_status || "",
        depIata: dep.iata || "", depAirport: dep.airport || "",
        arrIata: arr.iata || "", arrAirport: arr.airport || "",
        scheduledDep: dep.scheduled || "",
        flightDate: f.flight_date || "",
        lat: live && Number.isFinite(live.latitude) ? live.latitude : null,
        lon: live && Number.isFinite(live.longitude) ? live.longitude : null,
        altitude: live && Number.isFinite(live.altitude) ? live.altitude : null,
      };
    });
    if (items.length) {
      setCache("aviationstack", {
        status: "live",
        source: "AviationStack /flights (access_key)",
        items,
        note: [
          Number.isFinite(total) ? "Showing " + items.length + " of " + total.toLocaleString("en-US") + " flights in result set." : null,
          "Free tier: live fetch at most once per " + Math.round(AVIATIONSTACK_MIN_INTERVAL_MS / 3600000) + "h to respect the monthly cap.",
        ].filter(Boolean).join(" "),
      });
    } else {
      setCache("aviationstack", {
        status: prev && prev.items && prev.items.length ? "stale" : "error",
        source: "AviationStack /flights (access_key)",
        items: (prev && prev.items) || [],
        note: "AviationStack returned no flight rows.",
      });
    }
  } catch (e) {
    setCache("aviationstack", {
      status: prev && prev.items && prev.items.length ? "stale" : "error",
      source: "AviationStack /flights (access_key)",
      items: (prev && prev.items) || [],
      note: "AviationStack fetch failed: " + e.message,
    });
  }
}

// ---- AISStream: live vessel AIS positions (WebSocket stream, key-gated) -----
// AISStream.io is a *streaming* feed, not a REST API: we hold a single
// WebSocket to wss://stream.aisstream.io/v0/stream, send a subscription (API
// key + bounding boxes for a few busy shipping lanes) within 3s, then receive a
// continuous stream of vessel PositionReport messages. We keep ONLY the
// most-recent position per MMSI in a bounded in-memory map (capped at
// AISSTREAM_MAX_VESSELS, oldest-seen evicted first) so memory cannot grow
// unbounded, and serve a snapshot from /api/ais. Zero-dependency: uses Node's
// built-in global WebSocket (stable in Node >=22). If the runtime lacks it we
// degrade honestly (status "error" + note) instead of crashing the collector.
// Honest needs_key / 0 rows when AISSTREAM_API_KEY is unset. The key is never
// logged or echoed into any response.
const AISSTREAM_KEY = process.env.AISSTREAM_API_KEY || "";
const AISSTREAM_WS_URL = process.env.AISSTREAM_WS_URL || "wss://stream.aisstream.io/v0/stream";
const AISSTREAM_MAX_VESSELS = Number(process.env.AISSTREAM_MAX_VESSELS || 500);
const AISSTREAM_SAMPLE_ROWS = Number(process.env.AISSTREAM_SAMPLE_ROWS || 25);
// Default to a handful of busy shipping lanes so we get steady traffic without
// subscribing to the whole world (which streams ~300 msg/s). Each bbox is two
// [lat, lon] corners. Override with AISSTREAM_BBOXES as a JSON array of bboxes.
const AISSTREAM_BBOXES = (() => {
  if (process.env.AISSTREAM_BBOXES) {
    try { return JSON.parse(process.env.AISSTREAM_BBOXES); } catch { /* fall through to defaults */ }
  }
  return [
    [[51.6, 1.0], [50.9, 2.1]],     // Dover Strait / English Channel
    [[36.2, -5.8], [35.8, -5.2]],   // Strait of Gibraltar
    [[1.35, 103.5], [1.05, 104.2]], // Singapore Strait
    [[31.6, 121.5], [30.6, 122.8]], // Shanghai / Yangtze approaches
  ];
})();
const AISSTREAM_MESSAGE_TYPES = ["PositionReport"];

// Bounded "most-recent position per MMSI" store + lightweight connection state.
const aisVessels = new Map(); // MMSI -> { mmsi, name, lat, lon, sog, cog, time }
let aisConn = null;           // current WebSocket instance (or null)
let aisConnecting = false;
let aisMsgCount = 0;          // total position reports ingested since boot
let aisLastMsgAt = 0;         // epoch ms of the last position report
let aisReconnectMs = 2000;    // reconnect backoff; grows to a cap on repeat drops
let aisReconnectTimer = null;
let aisLastPubAt = 0;

function aisRememberVessel(meta, pr) {
  const mmsi = (meta && meta.MMSI != null) ? meta.MMSI : (pr && pr.UserID);
  if (mmsi == null) return;
  const lat = (meta && typeof meta.latitude === "number") ? meta.latitude : (pr && pr.Latitude);
  const lon = (meta && typeof meta.longitude === "number") ? meta.longitude : (pr && pr.Longitude);
  if (typeof lat !== "number" || typeof lon !== "number") return;
  // Re-insert so iteration order is oldest-seen -> newest (eviction takes head).
  aisVessels.delete(mmsi);
  aisVessels.set(mmsi, {
    mmsi,
    name: ((meta && meta.ShipName) || "").trim(),
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    sog: (pr && typeof pr.Sog === "number") ? pr.Sog : null,
    cog: (pr && typeof pr.Cog === "number") ? pr.Cog : null,
    time: (meta && meta.time_utc) || new Date().toISOString(),
  });
  while (aisVessels.size > AISSTREAM_MAX_VESSELS) {
    aisVessels.delete(aisVessels.keys().next().value);
  }
  aisMsgCount++;
  aisLastMsgAt = Date.now();
}

function aisPublish() {
  if (!AISSTREAM_KEY) {
    setCache("ais", {
      status: "needs_key",
      source: "AISStream wss /v0/stream",
      vesselCount: 0,
      items: [],
      note: "Set AISSTREAM_API_KEY to enable. No data served without a key.",
    });
    return;
  }
  const connected = !!aisConn && aisConn.readyState === 1; // 1 = OPEN
  const freshMs = aisLastMsgAt ? Date.now() - aisLastMsgAt : Infinity;
  const receiving = connected && freshMs < 120000;
  const sample = [...aisVessels.values()].reverse().slice(0, AISSTREAM_SAMPLE_ROWS).map((v) => ({
    mmsi: v.mmsi, name: v.name, lat: v.lat, lon: v.lon, speed: v.sog, course: v.cog, time: v.time,
  }));
  let status, note;
  if (receiving) {
    status = "live";
    note = "Live AIS stream — " + aisVessels.size + " vessels tracked across " +
      AISSTREAM_BBOXES.length + " shipping-lane boxes; " + aisMsgCount + " position reports since boot.";
  } else if (aisVessels.size) {
    status = "stale";
    note = connected ? "Stream connected, awaiting position reports."
      : "Stream disconnected — serving last known positions, reconnecting.";
  } else {
    status = "pending";
    note = connected ? "Connected to AISStream, waiting for first vessel report." : "Connecting to AISStream…";
  }
  setCache("ais", { status, source: "AISStream wss /v0/stream", vesselCount: aisVessels.size, items: sample, note });
}

function aisScheduleReconnect() {
  if (aisReconnectTimer) return;
  const delay = aisReconnectMs;
  aisReconnectMs = Math.min(aisReconnectMs * 2, 30000);
  aisReconnectTimer = setTimeout(() => { aisReconnectTimer = null; aisConnect(); }, delay);
}

function aisConnect() {
  if (!AISSTREAM_KEY) { aisPublish(); return; }
  if (typeof WebSocket === "undefined") {
    setCache("ais", {
      status: "error",
      source: "AISStream wss /v0/stream",
      vesselCount: aisVessels.size,
      items: [],
      note: "Runtime has no built-in WebSocket (needs Node >=22). AIS stream unavailable; rest of collector unaffected.",
    });
    return;
  }
  if (aisConnecting || (aisConn && aisConn.readyState === 1)) return;
  aisConnecting = true;
  let ws;
  try { ws = new WebSocket(AISSTREAM_WS_URL); }
  catch { aisConnecting = false; aisScheduleReconnect(); return; }
  // AISStream delivers JSON over BINARY frames; Node's built-in WebSocket hands
  // them back as Blob by default. Force ArrayBuffer so we can decode synchronously.
  try { ws.binaryType = "arraybuffer"; } catch { /* default binaryType is fine */ }
  aisConn = ws;
  ws.addEventListener("open", () => {
    aisConnecting = false;
    aisReconnectMs = 2000; // reset backoff after a good connection
    try {
      ws.send(JSON.stringify({
        APIKey: AISSTREAM_KEY,
        BoundingBoxes: AISSTREAM_BBOXES,
        FilterMessageTypes: AISSTREAM_MESSAGE_TYPES,
      }));
    } catch { /* a send failure surfaces via close/error below */ }
    aisPublish();
  });
  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      const raw = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8");
      msg = JSON.parse(raw);
    } catch { return; }
    if (msg && msg.error) { // invalid key / malformed subscription / throttling
      setCache("ais", {
        status: "error",
        source: "AISStream wss /v0/stream",
        vesselCount: aisVessels.size,
        items: [],
        note: "AISStream error: " + String(msg.error).slice(0, 200),
      });
      return;
    }
    if (msg && msg.MessageType === "PositionReport") {
      aisRememberVessel(msg.MetaData || {}, (msg.Message && msg.Message.PositionReport) || {});
      if (Date.now() - aisLastPubAt > 1000) { aisLastPubAt = Date.now(); aisPublish(); }
    }
  });
  ws.addEventListener("close", () => {
    aisConnecting = false;
    if (aisConn === ws) aisConn = null;
    aisPublish();
    aisScheduleReconnect();
  });
  ws.addEventListener("error", () => {
    aisConnecting = false;
    try { ws.close(); } catch { /* close handler will reconnect */ }
  });
}

// Called from refreshAll() (every POLL_MS) and once at boot: a watchdog that
// (re)connects the stream if it is not OPEN/CONNECTING, otherwise republishes.
function ensureAisStream() {
  if (!AISSTREAM_KEY) { aisPublish(); return; }
  if (typeof WebSocket === "undefined") { aisConnect(); return; }
  if (!aisConn || aisConn.readyState > 1) aisConnect(); // null / CLOSING / CLOSED
  else aisPublish();
}

// Heartbeat: refresh the /api/ais snapshot (and its live/stale flag) every 30s
// even when no new position reports have arrived, so freshness reflects reality.
setInterval(() => { if (AISSTREAM_KEY) aisPublish(); }, 30000).unref?.();

// ---- Cloudflare Radar: internet outages + global traffic / attack trends ---
// Cloudflare Radar exposes aggregate internet insight via a Bearer-token API
// (Authorization: Bearer <token>) under /client/v4/radar. We surface, in one
// compact panel: notable internet OUTAGES (the panel's primary rows), plus a
// summary of global HTTP traffic trend, Layer-7 DDoS attack trend, and median
// connection quality (speed / latency). Honest needs_key with NO rows when the
// token is unset. Radar timeseries values are normalized indices (share of the
// window max), so we report day-over-day % change rather than absolute volume.
const CLOUDFLARE_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const CLOUDFLARE_RADAR_BASE = "https://api.cloudflare.com/client/v4/radar";

// Reduce a Radar hourly timeseries to {latest, day-over-day %, latestAt}.
function cfTrend(serie) {
  const vals = (serie?.values || []).map(Number).filter(Number.isFinite);
  const ts = serie?.timestamps || [];
  if (!vals.length) return null;
  const latest = vals[vals.length - 1];
  const prev = vals.length > 24 ? vals[vals.length - 25] : vals[0]; // ~24h ago
  const dod = prev ? ((latest - prev) / prev) * 100 : null;
  return {
    latest: Number(latest.toFixed(4)),
    dayOverDayPct: dod == null ? null : Number(dod.toFixed(1)),
    latestAt: ts[ts.length - 1] || null,
  };
}

async function refreshCloudflareRadar() {
  if (!CLOUDFLARE_TOKEN) {
    setCache("cloudflare", {
      status: "needs_key",
      source: "Cloudflare Radar",
      items: [],
      summary: null,
      note: "Set CLOUDFLARE_API_TOKEN to enable. No data served without a token.",
    });
    return;
  }
  const auth = { authorization: "Bearer " + CLOUDFLARE_TOKEN };
  const failures = [];
  let outages = [];
  const summary = {};
  // 1) Notable internet outages over the last 30d (the panel's primary rows).
  try {
    const j = await getJsonHeaders(
      CLOUDFLARE_RADAR_BASE + "/annotations/outages?dateRange=30d&format=json&limit=20",
      auth
    );
    const anns = j?.result?.annotations || [];
    outages = anns.map((a) => ({
      id: a.id,
      description: a.description || "",
      eventType: a.eventType || "",
      cause: a.outage?.outageCause || "",
      outageType: a.outage?.outageType || "",
      startDate: a.startDate || "",
      endDate: a.endDate || "",
      locations: (a.locationsDetails || []).map((l) => l.name).filter(Boolean),
      asns: (a.asnsDetails || []).map((x) => ({ asn: x.asn, name: x.name, country: x.location?.name || "" })),
      url: a.linkedUrl || "",
    }));
  } catch (e) { failures.push("outages: " + e.message); }
  // 2) Global HTTP traffic trend (normalized index, day-over-day).
  try {
    const j = await getJsonHeaders(CLOUDFLARE_RADAR_BASE + "/http/timeseries?dateRange=7d&format=json", auth);
    summary.httpTraffic = cfTrend(j?.result?.serie_0);
  } catch (e) { failures.push("http: " + e.message); }
  // 3) Global Layer-7 attack trend (normalized index, day-over-day).
  try {
    const j = await getJsonHeaders(CLOUDFLARE_RADAR_BASE + "/attacks/layer7/timeseries?dateRange=7d&format=json", auth);
    summary.layer7Attacks = cfTrend(j?.result?.serie_0);
  } catch (e) { failures.push("attacks: " + e.message); }
  // 4) Median connection quality (speed / latency / packet loss), raw values.
  try {
    const j = await getJsonHeaders(CLOUDFLARE_RADAR_BASE + "/quality/speed/summary?format=json", auth);
    const s = j?.result?.summary_0;
    if (s) summary.quality = {
      downloadMbps: Number(Number(s.bandwidthDownload).toFixed(1)),
      uploadMbps: Number(Number(s.bandwidthUpload).toFixed(1)),
      latencyIdleMs: Number(Number(s.latencyIdle).toFixed(1)),
      latencyLoadedMs: Number(Number(s.latencyLoaded).toFixed(1)),
      packetLossPct: Number(Number(s.packetLoss).toFixed(2)),
    };
  } catch (e) { failures.push("quality: " + e.message); }

  if (outages.length || Object.keys(summary).length) {
    setCache("cloudflare", {
      status: "live",
      source: "Cloudflare Radar (Bearer token)",
      items: outages,
      summary,
      note: failures.length ? "Some Radar endpoints unavailable: " + failures.join(" | ") : null,
    });
  } else {
    const prev = getCache("cloudflare");
    setCache("cloudflare", {
      status: prev?.items?.length ? "stale" : "error",
      source: "Cloudflare Radar (Bearer token)",
      items: prev?.items || [],
      summary: prev?.summary || null,
      note: "Cloudflare Radar fetch failed: " + failures.join(" | "),
    });
  }
}

// ---- Groq AI Brief: synthesized situational summary (key-gated) ------------
// Unlike the raw-data sources, this panel CONSUMES the collector's OWN freshly
// aggregated feeds this cycle (news + geopolitical + live seismic + whatever
// else is live) and asks an LLM to write a short, neutral situational brief —
// "the world right now in N bullets". Groq is OpenAI-compatible: base
// https://api.groq.com/openai/v1, chat completions at /chat/completions,
// Authorization: Bearer <key>. The key is read from GROQ_API_KEY and is NEVER
// logged or echoed into any response (it only ever rides the request header).
// Honest needs_key / 0 rows when GROQ_API_KEY is unset.
//
// Cost/latency control: the brief is regenerated at most once per
// GROQ_BRIEF_MIN_INTERVAL_MS (default 20 min) even though refreshAll runs every
// POLL_MS — between regenerations the cached brief is served untouched, so we do
// not burn tokens every cycle. Model is overridable via GROQ_MODEL.
const GROQ_KEY = process.env.GROQ_API_KEY || "";
const GROQ_BASE = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_BRIEF_BULLETS = Number(process.env.GROQ_BRIEF_BULLETS || 6);
const GROQ_BRIEF_MIN_INTERVAL_MS = Number(process.env.GROQ_BRIEF_MIN_INTERVAL_MS || 20 * 60 * 1000);

// Pull the most salient rows out of a cached feed for the prompt (compact, and
// only when that feed actually has live data this cycle).
function briefLinesFromCache(key, max, fmt) {
  const c = getCache(key);
  if (!c || !Array.isArray(c.items) || c.status === "needs_key") return [];
  return c.items.slice(0, max).map(fmt).filter(Boolean);
}

// OpenAI-compatible chat call to Groq. Returns parsed JSON; throws with the
// provider's error message (never the key) on a non-2xx.
async function groqChat(messages, ms = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(GROQ_BASE + "/chat/completions", {
      method: "POST",
      headers: {
        "user-agent": UA,
        "content-type": "application/json",
        accept: "application/json",
        authorization: "Bearer " + GROQ_KEY,
      },
      body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.2, max_tokens: 700 }),
      signal: ctl.signal,
    });
    const text = await r.text();
    if (!r.ok) {
      let msg = "HTTP " + r.status;
      try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error.type)) || msg; } catch { /* keep HTTP code */ }
      throw new Error(msg);
    }
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

async function refreshAiBrief() {
  // Key-gated: serve an honest needs_key state (no brief) when GROQ_API_KEY unset.
  if (!GROQ_KEY) {
    setCache("brief", {
      status: "needs_key",
      source: "Groq chat completions (" + GROQ_MODEL + ")",
      items: [],
      brief: "",
      note: "Set GROQ_API_KEY to enable. No brief generated without a key.",
    });
    return;
  }
  // Throttle: regenerate at most once per min-interval; otherwise keep the cache
  // untouched so we serve the last good brief without spending tokens.
  const prev = getCache("brief");
  if (prev && prev.status === "live" && prev.fetchedAt) {
    const age = Date.now() - Date.parse(prev.fetchedAt);
    if (Number.isFinite(age) && age < GROQ_BRIEF_MIN_INTERVAL_MS) return;
  }

  // ---- gather the collector's OWN aggregated data this cycle ----
  const news = briefLinesFromCache("news", 14, (n) => n.title && ("- " + n.title + (n.source ? " [" + n.source + "]" : "")));
  const geo = briefLinesFromCache("geopolitical", 14, (g) => g.title && ("- " + g.title + (g.source ? " [" + g.source + "]" : "")));
  // Seismic is read client-side (not in collector cache); pull a compact USGS
  // M4.5+/day snapshot directly (keyless, CORS-open) so the brief has real
  // seismic context. Optional: omitted silently if USGS is unreachable.
  let quakes = [];
  try {
    const qj = await getJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson");
    quakes = (qj.features || [])
      .map((f) => ({ mag: f.properties?.mag, place: f.properties?.place }))
      .filter((q) => Number.isFinite(q.mag))
      .sort((a, b) => b.mag - a.mag)
      .slice(0, 8)
      .map((q) => "- M" + q.mag.toFixed(1) + " " + (q.place || ""));
  } catch { /* seismic optional */ }
  // Whatever else is live this cycle: a compact market-direction line + an
  // enumeration of any other live feeds, so the model knows the breadth.
  const extras = [];
  const fin = getCache("finnhub");
  if (fin && fin.status === "live" && Array.isArray(fin.items) && fin.items.length) {
    const mkt = fin.items.slice(0, 8)
      .map((m) => (m.label || m.symbol) + (Number.isFinite(m.changePct) ? " " + (m.changePct > 0 ? "+" : "") + m.changePct.toFixed(2) + "%" : ""))
      .join(", ");
    if (mkt) extras.push("- Markets: " + mkt);
  }
  const otherLive = [];
  for (const [key, label] of [["firms", "satellite active fires"], ["cloudflare", "internet outages/traffic"], ["opensky", "live aircraft"], ["aviationstack", "flights"], ["ais", "vessel AIS"], ["waqi", "air-quality index"], ["openaq", "air-quality PM2.5"]]) {
    const c = getCache(key);
    if (c && c.status === "live" && Array.isArray(c.items) && c.items.length) otherLive.push(label + " (" + c.items.length + ")");
  }
  if (otherLive.length) extras.push("- Other live feeds available: " + otherLive.join(", "));

  const sections = [];
  if (news.length) sections.push("GLOBAL NEWS (last 24h):\n" + news.join("\n"));
  if (geo.length) sections.push("GEOPOLITICAL HEADLINES:\n" + geo.join("\n"));
  if (quakes.length) sections.push("SIGNIFICANT SEISMIC (USGS M4.5+/24h):\n" + quakes.join("\n"));
  if (extras.length) sections.push("OTHER SIGNALS:\n" + extras.join("\n"));

  if (!sections.length) {
    setCache("brief", {
      status: prev?.items?.length ? "stale" : "error",
      source: "Groq chat completions (" + GROQ_MODEL + ")",
      items: prev?.items || [],
      brief: prev?.brief || "",
      note: "No upstream feed data available this cycle to synthesize a brief.",
    });
    return;
  }

  const system =
    "You are a neutral wire-service desk editor. Using ONLY the feed data " +
    "provided, write a concise situational brief of the world right now. " +
    "Output exactly " + GROQ_BRIEF_BULLETS + " bullet points, each a single " +
    "factual sentence, neutral and non-speculative. Group related items. Do " +
    "NOT invent facts, numbers, or events not present in the data. No preamble, " +
    "no headings, no closing line — only the bullets, one per line, each " +
    "starting with '- '.";
  const user =
    "Live feed data aggregated by the World View collector (" +
    new Date().toISOString() + "):\n\n" + sections.join("\n\n");

  try {
    const j = await groqChat([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const content = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "").trim();
    if (!content) throw new Error("empty completion");
    const bullets = content
      .split(/\r?\n+/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter(Boolean);
    const items = (bullets.length ? bullets : [content]).map((text) => ({ text }));
    const usage = j.usage || {};
    setCache("brief", {
      status: "live",
      source: "Groq chat completions (" + GROQ_MODEL + ")",
      model: GROQ_MODEL,
      items,
      brief: content,
      generatedAt: new Date().toISOString(),
      note: "Synthesized from this cycle's live feeds (news, geopolitical, seismic" +
        (extras.length ? ", + other live signals" : "") + ")." +
        (usage.total_tokens ? " Tokens: " + usage.total_tokens + "." : ""),
    });
  } catch (e) {
    setCache("brief", {
      status: prev?.items?.length ? "stale" : "error",
      source: "Groq chat completions (" + GROQ_MODEL + ")",
      items: prev?.items || [],
      brief: prev?.brief || "",
      note: "Groq brief generation failed: " + e.message,
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
  { panel: "Live Flights", provider: "AviationStack", key: "AVIATIONSTACK_API_KEY", status: "needs_key" },
  { panel: "Vessel / AIS Tracking", provider: "AISStream", key: "AISSTREAM_API_KEY", status: "needs_key" },
  { panel: "Aircraft Tracking", provider: "OpenSky Network", key: "OPENSKY_CLIENT_ID + OPENSKY_CLIENT_SECRET", status: "needs_key", notes: "OAuth2 client-credentials. Live state vectors over busy-airspace bboxes." },
  { panel: "Markets / Finance Radar", provider: "Finnhub", key: "FINNHUB_API_KEY", status: "needs_key" },
  { panel: "Energy", provider: "EIA", key: "EIA_API_KEY", status: "needs_key" },
  { panel: "Economic Data", provider: "FRED", key: "FRED_API_KEY", status: "needs_key" },
  { panel: "Air Quality", provider: "OpenAQ", key: "OPENAQ_API_KEY", status: "needs_key" },
  { panel: "Air Quality Index", provider: "WAQI", key: "WAQI_TOKEN", status: "needs_key" },
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
    for (const k of ["news", "geopolitical", "firms", "finnhub", "openaq", "waqi", "opensky", "aviationstack", "ais", "cloudflare", "fred", "brief"]) {
      const c = getCache(k);
      freshness[k] = c ? { status: c.status, fetchedAt: c.fetchedAt, count: c.items.length } : { status: "pending" };
    }
    Object.assign(freshness, extrasFreshness());
    return send(res, 200, { ok: true, service: "worldview-collector", pollMs: POLL_MS, freshness });
  }
  if (path === "/api/news") return send(res, 200, getCache("news") || { status: "pending", items: [] });
  if (path === "/api/geopolitical") return send(res, 200, getCache("geopolitical") || { status: "pending", items: [] });
  if (path === "/api/firms") return send(res, 200, getCache("firms") || { status: "pending", items: [] });
  if (path === "/api/finnhub") return send(res, 200, getCache("finnhub") || { status: "pending", items: [] });
  if (path === "/api/openaq") return send(res, 200, getCache("openaq") || { status: "pending", items: [] });
  if (path === "/api/waqi") return send(res, 200, getCache("waqi") || { status: "pending", items: [] });
  if (path === "/api/opensky") return send(res, 200, getCache("opensky") || { status: "pending", items: [] });
  if (path === "/api/aviationstack") return send(res, 200, getCache("aviationstack") || { status: "pending", items: [] });
  if (path === "/api/ais") return send(res, 200, getCache("ais") || { status: "pending", items: [] });
  if (path === "/api/cloudflare") return send(res, 200, getCache("cloudflare") || { status: "pending", items: [] });
  if (path === "/api/fred") return send(res, 200, getCache("fred") || { status: "pending", items: [] });
  if (path === "/api/brief") return send(res, 200, getCache("brief") || { status: "pending", items: [] });
  if (path === "/api/sources") {
    // Overlay the live FIRMS status (from cache) onto its static catalog row so
    // the panel flips needs_key -> live once the key is set and a fetch succeeds.
    const overlay = { "NASA FIRMS": getCache("firms"), "Finnhub": getCache("finnhub"), "OpenAQ": getCache("openaq"), "WAQI": getCache("waqi"), "OpenSky Network": getCache("opensky"), "AviationStack": getCache("aviationstack"), "AISStream": getCache("ais"), "Cloudflare Radar": getCache("cloudflare"), "Groq / OpenRouter / Anthropic": getCache("brief"), "FRED": getCache("fred") };
    const sources = SOURCE_CATALOG.map((s) => {
      const c = overlay[s.provider];
      return c
        ? { ...s, status: c.status, notes: c.note ?? s.notes, count: c.items?.length }
        : s;
    });
    return send(res, 200, { sources: [...sources, ...EXTRA_SOURCE_ROWS], fetchedAt: new Date().toISOString() });
  }
  const extra = extrasHandle(path);
  if (extra) return send(res, 200, extra);
  return send(res, 404, { error: "not found", endpoints: ["/health", "/api/news", "/api/geopolitical", "/api/firms", "/api/finnhub", "/api/openaq", "/api/waqi", "/api/opensky", "/api/aviationstack", "/api/ais", "/api/cloudflare", "/api/fred", "/api/brief", "/api/sources", ...EXTRA_ENDPOINTS] });
});

async function refreshAll() {
  ensureAisStream(); // maintain AISStream WebSocket (connect / reconnect watchdog)
  await Promise.allSettled([refreshNews(), refreshGeopolitical(), refreshFirms(), refreshFinnhub(), refreshOpenaq(), refreshWaqi(), refreshOpensky(), refreshAviationstack(), refreshFred(), refreshCloudflareRadar(), refreshExtras()]);
  // The AI brief consumes the feeds refreshed above, so run it AFTER they settle
  // (it self-throttles to GROQ_BRIEF_MIN_INTERVAL_MS, so this is cheap per cycle).
  await refreshAiBrief();
}
server.listen(PORT, () => {
  console.log("[worldview-collector] listening on :" + PORT + " (poll " + POLL_MS + "ms)");
  refreshAll();
  setInterval(refreshAll, POLL_MS);
});
