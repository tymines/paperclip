import { Router } from "express";
import { logger } from "../middleware/logger.js";

/**
 * World View proxy (additive, read-only).
 *
 * The World View tab needs feed data from August's host-portable
 * `worldview-collector` (services/worldview-collector), which listens on the
 * tailnet at `augibot2s-mac-mini.tail1537c5.ts.net:8788`. That host is only
 * reachable over Tailscale — a phone on cellular hitting the PUBLIC Paperclip
 * origin (paperclip.augiport.com) cannot reach it directly.
 *
 * Box 1 IS on the tailnet, so the server fetches the collector over Tailscale
 * and returns the JSON to the browser SAME-ORIGIN. The client therefore only
 * ever talks to the public Paperclip origin via `/api/worldview/*`.
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
};

const UPSTREAM_TIMEOUT_MS = 10_000;

export function worldviewProxyRoutes(): Router {
  const router = Router();

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
