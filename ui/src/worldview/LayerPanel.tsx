/** World View  layer toggle panel with live counts (TYL-131). */
import { Layers } from "lucide-react";
import { C } from "./theme";
import { LAYERS, type LayerId, type LayerDef } from "./layerRegistry";
import type { LayerData } from "./hooks/useLayerData";

interface Props {
  enabled: Set<LayerId>;
  data: Record<LayerId, LayerData>;
  onToggle: (id: LayerId) => void;
}

export function LayerPanel({ enabled, data, onToggle }: Props) {
  return (
    <div className="w-[184px]" style={{ background: "rgba(5,7,10,0.86)", border: `1px solid ${C.line2}`, backdropFilter: "blur(3px)" }}>
      <div className="flex items-center gap-1.5 px-2 py-1" style={{ borderBottom: `1px solid ${C.line}` }}>
        <Layers className="h-3 w-3" style={{ color: C.green }} />
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: C.mut }}>Layers</span>
      </div>
      <div className="flex flex-col gap-0.5 p-1.5">
        {(LAYERS as LayerDef[]).map((layer) => {
          const on = enabled.has(layer.id);
          const d = data[layer.id];
          const badge =
            !on ? "" :
            d?.status === "loading" ? "" :
            d?.status === "error" ? "ERR" :
            String(d?.count ?? 0);
          const badgeColor = d?.status === "error" ? C.red : on ? C.text : C.faint;
          return (
            <button
              key={layer.id}
              onClick={() => onToggle(layer.id)}
              className="flex items-center gap-1.5 px-1 py-0.5 text-left text-[10px] uppercase tracking-wider"
              style={{ color: on ? C.text : C.faint }}
              title={`${layer.provider}${layer.hotkey ? `  [${layer.hotkey.toUpperCase()}]` : ""}`}
            >
              <span className="flex h-2.5 w-2.5 items-center justify-center"
                style={{ border: `1px solid ${on ? C.green : C.line2}`, background: on ? `${C.green}22` : "transparent" }}>
                {on && <span style={{ color: C.green, fontSize: 8, lineHeight: "8px" }}></span>}
              </span>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: layer.color }} />
              <span className="flex-1 truncate">{layer.label}</span>
              {layer.marker === "NEEDS-ENDPOINT" && !on && (
                <span className="text-[7px]" style={{ color: C.faint }}></span>
              )}
              {badge && <span className="tabular-nums text-[9px]" style={{ color: badgeColor }}>{badge}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
