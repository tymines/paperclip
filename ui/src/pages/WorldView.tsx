/**
 * World View — global situational-awareness tab for Paperclip.
 *
 * Clean-room reimplementation inspired by koala73/worldmonitor ("Real-time
 * global intelligence dashboard", AGPL-3.0, (C) Elie Habib). The VISUAL DESIGN
 * and LAYOUT here deliberately echo worldmonitor's command-center look (pure-
 * black canvas, monospace, map-centric hero, dense hairline panels, green/amber/
 * red signal palette) — but NO worldmonitor source is copied. This is an
 * independent Paperclip page built from scratch, so it does NOT place Paperclip
 * under AGPL. Credit to the worldmonitor project for the concept and aesthetic.
 *
 * Architecture: the heavy feed-aggregation backend is a SEPARATE, host-portable
 * service (services/worldview-collector). This tab only READS from it over the
 * network at a CONFIGURABLE base URL (VITE_WORLDVIEW_API_URL, default the same-
 * origin proxy /api/worldview) — so the collector can live on Box 1 today or
 * move later without changing this page. The seismic layer reads USGS directly
 * (public, no key, CORS-open) so the map centerpiece is real with zero backend.
 *
 * Data honesty: only real upstream feeds. Panels whose providers need an API
 * key we do not have render an explicit "NEEDS <X> KEY" status — never
 * fabricated rows. The status/threat indicators are derived strictly from real
 * seismic magnitudes and are labelled as seismic, not invented geopolitics.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Newspaper, Radio, Waves, RefreshCw, ExternalLink, AlertTriangle,
  Activity, ServerCog, Layers, Crosshair, Signal, Database,
} from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { WORLD_W, WORLD_H, WORLD_LAND_PATH, WORLD_BORDERS_PATH } from "./worldLand";

// ── war-room design tokens (pure-black command-center palette) ──────────────
const C = {
  bg: "#000000",
  panel: "#070809",
  panel2: "#0A0C0E",
  inset: "#0E1114",
  line: "#1A1D22",
  line2: "#262B31",
  text: "#E7EBF0",
  mut: "#9AA2AD",
  faint: "#5A626D",
  green: "#3DE17E",
  amber: "#F5A524",
  red: "#FF4D4D",
  cyan: "#36C5F0",
  blue: "#5B8DEF",
  ocean: "#04070B",
  land: "#141A21",
  landStroke: "#28323D",
  grid: "#10161C",
} as const;
const MONO = "'JetBrains Mono','SF Mono',ui-monospace,Menlo,Consolas,monospace";

const COLLECTOR =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WORLDVIEW_API_URL) ||
  "/api/worldview";

// ── types ─────────────────────────────────────────────────────────────────
interface FeedResp<T> { status: string; source?: string; items: T[]; note?: string | null }
interface NewsItem { title: string; url: string; source?: string; published?: string; country?: string }
interface GeoItem { title: string; url: string; source?: string; published?: string; summary?: string }
interface SourceRow { panel: string; provider: string; key: string | null; status: string; notes?: string }
interface Quake { id: string; mag: number; place: string; time: number; lon: number; lat: number; url: string }

// ── fetchers ────────────────────────────────────────────────────────────────
async function getFeed<T>(path: string): Promise<FeedResp<T>> {
  const r = await fetch(`${COLLECTOR}${path}`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`collector ${r.status}`);
  return r.json();
}
async function getSources(): Promise<{ sources: SourceRow[] }> {
  const r = await fetch(`${COLLECTOR}/sources`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`collector ${r.status}`);
  return r.json();
}
async function getQuakes(): Promise<Quake[]> {
  const r = await fetch(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
    { signal: AbortSignal.timeout(10000) },
  );
  if (!r.ok) throw new Error(`USGS ${r.status}`);
  const j = await r.json();
  return (j.features || []).map((f: {
    id: string; properties: { mag: number; place: string; time: number; url: string };
    geometry: { coordinates: number[] };
  }) => ({
    id: f.id, mag: f.properties.mag, place: f.properties.place, time: f.properties.time,
    url: f.properties.url, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
  }));
}

// ── helpers ─────────────────────────────────────────────────────────────────
function timeAgo(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function magColor(m: number) { return m >= 5 ? C.red : m >= 4 ? C.amber : C.cyan; }

// ── small UI atoms ──────────────────────────────────────────────────────────
function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      {pulse && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: color }} />}
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    </span>
  );
}

function Tag({ children, color = C.faint }: { children: ReactNode; color?: string }) {
  return (
    <span className="px-1 text-[9px] uppercase tracking-wider" style={{ color, border: `1px solid ${color}44`, lineHeight: "14px" }}>
      {children}
    </span>
  );
}

const panelStyle: CSSProperties = { background: C.panel, border: `1px solid ${C.line}` };

function Panel({ icon: Icon, title, sub, right, children, className }: {
  icon: typeof Activity; title: string; sub?: string; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section style={panelStyle} className={`flex min-h-0 flex-col ${className || ""}`}>
      <header className="flex items-center gap-2 px-2.5 py-1.5" style={{ borderBottom: `1px solid ${C.line}`, background: C.panel2 }}>
        <Icon className="h-3.5 w-3.5" style={{ color: C.green }} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: C.text }}>{title}</h3>
        {sub && <span className="truncate text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>{sub}</span>}
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

function Offline({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center">
      <ServerCog className="h-6 w-6" style={{ color: C.faint }} />
      <p className="text-[11px] uppercase tracking-wider" style={{ color: C.amber }}>{what}</p>
      <p className="text-[10px]" style={{ color: C.faint }}>
        node services/worldview-collector/server.mjs &nbsp;·&nbsp; or set VITE_WORLDVIEW_API_URL
      </p>
      <p className="text-[10px]" style={{ color: C.faint }}>endpoint: <code style={{ color: C.cyan }}>{COLLECTOR}</code></p>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <p className="px-3 py-4 text-[11px] uppercase tracking-wider" style={{ color: C.faint }}>··· {label}</p>;
}

// ── live local clock (America/New_York) ─────────────────────────────────────
function useLocalClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long", month: "short", day: "2-digit", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
    hour12: true, timeZoneName: "short",
  }).format(now).toUpperCase();
}

// ── world map centerpiece (real continents + live USGS seismic layer) ───────
function WorldMap({ quakes, layers }: {
  quakes: Quake[];
  layers: { seismic: boolean; major: boolean; grid: boolean; borders: boolean };
}) {
  const px = (lon: number) => ((lon + 180) / 360) * WORLD_W;
  const py = (lat: number) => ((90 - lat) / 180) * WORLD_H;
  const lons = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
  const lats = [-60, -30, 0, 30, 60];
  const shown = quakes.filter((q) => (q.mag >= 5 ? layers.major : layers.seismic));
  return (
    <svg viewBox={`0 0 ${WORLD_W} ${WORLD_H}`} preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full" style={{ background: C.ocean }}>
      <rect x={0} y={0} width={WORLD_W} height={WORLD_H} fill={C.ocean} />
      {layers.grid && (
        <g opacity={0.5}>
          {lons.map((lon) => <line key={`v${lon}`} x1={px(lon)} y1={0} x2={px(lon)} y2={WORLD_H} stroke={C.grid} strokeWidth={1} />)}
          {lats.map((lat) => <line key={`h${lat}`} x1={0} y1={py(lat)} x2={WORLD_W} y2={py(lat)} stroke={C.grid} strokeWidth={1} />)}
          <line x1={0} y1={py(0)} x2={WORLD_W} y2={py(0)} stroke={C.line} strokeWidth={1} />
        </g>
      )}
      <path d={WORLD_LAND_PATH} fill={C.land} stroke={C.landStroke} strokeWidth={0.6} strokeLinejoin="round" />
      {layers.borders && <path d={WORLD_BORDERS_PATH} fill="none" stroke={C.landStroke} strokeWidth={0.4} opacity={0.7} />}
      {shown.map((q) => {
        const x = px(q.lon), y = py(q.lat), col = magColor(q.mag);
        return (
          <g key={q.id}>
            <circle cx={x} cy={y} r={Math.max(3, q.mag * 2.2)} fill={col} opacity={0.13}>
              {q.mag >= 5 && <animate attributeName="opacity" values="0.05;0.22;0.05" dur="2.4s" repeatCount="indefinite" />}
            </circle>
            <circle cx={x} cy={y} r={Math.max(1.3, q.mag * 0.85)} fill={col} opacity={0.95} stroke={col} strokeWidth={0.4}>
              <title>{`M${q.mag} — ${q.place}`}</title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export function WorldView() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "World View" }]); }, [setBreadcrumbs]);
  const clock = useLocalClock();

  const [layers, setLayers] = useState({ seismic: true, major: true, grid: true, borders: true });
  const toggle = (k: keyof typeof layers) => setLayers((s) => ({ ...s, [k]: !s[k] }));

  const news = useQuery({ queryKey: ["worldview", "news"], queryFn: () => getFeed<NewsItem>("/news"), refetchInterval: 120000, retry: 0 });
  const geo = useQuery({ queryKey: ["worldview", "geo"], queryFn: () => getFeed<GeoItem>("/geopolitical"), refetchInterval: 120000, retry: 0 });
  const sources = useQuery({ queryKey: ["worldview", "sources"], queryFn: getSources, staleTime: 600000, retry: 0 });
  const quakes = useQuery({ queryKey: ["worldview", "quakes"], queryFn: getQuakes, refetchInterval: 120000, retry: 1 });

  const collectorUp = !news.isError || !geo.isError;
  const qk = quakes.data || [];
  const maxMag = qk.reduce((m, q) => Math.max(m, q.mag), 0);
  const seismicLevel = maxMag >= 6 ? { label: "ELEVATED", color: C.red } : maxMag >= 5 ? { label: "WATCH", color: C.amber } : { label: "NOMINAL", color: C.green };
  const srcRows = sources.data?.sources || [];
  const liveCount = srcRows.filter((s) => String(s.status).toLowerCase().includes("live")).length;

  return (
    <div className="flex min-h-full flex-col" style={{ background: C.bg, fontFamily: MONO, color: C.text }} data-pp-page-v3="world-view">

      {/* ── command bar ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5" style={{ borderBottom: `1px solid ${C.line}`, background: C.panel2 }}>
        <div className="flex items-center gap-2">
          <span style={{ color: C.green }}>◢</span>
          <span className="text-[12px] font-bold uppercase tracking-[0.22em]" style={{ color: C.text }}>World&nbsp;Monitor</span>
          <span className="text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>v1 · paperclip</span>
        </div>
        <div className="order-last w-full text-center text-[11px] tracking-[0.18em] md:order-none md:w-auto md:flex-1" style={{ color: C.mut }}>
          {clock}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: collectorUp ? C.green : C.red }}>
            <Dot color={collectorUp ? C.green : C.red} pulse={collectorUp} />{collectorUp ? "LIVE" : "OFFLINE"}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: seismicLevel.color, border: `1px solid ${seismicLevel.color}55`, padding: "1px 6px" }}>
            SEISMIC {seismicLevel.label}
          </span>
          <code className="hidden text-[9px] sm:inline" style={{ color: C.faint }}>{COLLECTOR}</code>
        </div>
      </div>

      {/* ── GLOBAL SITUATION map ── */}
      <section style={{ borderBottom: `1px solid ${C.line}`, background: C.panel }}>
        <header className="flex items-center gap-2 px-2.5 py-1.5" style={{ borderBottom: `1px solid ${C.line}` }}>
          <Crosshair className="h-3.5 w-3.5" style={{ color: C.green }} />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: C.text }}>Global Situation</h2>
          <span className="ml-auto flex items-center gap-3 text-[10px] uppercase tracking-wider" style={{ color: C.faint }}>
            <span style={{ color: C.green, border: `1px solid ${C.green}55`, padding: "0px 5px" }}>2D</span>
            <span className="flex items-center gap-1.5"><Dot color={C.cyan} />{qk.length} EVENTS · 24H</span>
          </span>
        </header>

        <div className="relative w-full overflow-hidden" style={{ height: "min(54vh, 560px)", minHeight: 320, background: C.ocean }}>
          {quakes.isError
            ? <div className="flex h-full items-center justify-center text-[11px] uppercase tracking-wider" style={{ color: C.red }}>USGS feed unreachable</div>
            : <WorldMap quakes={qk} layers={layers} />}

          {/* layers overlay */}
          <div className="absolute left-2 top-2 w-[148px]" style={{ background: "rgba(5,7,10,0.82)", border: `1px solid ${C.line2}`, backdropFilter: "blur(2px)" }}>
            <div className="flex items-center gap-1.5 px-2 py-1" style={{ borderBottom: `1px solid ${C.line}` }}>
              <Layers className="h-3 w-3" style={{ color: C.green }} />
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: C.mut }}>Layers</span>
            </div>
            <div className="flex flex-col gap-0.5 p-1.5">
              {([
                ["seismic", "Seismic M2.5+", C.cyan],
                ["major", "Major M5.0+", C.red],
                ["grid", "Lat/Lon Grid", C.faint],
                ["borders", "Borders", C.faint],
              ] as const).map(([k, label, col]) => (
                <button key={k} onClick={() => toggle(k as keyof typeof layers)}
                  className="flex items-center gap-1.5 px-1 py-0.5 text-left text-[10px] uppercase tracking-wider"
                  style={{ color: layers[k as keyof typeof layers] ? C.text : C.faint }}>
                  <span className="flex h-2.5 w-2.5 items-center justify-center" style={{ border: `1px solid ${layers[k as keyof typeof layers] ? C.green : C.line2}`, background: layers[k as keyof typeof layers] ? `${C.green}22` : "transparent" }}>
                    {layers[k as keyof typeof layers] && <span style={{ color: C.green, fontSize: 8, lineHeight: "8px" }}>✓</span>}
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: col }} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* live tag top-right */}
          <div className="absolute right-2 top-2 flex items-center gap-1.5 px-2 py-1 text-[9px] uppercase tracking-wider"
            style={{ background: "rgba(5,7,10,0.82)", border: `1px solid ${C.line2}`, color: C.mut }}>
            <Signal className="h-3 w-3" style={{ color: C.green }} /> USGS · M2.5+ / 24H
          </div>

          {/* legend bottom-center */}
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-3 px-3 py-1 text-[9px] uppercase tracking-wider"
            style={{ background: "rgba(5,7,10,0.82)", border: `1px solid ${C.line2}`, color: C.mut }}>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: C.red }} />M5.0+ Major</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: C.amber }} />M4–5</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: C.cyan }} />M2.5–4</span>
          </div>
        </div>
      </section>

      {/* ── intel grid: news / geopolitical / seismic feed ── */}
      <div className="grid gap-px lg:grid-cols-3" style={{ background: C.line }}>
        <Panel icon={Newspaper} title="Live News" sub={news.data?.source || "GDELT / Google News"}
          right={<button onClick={() => news.refetch()} style={{ color: C.faint }} aria-label="refresh"><RefreshCw className="h-3 w-3" /></button>}>
          {news.isError ? <Offline what="Collector offline — news feed down" /> :
            news.isLoading ? <Loading label="acquiring news feed" /> :
            <ul className="flex flex-col">
              {(news.data?.items || []).slice(0, 16).map((n, i) => (
                <li key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
                  <a href={n.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 px-2.5 py-1.5 hover:bg-white/[0.02]">
                    <Radio className="mt-0.5 h-3 w-3 shrink-0" style={{ color: C.green }} />
                    <span className="flex-1 text-[11px] leading-snug" style={{ color: C.text }}>
                      {n.title}{" "}<span className="text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>{n.source}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>}
          {news.data?.note && <p className="px-2.5 py-1.5 text-[9px] uppercase tracking-wider" style={{ color: C.amber }}>⚠ {news.data.note}</p>}
        </Panel>

        <Panel icon={Activity} title="Geopolitical Monitor" sub={geo.data?.source || "Public RSS"}
          right={<button onClick={() => geo.refetch()} style={{ color: C.faint }} aria-label="refresh"><RefreshCw className="h-3 w-3" /></button>}>
          {geo.isError ? <Offline what="Collector offline — geo feed down" /> :
            geo.isLoading ? <Loading label="acquiring geo feed" /> :
            <ul className="flex flex-col">
              {(geo.data?.items || []).slice(0, 18).map((g, i) => (
                <li key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
                  <a href={g.url} target="_blank" rel="noreferrer" className="block px-2.5 py-1.5 hover:bg-white/[0.02]">
                    <p className="text-[11px] font-medium leading-snug" style={{ color: C.text }}>{g.title}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>
                      <span style={{ color: C.cyan }}>{g.source}</span>{g.published ? `· ${g.published}` : ""}
                    </p>
                  </a>
                </li>
              ))}
            </ul>}
        </Panel>

        <Panel icon={Waves} title="Seismic Feed" sub="USGS M2.5+ / 24H"
          right={<span className="text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>{qk.length} EVT</span>}>
          {quakes.isError ? <p className="px-3 py-4 text-[11px] uppercase tracking-wider" style={{ color: C.red }}>USGS unreachable</p> :
            quakes.isLoading ? <Loading label="acquiring usgs" /> :
            <ul className="flex flex-col">
              {qk.slice().sort((a, b) => b.time - a.time).slice(0, 28).map((q) => (
                <li key={q.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                  <a href={q.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-2.5 py-1 hover:bg-white/[0.02]">
                    <span className="flex h-4 w-8 items-center justify-center text-[9px] font-bold" style={{ color: magColor(q.mag), border: `1px solid ${magColor(q.mag)}55` }}>
                      M{q.mag.toFixed(1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[10px]" style={{ color: C.text }}>{q.place}</span>
                    <span className="text-[9px]" style={{ color: C.faint }}>{timeAgo(q.time)}</span>
                  </a>
                </li>
              ))}
            </ul>}
        </Panel>
      </div>

      {/* ── data sources status board ── */}
      <div className="px-px pb-px" style={{ background: C.line }}>
        <Panel icon={Database} title="Data Sources" sub={`${liveCount} live · ${srcRows.length} tracked`}>
          {sources.isError ? <Offline what="Collector offline — cannot enumerate sources" /> :
            !srcRows.length ? <Loading label="loading source catalog" /> :
            <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3" style={{ background: C.line }}>
              {srcRows.map((s, i) => {
                const isLive = String(s.status).toLowerCase().includes("live");
                const needsKey = String(s.status).toLowerCase().includes("needs");
                const col = isLive ? C.green : needsKey ? C.amber : C.faint;
                return (
                  <div key={i} className="flex items-start gap-2 px-2.5 py-1.5" style={{ background: C.panel }}>
                    {needsKey ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" style={{ color: C.amber }} /> : <Dot color={col} pulse={isLive} />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-semibold" style={{ color: C.text }}>{s.panel}</p>
                      <p className="truncate text-[9px]" style={{ color: C.faint }}>{s.provider}</p>
                    </div>
                    <Tag color={col}>{isLive ? "LIVE" : needsKey ? `NEEDS ${s.key || "KEY"}` : s.status}</Tag>
                  </div>
                );
              })}
            </div>}
        </Panel>
      </div>

      {/* ── footer credit ── */}
      <footer className="flex items-center gap-1.5 px-3 py-2 text-[9px] uppercase tracking-wider" style={{ color: C.faint, background: C.panel2, borderTop: `1px solid ${C.line}` }}>
        <ExternalLink className="h-3 w-3" />
        Design &amp; concept credit:&nbsp;
        <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noreferrer" style={{ color: C.green }}>koala73/worldmonitor</a>
        &nbsp;(AGPL-3.0). Independent clean-room build · map: Natural Earth (public domain).
      </footer>
    </div>
  );
}

export default WorldView;
