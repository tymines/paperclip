/** World View  high-severity alerts ticker (TYL-131). Derived from live feeds. */
import { AlertTriangle } from "lucide-react";
import { C } from "./theme";

export interface Alert { id: string; color: string; text: string }

export function AlertsTicker({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null;
  // duplicate the list so the marquee loops seamlessly
  const loop = [...alerts, ...alerts];
  return (
    <div className="flex items-center gap-2 overflow-hidden px-2 py-1"
      style={{ background: "rgba(5,7,10,0.9)", borderTop: `1px solid ${C.line}` }}>
      <AlertTriangle className="h-3 w-3 shrink-0" style={{ color: C.amber }} />
      <div className="relative flex-1 overflow-hidden">
        <div className="flex gap-8 whitespace-nowrap wv-marquee">
          {loop.map((a, i) => (
            <span key={`${a.id}-${i}`} className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: C.mut }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.color }} />
              {a.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
