import { Router } from "express";
import { logger } from "../middleware/logger.js";

/**
 * World View proxy (additive, read-only).
 *
 * The World View tab needs feed data from the
 * `worldview-collector` (services/worldview-collector), which runs as a launchd
 * service on Box 1 at `http://localhost:8788`. The server proxies collector
 * responses to the browser SAME-ORIGIN, so the client only ever talks to the
 * public Paperclip origin via `/api/worldview/*`.
 *
 * Mounted OUTSIDE the guarded `/api` router (like the webhook receivers) so the
 * passthrough needs no Paperclip session/board handshake. It is read-only: only
 * the three whitelisted GET endpoints below are proxied; nothing is mutated.
 *
 * Collector base is configurable via WORLDVIEW_COLLECTOR_URL (server-side env),
 * defaulting to the tailnet collector.
 */

const COLLECTOR_BASE = (
  process.env.WORLDVIEW_COLLECTOR_URL ||
  "http://localhost:8788"
).replace(/\/+$/, "");

// Whitelist: public route segment -> upstream collector path. Read-only.
const ROUTE_MAP: Record<string, string> = {
  news: "/api/news",
  geopolitical: "/api/geopolitical",
  firms: "/api/firms",
  finnhub: "/api/finnhub",
  openaq: "/api/openaq",
  waqi: "/api/waqi",
  opensky: "/api/opensky",
  aviationstack: "/api/aviationstack",
  ais: "/api/ais",
  cloudflare: "/api/cloudflare",
  brief: "/api/brief",
  fred: "/api/fred",
  sources: "/api/sources",
  // OSIRIS rebuild wave (TYL-131) — all keyless collector endpoints.
  quakes: "/api/quakes",
  eonet: "/api/eonet",
  swpc: "/api/swpc",
  cve: "/api/cve",
  satellites: "/api/satellites",
  conflicts: "/api/conflicts",
  cctv: "/api/cctv",
  "live-news": "/api/live-news",
  radar: "/api/radar",
  health: "/health",
};

const UPSTREAM_TIMEOUT_MS = 10_000;

// ---- basemap tile proxy (TYL-131) -------------------------------------------
// Same-origin raster-tile proxy for the World View MapLibre basemap, mirroring
// OSIRIS's /api/proxy-tiles: allowlisted upstreams only (no open proxy), long
// immutable cache. Read-only GET; no Paperclip session required, so it stays
// inside this unguarded router.
const TILE_HOSTS = [
  /(^|\.)basemaps\.cartocdn\.com$/i,
  /(^|\.)cartocdn\.com$/i,
  /(^|\.)tilecache\.rainviewer\.com$/i,
];
const TILE_TIMEOUT_MS = 15_000;
const TILE_CACHE_MAX = 2_000;
const tileCache = new Map<string, { body: Buffer; type: string }>();

export function worldviewProxyRoutes(): Router {
  const router = Router();

  router.get("/api/worldview/tiles", async (req, res) => {
    const raw = String(req.query.url || "");
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      res.status(400).json({ status: "error", error: "invalid url" });
      return;
    }
    if (target.protocol !== "https:" || !TILE_HOSTS.some((re) => re.test(target.hostname))) {
      res.status(403).json({ status: "error", error: "forbidden tile host" });
      return;
    }
    const key = target.toString();
    const hit = tileCache.get(key);
    if (hit) {
      res.set({ "content-type": hit.type, "cache-control": "public, max-age=31536000, immutable" });
      res.send(hit.body);
      return;
    }
    try {
      const upstream = await fetch(key, {
        headers: { accept: "*/*", "user-agent": "Paperclip-WorldView-TileProxy/1.0" },
        signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        res.status(upstream.status).json({ status: "error", error: "tile fetch failed" });
        return;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      const type = upstream.headers.get("content-type") || "application/octet-stream";
      if (tileCache.size >= TILE_CACHE_MAX) {
        const oldest = tileCache.keys().next().value;
        if (oldest) tileCache.delete(oldest);
      }
      tileCache.set(key, { body, type });
      res.set({ "content-type": type, "cache-control": "public, max-age=31536000, immutable" });
      res.send(body);
    } catch (error) {
      logger.warn({ err: error, target: key }, "World View tile proxy request failed");
      res.status(502).json({ status: "error", error: "tile_upstream_unreachable" });
    }
  });

  router.get("/api/worldview/:feed", async (req, res) => {
    const upstreamPath = ROUTE_MAP[req.params.feed];
    if (!upstreamPath) {
      res.status(404).json({ status: "error", error: "unknown worldview feed" });
      return;
    }

    const target = `${COLLECTOR_BASE}${upstreamPath}`;
    try {
      const upstream = await fetch(target, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      const body = await upstream.text();
      res
        .status(upstream.status)
        .type(upstream.headers.get("content-type") || "application/json")
        .send(body);
    } catch (error) {
      logger.warn(
        { err: error, feed: req.params.feed, target },
        "World View collector proxy request failed",
      );
      res.status(502).json({
        status: "error",
        error: "worldview_collector_unreachable",
        feed: req.params.feed,
      });
    }
  });

  return router;
}
