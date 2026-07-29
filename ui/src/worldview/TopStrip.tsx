import { Expand, HelpCircle } from "lucide-react";
import type { LayerData } from "./hooks/useLayerData";
import type { LayerId } from "./layerRegistry";
import { ModeSwitcher } from "./ModeSwitcher";
import type { ModeId } from "./modes";
import { formatRelativeTime } from "./time";
import { C } from "./theme";

interface Props {
  mode: ModeId;
  customized: boolean;
  modeOpen: boolean;
  enabled: ReadonlySet<LayerId>;
  data: Record<LayerId, LayerData>;
  answer: string;
  degradation: string | null;
  zulu: string;
  offsetMs: number;
  projection: "globe" | "mercator";
  onModeOpen: () => void;
  onMode: (mode: ModeId) => void;
  onModeReset: () => void;
  onToggle: (layer: LayerId) => void;
  onProjection: () => void;
  onFullscreen: () => void;
  onHelp: () => void;
}

export function TopStrip(props: Props) {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex min-h-12 items-start justify-between gap-4 px-3 py-3 sm:px-5" style={{ background: "linear-gradient(180deg,rgba(1,4,8,.82),transparent)" }}>
      <div className="pointer-events-auto min-w-0">
        <ModeSwitcher mode={props.mode} customized={props.customized} open={props.modeOpen} enabled={props.enabled} data={props.data} onOpen={props.onModeOpen} onMode={props.onMode} onReset={props.onModeReset} onToggle={props.onToggle} />
        <div className="mt-1 max-w-[70vw] truncate pl-3.5 text-[9px] tracking-wide" style={{ color: props.degradation ? C.amber : C.faint }}>{props.degradation || props.answer}</div>
      </div>
      <div className="pointer-events-auto flex shrink-0 items-center gap-2.5 text-[9px] uppercase tracking-[.14em]" style={{ color: C.mut }}>
        {props.offsetMs > 0 && <span className="hidden rounded-sm px-1.5 py-0.5 sm:inline" style={{ color: C.cyan, border: `1px solid ${C.cyan}44`, background: `${C.cyan}0c` }}>{formatRelativeTime(props.offsetMs)}</span>}
        <time className="tabular-nums">{props.zulu}</time>
        <button aria-label="Toggle globe projection" onClick={props.onProjection} className="hidden sm:inline" title="3D globe / 2D fallback" style={{ color: props.projection === "globe" ? C.text : C.cyan }}>{props.projection === "globe" ? "3D" : "2D"}</button>
        <button aria-label="Fullscreen" onClick={props.onFullscreen}><Expand className="h-3.5 w-3.5" /></button>
        <button aria-label="Help" onClick={props.onHelp}><HelpCircle className="h-3.5 w-3.5" /></button>
      </div>
    </header>
  );
}
