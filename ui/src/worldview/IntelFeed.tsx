/** World View  right intel drawer: News / Geopolitical / SITREP (TYL-131). */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, Radio, Activity, RefreshCw, ChevronRight } from "lucide-react";
import { C } from "./theme";
import { Loading, Offline } from "./atoms";
import { fetchNews, fetchGeo } from "./fetchers";
import { COLLECTOR } from "./theme";

type Tab = "news" | "geo" | "sitrep";

async function fetchBrief() {
  const r = await fetch(`${COLLECTOR}/brief`, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`brief ${r.status}`);
  return r.json();
}

export function IntelFeed({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [tab, setTab] = useState<Tab>("news");
  const news = useQuery({ queryKey: ["worldview", "news"], queryFn: fetchNews, refetchInterval: 120000, retry: 0, enabled: open });
  const geo = useQuery({ queryKey: ["worldview", "geo"], queryFn: fetchGeo, refetchInterval: 120000, retry: 0, enabled: open });
  const brief = useQuery({ queryKey: ["worldview", "brief"], queryFn: fetchBrief, refetchInterval: 300000, retry: 0, enabled: open && tab === "sitrep" });

  if (!open) {
    return (
      <button onClick={onToggle}
        className="flex h-full w-7 flex-col items-center justify-center gap-2"
        style={{ background: "rgba(5,7,10,0.86)", borderLeft: `1px solid ${C.line2}`, color: C.mut }}>
        <ChevronRight className="h-3.5 w-3.5 rotate-180" />
        <span className="text-[9px] uppercase tracking-[0.2em]" style={{ writingMode: "vertical-rl" }}>Intel</span>
      </button>
    );
  }

  return (
    <div className="flex h-full w-[300px] flex-col" style={{ background: "rgba(5,7,10,0.92)", borderLeft: `1px solid ${C.line2}`, backdropFilter: "blur(3px)" }}>
      <div className="flex items-center" style={{ borderBottom: `1px solid ${C.line}` }}>
        {([["news", "News", Newspaper], ["geo", "Geo", Activity], ["sitrep", "SITREP", Radio]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex flex-1 items-center justify-center gap-1 py-1.5 text-[10px] uppercase tracking-wider"
            style={{ color: tab === id ? C.green : C.faint, borderBottom: tab === id ? `1px solid ${C.green}` : "1px solid transparent" }}>
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
        <button onClick={onToggle} className="px-2" style={{ color: C.faint }} title="Collapse"><ChevronRight className="h-3.5 w-3.5" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "news" && (
          news.isError ? <Offline what="News feed offline" hint="collector /news unreachable" /> :
          news.isLoading ? <Loading label="acquiring news" /> :
          <ul className="flex flex-col">
            {(news.data?.items || []).slice(0, 20).map((n, i) => (
              <li key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
                <a href={n.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 px-2.5 py-1.5 hover:bg-white/[0.02]">
                  <Radio className="mt-0.5 h-3 w-3 shrink-0" style={{ color: C.green }} />
                  <span className="flex-1 text-[11px] leading-snug" style={{ color: C.text }}>
                    {n.title} <span className="text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>{n.source}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        {tab === "geo" && (
          geo.isError ? <Offline what="Geo feed offline" hint="collector /geopolitical unreachable" /> :
          geo.isLoading ? <Loading label="acquiring geo" /> :
          <ul className="flex flex-col">
            {(geo.data?.items || []).slice(0, 22).map((g, i) => (
              <li key={i} style={{ borderBottom: `1px solid ${C.line}` }}>
                <a href={g.url} target="_blank" rel="noreferrer" className="block px-2.5 py-1.5 hover:bg-white/[0.02]">
                  <p className="text-[11px] font-medium leading-snug" style={{ color: C.text }}>{g.title}</p>
                  <p className="mt-0.5 text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>
                    <span style={{ color: C.cyan }}>{g.source}</span>{g.published ? `  ${g.published}` : ""}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        )}
        {tab === "sitrep" && (
          brief.isError ? <Offline what="SITREP needs GROQ key" hint="collector /brief returns needs_key without a provider" /> :
          brief.isLoading ? <Loading label="synthesizing brief" /> :
          <div className="px-2.5 py-2 text-[11px] leading-relaxed" style={{ color: C.text }}>
            {brief.data?.items?.[0]?.text || brief.data?.text || (
              <Offline what="No brief available" hint="feed is live once a provider key is set" />
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-2.5 py-1" style={{ borderTop: `1px solid ${C.line}` }}>
        <button onClick={() => { news.refetch(); geo.refetch(); brief.refetch(); }} style={{ color: C.faint }} title="Refresh">
          <RefreshCw className="h-3 w-3" />
        </button>
        <span className="text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>
          {tab === "news" ? news.data?.source : tab === "geo" ? geo.data?.source : "AI SITREP"}
        </span>
      </div>
    </div>
  );
}
