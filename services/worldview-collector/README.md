# World View Collector

A **separable, host-portable** data backend for Paperclip's **World View** tab.

It is its own process with **zero npm dependencies** (Node >= 18 built-ins +
global `fetch` only). That means it can run on **Box 1 (Augi)** today via
`node server.mjs`, or be moved to **Box 2 (augibot2)** later **without touching
the Paperclip web app** — the tab simply points `VITE_WORLDVIEW_API_URL` at
wherever this service listens (e.g. a tailnet address on Box 2).

## Run

```bash
node services/worldview-collector/server.mjs
# or: WORLDVIEW_PORT=8788 WORLDVIEW_POLL_MS=300000 node server.mjs
```

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `WORLDVIEW_PORT` | `8788` | Listen port |
| `WORLDVIEW_HOST` | `0.0.0.0` | LAN bind; firewall port 8788 to the Paperclip host only at deploy time |
| `WORLDVIEW_POLL_MS` | `300000` | Upstream refresh interval (5 min) |
| `WORLDVIEW_HISTORY_DIR` | `.history` | Compressed seven-day snapshot ring; UI exposes the latest 24h |

The Paperclip tab reads `VITE_WORLDVIEW_API_URL` (default `http://localhost:8788`).
To host on Box 2: run this there and set
`VITE_WORLDVIEW_API_URL=http://augibot2.<tailnet>.ts.net:8788` in the UI build.

## Endpoints

- `GET /health` — liveness + per-source freshness
- `GET /api/news` — global news via **GDELT DOC 2.0** (no key)
- `GET /api/geopolitical` — headlines via **public RSS** (BBC/Al Jazeera/UN/DW, no key)
- `GET /api/sources` — catalog of every feed and which API key it needs
- `GET /api/history?at=<ISO>` — nearest real USGS/FIRMS/EONET/GDELT snapshots in the prior 24h, with explicit gap markers; flights are always `live_only`

## Resource footprint (this collector)

Tiny by design: a single Node process, no DB or Redis, and a fixed small cache.
The history module writes gzip JSON snapshots and prunes files older than seven
days. No outage is backfilled; missing snapshots remain visible gaps.

## Deployment gate

`deploy/install-launchd-macos.sh` is a deployment-held artifact. It installs
KeepAlive/RunAtLoad, a `/health` watchdog, and bounded log rotation on the Mac
host Tyler selects. Host selection, LAN firewall allowlisting, server
`WORLDVIEW_COLLECTOR_URL` repoint, and Windows collector decommission remain
explicit deploy-time gates and are not performed by this repository change.

## Data honesty

Only **real** upstream feeds are served. Panels whose providers need an API key
we do not have return `status:"needs_key"` and **no fabricated rows**. See
`/api/sources` for the full key list.

## Attribution & license

Inspired by **[koala73/worldmonitor](https://github.com/koala73/worldmonitor)**
("Real-time global intelligence dashboard", AGPL-3.0, (C) Elie Habib). This
collector is an **independent clean-room reimplementation** — no worldmonitor
source code is copied — so it does not place Paperclip under AGPL. Credit to the
worldmonitor project for the concept and the data-source map.
