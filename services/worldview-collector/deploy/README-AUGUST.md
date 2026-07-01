# World View Collector — Box 2 (augibot2) Deploy Package

Hi August 👋 — this is a tiny data service for Tyler's Paperclip "World View" tab.
The tab runs on Box 1 and just **reads** from this collector over Tailscale. We'd
like to run the collector on **augibot2** to keep the feed-polling off Augi's box.

## Resource footprint (confirm augibot2 has room — it's tiny)

| Resource | Cost |
|----------|------|
| Process | **1** Node process, **zero npm dependencies** |
| RAM | ~40–60 MB RSS idle |
| CPU | ~0 between polls; one short upstream burst every 5 min |
| Disk | source files only (~25 KB). No DB, no Redis, no cache files |
| Network | outbound: GDELT + Google News + a few RSS feeds every 5 min. inbound: serves JSON on one port |
| Node | requires Node **>= 18** (uses built-in `fetch`) |

This is NOT the full worldmonitor stack (that's a 4-container Redis/relay/Convex
system). This is a lightweight clean-room collector that only powers the panels
we actually use. So augibot2 needs almost nothing to run it.

## Install (macOS — keeps it running across reboots)

```bash
# 1. Put this folder somewhere on augibot2, e.g. ~/worldview-collector
# 2. Make sure Node 18+ is installed:  node -v
# 3. Install as a background service:
./deploy/install-launchd-macos.sh
# 4. Confirm it's up:
curl -s http://localhost:8788/health
```

Linux box instead? Use `deploy/worldview-collector.service` (systemd) — see the
comments at the top of that file. Or just run `./deploy/start.sh` under tmux.

## What port / address does Box 1 use?

- Listens on **0.0.0.0:8788** (override with `WORLDVIEW_PORT`).
- Tailnet URL Box 1 will point at:
  `http://augibot2.<your-tailnet>.ts.net:8788`
  (find it with `tailscale status` / your MagicDNS name).
- Tyler sets `VITE_WORLDVIEW_API_URL` to that URL on Box 1.

## API keys?

**None required** for what this ships: Global News (GDELT + Google News), the
Geopolitical RSS feed, and the source catalog all run key-free. The seismic panel
is read directly by the browser from USGS (also key-free) and doesn't even touch
this service.

Optional, only if Tyler later wants the key-gated panels (conflict events, fires,
flights, vessels, markets), set any of these in the service env and we'll wire
them: `ACLED_EMAIL/PASSWORD`, `UCDP_ACCESS_TOKEN`, `NASA_FIRMS_API_KEY`,
`AVIATIONSTACK_API`, `AISSTREAM_API_KEY`, `FINNHUB_API_KEY`. Until then those
panels show an honest "needs key" state — no fake data.

## Endpoints (for sanity-checking)

- `GET /health` — liveness + freshness
- `GET /api/news` — global news (real)
- `GET /api/geopolitical` — RSS headlines (real)
- `GET /api/sources` — which feeds need which key

## Attribution

Concept inspired by koala73/worldmonitor (AGPL-3.0, © Elie Habib). This collector
is an independent clean-room reimplementation — no worldmonitor code is included.
