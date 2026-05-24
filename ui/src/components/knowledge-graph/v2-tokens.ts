/**
 * Knowledge Graph v2 — shared design tokens.
 *
 * Single source of truth for entity colors, geometry math, LOD distance
 * thresholds, animation timings, and helper functions. Derived from the
 * spec in
 * `/Users/augi/.openclaw/agents/codex/workspace/knowledge-graph-polish-spec.md`.
 *
 * The renderer (v2-renderer / inline in KnowledgeGraph.tsx) and the
 * React UI (v2-controls, v2-detail-panel) both read from here so the
 * palette never drifts between Three.js materials and DOM chrome.
 */

/* ── Entity palette ───────────────────────────────────────────────────── */

/**
 * Five canonical entity types. Internal `NodeType`s (`agent`, `issue`,
 * `skill`, `run`, `hub`, `knowledge`) map down to these per the spec's
 * legacy mapping table.
 */
export type EntityKind = "person" | "project" | "concept" | "event" | "memory";

export const ENTITY_COLORS: Record<EntityKind, { hex: string; rgb: [number, number, number] }> = {
  person: { hex: "#f7a072", rgb: [247, 160, 114] }, // warm amber
  project: { hex: "#7cc4f5", rgb: [124, 196, 245] }, // calm cyan-blue
  concept: { hex: "#c6a8ff", rgb: [198, 168, 255] }, // ideas violet
  event: { hex: "#ffd166", rgb: [255, 209, 102] }, // sun-yellow
  memory: { hex: "#6fe0c2", rgb: [111, 224, 194] }, // mint
};

/** Legacy `NodeType` → spec EntityKind. */
export const NODE_TYPE_TO_ENTITY: Record<string, EntityKind> = {
  agent: "person",
  issue: "project",
  skill: "concept",
  run: "event",
  hub: "concept", // hubs are large-anchor concepts
  knowledge: "memory",
};

export const NEUTRAL = {
  bgDeep: "#08090b",
  bgNear: "#0c0d10",
  vignette: "rgba(0,0,0,0.4)",
  nodeDefault: "#a4afc0",
  nodeSelected: "#ffffff",
  nodeHover: "#cdd6e3",
  linkDefault: "rgba(180,190,205,0.22)",
  linkHover: "rgba(220,228,240,0.85)",
  panelBg: "rgba(14, 15, 18, 0.82)",
  controlsBg: "rgba(18, 19, 23, 0.78)",
  border: "rgba(255, 255, 255, 0.08)",
  borderStrong: "rgba(255, 255, 255, 0.14)",
} as const;

/* ── Geometry math ────────────────────────────────────────────────────── */

export const NODE_GEOMETRY = {
  baseRadius: 6,
  maxRadius: 24,
  hubMinRadius: 14,
  haloMultiplier: 3,
  haloOpacity: { default: 0.22, hover: 0.55, selected: 0.85 },
  emissiveIntensity: { default: 0.18, hover: 0.4, selected: 0.45 },
} as const;

/**
 * r = clamp(baseRadius * (1 + log2(1 + edgeCount)), baseRadius, maxRadius);
 * hubs floor at hubMinRadius so they always read as anchors.
 */
export function computeNodeRadius(edgeCount: number, isHub: boolean): number {
  const { baseRadius, maxRadius, hubMinRadius } = NODE_GEOMETRY;
  const raw = baseRadius * (1 + Math.log2(1 + Math.max(0, edgeCount)));
  const clamped = Math.min(maxRadius, Math.max(baseRadius, raw));
  return isHub ? Math.max(hubMinRadius, clamped) : clamped;
}

/* ── Level-of-detail distance thresholds ──────────────────────────────── */

export const LOD_THRESHOLDS = {
  pbr: 40,        // < 40 world units: full MeshPhysicalMaterial, halo on
  standard: 80,   // 40..80:  MeshStandardMaterial, halo 0.5x
  wireframe: 160, // 80..160: MeshBasicMaterial wireframe, halo off
  point: Infinity, // > 160:  Points sprite (single vertex)
} as const;

export type LodTier = "pbr" | "standard" | "wireframe" | "point";

export function lodTierForDistance(distance: number): LodTier {
  if (distance < LOD_THRESHOLDS.pbr) return "pbr";
  if (distance < LOD_THRESHOLDS.standard) return "standard";
  if (distance < LOD_THRESHOLDS.wireframe) return "wireframe";
  return "point";
}

/* ── Animation timings ────────────────────────────────────────────────── */

export const ANIMATION_TIMINGS = {
  selectedPulsePeriodMs: 1400,
  selectedPulseRange: [1.0, 1.15] as [number, number],
  hoverInDurationMs: 250,
  hoverOutDurationMs: 180,
  panelSlideMs: 220,
  panelDismissDelayMs: 5000,
  particleSpeed: 0.012,
  particleCount: 4,
  starfieldRotationPerFrame: 0.0002,
} as const;

/* ── Edge rendering ───────────────────────────────────────────────────── */

export const EDGE = {
  curvature: 0.18,
  /** Hover-incident edge widening multiplier vs source-node radius. */
  hoverParticleWidthFactor: 1.5,
  /** Days under which an edge renders at full opacity. */
  freshDays: 7,
  /** Past this many days, opacity floors at this value. */
  oldDays: 90,
  oldOpacityFloor: 0.35,
} as const;

export function recencyAlpha(lastTouchedAt: Date | string | number | null | undefined): number {
  if (!lastTouchedAt) return 0.6;
  const ms = lastTouchedAt instanceof Date
    ? lastTouchedAt.getTime()
    : typeof lastTouchedAt === "number"
      ? lastTouchedAt
      : new Date(lastTouchedAt).getTime();
  if (!Number.isFinite(ms)) return 0.6;
  const ageDays = (Date.now() - ms) / 86_400_000;
  if (ageDays <= EDGE.freshDays) return 1.0;
  const slope = 1 - (ageDays - EDGE.freshDays) / (EDGE.oldDays - EDGE.freshDays);
  return Math.max(EDGE.oldOpacityFloor, slope);
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

/** Apply alpha to a `#rrggbb` or `rgba(...)` color string. */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (color.startsWith("rgba(") || color.startsWith("rgb(")) {
    const inside = color.replace(/^rgba?\(/, "").replace(/\)$/, "");
    const parts = inside.split(",").map((p) => p.trim());
    const [r, g, b] = parts;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return color;
}

export const STARFIELD = {
  pointCount: 2000,
  radius: 800,
  sizeRange: [0.6, 1.2] as [number, number],
  alphaRange: [0.15, 0.35] as [number, number],
} as const;
