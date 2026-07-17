/** World View  top status bar (TYL-131). */
import { Maximize2, RotateCcw, HelpCircle, Globe2, Map as MapIcon } from "lucide-react";
import { C } from "./theme";
import { Dot } from "./atoms";
import type { Projection, Basemap } from "./MapCanvas";
import type { SwpcState } from "./types";

interface Props {
  zulu: string;
  feedsLive: number;
  feedsTotal: number;
  seismic: { label: string; color: string };
  swpc: SwpcState | null;
  projection: Projection;
  basemap: Basemap;
  onProjection: (p: Projection) => void;
  onBasemap: (b: Basemap) => void;
  onReset: () => void;
  onFullscreen: () => void;
  onShortcuts: () => void;
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
      style={{
        color: active ? C.bg : C.mut,
        background: active ? C.green : "transparent",
        border: `1px solid ${active ? C.green : C.line2}`,
      }}
    >
      {children}
    </button>
  );
}

export function StatusBar({
  zulu, feedsLive, feedsTotal, seismic, swpc, projection, basemap,
  onProjection, onBasemap, onReset, onFullscreen, onShortcuts,
}: Props) {
  const swpcColor =
    swpc?.level === "severe" ? C.red : swpc?.level === "storm" ? C.amber : swpc?.level === "active" ? C.cyan : C.green;
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5"
      style={{ borderBottom: `1px solid ${C.line}`, background: C.panel2 }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: C.green }}></span>
        <span className="text-[12px] font-bold uppercase tracking-[0.22em]" style={{ color: C.text }}>
          World&nbsp;View
        </span>
        <span className="text-[9px] uppercase tracking-wider" style={{ color: C.faint }}>v2  osiris</span>
      </div>

      <div className="order-last w-full text-center text-[11px] tracking-[0.2em] md:order-none md:w-auto md:flex-1"
        style={{ color: C.mut }}>
        {zulu}
      </div>

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider"
          style={{ color: feedsLive ? C.green : C.faint }}>
          <Dot color={feedsLive ? C.green : C.faint} pulse={feedsLive > 0} />
          {feedsLive}/{feedsTotal} FEEDS
        </span>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider"
          style={{ color: seismic.color, border: `1px solid ${seismic.color}55`, padding: "1px 6px" }}>
          SEISMIC {seismic.label}
        </span>
        {swpc?.kp != null && (
          <span className="hidden items-center gap-1.5 text-[10px] uppercase tracking-wider sm:flex"
            style={{ color: swpcColor, border: `1px solid ${swpcColor}55`, padding: "1px 6px" }}>
            KP {swpc.kp.toFixed(1)}
          </span>
        )}

        <div className="flex items-center gap-1">
          <Seg active={projection === "globe"} onClick={() => onProjection("globe")}><Globe2 className="inline h-2.5 w-2.5" /> 3D</Seg>
          <Seg active={projection === "mercator"} onClick={() => onProjection("mercator")}>2D</Seg>
        </div>
        <div className="flex items-center gap-1">
          <Seg active={basemap === "map"} onClick={() => onBasemap("map")}><MapIcon className="inline h-2.5 w-2.5" /> MAP</Seg>
          <Seg active={basemap === "sat"} onClick={() => onBasemap("sat")}>SAT</Seg>
        </div>

        <button onClick={onReset} title="Reset view [R]" style={{ color: C.faint }}><RotateCcw className="h-3 w-3" /></button>
        <button onClick={onFullscreen} title="Fullscreen [F]" style={{ color: C.faint }}><Maximize2 className="h-3 w-3" /></button>
        <button onClick={onShortcuts} title="Shortcuts [?]" style={{ color: C.faint }}><HelpCircle className="h-3 w-3" /></button>
      </div>
    </div>
  );
}
