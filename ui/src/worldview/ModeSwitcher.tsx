import { ChevronDown, Layers } from "lucide-react";
import type { LayerData } from "./hooks/useLayerData";
import { LAYERS, type LayerId } from "./layerRegistry";
import { MODES, type ModeId } from "./modes";
import { C } from "./theme";

interface Props {
  mode: ModeId;
  customized: boolean;
  open: boolean;
  enabled: ReadonlySet<LayerId>;
  data: Record<LayerId, LayerData>;
  onOpen: () => void;
  onMode: (mode: ModeId) => void;
  onReset: () => void;
  onToggle: (layer: LayerId) => void;
}

export function ModeSwitcher({ mode, customized, open, enabled, data, onOpen, onMode, onReset, onToggle }: Props) {
  return (
    <div className="relative">
      <button aria-expanded={open} onClick={customized ? onReset : onOpen} className="flex items-center gap-2 text-left" title={customized ? "Reset curated scene" : "Change scene"}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.amber, boxShadow: `0 0 12px ${C.amber}` }} />
        <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: C.mut }}>Mode</span>
        <strong className="text-[11px] uppercase tracking-[0.16em]" style={{ color: C.text }}>{MODES[mode].label}{customized ? " ·" : ""}</strong>
        <ChevronDown className="h-3 w-3" style={{ color: C.faint }} />
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-40 w-[260px] overflow-hidden rounded-sm" style={{ background: "rgba(4,8,13,.96)", border: `1px solid ${C.line2}`, boxShadow: "0 18px 60px rgba(0,0,0,.5)" }}>
          {(Object.keys(MODES) as ModeId[]).map((id) => (
            <button key={id} onClick={() => onMode(id)} className="block w-full px-3 py-2 text-left" style={{ borderBottom: `1px solid ${C.line}`, background: id === mode ? "rgba(245,165,36,.06)" : "transparent" }}>
              <span className="block text-[11px] uppercase tracking-[.14em]" style={{ color: id === mode ? C.amber : C.text }}>{MODES[id].label}</span>
              <span className="mt-0.5 block text-[9px]" style={{ color: C.faint }}>{MODES[id].personality}</span>
            </button>
          ))}
          <div className="flex items-center gap-1.5 px-3 py-2 text-[9px] uppercase tracking-[.18em]" style={{ color: C.faint }}><Layers className="h-3 w-3" /> Manual layers</div>
          <div className="px-2 pb-2">
            {LAYERS.map((layer) => (
              <button key={layer.id} onClick={() => onToggle(layer.id)} className="flex w-full items-center gap-2 px-1 py-1 text-left">
                <span className="h-2 w-2 rounded-full" style={{ background: enabled.has(layer.id) ? C.amber : C.line2, boxShadow: enabled.has(layer.id) ? `0 0 7px ${C.amber}66` : "none" }} />
                <span className="flex-1 text-[10px]" style={{ color: enabled.has(layer.id) ? C.text : C.faint }}>{layer.label}</span>
                <span className="text-[9px] tabular-nums" style={{ color: data[layer.id]?.status === "offline" ? C.red : C.faint }}>{data[layer.id]?.count || "—"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
