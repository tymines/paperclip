/**
 * Knowledge Graph v2 — floating glass camera-control panel.
 *
 * Spec: knowledge-graph-polish-spec.md §5.
 * Four 44×44 actions: zoom in / zoom out / fit-all / reset view.
 * Glass treatment: bg rgba(18,19,23,0.78), 20px blur + 140% saturate,
 * 18px radius, 1px white-8% border, 32px shadow at 45% black.
 * Positioned bottom-right, respects safe-area insets.
 *
 * Pure presentational — owner page wires the four callbacks to its
 * fgRef camera helpers.
 */
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

interface KnowledgeGraphControlsProps {
  onZoomIn(): void;
  onZoomOut(): void;
  onFitAll(): void;
  onReset(): void;
  /** Render bottom-center on mobile to avoid the iOS home-indicator. */
  mobile?: boolean;
}

export function KnowledgeGraphControls({
  onZoomIn,
  onZoomOut,
  onFitAll,
  onReset,
  mobile = false,
}: KnowledgeGraphControlsProps) {
  // Outer wrapper is pointer-events-none so OrbitControls keeps receiving
  // drag/scroll/touch events through the panel's bounding box. Each
  // button re-enables pointer-events on itself so clicks still register.
  return (
    <div
      role="toolbar"
      aria-label="Camera controls"
      className="pointer-events-none absolute z-20 flex flex-col gap-1"
      style={{
        right: mobile ? "12px" : `max(20px, env(safe-area-inset-right))`,
        bottom: mobile
          ? "calc(env(safe-area-inset-bottom) + 88px)"
          : `max(84px, env(safe-area-inset-bottom))`,
        padding: "8px",
        borderRadius: "18px",
        background: "rgba(18, 19, 23, 0.78)",
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)",
      }}
    >
      <ControlButton title="Zoom in" onClick={onZoomIn}>
        <ZoomIn className="h-5 w-5" />
      </ControlButton>
      <ControlButton title="Zoom out" onClick={onZoomOut}>
        <ZoomOut className="h-5 w-5" />
      </ControlButton>
      <div className="my-0.5 h-px bg-white/10" aria-hidden />
      <ControlButton title="Fit all" onClick={onFitAll}>
        <Maximize2 className="h-5 w-5" />
      </ControlButton>
      <ControlButton title="Reset view" onClick={onReset}>
        <RotateCcw className="h-5 w-5" />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="pointer-events-auto group grid h-11 w-11 place-items-center rounded-xl text-gray-300 transition-[transform,background] duration-150 ease-out hover:bg-white/10 hover:text-white active:translate-y-0 hover:-translate-y-px"
    >
      {children}
    </button>
  );
}
