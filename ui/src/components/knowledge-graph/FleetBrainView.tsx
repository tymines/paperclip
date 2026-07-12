/**
 * FleetBrainView — Neural Command Network
 *
 * A glowing 3D neural brain rendering of the live Fleet KB graph (three.js /
 * WebGL via react-force-graph-3d + UnrealBloom). Memory categories cluster
 * into anatomical-style lobes via a real region force.
 *
 * DATA-HONESTY (Design System v1.0 rule: wire a real source or drop it):
 *   · every node        = a real vault note / agent / category / index
 *   · lobe assignment   = the note's real vault category (no hash scatter)
 *   · node size         = real edge degree (hubs scale with real member count)
 *   · node brightness   = really updated in the last 24h
 *   · edge particles    = only on real authored wikilinks + TF-IDF "related"
 *                         edges; count/width derive from the real edge weight
 *   · pulses            = notes that really appeared since the previous poll
 *   · HUD stats         = computed from the payload (never seeded/hardcoded)
 *
 * PERF: the server caches + fingerprints the vault, so polls return an
 * identical payload while the vault is unchanged → React Query structural
 * sharing keeps object identity → the force sim does NOT re-heat every poll.
 * Bodies are no longer shipped with the graph (fetched per-note on demand).
 */
import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import SpriteText from "three-spritetext";
import {
  FileText, RefreshCw, BookOpen, X, Bot, ExternalLink, Search, Link2,
  Brain, Activity, Zap, Wifi,
} from "lucide-react";
import { fleetKbApi, type FleetKbGraphNode } from "../../api/knowledgeGraph";

// ═══════════════════════════════════════════════════════════════════════════════
//  DESIGN SYSTEM v1.0 TOKENS (paperclip-product-spec.md — canonical)
// ═══════════════════════════════════════════════════════════════════════════════

const T = {
  canvas: "#06090F",
  surface1: "rgba(13,19,29,0.82)",   // #0D131D
  surface2: "rgba(17,25,38,0.88)",   // #111926
  border: "1px solid rgba(255,255,255,0.06)",
  textPrimary: "#F5F8FF",
  textSecondary: "#A3B0C2",
  textTertiary: "#68758A",
  accent: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
  automation: "#A56EFF",
  analytics: "#31D9FF",
  radius: 16,
} as const;

const MONO = '"IBM Plex Mono", Menlo, ui-monospace, monospace';

// ═══════════════════════════════════════════════════════════════════════════════
//  REGIONS — anatomical lobes, each mapped to a REAL vault category group
// ═══════════════════════════════════════════════════════════════════════════════

type RegionKey = "CORE" | "MEMORY" | "AGENTS" | "WORK" | "SYNTHESIS" | "PROJECTS" | "ARCHIVE";

interface Region {
  label: string;
  role: string;          // the real vault folders this lobe renders
  color: string;
  bright: string;        // tint for notes really updated <24h ago
  anchor: [number, number, number]; // lobe position in brain space
}

const REGIONS: Record<RegionKey, Region> = {
  CORE:      { label: "CORE",        role: "index · category hubs",           color: T.accent,       bright: "#9CC2FF", anchor: [0, 0, 0] },
  MEMORY:    { label: "HIPPOCAMPUS", role: "01 - Fleet KB · agent memories",  color: T.automation,   bright: "#D3B9FF", anchor: [-170, -40, 60] },
  AGENTS:    { label: "BROCA",       role: "04 - Agents · authorship",        color: T.warning,      bright: "#FFDFA1", anchor: [160, 30, 90] },
  WORK:      { label: "OCCIPITAL",   role: "decisions · completed work",      color: T.success,      bright: "#A9F5D2", anchor: [10, -30, -180] },
  SYNTHESIS: { label: "DREAMS",      role: "08 - Consolidation · synthesis",  color: T.analytics,    bright: "#B2EFFF", anchor: [-40, 160, -50] },
  PROJECTS:  { label: "FRONTAL",     role: "projects · research · apps",      color: T.critical,     bright: "#FFB9B9", anchor: [70, 70, 170] },
  ARCHIVE:   { label: "ARCHIVE",     role: "archive · meta",                  color: T.textTertiary, bright: "#9AA6BA", anchor: [-150, -100, -120] },
};

const DIM_NODE = "#141823";
const DIM_LINK = "#0b0e15";
const PULSE_MS = 2600;
const IDLE_MS = 2200;
const POLL_MS = 12000;
const RECENT_MS = 24 * 60 * 60 * 1000;

/** Region from REAL fields only: node kind + the note's actual vault category. */
function regionForNode(n: FleetKbGraphNode): RegionKey {
  if (n.kind === "index" || n.kind === "category") return "CORE";
  if (n.kind === "agent") return "AGENTS";
  const c = n.category ?? "";
  if (c === "01---fleet-kb") return "MEMORY";
  if (c === "04---agents") return "AGENTS";
  if (c === "decision" || c === "completed") return "WORK";
  if (c === "08---consolidation") return "SYNTHESIS";
  if (c === "06---projects" || c === "05---research" || c === "09---book-studio" || c === "10---apps" || c === "paperclip") return "PROJECTS";
  return "ARCHIVE"; // 07 - Archive, 00 - Meta, other
}

interface BrainNode extends FleetKbGraphNode {
  region: RegionKey;
  color: string;
  val: number;        // from real degree
  isHub: boolean;
  recent: boolean;    // really updated in the last 24h
  x?: number; y?: number; z?: number;
  vx?: number; vy?: number; vz?: number;
}

interface BrainLink {
  source: string; target: string; kind: string; color: string;
  weight: number;
  particles: number;  // 0 for structural edges; weight-derived for link/related
  pwidth: number;
  pspeed: number;
}

/** Custom d3 force pulling each node toward its lobe anchor (no extra deps). */
function makeRegionForce(strength: number) {
  let nodes: BrainNode[] = [];
  const force = (alpha: number) => {
    for (const n of nodes) {
      const [ax, ay, az] = REGIONS[n.region].anchor;
      const k = (n.isHub ? strength * 1.8 : strength) * alpha;
      n.vx = (n.vx ?? 0) + (ax - (n.x ?? 0)) * k;
      n.vy = (n.vy ?? 0) + (ay - (n.y ?? 0)) * k;
      n.vz = (n.vz ?? 0) + (az - (n.z ?? 0)) * k;
    }
  };
  force.initialize = (ns: BrainNode[]) => { nodes = ns; };
  return force;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function FleetBrainView({ onShowKb }: { onShowKb: () => void; }) {
  // ── latency + stats ─────────────────────────────────────────────────────────
  const [latency, setLatency] = useState<number | null>(null);
  const [activityPct, setActivityPct] = useState<string>("—");

  // ── graph query (slim payload — no note bodies) ─────────────────────────────
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["fleet-kb", "graph"],
    queryFn: async () => {
      const start = Date.now();
      const result = await fleetKbApi.getGraph();
      setLatency(Date.now() - start);
      return result;
    },
    staleTime: 60_000,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false, // don't burn cycles in background tabs
  });

  // ── dreams query ────────────────────────────────────────────────────────────
  const { data: dreamsData } = useQuery({
    queryKey: ["fleet-kb", "dreams"],
    queryFn: () => fleetKbApi.getDreams(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dim, setDim] = useState({ w: window.innerWidth, h: window.innerHeight - 56 });
  const [hover, setHover] = useState<BrainNode | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // ── interactive controls ────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [focusRegion, setFocusRegion] = useState<RegionKey | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());

  // ── interaction clock ───────────────────────────────────────────────────────
  const lastInteractRef = useRef(0);
  const bump = useCallback(() => { lastInteractRef.current = Date.now(); }, []);

  // ── pulse bookkeeping (real new-note events) ────────────────────────────────
  const prevIdsRef = useRef<Set<string>>(new Set());
  const pulseRef = useRef<Map<string, number>>(new Map());
  const pulseRunning = useRef(false);
  const [pulseVersion, setPulseVersion] = useState(0);

  const startPulseLoop = useCallback(() => {
    if (pulseRunning.current) return;
    pulseRunning.current = true;
    let last = 0;
    const tick = () => {
      const now = Date.now();
      for (const [id, end] of pulseRef.current) if (end <= now) pulseRef.current.delete(id);
      // 150ms cadence — enough for a smooth swell without a re-render storm
      if (now - last > 150) { last = now; setPulseVersion((v) => v + 1); }
      if (pulseRef.current.size > 0) requestAnimationFrame(tick);
      else { pulseRunning.current = false; setPulseVersion((v) => v + 1); }
    };
    requestAnimationFrame(tick);
  }, []);

  // ── size tracking ───────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setDim({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // note metadata lookup (no bodies here — fetched on demand)
  const notesById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof data>["notes"][number]>();
    for (const n of data?.notes ?? []) m.set(n.id, n);
    return m;
  }, [data]);

  // ── transform graph (all visual attributes derive from real values) ─────────
  const graph = useMemo(() => {
    const rawNodes = data?.graph?.nodes ?? [];
    const rawEdges = data?.graph?.edges ?? [];
    const now = Date.now();

    // real degree per node
    const degree = new Map<string, number>();
    for (const e of rawEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }

    const regionOf = new Map<string, RegionKey>();
    const nodes: BrainNode[] = rawNodes.map((n) => {
      const region = regionForNode(n);
      regionOf.set(n.id, region);
      const deg = degree.get(n.id) ?? 0;
      const note = n.noteId ? notesById.get(n.noteId) : undefined;
      const recent = !!note && now - Date.parse(note.updatedAt) < RECENT_MS;
      const isHub = n.kind !== "note";
      // size: hubs scale with real member count (their degree); notes with real
      // connectivity. sqrt keeps the CORE index from dwarfing everything.
      const val = isHub
        ? 10 + Math.sqrt(deg) * 3.2
        : 2 + Math.min(9, Math.sqrt(deg) * 1.7);
      return {
        ...n,
        region,
        color: recent ? REGIONS[region].bright : REGIONS[region].color,
        val,
        isHub,
        recent,
      };
    });

    const ids = new Set(nodes.map((n) => n.id));
    const links: BrainLink[] = rawEdges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => {
        const srcRegion = regionOf.get(e.source)!;
        const w = e.weight ?? 0;
        const isFlow = e.kind === "link" || e.kind === "related";
        // particles ONLY on real relationships; count/width from real weight.
        // Explicit authored wikilinks are the strongest signal → 2 particles.
        const particles = !isFlow ? 0 : e.kind === "link" ? 2 : w >= 0.45 ? 2 : 1;
        return {
          source: e.source,
          target: e.target,
          kind: e.kind,
          weight: w,
          color: isFlow ? REGIONS[srcRegion].color : "#1C2635",
          particles,
          pwidth: e.kind === "link" ? 1.3 : 0.5 + w * 1.4,
          pspeed: e.kind === "link" ? 0.009 : 0.006,
        };
      });

    return { nodes, links, regionOf };
  }, [data, notesById]);

  // fast lookups
  const nodeById = useMemo(() => {
    const m = new Map<string, BrainNode>();
    for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph.nodes]);

  // search index (title + excerpt + tags — bodies are no longer shipped)
  const searchIndex = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes) {
      let t = n.label || "";
      if (n.noteId) {
        const note = notesById.get(n.noteId);
        if (note) t += " " + note.title + " " + (note.excerpt || "") + " " + note.tags.join(" ");
      }
      m.set(n.id, t.toLowerCase());
    }
    return m;
  }, [graph.nodes, notesById]);

  const q = searchQuery.trim().toLowerCase();
  const matchSet = useMemo(() => {
    if (!q) return null;
    const s = new Set<string>();
    for (const n of graph.nodes) {
      const t = searchIndex.get(n.id);
      if (t && t.includes(q)) s.add(n.id);
    }
    return s;
  }, [q, graph.nodes, searchIndex]);

  const hasNarrowing =
    !!q || !!focusRegion || selectedAgents.size > 0 || selectedCats.size > 0;

  const isNodeActive = useCallback(
    (n: BrainNode) => {
      if (focusRegion && n.region !== focusRegion) return false;
      if (selectedAgents.size > 0 && n.kind === "note" && !(n.agentId && selectedAgents.has(n.agentId))) return false;
      if (selectedCats.size > 0 && n.kind === "note" && !(n.category && selectedCats.has(n.category))) return false;
      if (matchSet && !matchSet.has(n.id)) return false;
      return true;
    },
    [focusRegion, selectedAgents, selectedCats, matchSet],
  );

  // present regions with real counts
  const presentRegions = useMemo(() => {
    const counts = new Map<RegionKey, number>();
    for (const n of graph.nodes) counts.set(n.region, (counts.get(n.region) ?? 0) + 1);
    return (Object.keys(REGIONS) as RegionKey[])
      .filter((k) => counts.has(k))
      .map((k) => ({ key: k, ...REGIONS[k], count: counts.get(k)! }));
  }, [graph.nodes]);

  const totalNodes = graph.nodes.length;
  const totalLinks = graph.links.length;
  const recentCount = useMemo(() => graph.nodes.filter((n) => n.recent).length, [graph.nodes]);

  // ── coherence (share of nodes with at least one real edge) ──────────────────
  const coherencePct = useMemo(() => {
    const rawEdges = data?.graph?.edges ?? [];
    const connected = new Set<string>();
    for (const e of rawEdges) { connected.add(e.source); connected.add(e.target); }
    const isolated = graph.nodes.filter((n) => !connected.has(n.id)).length;
    return totalNodes > 0 ? ((1 - isolated / totalNodes) * 100).toFixed(1) : "—";
  }, [data?.graph?.edges, graph.nodes, totalNodes]);

  // ── node label sprites (hubs only — ~20 sprites, not 1,000) ─────────────────
  const nodeThreeObject = useCallback((node: BrainNode) => {
    if (!node.isHub) return undefined as unknown as THREE.Object3D;
    const label = node.kind === "agent" ? (node.label || "agent").slice(0, 14) : node.label;
    const sprite = new SpriteText(label);
    sprite.color = node.color;
    sprite.fontWeight = "600";
    sprite.fontFace = "IBM Plex Mono, Menlo, monospace";
    sprite.textHeight = node.kind === "index" ? 9 : node.kind === "category" ? 8 : 4.5;
    sprite.backgroundColor = false as unknown as string;
    sprite.padding = 1.5;
    sprite.strokeColor = node.color;
    sprite.strokeWidth = 0.5;
    sprite.position.set(0, node.kind === "note" ? 6 : 13, 0);
    return sprite;
  }, []);

  // ── dynamic accessors ───────────────────────────────────────────────────────
  const nodeColorFn = useCallback(
    (n: BrainNode) => {
      const pe = pulseRef.current.get(n.id);
      if (pe && pe > Date.now()) return "#ffffff";
      if (n.id === selectedNodeId) return "#ffffff";
      if (hasNarrowing && !isNodeActive(n)) return DIM_NODE;
      return n.color;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasNarrowing, isNodeActive, selectedNodeId, pulseVersion],
  );

  const nodeValFn = useCallback(
    (n: BrainNode) => {
      let v = n.val;
      const pe = pulseRef.current.get(n.id);
      if (pe) {
        const rem = pe - Date.now();
        if (rem > 0) v *= 1 + 2.4 * (rem / PULSE_MS);
      }
      if (n.id === selectedNodeId) v *= 1.6;
      return v;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedNodeId, pulseVersion],
  );

  const linkColorFn = useCallback(
    (l: BrainLink) => {
      if (!hasNarrowing) return l.color;
      const sid = typeof l.source === "object" ? (l.source as BrainNode).id : (l.source as string);
      const tid = typeof l.target === "object" ? (l.target as BrainNode).id : (l.target as string);
      const s = nodeById.get(sid); const t = nodeById.get(tid);
      return s && t && isNodeActive(s) && isNodeActive(t) ? l.color : DIM_LINK;
    },
    [hasNarrowing, isNodeActive, nodeById],
  );

  const linkParticlesFn = useCallback(
    (l: BrainLink) => {
      if (l.particles === 0) return 0;
      if (!hasNarrowing) return l.particles;
      const sid = typeof l.source === "object" ? (l.source as BrainNode).id : (l.source as string);
      const tid = typeof l.target === "object" ? (l.target as BrainNode).id : (l.target as string);
      const s = nodeById.get(sid); const t = nodeById.get(tid);
      return s && t && isNodeActive(s) && isNodeActive(t) ? l.particles : 0;
    },
    [hasNarrowing, isNodeActive, nodeById],
  );

  // ── bloom + lobe forces + labels + shells + auto-rotate + energy core ───────
  const regionLabelsRef = useRef<THREE.Sprite[]>([]);
  const regionShellsRef = useRef<THREE.Mesh[]>([]);
  const coreGroupRef = useRef<THREE.Group | null>(null);
  const coreRafRef = useRef<number>(0);
  const bloomAddedRef = useRef(false);

  useEffect(() => {
    if (!graph.nodes.length) return;
    let raf = 0;
    let rotTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    function regionCentroids(nodes: BrainNode[]) {
      const sums = new Map<RegionKey, { x: number; y: number; z: number; n: number; r2: number }>();
      for (const nd of nodes) {
        if (nd.x == null) continue;
        const a = sums.get(nd.region) ?? { x: 0, y: 0, z: 0, n: 0, r2: 0 };
        a.x += nd.x; a.y += nd.y!; a.z += nd.z!; a.n++;
        sums.set(nd.region, a);
      }
      // second pass: mean squared distance from centroid → real lobe radius
      for (const nd of nodes) {
        if (nd.x == null) continue;
        const a = sums.get(nd.region)!;
        const cx = a.x / a.n, cy = a.y / a.n, cz = a.z / a.n;
        const dx = nd.x - cx, dy = nd.y! - cy, dz = nd.z! - cz;
        a.r2 += dx * dx + dy * dy + dz * dz;
      }
      return sums;
    }

    function buildRegionDecor(scene: THREE.Scene, nodes: BrainNode[]) {
      for (const s of regionLabelsRef.current) scene.remove(s);
      for (const m of regionShellsRef.current) scene.remove(m);
      regionLabelsRef.current = [];
      regionShellsRef.current = [];
      const sums = regionCentroids(nodes);
      for (const [rk, a] of sums) {
        if (!a.n) continue;
        const reg = REGIONS[rk];
        const cx = a.x / a.n, cy = a.y / a.n, cz = a.z / a.n;

        // label — lobe name + REAL node count
        const st = new SpriteText(`${reg.label} · ${a.n}`);
        st.color = reg.color;
        st.fontWeight = "600";
        st.fontFace = "IBM Plex Mono, Menlo, monospace";
        st.textHeight = 15;
        st.backgroundColor = false as unknown as string;
        st.strokeColor = reg.color;
        st.strokeWidth = 0.4;
        st.material.opacity = 0.55;
        st.material.depthWrite = false;
        (st as unknown as { __rk: RegionKey }).__rk = rk;
        st.position.set(cx, cy + 46, cz);
        scene.add(st);
        regionLabelsRef.current.push(st);

        // translucent glow shell — position + radius from the REAL cluster
        // (centroid + RMS spread of the lobe's actual nodes)
        if (rk !== "CORE" && a.n >= 3) {
          const radius = Math.max(28, Math.sqrt(a.r2 / a.n) * 1.45);
          const geo = new THREE.SphereGeometry(radius, 24, 24);
          const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(reg.color),
            transparent: true,
            opacity: 0.055,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const mesh = new THREE.Mesh(geo, mat);
          (mesh as unknown as { __rk: RegionKey }).__rk = rk;
          mesh.position.set(cx, cy, cz);
          scene.add(mesh);
          regionShellsRef.current.push(mesh);
        }
      }
    }

    function buildEnergyCore(scene: THREE.Scene, categoryHubCount: number) {
      if (coreGroupRef.current) {
        scene.remove(coreGroupRef.current);
        coreGroupRef.current = null;
      }
      const group = new THREE.Group();

      // outer glow sphere
      const outerGeo = new THREE.SphereGeometry(18, 24, 24);
      const outerMat = new THREE.MeshBasicMaterial({ color: 0x3b82ff, transparent: true, opacity: 0.22 });
      group.add(new THREE.Mesh(outerGeo, outerMat));

      // inner core
      const innerGeo = new THREE.SphereGeometry(6, 16, 16);
      const innerMat = new THREE.MeshBasicMaterial({ color: 0x9cc2ff });
      group.add(new THREE.Mesh(innerGeo, innerMat));

      // filaments — one per REAL category hub, radiating from the index
      const filamentCount = Math.max(1, categoryHubCount);
      for (let i = 0; i < filamentCount; i++) {
        const angle = (i / filamentCount) * Math.PI * 2;
        const lift = Math.sin((i / filamentCount) * Math.PI * 2) * 14;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(Math.cos(angle) * 20, lift * 0.5, Math.sin(angle) * 20),
          new THREE.Vector3(Math.cos(angle) * 40, lift, Math.sin(angle) * 40),
        ]);
        const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(12));
        const mat = new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.18 });
        group.add(new THREE.Line(geo, mat));
      }

      scene.add(group);
      coreGroupRef.current = group;

      const spin = () => {
        if (!coreGroupRef.current) return;
        coreGroupRef.current.rotation.y += 0.003;
        coreGroupRef.current.rotation.x += 0.001;
        coreRafRef.current = requestAnimationFrame(spin);
      };
      coreRafRef.current = requestAnimationFrame(spin);
    }

    function setup() {
      if (cancelled) return;
      const fg = fgRef.current;
      if (!fg) { raf = requestAnimationFrame(setup); return; }
      const renderer = fg.renderer?.() as THREE.WebGLRenderer | undefined;
      const scene = fg.scene?.() as THREE.Scene | undefined;
      if (!renderer || !scene) { raf = requestAnimationFrame(setup); return; }

      if (!bloomAddedRef.current) {
        bloomAddedRef.current = true;
        renderer.toneMapping = THREE.ReinhardToneMapping;
        renderer.toneMappingExposure = 1.2;
        const composer = (fg as unknown as { postProcessingComposer: () => { addPass: (p: unknown) => void } }).postProcessingComposer();
        const bloom = new UnrealBloomPass(
          new THREE.Vector2(dim.w, dim.h),
          1.6,   // maximal sci-fi glow (Tyler's call) — tamed by tone mapping
          0.9,
          0.0,
        );
        composer.addPass(bloom);
      }

      try {
        fg.d3Force("charge")?.strength((n: BrainNode) => (n.isHub ? -220 : -55));
        const linkForce = fg.d3Force("link");
        if (linkForce) {
          linkForce.distance((l: BrainLink) => {
            if (l.kind === "category" || l.kind === "agent") return 120; // structural spokes
            const ra = graph.regionOf.get(typeof l.source === "object" ? (l.source as BrainNode).id : (l.source as string));
            const rb = graph.regionOf.get(typeof l.target === "object" ? (l.target as BrainNode).id : (l.target as string));
            return ra && rb && ra === rb ? 32 : 100;
          });
        }
        // anatomical lobes: pull every node toward its region's anchor
        fg.d3Force("region", makeRegionForce(0.045));
        fg.d3ReheatSimulation?.();
      } catch { /* best effort */ }

      const RADIUS = 460;
      let angle = 0;
      fg.cameraPosition({ x: 0, y: 60, z: RADIUS });
      rotTimer = setInterval(() => {
        if (document.hidden) return; // hidden tabs: no camera churn
        if (Date.now() - lastInteractRef.current < IDLE_MS) {
          const cam = fg.camera?.();
          if (cam) angle = Math.atan2(cam.position.x, cam.position.z);
          return;
        }
        angle += Math.PI / 1500;
        fg.cameraPosition({
          x: RADIUS * Math.sin(angle),
          y: 110 * Math.sin(angle * 0.35),
          z: RADIUS * Math.cos(angle),
        });
      }, 30);

      const categoryHubs = graph.nodes.filter((n) => n.kind === "category").length;
      buildEnergyCore(scene, categoryHubs);
      buildRegionDecor(scene, graph.nodes);
    }
    raf = requestAnimationFrame(setup);
    const settle = setTimeout(() => {
      const fg = fgRef.current; const scene = fg?.scene?.() as THREE.Scene | undefined;
      if (scene) buildRegionDecor(scene, graph.nodes);
    }, 4500);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(coreRafRef.current);
      clearTimeout(settle);
      if (rotTimer) clearInterval(rotTimer);
      const scene = fgRef.current?.scene?.() as THREE.Scene | undefined;
      if (scene) {
        for (const s of regionLabelsRef.current) scene.remove(s);
        for (const m of regionShellsRef.current) scene.remove(m);
        if (coreGroupRef.current) scene.remove(coreGroupRef.current);
      }
      regionLabelsRef.current = [];
      regionShellsRef.current = [];
      coreGroupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // ── focus: fade lobe decor ──────────────────────────────────────────────────
  useEffect(() => {
    for (const s of regionLabelsRef.current) {
      const rk = (s as unknown as { __rk?: RegionKey }).__rk;
      s.material.opacity = !focusRegion || rk === focusRegion ? 0.55 : 0.08;
    }
    for (const m of regionShellsRef.current) {
      const rk = (m as unknown as { __rk?: RegionKey }).__rk;
      (m.material as THREE.MeshBasicMaterial).opacity = !focusRegion || rk === focusRegion ? 0.055 : 0.012;
    }
  }, [focusRegion, pulseVersion]);

  // ── LIVE PULSE (only notes that really appeared since the last poll) ────────
  useEffect(() => {
    if (!graph.nodes.length) return;
    const ids = new Set(graph.nodes.map((n) => n.id));
    if (prevIdsRef.current.size === 0) { prevIdsRef.current = ids; return; }
    const news: string[] = [];
    for (const id of ids) if (!prevIdsRef.current.has(id)) news.push(id);
    if (news.length) {
      const pct = ids.size > 0 ? ((news.length / ids.size) * 100).toFixed(1) : "0.0";
      setActivityPct(pct);
      const end = Date.now() + PULSE_MS;
      for (const id of news) pulseRef.current.set(id, end);
      startPulseLoop();
    } else {
      setActivityPct("0.0");
    }
    prevIdsRef.current = ids;
  }, [graph.nodes, startPulseLoop]);

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedMeta = selectedNode?.kind === "note" && selectedNode.noteId
    ? notesById.get(selectedNode.noteId) ?? null
    : null;

  // full note body on demand (bodies are no longer in the graph payload)
  const { data: noteDetail } = useQuery({
    queryKey: ["fleet-kb", "note", selectedMeta?.id],
    queryFn: () => fleetKbApi.getNote(selectedMeta!.id),
    enabled: !!selectedMeta,
    staleTime: 300_000,
  });

  const relatedLinks = useMemo(() => {
    if (!selectedNodeId) return [] as Array<{ id: string; title: string; region: RegionKey; color: string }>;
    const out: Array<{ id: string; title: string; region: RegionKey; color: string }> = [];
    const seen = new Set<string>();
    for (const e of data?.graph?.edges ?? []) {
      if (e.kind !== "related" && e.kind !== "link") continue;
      let other: string | null = null;
      if (e.source === selectedNodeId) other = e.target;
      else if (e.target === selectedNodeId) other = e.source;
      if (!other || seen.has(other)) continue;
      const on = nodeById.get(other);
      if (!on || on.kind !== "note") continue;
      seen.add(other);
      out.push({ id: other, title: on.label, region: on.region, color: on.color });
    }
    return out.slice(0, 24);
  }, [selectedNodeId, data, nodeById]);

  // ── camera fly-to ───────────────────────────────────────────────────────────
  const flyTo = useCallback((id: string) => {
    const fg = fgRef.current;
    if (!fg) return;
    const n = nodeById.get(id) as (BrainNode & { x?: number; y?: number; z?: number }) | undefined;
    if (!n || n.x == null) return;
    bump();
    const dist = 120;
    const r = 1 + dist / Math.max(1, Math.hypot(n.x, n.y ?? 0, n.z ?? 0));
    fg.cameraPosition({ x: n.x * r, y: (n.y ?? 0) * r, z: (n.z ?? 0) * r }, n, 1400);
  }, [nodeById, bump]);

  const handleNodeClick = useCallback((node: BrainNode) => {
    bump();
    if (node.kind === "note") setSelectedNodeId(node.id);
  }, [bump]);

  const jumpToRelated = useCallback((id: string) => {
    setSelectedNodeId(id);
    flyTo(id);
  }, [flyTo]);

  // ── toggles ─────────────────────────────────────────────────────────────────
  const toggleAgent = useCallback((id: string) => {
    bump();
    setSelectedAgents((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, [bump]);
  const toggleCat = useCallback((key: string) => {
    bump();
    setSelectedCats((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }, [bump]);
  const toggleRegion = useCallback((key: RegionKey) => {
    bump();
    setFocusRegion((prev) => (prev === key ? null : key));
  }, [bump]);
  const resetAll = useCallback(() => {
    bump();
    setSearchQuery(""); setFocusRegion(null);
    setSelectedAgents(new Set()); setSelectedCats(new Set());
  }, [bump]);

  const matchCount = matchSet ? matchSet.size : 0;

  const panel: CSSProperties = {
    background: T.surface1,
    border: T.border,
    borderRadius: T.radius,
    backdropFilter: "blur(10px)",
  };

  const chipStyle = (on: boolean, color: string) => ({
    border: on ? `1px solid ${color}` : T.border,
    background: on ? `${color}26` : T.surface2,
    color: on ? color : T.textSecondary,
    boxShadow: on ? `0 0 10px ${color}55` : "none",
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="relative w-full overflow-hidden" style={{ height: "100%", background: T.canvas }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div
        className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-4 py-2"
        style={{ background: "rgba(6,9,15,0.72)", borderBottom: T.border, backdropFilter: "blur(10px)" }}
      >
        <div className="flex items-center gap-2">
          <Brain size={16} style={{ color: T.accent }} />
          <span
            className="text-xs font-semibold tracking-widest"
            style={{ color: T.textPrimary, fontFamily: MONO, letterSpacing: "0.18em" }}
          >
            FLEET BRAIN · NEURAL COMMAND NETWORK
          </span>
        </div>
        <div className="flex items-center gap-4 text-[10px]" style={{ fontFamily: MONO, color: T.textSecondary }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: T.success, boxShadow: `0 0 6px ${T.success}` }} />
            LIVE
          </span>
          {latency !== null && (
            <span className="inline-flex items-center gap-1">
              <Wifi size={10} /> {latency}ms
            </span>
          )}
          <button
            onClick={() => { bump(); refetch(); }}
            title="Refresh"
            className="inline-flex items-center gap-1 rounded p-1 transition hover:text-white"
            style={{ border: T.border, background: T.surface2, color: T.textSecondary }}
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          </button>
          <button
            onClick={onShowKb}
            title="Open Fleet KB"
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 transition hover:text-white"
            style={{ border: `1px solid ${T.automation}59`, background: T.surface2, color: T.textSecondary }}
          >
            <BookOpen size={11} style={{ color: T.automation }} /> KB
          </button>
        </div>
      </div>

      {/* ── LEFT CONTROL DECK (search · filters) ────────────────────────── */}
      {!isLoading && !isError && data?.available && graph.nodes.length > 0 && (
        <div className="absolute left-4 top-16 z-20 flex flex-col gap-2" style={{ width: 280 }}>
          <div className="flex items-center gap-2 px-2.5 py-1.5" style={panel}>
            <Search size={14} style={{ color: T.analytics }} />
            <input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); bump(); }}
              onFocus={bump}
              placeholder="search neurons…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-gray-600"
              style={{ fontFamily: MONO, color: T.textPrimary }}
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(""); bump(); }} style={{ color: T.textTertiary }} className="transition hover:text-white">
                <X size={13} />
              </button>
            )}
          </div>
          {searchQuery && (
            <div className="px-1 text-[10px]" style={{ color: T.textSecondary, fontFamily: MONO, letterSpacing: "0.08em" }}>
              {matchCount} NEURON{matchCount === 1 ? "" : "S"} HIGHLIGHTED
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {(data?.categories ?? []).slice(0, 8).map((c) => (
              <button
                key={c.key}
                onClick={() => toggleCat(c.key)}
                className="rounded-full px-2 py-0.5 text-[10px] transition"
                style={{ ...chipStyle(selectedCats.has(c.key), c.key === "decision" ? T.automation : T.critical), fontFamily: MONO }}
              >
                {c.label} · {c.count}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(data?.agents ?? []).map((a) => (
              <button
                key={a.id}
                onClick={() => toggleAgent(a.id)}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition"
                style={{ ...chipStyle(selectedAgents.has(a.id), T.warning), fontFamily: MONO }}
                title={`agent ${a.id}`}
              >
                <Bot size={10} /> {a.id.slice(0, 6)} · {a.count}
              </button>
            ))}
          </div>
          {hasNarrowing && (
            <button
              onClick={resetAll}
              className="self-start rounded-md px-2 py-0.5 text-[10px] transition hover:text-white"
              style={{ border: T.border, background: T.surface2, color: T.textSecondary, fontFamily: MONO, letterSpacing: "0.08em" }}
            >
              ✕ CLEAR FILTERS
            </button>
          )}
        </div>
      )}

      {/* ── LEGEND (right side) — lobes = real vault categories ─────────── */}
      <div
        className="absolute right-4 top-16 z-20 p-3 text-right"
        style={{ ...panel, fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", lineHeight: 1.7, maxWidth: 290 }}
      >
        <div className="mb-1 text-[9px]" style={{ color: T.textTertiary }}>CLICK A LOBE TO FOCUS</div>
        {presentRegions.map((r) => {
          const active = focusRegion === r.key;
          const faded = focusRegion != null && !active;
          return (
            <button
              key={r.key}
              onClick={() => toggleRegion(r.key)}
              className="flex w-full items-center justify-end gap-2 rounded px-1 transition hover:bg-white/5"
              style={{ opacity: faded ? 0.35 : 1, background: active ? `${r.color}1f` : "transparent" }}
            >
              <span style={{ color: r.color, fontWeight: active ? 700 : 400 }}>{r.label}</span>
              <span style={{ color: T.textTertiary }}>{r.role}</span>
              <span style={{ color: T.textTertiary, opacity: 0.8 }}>{r.count}</span>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: r.color, boxShadow: `0 0 8px ${r.color}` }} />
            </button>
          );
        })}
      </div>

      {/* ── HOVER TOOLTIP ───────────────────────────────────────────────── */}
      {hover && (
        <div
          className="pointer-events-none absolute left-1/2 top-12 z-20 -translate-x-1/2 rounded-md px-3 py-1.5 text-xs"
          style={{ background: T.surface2, border: T.border, color: T.textPrimary, backdropFilter: "blur(6px)" }}
        >
          <span style={{ color: hover.color }}>●</span>{" "}
          <span className="font-medium">{hover.label}</span>{" "}
          <span style={{ color: T.textTertiary }}>· {REGIONS[hover.region].label}</span>
          {hover.recent && <span style={{ color: REGIONS[hover.region].bright }}> · updated &lt;24h</span>}
        </div>
      )}

      {/* ── BOTTOM HUD STRIP ────────────────────────────────────────────── */}
      {!isLoading && !isError && data?.available && graph.nodes.length > 0 && (
        <div className="absolute bottom-4 left-4 right-4 z-20 flex items-end gap-3">
          {/* Fleet Brain Overview */}
          <div className="flex flex-col gap-1.5 p-3" style={{ ...panel, width: 230 }}>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider" style={{ color: T.textPrimary, fontFamily: MONO }}>
              <Brain size={12} /> FLEET BRAIN OVERVIEW
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]" style={{ fontFamily: MONO }}>
              <span style={{ color: T.textTertiary }}>Neurons</span>
              <span className="text-right" style={{ color: T.textPrimary }}>{totalNodes}</span>
              <span style={{ color: T.textTertiary }}>Synapses</span>
              <span className="text-right" style={{ color: T.textPrimary }}>{totalLinks}</span>
              <span style={{ color: T.textTertiary }}>Activity</span>
              <span className="text-right" style={{ color: activityPct !== "—" ? T.success : T.textSecondary }}>{activityPct}%</span>
              <span style={{ color: T.textTertiary }}>Coherence</span>
              <span className="text-right" style={{ color: T.textPrimary }}>{coherencePct}%</span>
              <span style={{ color: T.textTertiary }}>Hot &lt;24h</span>
              <span className="text-right" style={{ color: recentCount > 0 ? T.warning : T.textSecondary }}>{recentCount}</span>
            </div>
          </div>

          {/* Dreams — latest consolidation log (real values only) */}
          <div className="flex flex-1 flex-col gap-1.5 p-3" style={{ ...panel, minWidth: 200 }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider" style={{ color: T.analytics, fontFamily: MONO }}>
                <Zap size={12} /> DREAMS · CONSOLIDATION
              </div>
              <span className="text-[9px]" style={{ color: T.textTertiary, fontFamily: MONO }}>
                {dreamsData?.date ?? "—"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10px]" style={{ fontFamily: MONO }}>
              <span style={{ color: T.textTertiary }}>Logs:</span>
              <span style={{ color: T.textPrimary }}>{dreamsData?.noteCount ?? 0}</span>
              {dreamsData?.dirsConsolidated != null && (
                <>
                  <span style={{ color: T.textTertiary }}>Dirs:</span>
                  <span style={{ color: T.textPrimary }}>{dreamsData.dirsConsolidated}</span>
                </>
              )}
              {dreamsData?.failures != null && (
                <>
                  <span style={{ color: T.textTertiary }}>Failures:</span>
                  <span style={{ color: dreamsData.failures > 0 ? T.critical : T.success }}>{dreamsData.failures}</span>
                </>
              )}
              {dreamsData?.filename && (
                <span className="truncate" style={{ color: T.textTertiary }}>{dreamsData.filename}</span>
              )}
            </div>
            <div className="max-h-20 overflow-y-auto text-[10px] leading-relaxed" style={{ fontFamily: MONO, color: T.textSecondary }}>
              {dreamsData?.content ? (
                dreamsData.content.slice(0, 360).replace(/\n/g, " ").replace(/\s+/g, " ") + (dreamsData.content.length > 360 ? "…" : "")
              ) : (
                <span className="italic opacity-50">No consolidation data available.</span>
              )}
            </div>
          </div>

          {/* Signal Flow — real share of neurons per lobe */}
          <div className="flex flex-col gap-1.5 p-3" style={{ ...panel, width: 250 }}>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider" style={{ color: T.warning, fontFamily: MONO }}>
              <Activity size={12} /> SIGNAL FLOW
            </div>
            <div className="mt-1 flex flex-col gap-1.5">
              {presentRegions.map((r) => {
                const pct = totalNodes > 0 ? ((r.count / totalNodes) * 100).toFixed(1) : "0.0";
                return (
                  <div key={r.key} className="flex items-center gap-2">
                    <span className="w-20 text-[9px] uppercase" style={{ color: r.color }}>{r.label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-1000"
                        style={{ width: `${pct}%`, background: r.color, boxShadow: `0 0 6px ${r.color}66` }}
                      />
                    </div>
                    <span className="w-8 text-[9px] text-right" style={{ color: T.textSecondary }}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── STATES ──────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex h-full items-center justify-center text-sm" style={{ color: T.accent, fontFamily: MONO, letterSpacing: "0.2em" }}>
          INITIALIZING SYNAPSES…
        </div>
      )}
      {isError && (
        <div className="flex h-full items-center justify-center text-sm" style={{ color: T.critical }}>Failed to load Fleet KB graph.</div>
      )}
      {!isLoading && !isError && data?.available === false && (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm" style={{ color: T.textTertiary }}>
          <div>Fleet KB vault not found.</div>
          <code className="text-[11px]" style={{ color: T.textTertiary }}>{data.vaultPath}</code>
        </div>
      )}

      {/* ── THE BRAIN ───────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ touchAction: "none" }}
        onPointerDown={bump}
        onPointerMove={bump}
        onWheel={bump}
      >
        {!isLoading && !isError && data?.available && graph.nodes.length > 0 && (
          <ForceGraph3D<BrainNode, BrainLink>
            ref={fgRef}
            width={dim.w}
            height={dim.h}
            graphData={graph}
            backgroundColor={T.canvas}
            showNavInfo={false}
            nodeRelSize={4}
            nodeVal={nodeValFn}
            nodeColor={nodeColorFn}
            nodeOpacity={0.92}
            nodeResolution={8}
            nodeThreeObjectExtend={true}
            nodeThreeObject={nodeThreeObject}
            nodeLabel={(n) => `${n.label} · ${REGIONS[n.region].label}`}
            linkColor={linkColorFn}
            linkOpacity={0.14}
            linkWidth={0.4}
            linkCurvature={0.22}
            linkDirectionalParticles={linkParticlesFn}
            linkDirectionalParticleWidth="pwidth"
            linkDirectionalParticleSpeed="pspeed"
            linkDirectionalParticleColor="color"
            linkDirectionalParticleResolution={4}
            warmupTicks={120}
            cooldownTime={8000}
            onNodeHover={(n) => { setHover((n as BrainNode) ?? null); bump(); }}
            onNodeClick={(n) => handleNodeClick(n as BrainNode)}
          />
        )}
      </div>

      {/* ── NOTE DETAIL CARD ────────────────────────────────────────────── */}
      {selectedMeta && (
        <aside
          className="absolute right-4 top-32 z-30 flex max-h-[70vh] w-[400px] flex-col overflow-hidden"
          style={{ background: "rgba(13,19,29,0.94)", border: T.border, borderRadius: T.radius + 4, backdropFilter: "blur(10px)" }}
        >
          <div className="flex items-start gap-2 px-4 pb-3 pt-3" style={{ borderBottom: T.border }}>
            <FileText size={16} className="mt-0.5 shrink-0" style={{ color: selectedNode?.color ?? T.accent }} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-snug" style={{ color: T.textPrimary }}>{selectedMeta.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ color: T.textTertiary }}>
                {selectedMeta.date && <span>{selectedMeta.date}</span>}
                <span className="rounded px-1.5 py-0.5" style={{ background: "rgba(255,255,255,0.06)" }}>{selectedMeta.categoryLabel}</span>
                {selectedMeta.agentId && (
                  <span className="inline-flex items-center gap-1" style={{ color: T.warning }}>
                    <Bot size={11} /> {selectedMeta.agentId.slice(0, 8)}
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => setSelectedNodeId(null)} className="rounded p-1 transition hover:bg-white/5 hover:text-white" style={{ color: T.textTertiary }}>
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 text-[12px] leading-relaxed" style={{ color: T.textSecondary }}>
            {noteDetail?.note.body?.slice(0, 1200) || selectedMeta.excerpt || "No preview available."}

            {relatedLinks.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: T.textTertiary, fontFamily: MONO }}>
                  <Link2 size={11} /> Related neurons · {relatedLinks.length}
                </div>
                <div className="flex flex-col gap-1">
                  {relatedLinks.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => jumpToRelated(r.id)}
                      title="Fly to this neuron"
                      className="group flex items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition hover:bg-white/5 hover:text-white"
                      style={{ border: T.border, color: T.textSecondary }}
                    >
                      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 99, background: r.color, boxShadow: `0 0 6px ${r.color}`, flexShrink: 0 }} />
                      <span className="min-w-0 flex-1 truncate">{r.title}</span>
                      <ExternalLink size={11} className="shrink-0 opacity-40 transition group-hover:opacity-90" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onShowKb}
            className="m-3 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs transition hover:bg-white/5"
            style={{ border: T.border, color: T.textSecondary }}
          >
            <ExternalLink size={13} /> Open in Fleet KB reader
          </button>
        </aside>
      )}
    </div>
  );
}

export default FleetBrainView;
