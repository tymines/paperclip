/**
 * Knowledge Graph v2 — renderer composition.
 *
 * Spec sections this module implements (phase D):
 *   §2 — Selected-node pulse + PBR materials + IcosahedronGeometry
 *   §3 — Recency-opacity edges
 *   §4 — Drifting starfield (vignette is owned by KnowledgeGraph.tsx)
 *   §7 — Frustum culling + LOD + instanced halos + FPS overlay
 *   §labels — Troika SDF text labels
 *
 * The component wraps <ForceGraph3D> for the standard view mode. Neuromorphic
 * mode still mounts the inline ForceGraph3D in KnowledgeGraph.tsx because its
 * particle clouds + lightning arcs don't fit the v2 visual language.
 *
 * Coordination contract (phase D parallel session):
 *   - This file owns the ForceGraph3D mount visual props (node factory,
 *     link color, particle config).
 *   - It does NOT own `enableNavigationControls`, OrbitControls config, or
 *     pointer-event wiring — those are passed through from the caller and
 *     fixed by the camera-regression session on v2-controls.tsx.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { Text as TroikaText } from "troika-three-text";

import {
  ANIMATION_TIMINGS,
  ENTITY_COLORS,
  LOD_THRESHOLDS,
  NEUTRAL,
  NODE_GEOMETRY,
  NODE_TYPE_TO_ENTITY,
  STARFIELD,
  computeNodeRadius,
  lodTierForDistance,
  recencyAlpha,
  withAlpha,
  type EntityKind,
} from "./v2-tokens";

/* ── Public types ──────────────────────────────────────────────────────── */

export interface V2GraphNode {
  id: string;
  type: string;
  label: string;
  isNew?: boolean;
  createdAt: Date | string | number;
  x?: number;
  y?: number;
  z?: number;
}

export interface V2GraphLink {
  source: string | V2GraphNode;
  target: string | V2GraphNode;
  type: string;
  lastTouchedAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
  createdAt?: Date | string | number | null;
}

export interface V2RendererProps<
  N extends V2GraphNode = V2GraphNode,
  L extends V2GraphLink = V2GraphLink,
> {
  graphData: { nodes: N[]; links: L[] };
  width: number;
  height: number;
  /** Shared with page so its existing per-frame effects keep working. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fgRef: React.MutableRefObject<any>;
  /** Currently hovered node — drives halo + label visibility. */
  hoveredId: string | null;
  /** Currently selected node — drives pulse + halo + label visibility. */
  selectedId: string | null;
  /** Edge count per node id — drives radius and label visibility heuristics. */
  edgeCountByNode: Map<string, number>;
  /** Mobile flag — disables some effects, lifts hit-target sizes. */
  isMobile: boolean;
  /** Cooldowns and warmup ticks — passed through to ForceGraph3D. */
  warmupTicks: number;
  cooldownTicks: number;
  d3AlphaDecay: number;
  d3VelocityDecay: number;
  /** ForceGraph3D event callbacks. */
  onNodeClick(node: N): void;
  onNodeHover(node: N | null): void;
  onBackgroundClick(): void;
  onEngineStop?(): void;
  /** Override link particle counts (path highlights, hover, etc.). */
  linkParticles?(link: L): number;
  linkParticleSpeed?(link: L): number;
  linkParticleColor?(link: L): string;
  /** Optional callback so the page can still tint edges for path/highlight. */
  linkColorOverride?(link: L): string | null;
  /** Optional escape hatch for the page's existing instanced-mesh placeholder. */
  isPlaceholderNode?(node: N): boolean;
  /** Optional override for label text (defaults to `node.label`). */
  labelFor?(node: N): string;
}

/* ── Shared materials & geometry (allocated once, mutated never) ───────── */

const ICO_GEOMETRY = new THREE.IcosahedronGeometry(1, 1);

interface NodeMaterialBundle {
  pbr: THREE.MeshStandardMaterial;
  basic: THREE.MeshBasicMaterial;
}

/**
 * Pre-built material bundles per EntityKind so the LOD swap is a reference
 * change rather than a `new THREE.Material()` in the render loop.
 */
const ENTITY_MATERIALS: Record<EntityKind, NodeMaterialBundle> = (() => {
  const out = {} as Record<EntityKind, NodeMaterialBundle>;
  (Object.keys(ENTITY_COLORS) as EntityKind[]).forEach((kind) => {
    const hex = ENTITY_COLORS[kind].hex;
    const color = new THREE.Color(hex);
    out[kind] = {
      pbr: new THREE.MeshStandardMaterial({
        color,
        roughness: 0.4,
        metalness: 0.15,
        emissive: color.clone(),
        emissiveIntensity: NODE_GEOMETRY.emissiveIntensity.default,
        transparent: true,
        opacity: 0.95,
      }),
      basic: new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
      }),
    };
  });
  return out;
})();

/* ── Halo texture (radial gradient → transparent) ─────────────────────── */

function buildHaloTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.05,
      size / 2,
      size / 2,
      size / 2,
    );
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.4)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

let _haloTexture: THREE.CanvasTexture | null = null;
function getHaloTexture(): THREE.CanvasTexture {
  if (!_haloTexture) _haloTexture = buildHaloTexture();
  return _haloTexture;
}

/* ── Per-node Three object factory ────────────────────────────────────── */

interface NodeFactoryArgs {
  entity: EntityKind;
  radius: number;
}

interface NodeUserData {
  v2Kind: EntityKind;
  v2Radius: number;
  v2BaseEmissive: number;
  v2LodTier: "pbr" | "standard" | "wireframe" | "point";
}

function makeV2NodeMesh({ entity, radius }: NodeFactoryArgs): THREE.Mesh {
  const mat = ENTITY_MATERIALS[entity].pbr.clone();
  // Clone color so per-node selection/hover tinting doesn't bleed across nodes.
  mat.color = mat.color.clone();
  mat.emissive = mat.emissive.clone();
  const mesh = new THREE.Mesh(ICO_GEOMETRY, mat);
  mesh.scale.setScalar(radius);
  const ud: NodeUserData = {
    v2Kind: entity,
    v2Radius: radius,
    v2BaseEmissive: NODE_GEOMETRY.emissiveIntensity.default,
    v2LodTier: "pbr",
  };
  Object.assign(mesh.userData, ud);
  return mesh;
}

/* ── Pre-allocated scratch ────────────────────────────────────────────── */

const _matrix = new THREE.Matrix4();
const _dummyObj = new THREE.Object3D();
const _frustum = new THREE.Frustum();
const _projMx = new THREE.Matrix4();
const _camPos = new THREE.Vector3();
const _nodePos = new THREE.Vector3();
const _haloColor = new THREE.Color();
const _haloQuat = new THREE.Quaternion();
const _haloScale = new THREE.Vector3();

/* ── FPS tracker for the overlay (renderer-owned, independent from page) */

class V2FpsTracker {
  private samples: number[] = [];
  private windowMs = 1000;
  fps = 0;
  tick(now: number) {
    this.samples.push(now);
    const cutoff = now - this.windowMs;
    while (this.samples.length && this.samples[0] < cutoff) this.samples.shift();
    if (this.samples.length > 1) {
      const elapsed = this.samples[this.samples.length - 1] - this.samples[0];
      this.fps = elapsed > 0 ? ((this.samples.length - 1) / elapsed) * 1000 : 0;
    }
  }
}

function isFpsDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.search.includes("debug=fps")) return true;
  // Production-safe: also gate on a localStorage flag for ad-hoc debugging.
  try {
    return window.localStorage.getItem("kg-debug-fps") === "1";
  } catch {
    return false;
  }
}

/* ── Component ────────────────────────────────────────────────────────── */

export function V2Renderer<
  N extends V2GraphNode = V2GraphNode,
  L extends V2GraphLink = V2GraphLink,
>(props: V2RendererProps<N, L>) {
  const {
    graphData,
    width,
    height,
    fgRef,
    hoveredId,
    selectedId,
    edgeCountByNode,
    isMobile,
    warmupTicks,
    cooldownTicks,
    d3AlphaDecay,
    d3VelocityDecay,
    onNodeClick,
    onNodeHover,
    onBackgroundClick,
    onEngineStop,
    linkParticles,
    linkParticleSpeed,
    linkParticleColor,
    linkColorOverride,
    isPlaceholderNode,
    labelFor,
  } = props;

  // Latest-state refs so the rAF loop reads fresh values without re-binding.
  const hoveredIdRef = useRef<string | null>(hoveredId);
  const selectedIdRef = useRef<string | null>(selectedId);
  hoveredIdRef.current = hoveredId;
  selectedIdRef.current = selectedId;

  const edgeCountRef = useRef(edgeCountByNode);
  edgeCountRef.current = edgeCountByNode;

  const linkColorOverrideRef = useRef(linkColorOverride);
  linkColorOverrideRef.current = linkColorOverride;

  /* ── Node factory ───────────────────────────────────────────────────── */

  const nodeThreeObject = useCallback(
    (node: N): THREE.Object3D => {
      if (isPlaceholderNode?.(node)) {
        // Page's existing InstancedMesh draws these — return invisible stub.
        const geo = new THREE.SphereGeometry(0.5, 4, 2);
        const mat = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        return new THREE.Mesh(geo, mat);
      }
      const entity: EntityKind =
        (NODE_TYPE_TO_ENTITY[node.type] as EntityKind | undefined) ?? "memory";
      const edges = edgeCountByNode.get(node.id) ?? 0;
      const radius = computeNodeRadius(edges, node.type === "hub");
      const mesh = makeV2NodeMesh({ entity, radius });
      mesh.userData.v2NodeId = node.id;
      mesh.userData.v2IsNew = node.isNew === true;
      return mesh;
    },
    [edgeCountByNode, isPlaceholderNode],
  );

  /* ── Link color: recency + override ─────────────────────────────────── */

  const linkColor = useCallback(
    (link: L): string => {
      const override = linkColorOverrideRef.current?.(link);
      if (override) return override;
      // GraphLink may not carry lastTouchedAt yet — fall back to updatedAt /
      // createdAt or the source node's createdAt as the recency signal.
      const ts =
        link.lastTouchedAt ??
        link.updatedAt ??
        link.createdAt ??
        (typeof link.source === "object"
          ? (link.source as V2GraphNode).createdAt
          : null);
      const alpha = recencyAlpha(ts);
      return withAlpha(NEUTRAL.linkDefault, alpha);
    },
    [],
  );

  /* ── Starfield: scene group + per-frame Y rotation, pauses on hidden ── */

  const starfieldRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || typeof fg.scene !== "function") return;
    const scene = fg.scene() as THREE.Scene;

    const group = new THREE.Group();
    group.name = "v2-starfield";

    const { pointCount, radius, sizeRange, alphaRange } = STARFIELD;
    const positions = new Float32Array(pointCount * 3);
    const sizes = new Float32Array(pointCount);
    const colors = new Float32Array(pointCount * 3);

    for (let i = 0; i < pointCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = radius * Math.cbrt(Math.random());
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      sizes[i] = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
      const a = alphaRange[0] + Math.random() * (alphaRange[1] - alphaRange[0]);
      // Pre-multiplied alpha into white so PointsMaterial's flat opacity stays simple.
      colors[i * 3] = a;
      colors[i * 3 + 1] = a;
      colors[i * 3 + 2] = a;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 1,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    group.add(points);
    scene.add(group);
    starfieldRef.current = group;

    return () => {
      scene.remove(group);
      geo.dispose();
      mat.dispose();
      starfieldRef.current = null;
    };
  }, [fgRef, width, height]);

  /* ── Instanced halo mesh — single draw call for all hover/selected glow */

  const haloMeshRef = useRef<THREE.InstancedMesh | null>(null);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || typeof fg.scene !== "function") return;
    const scene = fg.scene() as THREE.Scene;

    // Allocate for up to graphData.nodes.length halos. We update count per frame.
    const capacity = Math.max(64, graphData.nodes.length);
    const geo = new THREE.PlaneGeometry(2, 2);
    const mat = new THREE.MeshBasicMaterial({
      map: getHaloTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, capacity);
    mesh.name = "v2-halos";
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    scene.add(mesh);
    haloMeshRef.current = mesh;

    return () => {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      haloMeshRef.current = null;
    };
  }, [fgRef, graphData.nodes.length]);

  /* ── Troika SDF labels — managed per node, visibility gated by zoom ─── */

  // Map node id → TroikaText. We create lazily on first frame and never
  // recreate; only update text content if the label changes.
  const labelsRef = useRef<Map<string, TroikaText>>(new Map());

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || typeof fg.scene !== "function") return;
    const scene = fg.scene() as THREE.Scene;
    const labels = labelsRef.current;

    // Sync map keys with current node ids.
    const presentIds = new Set(graphData.nodes.map((n) => n.id));
    for (const [id, text] of labels) {
      if (!presentIds.has(id)) {
        scene.remove(text);
        text.dispose();
        labels.delete(id);
      }
    }

    for (const node of graphData.nodes) {
      let text = labels.get(node.id);
      if (!text) {
        text = new TroikaText();
        // Troika ships its own bundled Roboto fallback — leaving font
        // unset avoids a network fetch and works offline.
        text.fontSize = 4.8;
        text.fontWeight = 500;
        text.color = 0xe8ecf2;
        text.anchorX = "center";
        text.anchorY = "bottom";
        text.outlineWidth = 0.35;
        text.outlineColor = 0x000000;
        text.outlineOpacity = 0.7;
        // depthOffset pushes the label toward the camera in eye-space so
        // it never z-fights with the node it's labeling. Cheaper and
        // safer than swapping Troika's own SDF material.
        text.depthOffset = -2;
        text.renderOrder = 10;
        text.visible = false;
        scene.add(text);
        labels.set(node.id, text);
      }
      const desired = labelFor ? labelFor(node) : node.label;
      if (text.text !== desired) {
        text.text = desired;
        text.sync();
      }
    }

    return () => {
      // Don't dispose on every render — only on unmount.
    };
  }, [fgRef, graphData.nodes, labelFor]);

  // Final unmount cleanup for labels.
  useEffect(() => {
    return () => {
      const labels = labelsRef.current;
      const fg = fgRef.current;
      const scene = fg && typeof fg.scene === "function" ? (fg.scene() as THREE.Scene) : null;
      for (const text of labels.values()) {
        if (scene) scene.remove(text);
        text.dispose();
      }
      labels.clear();
    };
  }, [fgRef]);

  /* ── Per-frame loop: pulse / LOD / halos / labels / starfield / FPS ─── */

  const fpsTracker = useRef(new V2FpsTracker()).current;
  const [fpsReading, setFpsReading] = useState(0);
  const fpsDebug = useMemo(() => isFpsDebugEnabled(), []);
  const fpsUiTickRef = useRef(0);
  const visibilityRef = useRef<boolean>(
    typeof document !== "undefined" ? document.visibilityState !== "hidden" : true,
  );

  useEffect(() => {
    const onVis = () => {
      visibilityRef.current = document.visibilityState !== "hidden";
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      fpsTracker.tick(now);

      if (!visibilityRef.current) {
        // Spec §4: pause starfield rotation while tab hidden. Also bail
        // on the rest of the loop — react-force-graph keeps its own
        // animation, but we don't add per-frame work here.
        return;
      }

      const fg = fgRef.current;
      if (!fg || typeof fg.scene !== "function") return;

      // Starfield drift — gentle Y rotation.
      const star = starfieldRef.current;
      if (star) star.rotation.y += ANIMATION_TIMINGS.starfieldRotationPerFrame;

      const camera = fg.camera() as THREE.PerspectiveCamera | undefined;
      if (!camera) return;
      camera.getWorldPosition(_camPos);
      _projMx.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projMx);

      // Compute selected pulse value once per frame.
      const t = (now % ANIMATION_TIMINGS.selectedPulsePeriodMs) /
        ANIMATION_TIMINGS.selectedPulsePeriodMs;
      // Smooth easeInOutSine from 0..1..0
      const pulsePhase = 0.5 * (1 - Math.cos(2 * Math.PI * t));
      const [pulseMin, pulseMax] = ANIMATION_TIMINGS.selectedPulseRange;
      const pulseScale = pulseMin + (pulseMax - pulseMin) * pulsePhase;
      const pulseEmissive = NODE_GEOMETRY.emissiveIntensity.selected -
        (NODE_GEOMETRY.emissiveIntensity.selected -
          NODE_GEOMETRY.emissiveIntensity.default) *
          (1 - pulsePhase);

      // Walk nodes and apply LOD / pulse / label visibility / halo state.
      const halo = haloMeshRef.current;
      const gNodes = (
        typeof fg.graphData === "function" ? fg.graphData().nodes : graphData.nodes
      ) as N[];
      let haloIdx = 0;
      const hovered = hoveredIdRef.current;
      const selected = selectedIdRef.current;
      const camDistSqGate = 250 ** 2; // labels off past 250 world units

      for (const node of gNodes) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj = (node as any).__threeObj as THREE.Object3D | undefined;
        if (
          !obj ||
          typeof node.x !== "number" ||
          typeof node.y !== "number" ||
          typeof node.z !== "number"
        ) {
          continue;
        }
        _nodePos.set(node.x, node.y, node.z);
        const camDist = _nodePos.distanceTo(_camPos);

        // Skip frustum cull on tiny graphs (overhead exceeds savings).
        const skipFrustum = isMobile && gNodes.length < 80;
        const inFrustum = skipFrustum ? true : _frustum.containsPoint(_nodePos);

        // Map to NodeUserData if this object was built by our factory.
        const ud = obj.userData as Partial<NodeUserData>;
        const isV2Node = ud.v2Kind != null && ud.v2Radius != null;

        if (isV2Node) {
          // LOD: track tier per node so future renderer-level material
          // swaps remain zero-allocation. Visibility itself is owned by
          // the page's existing per-frame loop (zoom-level driven), so
          // we deliberately don't touch mesh.visible here to avoid a
          // two-rAF write race.
          ud.v2LodTier = lodTierForDistance(camDist);
          const mesh = obj as THREE.Mesh;

          // Selected pulse: scale and emissive intensity.
          if (selected === node.id) {
            mesh.scale.setScalar(ud.v2Radius! * pulseScale);
            const m = mesh.material as THREE.MeshStandardMaterial;
            if ("emissiveIntensity" in m) m.emissiveIntensity = pulseEmissive;
          } else if (hovered === node.id) {
            // Static hover scale — no breathing animation.
            const k = 1.12;
            mesh.scale.setScalar(ud.v2Radius! * k);
            const m = mesh.material as THREE.MeshStandardMaterial;
            if ("emissiveIntensity" in m) m.emissiveIntensity = NODE_GEOMETRY.emissiveIntensity.hover;
          } else {
            mesh.scale.setScalar(ud.v2Radius!);
            const m = mesh.material as THREE.MeshStandardMaterial;
            if ("emissiveIntensity" in m) m.emissiveIntensity = ud.v2BaseEmissive ?? NODE_GEOMETRY.emissiveIntensity.default;
          }
        }

        // Halo: render for hovered, selected, and isNew nodes.
        const wantHalo =
          (hovered === node.id ||
            selected === node.id ||
            (node.isNew === true)) &&
          inFrustum;
        if (halo && wantHalo && haloIdx < halo.instanceMatrix.count) {
          const radius = (ud.v2Radius as number | undefined) ?? 6;
          const state = selected === node.id
            ? "selected"
            : hovered === node.id
              ? "hover"
              : "default";
          const opacity = NODE_GEOMETRY.haloOpacity[state];
          // Billboard the plane to camera by copying camera quaternion.
          _haloQuat.copy(camera.quaternion);
          _haloScale.setScalar(radius * NODE_GEOMETRY.haloMultiplier);
          _matrix.compose(_nodePos, _haloQuat, _haloScale);
          halo.setMatrixAt(haloIdx, _matrix);
          // Color from entity hex, modulated by opacity.
          const entityKind = (NODE_TYPE_TO_ENTITY[node.type] ?? "memory") as EntityKind;
          const hex = ENTITY_COLORS[entityKind].hex;
          _haloColor.set(hex).multiplyScalar(opacity);
          halo.setColorAt(haloIdx, _haloColor);
          haloIdx++;
        }

        // SDF label: position above the node, visibility gated by zoom +
        // hovered/selected (per spec §labels visibility rule).
        const label = labelsRef.current.get(node.id);
        if (label) {
          const isFocused = hovered === node.id || selected === node.id;
          const zoomReveal = camDist < camDistSqGate / 250; // ~camDist < 250
          if (inFrustum && (isFocused || zoomReveal)) {
            label.visible = true;
            const radius = (ud.v2Radius as number | undefined) ?? 6;
            label.position.set(node.x, node.y + radius + 4, node.z);
            // Billboard
            label.quaternion.copy(camera.quaternion);
            label.fontSize = isFocused ? 6 : 4.8;
          } else {
            label.visible = false;
          }
        }
      }

      if (halo) {
        halo.count = haloIdx;
        halo.instanceMatrix.needsUpdate = true;
        if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
      }

      // FPS overlay update — 250 ms throttle so React state churn stays low.
      if (fpsDebug && now - fpsUiTickRef.current > 250) {
        fpsUiTickRef.current = now;
        setFpsReading(Math.round(fpsTracker.fps));
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fgRef, isMobile, fpsDebug, graphData.nodes.length]);

  /* ── ForceGraph3D mount ─────────────────────────────────────────────── */

  // Keep particle callbacks defaulted so the page can stay agnostic.
  const defaultLinkParticles = useCallback(
    (link: L): number => {
      const hov = hoveredIdRef.current;
      if (!hov) return 0;
      const s = typeof link.source === "object" ? (link.source as V2GraphNode).id : link.source;
      const t = typeof link.target === "object" ? (link.target as V2GraphNode).id : link.target;
      return s === hov || t === hov ? ANIMATION_TIMINGS.particleCount : 0;
    },
    [],
  );

  return (
    <>
      <ForceGraph3D<N, L>
        ref={fgRef}
        width={width}
        height={Math.max(height, 1)}
        // ForceGraph3D's recursive node-object generic and our flat
        // V2GraphNode/V2GraphLink don't reconcile cleanly; the runtime
        // shape is identical, so cast.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graphData={graphData as any}
        backgroundColor="rgba(8,9,11,0)"
        nodeLabel={(n) => `[${n.type.toUpperCase()}] ${n.label}`}
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={linkColor}
        linkWidth={isMobile ? 3 : 1.2}
        linkCurvature={0.18}
        linkOpacity={isMobile ? 0.75 : 0.6}
        linkDirectionalArrowLength={isMobile ? 8 : 4}
        linkDirectionalArrowRelPos={1}
        linkDirectionalParticles={linkParticles ?? defaultLinkParticles}
        linkDirectionalParticleSpeed={linkParticleSpeed ?? (() => ANIMATION_TIMINGS.particleSpeed)}
        linkDirectionalParticleWidth={isMobile ? 4 : 1.8}
        linkDirectionalParticleColor={linkParticleColor}
        onNodeClick={onNodeClick}
        onNodeHover={(n) => onNodeHover(n ?? null)}
        onBackgroundClick={onBackgroundClick}
        onEngineStop={onEngineStop}
        enableNodeDrag
        enableNavigationControls
        showNavInfo={false}
        warmupTicks={warmupTicks}
        cooldownTicks={cooldownTicks}
        d3AlphaDecay={d3AlphaDecay}
        d3VelocityDecay={d3VelocityDecay}
      />
      {fpsDebug ? (
        <div
          className="pointer-events-none absolute z-30 rounded-md border px-2 py-1 font-mono text-[11px] tabular-nums"
          style={{
            top: "8px",
            right: "8px",
            background: "rgba(8, 9, 11, 0.82)",
            borderColor: NEUTRAL.border,
            color: fpsReading >= 55 ? "#6fe0c2" : fpsReading >= 30 ? "#ffd166" : "#f7a072",
          }}
        >
          FPS {fpsReading}
        </div>
      ) : null}
    </>
  );
}
