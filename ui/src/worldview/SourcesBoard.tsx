/** World View  data-sources status board (TYL-131). Reads /api/worldview/sources. */
import { useQuery } from "@tanstack/react-query";
import { Database, AlertTriangle, X } from "lucide-react";
import { C } from "./theme";
import { Dot, Tag, Loading, Offline } from "./atoms";
import { fetchSources } from "./fetchers";

export function SourcesBoard({ onClose }: { onClose: () => void }) {
  const sources = useQuery({ queryKey: ["worldview", "sources"], queryFn: fetchSources, staleTime: 600000, retry: 0 });
  const rows = sources.data?.sources || [];
  const live = rows.filter((s) => String(s.status).toLowerCase().includes("live")).length;

  return (
    <div className="absolute left-1/2 top-10 z-30 max-h-[70vh] w-[540px] max-w-[92vw] -translate-x-1/2 overflow-auto"
      style={{ background: "rgba(6,8,11,0.97)", border: `1px solid ${C.line2}`, backdropFilter: "blur(4px)" }}>
      <div className="sticky top-0 flex items-center gap-2 px-3 py-2" style={{ background: C.panel2, borderBottom: `1px solid ${C.line}` }}>
        <Database className="h-3.5 w-3.5" style={{ color: C.green }} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: C.text }}>Data Sources</span>
        <span className="text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>{live} live  {rows.length} tracked</span>
        <button onClick={onClose} className="ml-auto" style={{ color: C.faint }}><X className="h-3.5 w-3.5" /></button>
      </div>
      {sources.isError ? <Offline what="Collector offline" hint="cannot enumerate sources" /> :
        !rows.length ? <Loading label="loading source catalog" /> :
        <div className="grid gap-px sm:grid-cols-2" style={{ background: C.line }}>
          {rows.map((s, i) => {
            const isLive = String(s.status).toLowerCase().includes("live");
            const needsKey = String(s.status).toLowerCase().includes("needs");
            const col = isLive ? C.green : needsKey ? C.amber : C.faint;
            return (
              <div key={i} className="flex items-start gap-2 px-2.5 py-1.5" style={{ background: C.panel }}>
                {needsKey ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" style={{ color: C.amber }} /> : <Dot color={col} pulse={isLive} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-semibold" style={{ color: C.text }}>{s.panel}</p>
                  <p className="truncate text-[9px]" style={{ color: C.faint }}>{s.provider}{s.count != null ? `  ${s.count}` : ""}</p>
                </div>
                <Tag color={col}>{isLive ? "LIVE" : needsKey ? `NEEDS ${s.key || "KEY"}` : s.status}</Tag>
              </div>
            );
          })}
        </div>}
    </div>
  );
}
