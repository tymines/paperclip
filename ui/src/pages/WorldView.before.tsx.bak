/**
 * World View — global situational-awareness tab for Paperclip.
 *
 * Clean-room reimplementation inspired by koala73/worldmonitor ("Real-time
 * global intelligence dashboard", AGPL-3.0, (C) Elie Habib). No worldmonitor
 * source is copied; this is an independent Paperclip page, so it does NOT place
 * Paperclip under AGPL. Credit to the worldmonitor project for the concept.
 *
 * Architecture: the heavy feed-aggregation backend is a SEPARATE, host-portable
 * service (services/worldview-collector). This tab only READS from it over the
 * network at a CONFIGURABLE base URL (VITE_WORLDVIEW_API_URL, default
 * the same-origin proxy /api/worldview) — so the collector can live on Box 1 today or move to
 * Box 2 later without changing this page. The seismic panel reads USGS directly
 * (public, no key, CORS-open) so at least one panel is real with zero backend.
 *
 * Data honesty: only real upstream feeds. Panels whose providers need an API
 * key we do not have render an explicit "needs <X> key" empty state — never
 * fabricated rows.
 */
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Globe, Newspaper, Radio, Waves, KeyRound, RefreshCw, ExternalLink,
  AlertTriangle, Activity, ServerCog,
} from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

// ── locked blue design system (mirrors the palette used across Paperclip v2) ──
const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warn: "#FFB020",
  critical: "#FF5B5B",
} as const;

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

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
  // USGS — real, no key, CORS-open. Magnitude 2.5+ past 24h.
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

// ── small UI atoms ────────────────────────────────────────────────────────
function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  const c = ok ? DS.success : DS.critical;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `${c}1F`, color: c, border: `1px solid ${c}33` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{label}
    </span>
  );
}

function PanelShell({ icon: Icon, title, subtitle, right, children }: {
  icon: typeof Globe; title: string; subtitle?: string; right?: ReactNode; children: ReactNode;
}) {
  return (
    <section style={surfaceCard} className="flex min-h-[260px] flex-col overflow-hidden">
      <header className="flex items-center gap-2.5 border-b px-4 py-3" style={{ borderColor: DS.border }}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: `${DS.primary}1A`, border: `1px solid ${DS.border2}` }}>
          <Icon className="h-4 w-4" style={{ color: DS.primary }} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold" style={{ color: DS.text }}>{title}</h3>
          {subtitle && <p className="truncate text-[11px]" style={{ color: DS.textFaint }}>{subtitle}</p>}
        </div>
        {right}
      </header>
      <div className="flex-1 overflow-auto p-3">{children}</div>
    </section>
  );
}

function Unreachable({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <ServerCog className="h-8 w-8" style={{ color: DS.textFaint }} />
      <p className="text-xs" style={{ color: DS.textMuted }}>{what}</p>
      <p className="text-[11px]" style={{ color: DS.textFaint }}>
        Start it with <code style={{ color: DS.primary }}>node services/worldview-collector/server.mjs</code>,
        or point <code style={{ color: DS.primary }}>VITE_WORLDVIEW_API_URL</code> at its host (e.g. Box 2).
      </p>
      <p className="text-[11px]" style={{ color: DS.textFaint }}>Currently: <code>{COLLECTOR}</code></p>
    </div>
  );
}

function timeAgo(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── seismic equirectangular plot (real lon/lat, dependency-free) ────────────
function QuakeMap({ quakes }: { quakes: Quake[] }) {
  const W = 360, H = 180;
  const px = (lon: number) => ((lon + 180) / 360) * W;
  const py = (lat: number) => ((90 - lat) / 180) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg" style={{ background: DS.surface3, border: `1px solid ${DS.border}` }}>
      {/* graticule */}
      {[-120, -60, 0, 60, 120].map((lon) => (
        <line key={`v${lon}`} x1={px(lon)} y1={0} x2={px(lon)} y2={H} stroke={DS.border2} strokeWidth={0.3} />
      ))}
      {[-60, -30, 0, 30, 60].map((lat) => (
        <line key={`h${lat}`} x1={0} y1={py(lat)} x2={W} y2={py(lat)} stroke={DS.border2} strokeWidth={0.3} />
      ))}
      <line x1={0} y1={py(0)} x2={W} y2={py(0)} stroke={DS.border2} strokeWidth={0.6} />
      {quakes.map((q) => (
        <circle key={q.id} cx={px(q.lon)} cy={py(q.lat)} r={Math.max(1.2, q.mag * 0.9)}
          fill={q.mag >= 5 ? `${DS.critical}` : DS.warn} fillOpacity={0.55}
          stroke={q.mag >= 5 ? DS.critical : DS.warn} strokeWidth={0.4}>
          <title>{`M${q.mag} — ${q.place}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export function WorldView() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { setBreadcrumbs([{ label: "World View" }]); }, [setBreadcrumbs]);

  const news = useQuery({ queryKey: ["worldview", "news"], queryFn: () => getFeed<NewsItem>("/news"), refetchInterval: 120000, retry: 0 });
  const geo = useQuery({ queryKey: ["worldview", "geo"], queryFn: () => getFeed<GeoItem>("/geopolitical"), refetchInterval: 120000, retry: 0 });
  const sources = useQuery({ queryKey: ["worldview", "sources"], queryFn: getSources, staleTime: 600000, retry: 0 });
  const quakes = useQuery({ queryKey: ["worldview", "quakes"], queryFn: getQuakes, refetchInterval: 120000, retry: 1 });

  const collectorUp = !news.isError || !geo.isError;
  const needKey = (sources.data?.sources || []).filter((s) => String(s.status).includes("needs"));

  return (
    <div className="flex min-h-full flex-col gap-5 p-8" style={{ background: DS.canvas }} data-pp-page-v2="world-view">
      {/* header */}
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: `${DS.primary}1A`, border: `1px solid ${DS.border2}` }}>
          <Globe className="h-5 w-5" style={{ color: DS.primary }} />
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-semibold" style={{ color: DS.text }}>World View</h1>
          <p className="text-xs" style={{ color: DS.textFaint }}>
            Real-time global intelligence — news, geopolitics & infrastructure. Inspired by worldmonitor (AGPL-3.0); data via the host-portable collector + USGS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill ok={collectorUp} label={collectorUp ? "collector online" : "collector offline"} />
          <code className="text-[11px]" style={{ color: DS.textFaint }}>{COLLECTOR}</code>
        </div>
      </header>

      {/* top row: news + geopolitical */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PanelShell icon={Newspaper} title="Global News" subtitle={news.data?.source || "GDELT / Google News (no key)"}
          right={<button onClick={() => news.refetch()} className="rounded-md p-1" style={{ color: DS.textFaint }} aria-label="refresh"><RefreshCw className="h-3.5 w-3.5" /></button>}>
          {news.isError ? <Unreachable what="World View collector unreachable — Global News needs the collector service." /> :
            news.isLoading ? <p className="text-xs" style={{ color: DS.textFaint }}>Loading…</p> :
            <ul className="flex flex-col gap-2">
              {(news.data?.items || []).slice(0, 14).map((n, i) => (
                <li key={i}>
                  <a href={n.url} target="_blank" rel="noreferrer" className="group flex items-start gap-2">
                    <Radio className="mt-0.5 h-3 w-3 shrink-0" style={{ color: DS.primary }} />
                    <span className="text-xs leading-snug" style={{ color: DS.text }}>
                      {n.title}
                      <span className="ml-1.5 text-[10px]" style={{ color: DS.textFaint }}>{n.source}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>}
          {news.data?.note && <p className="mt-2 text-[10px]" style={{ color: DS.warn }}>{news.data.note}</p>}
        </PanelShell>

        <PanelShell icon={Activity} title="Geopolitical Monitor" subtitle={geo.data?.source || "Public RSS (no key)"}
          right={<button onClick={() => geo.refetch()} className="rounded-md p-1" style={{ color: DS.textFaint }} aria-label="refresh"><RefreshCw className="h-3.5 w-3.5" /></button>}>
          {geo.isError ? <Unreachable what="World View collector unreachable — Geopolitical Monitor needs the collector service." /> :
            geo.isLoading ? <p className="text-xs" style={{ color: DS.textFaint }}>Loading…</p> :
            <ul className="flex flex-col gap-2.5">
              {(geo.data?.items || []).slice(0, 16).map((g, i) => (
                <li key={i} className="border-b pb-2" style={{ borderColor: DS.border }}>
                  <a href={g.url} target="_blank" rel="noreferrer" className="block">
                    <p className="text-xs font-medium leading-snug" style={{ color: DS.text }}>{g.title}</p>
                    <p className="mt-0.5 text-[10px]" style={{ color: DS.textFaint }}>{g.source}{g.published ? ` · ${g.published}` : ""}</p>
                  </a>
                </li>
              ))}
            </ul>}
        </PanelShell>
      </div>

      {/* seismic */}
      <PanelShell icon={Waves} title="Seismic & Natural Hazards" subtitle="USGS Earthquakes M2.5+ / 24h — live, no key (read direct)"
        right={quakes.data ? <span className="text-[11px]" style={{ color: DS.textFaint }}>{quakes.data.length} events</span> : null}>
        {quakes.isError ? <p className="text-xs" style={{ color: DS.critical }}>USGS feed unreachable.</p> :
          quakes.isLoading ? <p className="text-xs" style={{ color: DS.textFaint }}>Loading USGS…</p> :
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <QuakeMap quakes={quakes.data || []} />
            <ul className="flex max-h-[260px] flex-col gap-1.5 overflow-auto">
              {(quakes.data || []).slice(0, 24).map((q) => (
                <li key={q.id} className="flex items-center gap-2">
                  <span className="flex h-5 w-9 items-center justify-center rounded text-[10px] font-bold"
                    style={{ background: q.mag >= 5 ? `${DS.critical}22` : `${DS.warn}22`, color: q.mag >= 5 ? DS.critical : DS.warn }}>
                    M{q.mag.toFixed(1)}
                  </span>
                  <a href={q.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[11px]" style={{ color: DS.text }}>{q.place}</a>
                  <span className="text-[10px]" style={{ color: DS.textFaint }}>{timeAgo(q.time)}</span>
                </li>
              ))}
            </ul>
          </div>}
      </PanelShell>

      {/* feeds needing keys — honest empty states */}
      <PanelShell icon={KeyRound} title="Feeds requiring an API key"
        subtitle="Honest empty states — provision a key to light these up. Source: collector /api/sources">
        {sources.isError ? <Unreachable what="Collector unreachable — cannot list key-gated feeds." /> :
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {needKey.map((s, i) => (
              <div key={i} className="rounded-lg p-3" style={{ background: DS.surface3, border: `1px dashed ${DS.border2}` }}>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" style={{ color: DS.warn }} />
                  <p className="text-xs font-semibold" style={{ color: DS.text }}>{s.panel}</p>
                </div>
                <p className="mt-1 text-[11px]" style={{ color: DS.textMuted }}>{s.provider}</p>
                <p className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: `${DS.warn}14`, color: DS.warn }}>
                  needs {s.key}
                </p>
              </div>
            ))}
            {!needKey.length && <p className="text-xs" style={{ color: DS.textFaint }}>Loading source catalog…</p>}
          </div>}
      </PanelShell>

      <footer className="flex items-center gap-1.5 pt-1 text-[11px]" style={{ color: DS.textFaint }}>
        <ExternalLink className="h-3 w-3" />
        Concept &amp; data-source map credit:&nbsp;
        <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noreferrer" style={{ color: DS.primary }}>koala73/worldmonitor</a>
        &nbsp;(AGPL-3.0). This page is an independent clean-room reimplementation.
      </footer>
    </div>
  );
}

export default WorldView;
