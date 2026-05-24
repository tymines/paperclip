/**
 * Knowledge Graph v2 — right-rail hover detail panel.
 *
 * Spec: knowledge-graph-polish-spec.md §6.
 *
 * 320px panel that slides in from the right when a node is hovered.
 * Auto-dismisses 5s after the mouse leaves the node AND the panel.
 *
 * Sections, top to bottom:
 *   1. Entity-type pill (color = entity hex)
 *   2. Label (24px Inter Semibold)
 *   3. Description body (14px/1.5, clamped to 5 lines)
 *   4. Meta row (edge count • created date)
 *   5. Related concepts — up to 8 chips, clicking centers + zooms
 *
 * Pure presentational. Owner page (KnowledgeGraph.tsx) wires the props.
 */
import { useEffect, useRef, useState } from "react";
import { ANIMATION_TIMINGS, ENTITY_COLORS, NEUTRAL, NODE_TYPE_TO_ENTITY, withAlpha, type EntityKind } from "./v2-tokens";

export interface DetailPanelNode {
  id: string;
  type: string; // legacy NodeType — mapped via NODE_TYPE_TO_ENTITY
  label: string;
  description?: string | null;
  createdAt: Date | string | null;
  edgeCount: number;
  related?: Array<{ id: string; label: string; type: string }>;
}

interface KnowledgeGraphDetailPanelProps {
  /** The currently-hovered or pinned node; null hides the panel. */
  node: DetailPanelNode | null;
  /** Mobile: bottom sheet instead of right rail. */
  mobile?: boolean;
  /** Click a related-concept chip; owner pans/zooms the camera. */
  onRelatedClick?(nodeId: string): void;
}

export function KnowledgeGraphDetailPanel({
  node,
  mobile = false,
  onRelatedClick,
}: KnowledgeGraphDetailPanelProps) {
  // 5s auto-dismiss timer — kicks in when the node prop goes null OR when
  // the user mouses off the panel after a hover.
  const [renderedNode, setRenderedNode] = useState<DetailPanelNode | null>(node);
  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    if (node) {
      if (dismissTimer.current) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setRenderedNode(node);
      return;
    }
    // node went null — start the dismiss timer
    if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    dismissTimer.current = window.setTimeout(() => {
      setRenderedNode(null);
      dismissTimer.current = null;
    }, ANIMATION_TIMINGS.panelDismissDelayMs);
    return () => {
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    };
  }, [node]);

  const visible = node !== null;
  const data = renderedNode;

  if (!data) return null;

  const entity: EntityKind = (NODE_TYPE_TO_ENTITY[data.type] ?? "memory") as EntityKind;
  const entityColor = ENTITY_COLORS[entity].hex;

  if (mobile) {
    return (
      <div
        className="pointer-events-auto absolute z-30 left-2 right-2"
        style={{
          bottom: visible
            ? "calc(env(safe-area-inset-bottom) + 12px)"
            : "calc(env(safe-area-inset-bottom) - 120px)",
          maxHeight: "40vh",
          padding: "16px",
          borderRadius: "18px",
          background: NEUTRAL.panelBg,
          backdropFilter: "blur(24px) saturate(150%)",
          WebkitBackdropFilter: "blur(24px) saturate(150%)",
          border: `1px solid ${NEUTRAL.border}`,
          opacity: visible ? 1 : 0,
          transition: `transform ${ANIMATION_TIMINGS.panelSlideMs}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${ANIMATION_TIMINGS.panelSlideMs}ms ease-out`,
          overflowY: "auto",
        }}
      >
        <DetailContent data={data} entity={entity} entityColor={entityColor} onRelatedClick={onRelatedClick} />
      </div>
    );
  }

  return (
    <div
      className="pointer-events-auto absolute z-30"
      style={{
        top: "56px",
        right: 0,
        width: "320px",
        height: "calc(100% - 56px)",
        padding: "24px 20px 32px",
        background: NEUTRAL.panelBg,
        backdropFilter: "blur(24px) saturate(150%)",
        WebkitBackdropFilter: "blur(24px) saturate(150%)",
        borderLeft: `1px solid ${NEUTRAL.border}`,
        transform: visible ? "translateX(0)" : "translateX(100%)",
        opacity: visible ? 1 : 0,
        transition: `transform ${ANIMATION_TIMINGS.panelSlideMs}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${ANIMATION_TIMINGS.panelSlideMs}ms ease-out`,
        overflowY: "auto",
      }}
    >
      <DetailContent data={data} entity={entity} entityColor={entityColor} onRelatedClick={onRelatedClick} />
    </div>
  );
}

function DetailContent({
  data,
  entity,
  entityColor,
  onRelatedClick,
}: {
  data: DetailPanelNode;
  entity: EntityKind;
  entityColor: string;
  onRelatedClick?(id: string): void;
}) {
  return (
    <>
      {/* §6.1 — Entity-type pill */}
      <div
        className="inline-flex items-center"
        style={{
          padding: "4px 10px",
          borderRadius: "999px",
          background: withAlpha(entityColor, 0.13),
          color: entityColor,
          font: "600 11px/1 Inter, system-ui, sans-serif",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {entity}
      </div>

      {/* §6.2 — Label */}
      <h2
        className="mt-3 text-[24px] font-semibold leading-tight"
        style={{ color: "#f3f5f9", margin: "12px 0 6px" }}
      >
        {data.label}
      </h2>

      {/* §6.3 — Description body */}
      {data.description ? (
        <p
          className="text-sm leading-[1.5]"
          style={{
            color: "rgba(232, 236, 242, 0.72)",
            display: "-webkit-box",
            WebkitLineClamp: 5,
            WebkitBoxOrient: "vertical" as const,
            overflow: "hidden",
          }}
        >
          {data.description}
        </p>
      ) : (
        <p className="text-sm" style={{ color: "rgba(232, 236, 242, 0.4)" }}>
          No description.
        </p>
      )}

      {/* §6.4 — Meta row */}
      <div
        className="mt-3 flex items-center gap-1.5 text-xs"
        style={{ color: "rgba(232, 236, 242, 0.5)" }}
      >
        <span>
          {data.edgeCount} connection{data.edgeCount === 1 ? "" : "s"}
        </span>
        <span aria-hidden>•</span>
        <span>{formatCreated(data.createdAt)}</span>
      </div>

      {/* §6.5 — Related concepts */}
      {data.related && data.related.length > 0 ? (
        <div className="mt-5">
          <div
            className="mb-2 text-[11px] uppercase"
            style={{ color: "rgba(232, 236, 242, 0.5)", letterSpacing: "0.06em" }}
          >
            Related
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.related.slice(0, 8).map((rel) => (
              <button
                key={rel.id}
                type="button"
                onClick={() => onRelatedClick?.(rel.id)}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-gray-300 transition-colors hover:border-white/30 hover:text-white"
                title={rel.label}
              >
                {rel.label.length > 28 ? `${rel.label.slice(0, 27)}…` : rel.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function formatCreated(value: Date | string | null): string {
  if (!value) return "";
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}
