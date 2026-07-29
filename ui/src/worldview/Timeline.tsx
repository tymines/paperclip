import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { formatRelativeTime } from "./time";
import { C } from "./theme";

const DAY = 24 * 3600_000;

export function Timeline({ offsetMs, playing, gaps, onOffset, onPlay, onLive }: { offsetMs: number; playing: boolean; gaps: string[]; onOffset: (ms: number) => void; onPlay: () => void; onLive: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="absolute inset-x-0 bottom-16 z-30 flex justify-center px-3 sm:bottom-0" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)} onFocus={() => setExpanded(true)} onBlur={() => setExpanded(false)}>
      <div className="w-full max-w-[760px] transition-all duration-300" style={{ height: expanded || offsetMs > 0 ? 62 : 25, background: "linear-gradient(180deg,transparent,rgba(1,4,8,.9))" }}>
        <div className="flex h-full items-end gap-3 pb-2">
          {(expanded || offsetMs > 0) && (
            <button aria-label={playing ? "Pause history" : "Play history at 60 times speed"} onClick={onPlay} disabled={offsetMs === 0} className="mb-0.5 rounded-full p-1" style={{ color: offsetMs ? C.text : C.faint, border: `1px solid ${C.line2}` }}>{playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}</button>
          )}
          <div className="flex-1">
            {(expanded || offsetMs > 0) && <div className="mb-1 flex justify-between text-[8px] uppercase tracking-[.18em]" style={{ color: C.faint }}><span>−24h</span><span>{gaps.length ? `gaps · ${gaps.join(" · ")}` : "collector memory"}</span><span>now</span></div>}
            <input aria-label="World View time, now to 24 hours ago" type="range" min={0} max={DAY} step={5 * 60_000} value={offsetMs} onChange={(event) => onOffset(Number(event.target.value))} className="h-px w-full cursor-ew-resize accent-amber-400" style={{ direction: "rtl" }} />
          </div>
          <button onClick={onLive} className="min-w-[58px] text-right text-[10px] font-semibold uppercase tracking-[.2em]" style={{ color: offsetMs ? C.cyan : C.amber, textShadow: offsetMs ? `0 0 10px ${C.cyan}` : `0 0 10px ${C.amber}` }}>{formatRelativeTime(offsetMs)}</button>
        </div>
      </div>
    </div>
  );
}
