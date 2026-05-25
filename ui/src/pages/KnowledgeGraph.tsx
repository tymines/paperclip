/**
 * KnowledgeGraph — All Phases Merged
 *
 * Phase 1: 3D force-directed visualization
 * Phase 2: Smart connections with TF-IDF clustering
 * Phase 3: Scale & Polish — InstancedMesh, bloom, minimap, BFS path, semantic zoom, web worker
 * Phase 4: Second brain with entity extraction and Obsidian export
 */

import {
  useEffect, useRef, useState, useCallback, useMemo, memo,
  type RefObject, type CSSProperties,
} from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { KnowledgeGraphControls } from "../components/knowledge-graph/v2-controls";
import { KnowledgeGraphDetailPanel, type DetailPanelNode } from "../components/knowledge-graph/v2-detail-panel";
import { useKnowledgeGraphGestures } from "../components/knowledge-graph/v2-gestures";
import { V2Renderer } from "../components/knowledge-graph/v2-renderer";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../lib/queryKeys";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { heartbeatsApi } from "../api/heartbeats";
import { companySkillsApi } from "../api/companySkills";
import { knowledgeGraphApi } from "../api/knowledgeGraph";
import type { Agent, Issue, HeartbeatRun, CompanySkillListItem, KnowledgeEntity } from "@paperclipai/shared";
import type { PhysicsInput, PhysicsOutput } from "../workers/graphPhysics.worker";
import { Link } from "../lib/router";
import { SlidersHorizontal, X, RefreshCw, ChevronRight, Brain, PanelLeftClose, PanelLeft } from "lucide-react";

// ─── Graph data types ──────────────────────────────────────────────────────

type NodeType = "agent" | "issue" | "run" | "hub" | "skill" | "knowledge";
type LinkType = "assigned" | "produced" | "clusters" | "capability" | "uses" | "modifies" | "caused" | "decided" | "references";
type ZoomLevel = "far" | "mid" | "close";

interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  status?: string;
  description?: string;
  agentId?: string;
  createdAt: Date;
  isNew?: boolean;
  startedAt?: Date | null;
  x?: number; y?: number; z?: number;
  vx?: number; vy?: number; vz?: number;
  fx?: number; fy?: number; fz?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: LinkType;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ─── Visual config ─────────────────────────────────────────────────────────

const NODE_COLOR: Record<NodeType, string> = {
  agent:     "#f97316",
  issue:     "#3b82f6",
  run:       "#22c55e",
  hub:       "#a855f7",
  skill:     "#eab308",
  knowledge: "#06b6d4",
};

const NODE_COLOR_NEW = "#ffffff";

const NODE_SIZE: Record<NodeType, number> = {
  hub:       20,
  agent:     10,
  issue:      7,
  skill:      8,
  run:        4,
  knowledge:  6,
};

const LINK_COLOR: Record<LinkType, string> = {
  assigned:   "#f97316aa",
  produced:   "#22c55eaa",
  clusters:   "#a855f7aa",
  capability: "#eab308aa",
  uses:       "#06b6d4aa",
  modifies:   "#ec4899aa",
  caused:     "#ef4444aa",
  decided:    "#8b5cf6aa",
  references: "#64748baa",
};

const ZOOM_FAR = 900;
const ZOOM_MID = 300;
// On mobile we clamp the camera much closer so nodes are pin-sized, not pixel-sized
const MOBILE_MAX_CAMERA_DIST = 120;

// ─── Neuromorphic brain visualization config ─────────────────────────────────

type ViewMode = "standard" | "neuromorphic";

interface BrainRegion {
  name: string;
  center: [number, number, number];
  color: string;
  warmth: number; // 0 = cool, 1 = warm — for bloom tinting
}

// Map node types to brain regions. "skill" → Prefrontal Cortex (planning/goals),
// "hub" → Cerebellum (coordination), others map by function.
const BRAIN_REGIONS: Record<NodeType, BrainRegion> = {
  knowledge: { name: "Hippocampus",        center: [0, -30, -80],    color: "#06b6d4", warmth: 0.15 },
  agent:     { name: "Motor Cortex",        center: [-120, 60, 40],   color: "#f97316", warmth: 0.85 },
  issue:     { name: "Sensory Cortex",      center: [120, 60, 40],    color: "#3b82f6", warmth: 0.25 },
  hub:       { name: "Cerebellum",          center: [0, -80, 60],     color: "#a855f7", warmth: 0.5 },
  skill:     { name: "Prefrontal Cortex",   center: [0, 80, -100],    color: "#eab308", warmth: 0.7 },
  run:       { name: "Association Cortex",  center: [0, 20, 80],      color: "#22c55e", warmth: 0.4 },
};

const NEURO_REGION_COLOR: Record<string, string> = {
  "Hippocampus":       "#06b6d4",
  "Motor Cortex":      "#f97316",
  "Sensory Cortex":    "#3b82f6",
  "Cerebellum":        "#a855f7",
  "Prefrontal Cortex": "#eab308",
  "Association Cortex": "#22c55e",
};

const NEURO_PARTICLE_COUNT_MIN = 50;
const NEURO_PARTICLE_COUNT_MAX = 200;
const NEURO_ATTRACTOR_STRENGTH = 0.0008;
const NEURO_FIRE_DURATION_MS = 800;
const NEURO_HOP_DELAY_MS = 150;
const NEURO_FIRE_WINDOW_S = 30;
const NEURO_ACTIVE_WINDOW_S = 60;

// Region bloom color overrides (warm vs cool)
const NEURO_BLOOM_COLORS: Record<string, THREE.Color> = {};
for (const [, region] of Object.entries(BRAIN_REGIONS)) {
  if (!NEURO_BLOOM_COLORS[region.name]) {
    NEURO_BLOOM_COLORS[region.name] = new THREE.Color(region.color);
  }
}

// ─── Neuromorphic particle cloud helpers ──────────────────────────────────────

function createParticleCluster(
  node: GraphNode,
  connectionCount: number,
): THREE.Points {
  const baseSize = NODE_SIZE[node.type];
  const count = Math.min(
    NEURO_PARTICLE_COUNT_MAX,
    Math.max(NEURO_PARTICLE_COUNT_MIN, 50 + connectionCount * 15),
  );
  const radius = baseSize * 1.2 + connectionCount * 0.5;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  // Store orbital params as custom attribute
  const orbitPhases = new Float32Array(count);
  const orbitSpeeds = new Float32Array(count);
  const orbitRadii = new Float32Array(count);

  const region = BRAIN_REGIONS[node.type];
  const baseColor = new THREE.Color(node.isNew ? NODE_COLOR_NEW : region.color);

  for (let i = 0; i < count; i++) {
    // Random spherical distribution
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * (0.2 + Math.random() * 0.8);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Slight color variation
    const variation = 0.85 + Math.random() * 0.3;
    colors[i * 3] = baseColor.r * variation;
    colors[i * 3 + 1] = baseColor.g * variation;
    colors[i * 3 + 2] = baseColor.b * variation;

    sizes[i] = (1.5 + Math.random() * 2.5) * (baseSize / 8);

    orbitPhases[i] = Math.random() * Math.PI * 2;
    orbitSpeeds[i] = 0.3 + Math.random() * 0.7;
    orbitRadii[i] = r;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  // Store orbital data for animation
  geometry.setAttribute("orbitPhase", new THREE.BufferAttribute(orbitPhases, 1));
  geometry.setAttribute("orbitSpeed", new THREE.BufferAttribute(orbitSpeeds, 1));
  geometry.setAttribute("orbitRadius", new THREE.BufferAttribute(orbitRadii, 1));

  const material = new THREE.PointsMaterial({
    size: 2.5 * (baseSize / 8),
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.userData.nodeId = node.id;
  points.userData.nodeType = node.type;
  points.userData.particleCount = count;
  points.userData.baseRadius = radius;
  return points;
}

function animateParticleCluster(points: THREE.Points, time: number, fireIntensity: number) {
  const geo = points.geometry;
  const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
  const sizeAttr = geo.getAttribute("size") as THREE.BufferAttribute;
  const colorAttr = geo.getAttribute("color") as THREE.BufferAttribute;
  const phaseAttr = geo.getAttribute("orbitPhase") as THREE.BufferAttribute;
  const speedAttr = geo.getAttribute("orbitSpeed") as THREE.BufferAttribute;
  const radiusAttr = geo.getAttribute("orbitRadius") as THREE.BufferAttribute;
  if (!phaseAttr || !speedAttr || !radiusAttr) return;

  const count = posAttr.count;
  const baseSize = (points.material as THREE.PointsMaterial).size;

  for (let i = 0; i < count; i++) {
    const phase = phaseAttr.getX(i);
    const speed = speedAttr.getX(i);
    const r = radiusAttr.getX(i);

    const t = time * speed + phase;
    // Subtle orbital motion — particles drift around their original position
    const dx = Math.sin(t) * r * 0.08;
    const dy = Math.cos(t * 0.7) * r * 0.06;
    const dz = Math.sin(t * 1.3) * r * 0.07;

    // Get base spherical position from phase/radius, add orbital drift
    const theta = phase;
    const phi = Math.acos(2 * (((i * 0.618) % 1)) - 1);
    const bx = r * Math.sin(phi) * Math.cos(theta);
    const by = r * Math.sin(phi) * Math.sin(theta);
    const bz = r * Math.cos(phi);

    posAttr.setXYZ(i, bx + dx, by + dy, bz + dz);

    // Fire effect: spike sizes and brighten colors
    if (fireIntensity > 0) {
      sizeAttr.setX(i, baseSize * (1 + fireIntensity * 3));
      const bright = 1.0 + fireIntensity * 2;
      colorAttr.setXYZ(i,
        Math.min(1, colorAttr.getX(i) * 0.5 + bright * 0.5),
        Math.min(1, colorAttr.getY(i) * 0.5 + bright * 0.4),
        Math.min(1, colorAttr.getZ(i) * 0.3 + bright * 0.2),
      );
    } else {
      sizeAttr.setX(i, baseSize);
    }
  }

  posAttr.needsUpdate = true;
  sizeAttr.needsUpdate = true;
  if (fireIntensity > 0) colorAttr.needsUpdate = true;
}

// ─── Mobile detection (hoisted for use in lightning/bloom constants) ─────────

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const byUA = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const byViewport = typeof window !== "undefined" && window.innerWidth < 768;
  return byUA || byViewport;
}

const IS_MOBILE = isMobileDevice();

// ─── Lightning arc helpers ───────────────────────────────────────────────────

// Desktop defaults
const LIGHTNING_SEGMENTS_DESKTOP = 24;
const LIGHTNING_REFRESH_INTERVAL_DESKTOP = 0.12; // seconds between jag re-rolls
const AUTO_FIRE_BATCH_DESKTOP = 3;

// Mobile — lighter settings to avoid GPU stalls
const LIGHTNING_SEGMENTS_MOBILE = 6;
const LIGHTNING_REFRESH_INTERVAL_MOBILE = 0.5; // much slower re-rolls
const AUTO_FIRE_BATCH_MOBILE = 1;

const LIGHTNING_SEGMENTS = IS_MOBILE ? LIGHTNING_SEGMENTS_MOBILE : LIGHTNING_SEGMENTS_DESKTOP;
const LIGHTNING_DISPLACEMENT = IS_MOBILE ? 3 : 6; // max lateral jag in world units
const LIGHTNING_REFRESH_INTERVAL = IS_MOBILE ? LIGHTNING_REFRESH_INTERVAL_MOBILE : LIGHTNING_REFRESH_INTERVAL_DESKTOP;
const LIGHTNING_GLOW_WIDTH = 4;
const LIGHTNING_CORE_WIDTH = 1.5;
const PULSE_SPEED = 0.35; // 0→1 travel time in seconds
const PULSE_WIDTH = 0.12; // fraction of arc length the pulse illuminates
const AUTO_FIRE_INTERVAL_MS = IS_MOBILE ? 1200 : 600; // ms between random link fires
const AUTO_FIRE_BATCH = IS_MOBILE ? AUTO_FIRE_BATCH_MOBILE : AUTO_FIRE_BATCH_DESKTOP;

// ─── FPS tracker for adaptive quality ───────────────────────────────────────

class FpsTracker {
  private frameTimes: number[] = [];
  private windowSize = 30;
  degraded = false; // true when FPS < 15 — skip expensive effects

  tick(now: number) {
    this.frameTimes.push(now);
    if (this.frameTimes.length > this.windowSize) this.frameTimes.shift();
    if (this.frameTimes.length < 6) return; // not enough data yet
    const elapsed = now - this.frameTimes[0];
    const fps = (this.frameTimes.length - 1) / (elapsed / 1000);
    if (fps < 15) this.degraded = true;
    // Recover only when FPS is well above threshold to avoid flip-flopping
    if (fps > 25 && this.degraded) this.degraded = false;
  }
}

const fpsTracker = new FpsTracker();

/** Generate jagged displacement offsets for a lightning bolt */
function generateJagOffsets(count: number, scale: number): Float32Array {
  const offsets = new Float32Array(count * 2); // x,y displacement per segment point
  offsets[0] = 0; offsets[1] = 0; // start anchored
  offsets[(count - 1) * 2] = 0; offsets[(count - 1) * 2 + 1] = 0; // end anchored
  for (let i = 1; i < count - 1; i++) {
    offsets[i * 2] = (Math.random() - 0.5) * 2 * scale;
    offsets[i * 2 + 1] = (Math.random() - 0.5) * 2 * scale;
  }
  return offsets;
}

/** Build positions array for a lightning arc between two 3D points */
function buildLightningPositions(
  src: THREE.Vector3, tgt: THREE.Vector3,
  jagOffsets: Float32Array, segments: number,
): Float32Array {
  const positions = new Float32Array(segments * 3);
  const dir = new THREE.Vector3().subVectors(tgt, src);
  // Perpendicular axes for displacement
  const up = new THREE.Vector3(0, 1, 0);
  const perp1 = new THREE.Vector3().crossVectors(dir, up).normalize();
  if (perp1.lengthSq() < 0.001) perp1.set(1, 0, 0);
  const perp2 = new THREE.Vector3().crossVectors(dir, perp1).normalize();

  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const px = src.x + dir.x * t + perp1.x * jagOffsets[i * 2] + perp2.x * jagOffsets[i * 2 + 1];
    const py = src.y + dir.y * t + perp1.y * jagOffsets[i * 2] + perp2.y * jagOffsets[i * 2 + 1];
    const pz = src.z + dir.z * t + perp1.z * jagOffsets[i * 2] + perp2.z * jagOffsets[i * 2 + 1];
    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
  }
  return positions;
}

interface LightningArcData {
  group: THREE.Group;
  coreLine: THREE.Line;
  glowLine: THREE.Line | null; // null on mobile — skip glow for perf
  segments: number;
  jagOffsets: Float32Array;
  lastJagTime: number;
  // Pulse state
  pulseT: number; // 0→1 progress, -1 = inactive
  pulseStartTime: number;
  srcColor: THREE.Color;
}

function createLightningArc(link: GraphLink, nodes: GraphNode[]): LightningArcData {
  const srcId = typeof link.source === "object" ? link.source.id : link.source;
  const srcNode = nodes.find(n => n.id === srcId);
  const region = srcNode ? BRAIN_REGIONS[srcNode.type] : null;
  const color = new THREE.Color(region?.color ?? "#ffffff");

  const segments = LIGHTNING_SEGMENTS;
  const jagOffsets = generateJagOffsets(segments, LIGHTNING_DISPLACEMENT);

  // Core bright line
  const coreGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(segments * 3);
  coreGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const coreMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.7,
    linewidth: LIGHTNING_CORE_WIDTH,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const coreLine = new THREE.Line(coreGeo, coreMat);

  // Outer glow line (same geometry, wider & dimmer) — skip on mobile for perf
  let glowLine: THREE.Line | null = null;
  if (!IS_MOBILE) {
    const glowGeo = new THREE.BufferGeometry();
    const glowPositions = new Float32Array(segments * 3);
    glowGeo.setAttribute("position", new THREE.BufferAttribute(glowPositions, 3));
    const glowColor = color.clone().multiplyScalar(0.6);
    const glowMat = new THREE.LineBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: 0.25,
      linewidth: LIGHTNING_GLOW_WIDTH,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    glowLine = new THREE.Line(glowGeo, glowMat);
  }

  const group = new THREE.Group();
  if (glowLine) group.add(glowLine);
  group.add(coreLine);

  return {
    group, coreLine, glowLine, segments, jagOffsets,
    lastJagTime: performance.now() * 0.001,
    pulseT: -1, pulseStartTime: 0,
    srcColor: color,
  };
}

function updateLightningArc(
  arc: LightningArcData,
  src: THREE.Vector3, tgt: THREE.Vector3,
  time: number,
) {
  // When FPS is critically low, skip geometry updates entirely — just advance pulse timer
  if (fpsTracker.degraded) {
    if (arc.pulseT >= 0) {
      const elapsed = (performance.now() - arc.pulseStartTime) / 1000;
      arc.pulseT = elapsed / PULSE_SPEED;
      if (arc.pulseT > 1) arc.pulseT = -1;
    }
    return;
  }

  // Re-roll jag offsets periodically for crackling effect
  if (time - arc.lastJagTime > LIGHTNING_REFRESH_INTERVAL) {
    arc.lastJagTime = time;
    const newJag = generateJagOffsets(arc.segments, LIGHTNING_DISPLACEMENT);
    arc.jagOffsets.set(newJag);
  }

  const positions = buildLightningPositions(src, tgt, arc.jagOffsets, arc.segments);

  // Update core line
  const corePos = arc.coreLine.geometry.getAttribute("position") as THREE.BufferAttribute;
  corePos.array.set(positions);
  corePos.needsUpdate = true;
  arc.coreLine.geometry.computeBoundingSphere();

  // Update glow line (same positions) — may be null on mobile
  if (arc.glowLine) {
    const glowPos = arc.glowLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    glowPos.array.set(positions);
    glowPos.needsUpdate = true;
    arc.glowLine.geometry.computeBoundingSphere();
  }

  // Pulse brightness
  const coreMat = arc.coreLine.material as THREE.LineBasicMaterial;
  const glowMat = arc.glowLine?.material as THREE.LineBasicMaterial | undefined;

  if (arc.pulseT >= 0 && arc.pulseT <= 1) {
    const elapsed = (performance.now() - arc.pulseStartTime) / 1000;
    arc.pulseT = elapsed / PULSE_SPEED;
    if (arc.pulseT > 1) {
      arc.pulseT = -1;
      coreMat.opacity = 0.7;
      if (glowMat) glowMat.opacity = 0.25;
      coreMat.color.copy(arc.srcColor);
    } else {
      // Bright flash traveling along the arc
      coreMat.opacity = 0.7 + 0.3 * Math.sin(arc.pulseT * Math.PI);
      if (glowMat) glowMat.opacity = 0.25 + 0.55 * Math.sin(arc.pulseT * Math.PI);
      // Brighten to white at peak
      const flash = Math.sin(arc.pulseT * Math.PI);
      coreMat.color.copy(arc.srcColor).lerp(_whiteColor, flash * 0.7);
    }
  } else {
    // Subtle ambient flicker
    const flicker = 0.6 + 0.15 * Math.sin(time * 8 + src.x * 3) + 0.05 * Math.sin(time * 23 + tgt.z * 5);
    coreMat.opacity = flicker;
    if (glowMat) glowMat.opacity = flicker * 0.35;
  }
}

function triggerArcPulse(arc: LightningArcData) {
  arc.pulseT = 0;
  arc.pulseStartTime = performance.now();
}

// ─── Firing animation tracker ────────────────────────────────────────────────

interface FiringEvent {
  nodeId: string;
  startTime: number;
  hop: number;
}

class FiringSystem {
  events: FiringEvent[] = [];
  firingLog: number[] = []; // timestamps of fire events for rate calc

  fire(nodeId: string, now: number, hop: number = 0) {
    this.events.push({ nodeId, startTime: now + hop * NEURO_HOP_DELAY_MS, hop });
    if (hop === 0) this.firingLog.push(now);
  }

  propagate(nodeId: string, neighbors: string[], now: number) {
    for (const nId of neighbors) {
      // Don't re-fire nodes already firing
      if (!this.events.some(e => e.nodeId === nId && now - e.startTime < NEURO_FIRE_DURATION_MS)) {
        this.fire(nId, now, 1);
      }
    }
  }

  getIntensity(nodeId: string, now: number): number {
    let maxIntensity = 0;
    for (const e of this.events) {
      if (e.nodeId !== nodeId) continue;
      const elapsed = now - e.startTime;
      if (elapsed < 0 || elapsed > NEURO_FIRE_DURATION_MS) continue;
      // Quick spike then decay
      const t = elapsed / NEURO_FIRE_DURATION_MS;
      const intensity = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      maxIntensity = Math.max(maxIntensity, intensity);
    }
    return maxIntensity;
  }

  cleanup(now: number) {
    this.events = this.events.filter(e => now - e.startTime < NEURO_FIRE_DURATION_MS * 2);
    const cutoff = now - 60_000;
    this.firingLog = this.firingLog.filter(t => t > cutoff);
  }

  activeCount(now: number): number {
    const cutoff = now - NEURO_ACTIVE_WINDOW_S * 1000;
    const active = new Set<string>();
    for (const e of this.events) { if (e.startTime > cutoff) active.add(e.nodeId); }
    return active.size;
  }

  firingRate(): number {
    return this.firingLog.length; // events in last 60s
  }

  regionActivity(nodes: GraphNode[], now: number): Record<string, number> {
    const cutoff = now - NEURO_ACTIVE_WINDOW_S * 1000;
    const activity: Record<string, number> = {};
    const activeNodes = new Set<string>();
    for (const e of this.events) { if (e.startTime > cutoff) activeNodes.add(e.nodeId); }
    for (const n of nodes) {
      const region = BRAIN_REGIONS[n.type]?.name ?? "Unknown";
      if (!activity[region]) activity[region] = 0;
      if (activeNodes.has(n.id)) activity[region]++;
    }
    return activity;
  }
}

// ─── Brain region label sprite factory ────────────────────────────────────────

function createRegionLabel(name: string, position: [number, number, number], color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 28px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.4;
  ctx.fillText(name, 256, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(position[0], position[1] + 30, position[2]);
  sprite.scale.set(80, 10, 1);
  return sprite;
}

const LEGEND: { type: NodeType; shape: string; label: string }[] = [
  { type: "agent",     shape: "●", label: "Agent" },
  { type: "issue",     shape: "■", label: "Issue" },
  { type: "run",       shape: "●", label: "Run" },
  { type: "hub",       shape: "◉", label: "Big Idea Hub" },
  { type: "skill",     shape: "◆", label: "Skill" },
  { type: "knowledge", shape: "◈", label: "Knowledge Entity" },
];

// ─── Three.js node geometry factories ──────────────────────────────────────

function makeNodeObject(node: GraphNode): THREE.Object3D {
  const color = new THREE.Color(node.isNew ? NODE_COLOR_NEW : NODE_COLOR[node.type]);
  const size = NODE_SIZE[node.type];

  if (node.type === "issue") {
    const geo = new THREE.BoxGeometry(size * 0.9, size * 0.9, size * 0.9);
    const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.9 });
    return new THREE.Mesh(geo, mat);
  }

  if (node.type === "skill") {
    const geo = new THREE.OctahedronGeometry(size * 0.7);
    const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.9 });
    return new THREE.Mesh(geo, mat);
  }

  if (node.type === "knowledge") {
    const geo = new THREE.IcosahedronGeometry(size * 0.6);
    const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: node.isNew ? 1 : 0.85 });
    if (node.isNew) {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(geo, mat));
      const glowGeo = new THREE.IcosahedronGeometry(size * 0.9);
      const glowMat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.25, side: THREE.BackSide });
      group.add(new THREE.Mesh(glowGeo, glowMat));
      return group;
    }
    return new THREE.Mesh(geo, mat);
  }

  if (node.type === "hub") {
    const group = new THREE.Group();
    const geoCore = new THREE.SphereGeometry(size * 0.5, 16, 16);
    const matCore = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.95 });
    group.add(new THREE.Mesh(geoCore, matCore));
    const geoGlow = new THREE.SphereGeometry(size * 0.75, 16, 16);
    const matGlow = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.18, side: THREE.BackSide });
    group.add(new THREE.Mesh(geoGlow, matGlow));
    return group;
  }

  const radius = node.type === "run" ? size * 0.4 : size * 0.5;
  const geo = new THREE.SphereGeometry(radius, 12, 12);
  const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.9 });
  return new THREE.Mesh(geo, mat);
}

function makePlaceholder(size: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(size * 0.55, 4, 2);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.001, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

// ─── Detail link helper ─────────────────────────────────────────────────────

function nodeDetailPath(node: GraphNode): string | null {
  switch (node.type) {
    case "agent": return `/agents/${node.id}`;
    case "issue": return `/issues/${node.id}`;
    case "run":   return node.agentId ? `/agents/${node.agentId}/runs/${node.id}` : null;
    case "skill": return `/skills`;
    default:      return null;
  }
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    done: "text-green-400", in_progress: "text-blue-400", backlog: "text-gray-400",
    cancelled: "text-gray-500", success: "text-green-400", failed: "text-red-400",
    running: "text-blue-400", queued: "text-yellow-400", idle: "text-gray-400",
    active: "text-green-400", paused: "text-yellow-400", error: "text-red-400",
  };
  return (
    <span className={`text-[10px] font-medium uppercase tracking-wide ${colors[status] ?? "text-gray-400"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function formatTimelineDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSliderLabel(d: Date): string {
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── BFS shortest-path ────────────────────────────────────────────────────────

interface PathResult {
  nodeIds: Set<string>;
  linkIds: Set<string>;
  hops: number;
}

function bfsShortestPath(
  nodes: GraphNode[], links: GraphLink[], startId: string, endId: string,
): PathResult | null {
  if (startId === endId) return null;
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const link of links) {
    const s = typeof link.source === "object" ? link.source.id : link.source;
    const t = typeof link.target === "object" ? link.target.id : link.target;
    adj.get(s)?.push(t);
    adj.get(t)?.push(s);
  }
  const prev = new Map<string, string | null>([[startId, null]]);
  const queue: string[] = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === endId) {
      const nodeIds = new Set<string>();
      const linkIds = new Set<string>();
      let n: string | null = cur;
      while (n !== null) {
        nodeIds.add(n);
        const p: string | null = prev.get(n) ?? null;
        if (p !== null) { linkIds.add(`${p}|${n}`); linkIds.add(`${n}|${p}`); }
        n = p;
      }
      return { nodeIds, linkIds, hops: nodeIds.size - 1 };
    }
    for (const nb of adj.get(cur) ?? []) {
      if (!prev.has(nb)) { prev.set(nb, cur); queue.push(nb); }
    }
  }
  return null;
}

// ─── Mini-map ─────────────────────────────────────────────────────────────────

interface MinimapProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onNavigate: (x: number, z: number) => void;
  width?: number;
  height?: number;
}

const Minimap = memo(function Minimap({ canvasRef, onNavigate, width = 160, height = 110 }: MinimapProps) {
  return (
    <canvas
      ref={canvasRef} width={width} height={height}
      onClick={(e) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        onNavigate((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      }}
      className="cursor-crosshair rounded"
      style={{ imageRendering: "pixelated" }}
    />
  );
});

// ─── Mobile detection ────────────────────────────────────────────────────────

// ─── Pre-allocated helpers ────────────────────────────────────────────────────

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _vec3 = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _projMx = new THREE.Matrix4();
const _whiteColor = new THREE.Color("#ffffff");
// Pre-allocated vectors for linkPositionUpdate to avoid per-frame GC pressure
const _arcSrc = new THREE.Vector3();
const _arcTgt = new THREE.Vector3();

// ─── Main component ─────────────────────────────────────────────────────────

export function KnowledgeGraph() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => { setBreadcrumbs([{ label: "Knowledge Graph" }]); }, [setBreadcrumbs]);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId, staleTime: 60_000,
  });

  const { data: issues = [] } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId, staleTime: 60_000,
  });

  const { data: runs = [] } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!, undefined, 80),
    enabled: !!selectedCompanyId, staleTime: 60_000,
  });

  const { data: skills = [] } = useQuery({
    queryKey: queryKeys.companySkills.list(selectedCompanyId!),
    queryFn: () => companySkillsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId, staleTime: 60_000,
  });

  const { data: hubs = [] } = useQuery({
    queryKey: queryKeys.knowledgeGraph.hubs(selectedCompanyId!),
    queryFn: () => knowledgeGraphApi.getHubs(selectedCompanyId!),
    enabled: !!selectedCompanyId, staleTime: 5 * 60_000,
  });

  const { data: agentSkillEdges = [] } = useQuery({
    queryKey: queryKeys.knowledgeGraph.agentSkills(selectedCompanyId!),
    queryFn: () => knowledgeGraphApi.getAgentSkillEdges(selectedCompanyId!),
    enabled: !!selectedCompanyId, staleTime: 60_000,
  });

  const { data: kgData } = useQuery({
    queryKey: queryKeys.knowledgeGraph.get(selectedCompanyId!),
    queryFn: () => knowledgeGraphApi.get(selectedCompanyId!),
    enabled: !!selectedCompanyId, staleTime: 30_000,
  });

  const generateHubs = useMutation({
    mutationFn: () => knowledgeGraphApi.generateHubs(selectedCompanyId!),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeGraph.hubs(selectedCompanyId!) }); },
  });

  // ── New-node pulse tracking ────────────────────────────────────────────────

  const [recentEntityIds, setRecentEntityIds] = useState<Set<string>>(new Set());
  const prevEntityIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!kgData?.entities) return;
    const currentIds = new Set(kgData.entities.map((e) => e.id));
    const newIds: string[] = [];
    for (const id of currentIds) { if (!prevEntityIdsRef.current.has(id)) newIds.push(id); }
    if (newIds.length > 0) {
      setRecentEntityIds((prev) => new Set([...prev, ...newIds]));
      const timer = setTimeout(() => {
        setRecentEntityIds((prev) => { const next = new Set(prev); for (const id of newIds) next.delete(id); return next; });
      }, 30_000);
      return () => clearTimeout(timer);
    }
    prevEntityIdsRef.current = currentIds;
  }, [kgData?.entities]);

  // ── Filter/search state ────────────────────────────────────────────────────

  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [typeFilters, setTypeFilters] = useState<Set<NodeType>>(new Set(["agent", "issue", "run", "hub", "skill", "knowledge"]));
  const [statusFilters, setStatusFilters] = useState({ showOpenIssues: true, showClosedIssues: true, showSuccessRuns: true, showFailedRuns: true });
  const [runDateFrom, setRunDateFrom] = useState("");
  const [runDateTo, setRunDateTo] = useState("");

  function toggleType(t: NodeType) {
    setTypeFilters((prev) => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next; });
  }

  // ── Build full graph data ──────────────────────────────────────────────────

  const { allGraphData, timeMin, timeMax } = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const agentIds = new Set<string>();
    const issueIds = new Set<string>();
    const skillIds = new Set<string>();
    const epoch = new Date(0);
    const dateFrom = runDateFrom ? new Date(runDateFrom) : null;
    const dateTo = runDateTo ? new Date(runDateTo + "T23:59:59Z") : null;

    if (typeFilters.has("agent")) {
      for (const a of agents as Agent[]) {
        nodes.push({ id: a.id, type: "agent", label: a.name, status: a.status, createdAt: a.createdAt ? new Date(a.createdAt) : epoch });
        agentIds.add(a.id);
      }
    }

    if (typeFilters.has("issue")) {
      for (const iss of (issues as Issue[]).slice(0, 100)) {
        const isClosed = iss.status === "done" || iss.status === "cancelled";
        if (isClosed && !statusFilters.showClosedIssues) continue;
        if (!isClosed && !statusFilters.showOpenIssues) continue;
        nodes.push({ id: iss.id, type: "issue", label: iss.title, status: iss.status, description: iss.description ?? undefined, createdAt: iss.createdAt ? new Date(iss.createdAt) : epoch });
        issueIds.add(iss.id);
        if (iss.assigneeAgentId && agentIds.has(iss.assigneeAgentId)) links.push({ source: iss.assigneeAgentId, target: iss.id, type: "assigned" });
      }
    }

    if (typeFilters.has("run")) {
      for (const r of (runs as HeartbeatRun[]).slice(0, 80)) {
        if (!statusFilters.showSuccessRuns && r.status === "succeeded") continue;
        if (!statusFilters.showFailedRuns && r.status === "failed") continue;
        if (dateFrom && r.startedAt && new Date(r.startedAt) < dateFrom) continue;
        if (dateTo && r.startedAt && new Date(r.startedAt) > dateTo) continue;
        nodes.push({ id: r.id, type: "run", label: `Run ${r.id.slice(0, 8)}`, status: r.status, agentId: r.agentId, createdAt: r.createdAt ? new Date(r.createdAt) : epoch, startedAt: r.startedAt ? new Date(r.startedAt) : null });
        if (agentIds.has(r.agentId)) links.push({ source: r.agentId, target: r.id, type: "produced" });
      }
    }

    if (typeFilters.has("skill")) {
      for (const s of skills as CompanySkillListItem[]) {
        nodes.push({ id: s.id, type: "skill", label: s.name, description: s.description ?? undefined, createdAt: s.createdAt ? new Date(s.createdAt) : epoch });
        skillIds.add(s.id);
      }
    }

    for (const edge of agentSkillEdges) {
      if (agentIds.has(edge.agentId) && skillIds.has(edge.skillId)) links.push({ source: edge.skillId, target: edge.agentId, type: "capability" });
    }

    if (typeFilters.has("hub") && hubs.length > 0) {
      for (const hub of hubs) {
        nodes.push({ id: hub.id, type: "hub", label: hub.name, description: hub.description ?? undefined, createdAt: hub.createdAt ? new Date(hub.createdAt) : epoch });
        for (const issueId of hub.issueIds) { if (issueIds.has(issueId)) links.push({ source: hub.id, target: issueId, type: "clusters" }); }
      }
    }

    if (typeFilters.has("knowledge") && kgData) {
      const entityIdSet = new Set<string>();
      for (const e of kgData.entities as KnowledgeEntity[]) {
        nodes.push({ id: e.id, type: "knowledge", label: e.label, createdAt: new Date(e.createdAt), isNew: recentEntityIds.has(e.id) });
        entityIdSet.add(e.id);
      }
      for (const edge of kgData.edges) {
        if (entityIdSet.has(edge.sourceEntityId) && entityIdSet.has(edge.targetEntityId)) {
          links.push({ source: edge.sourceEntityId, target: edge.targetEntityId, type: edge.relationType as LinkType });
        }
      }
    }

    const timestamps = nodes.map((n) => n.createdAt.getTime()).filter((t) => t > 0);
    const timeMin = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date(Date.now() - 86400000);
    const timeMax = new Date();
    return { allGraphData: { nodes, links }, timeMin, timeMax };
  }, [agents, issues, runs, skills, hubs, agentSkillEdges, kgData, recentEntityIds, typeFilters, statusFilters, runDateFrom, runDateTo]);

  // ── Time-travel slider ─────────────────────────────────────────────────────

  const [timeFilterMs, setTimeFilterMs] = useState<number | null>(null);
  const timeFilterDate = timeFilterMs != null ? new Date(timeFilterMs) : null;
  const isTimeTraveling = timeFilterDate !== null && timeFilterDate < timeMax;

  const graphData = useMemo<GraphData>(() => {
    if (!timeFilterDate) return allGraphData;
    const cutoff = timeFilterDate.getTime();
    const visibleIds = new Set(allGraphData.nodes.filter((n) => n.createdAt.getTime() <= cutoff).map((n) => n.id));
    return {
      nodes: allGraphData.nodes.filter((n) => visibleIds.has(n.id)),
      links: allGraphData.links.filter((l) => {
        const srcId = typeof l.source === "object" ? l.source.id : l.source;
        const tgtId = typeof l.target === "object" ? l.target.id : l.target;
        return visibleIds.has(srcId) && visibleIds.has(tgtId);
      }),
    };
  }, [allGraphData, timeFilterDate]);

  const timelineEvents = useMemo(() => {
    const events: { time: number; label: string }[] = [];
    for (const n of allGraphData.nodes) {
      if (n.type === "run" || n.type === "agent") { const t = n.createdAt.getTime(); if (t > 0) events.push({ time: t, label: n.label }); }
    }
    return events.sort((a, b) => a.time - b.time).slice(0, 20);
  }, [allGraphData.nodes]);

  const searchLower = searchText.toLowerCase().trim();
  const searchMatchIds = useMemo<Set<string> | null>(() => {
    if (!searchLower) return null;
    const ids = new Set<string>();
    for (const node of graphData.nodes) { if (node.label.toLowerCase().includes(searchLower)) ids.add(node.id); }
    return ids;
  }, [searchLower, graphData.nodes]);

  // ── Interaction state ──────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight - 56 });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [pathEndNode, setPathEndNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [collapsedHubs, setCollapsedHubs] = useState<Set<string>>(new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("mid");
  const [physicsReady, setPhysicsReady] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("standard");
  const neuroParticlesRef = useRef<Map<string, THREE.Points>>(new Map());
  const neuroLabelsRef = useRef<THREE.Sprite[]>([]);
  const firingSystemRef = useRef(new FiringSystem());
  const neuroStatsRef = useRef({ neurons: 0, synapses: 0, active: 0, rate: 0, regions: {} as Record<string, number> });
  const [neuroStats, setNeuroStats] = useState({ neurons: 0, synapses: 0, active: 0, rate: 0, regions: {} as Record<string, number> });
  const prevNewNodeIdsRef = useRef<Set<string>>(new Set());
  const neuroAdjMapRef = useRef<Map<string, string[]>>(new Map());
  const lightningArcsRef = useRef<Map<string, LightningArcData>>(new Map());
  const lastAutoFireRef = useRef(0);

  const selectedNodeRef = useRef<GraphNode | null>(null);
  const pathEndNodeRef = useRef<GraphNode | null>(null);
  const collapsedHubsRef = useRef<Set<string>>(new Set());
  const zoomLevelRef = useRef<ZoomLevel>("mid");
  const initialZoomDoneRef = useRef(false);
  const highlightedIdsRef = useRef<Set<string> | null>(null);
  const pathResultRef = useRef<PathResult | null>(null);

  useEffect(() => { selectedNodeRef.current = selectedNode; }, [selectedNode]);
  useEffect(() => { pathEndNodeRef.current = pathEndNode; }, [pathEndNode]);
  useEffect(() => { collapsedHubsRef.current = collapsedHubs; }, [collapsedHubs]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      // On mobile the component is position:fixed and fills the full viewport,
      // so always use window dimensions to avoid measuring the padded layout container.
      const w = IS_MOBILE ? window.innerWidth : (el.clientWidth > 0 ? el.clientWidth : window.innerWidth);
      const h = IS_MOBILE ? window.innerHeight : (el.clientHeight > 50 ? el.clientHeight : (window.innerHeight - 56));
      setDimensions({ width: w, height: h });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  const highlightedIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedNode) {
      ids.add(selectedNode.id);
      for (const link of graphData.links) {
        const srcId = typeof link.source === "object" ? link.source.id : link.source;
        const tgtId = typeof link.target === "object" ? link.target.id : link.target;
        if (srcId === selectedNode.id) ids.add(tgtId);
        if (tgtId === selectedNode.id) ids.add(srcId);
      }
    }
    if (searchMatchIds) { for (const id of searchMatchIds) ids.add(id); }
    return ids.size > 0 ? ids : null;
  }, [selectedNode, graphData.links, searchMatchIds]);

  useEffect(() => { highlightedIdsRef.current = highlightedIds; }, [highlightedIds]);

  // ── Neuromorphic adjacency map for firing propagation ─────────────────────
  useEffect(() => {
    const adj = new Map<string, string[]>();
    for (const n of graphData.nodes) adj.set(n.id, []);
    for (const link of graphData.links) {
      const s = typeof link.source === "object" ? link.source.id : link.source;
      const t = typeof link.target === "object" ? link.target.id : link.target;
      adj.get(s)?.push(t);
      adj.get(t)?.push(s);
    }
    neuroAdjMapRef.current = adj;
  }, [graphData]);

  const pathResult = useMemo<PathResult | null>(() => {
    if (!selectedNode || !pathEndNode) return null;
    return bfsShortestPath(graphData.nodes, graphData.links, selectedNode.id, pathEndNode.id);
  }, [selectedNode, pathEndNode, graphData]);

  useEffect(() => { pathResultRef.current = pathResult; }, [pathResult]);

  const connectedLinks = useMemo(() => {
    if (!selectedNode) return null;
    return graphData.links.filter((link) => {
      const srcId = typeof link.source === "object" ? link.source.id : link.source;
      const tgtId = typeof link.target === "object" ? link.target.id : link.target;
      return srcId === selectedNode.id || tgtId === selectedNode.id;
    });
  }, [selectedNode, graphData.links]);

  const connectedNodes = useMemo(() => {
    if (!selectedNode || !connectedLinks) return [];
    return connectedLinks.map((link) => {
      const srcId = typeof link.source === "object" ? link.source.id : link.source;
      const tgtId = typeof link.target === "object" ? link.target.id : link.target;
      const otherId = srcId === selectedNode.id ? tgtId : srcId;
      const direction = srcId === selectedNode.id ? "→" : "←";
      const otherNode = graphData.nodes.find((n) => n.id === otherId);
      return { otherNode, direction, linkType: link.type };
    });
  }, [selectedNode, connectedLinks, graphData.nodes]);

  const hubClusterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of graphData.links) {
      if (link.type !== "clusters") continue;
      const s = typeof link.source === "object" ? link.source.id : link.source;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return counts;
  }, [graphData.links]);

  const hubNodes = useMemo(() => graphData.nodes.filter(n => n.type === "hub"), [graphData.nodes]);

  // ── Physics Web Worker ────────────────────────────────────────────────────

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    try {
      const worker = new Worker(new URL("../workers/graphPhysics.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<PhysicsOutput>) => {
        if (e.data.type !== "done") return;
        const { positions } = e.data;
        const fg = fgRef.current;
        if (!fg || typeof fg.graphData !== "function") return;
        for (const node of fg.graphData().nodes as GraphNode[]) {
          const p = positions[node.id];
          if (p) { node.x = p.x; node.y = p.y; node.z = p.z; }
        }
        setPhysicsReady(true);
      };
      worker.onerror = () => { setPhysicsReady(true); };
      workerRef.current = worker;
      return () => worker.terminate();
    } catch {
      // Web Worker may fail on some mobile browsers — fall back to built-in physics
      setPhysicsReady(true);
    }
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !graphData.nodes.length) return;
    worker.postMessage({
      nodeIds: graphData.nodes.map(n => n.id),
      nodeTypes: graphData.nodes.map(n => n.type),
      links: graphData.links.map(l => ({
        source: typeof l.source === "object" ? l.source.id : l.source,
        target: typeof l.target === "object" ? l.target.id : l.target,
      })),
    } satisfies PhysicsInput);
  }, [graphData]);

  // ── InstancedMesh setup ───────────────────────────────────────────────────

  const instancedMeshRef = useRef<{ run: THREE.InstancedMesh | null; issue: THREE.InstancedMesh | null; runCount: number; issueCount: number }>({ run: null, issue: null, runCount: 0, issueCount: 0 });

  useEffect(() => {
    // Skip InstancedMesh on mobile or in neuromorphic mode (all nodes are particle clouds)
    if (IS_MOBILE || viewMode === "neuromorphic") return;
    const fg = fgRef.current;
    if (!fg) return;
    const scene = fg.scene() as THREE.Scene;
    const runCount = graphData.nodes.filter(n => n.type === "run").length;
    const issueCount = graphData.nodes.filter(n => n.type === "issue").length;
    if (!runCount && !issueCount) return;

    const runGeo = new THREE.SphereGeometry(NODE_SIZE.run * 0.42, 7, 5);
    const runMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(NODE_COLOR.run) });
    const runMesh = new THREE.InstancedMesh(runGeo, runMat, Math.max(runCount, 1));
    runMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    runMesh.name = "kg-instanced-run";
    scene.add(runMesh);

    const s = NODE_SIZE.issue * 0.85;
    const issGeo = new THREE.BoxGeometry(s, s, s);
    const issMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(NODE_COLOR.issue) });
    const issMesh = new THREE.InstancedMesh(issGeo, issMat, Math.max(issueCount, 1));
    issMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    issMesh.name = "kg-instanced-issue";
    scene.add(issMesh);

    instancedMeshRef.current = { run: runMesh, issue: issMesh, runCount, issueCount };
    return () => {
      scene.remove(runMesh); scene.remove(issMesh);
      runGeo.dispose(); runMat.dispose(); issGeo.dispose(); issMat.dispose();
      instancedMeshRef.current = { run: null, issue: null, runCount: 0, issueCount: 0 };
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData.nodes.length]);

  // ── Bloom post-processing ─────────────────────────────────────────────────

  const bloomSetupRef = useRef(false);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);

  const setupBloom = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || bloomSetupRef.current) return;
    const renderer = fg.renderer() as THREE.WebGLRenderer | undefined;
    if (!renderer) return;
    bloomSetupRef.current = true;
    // On mobile, cap pixel ratio to 1 to reduce GPU fill cost; desktop uses native DPR
    renderer.setPixelRatio(IS_MOBILE ? 1 : window.devicePixelRatio);
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 1.1;
    // Use the library's built-in post-processing composer — it manages the render loop
    // internally (including its own RenderPass), so no monkey-patching of renderer.render.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const composer = (fg as any).postProcessingComposer();
    // On mobile, render bloom at half resolution to reduce fragment shader cost
    const bloomW = IS_MOBILE ? Math.round(dimensions.width / 2) : dimensions.width;
    const bloomH = IS_MOBILE ? Math.round(dimensions.height / 2) : dimensions.height;
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(bloomW, bloomH), 0.45, 0.35, 0.87,
    );
    composer.addPass(bloomPass);
    bloomPassRef.current = bloomPass;
  }, [dimensions.width, dimensions.height]);

  useEffect(() => {
    if (bloomPassRef.current) {
      bloomPassRef.current.resolution.set(dimensions.width, dimensions.height);
    }
  }, [dimensions.width, dimensions.height]);

  // ── Neuromorphic mode: bloom strength & brain region labels ───────────────

  useEffect(() => {
    if (bloomPassRef.current) {
      if (viewMode === "neuromorphic") {
        bloomPassRef.current.strength = IS_MOBILE ? 1.0 : 2.0;
        bloomPassRef.current.radius = IS_MOBILE ? 0.4 : 0.8;
        bloomPassRef.current.threshold = IS_MOBILE ? 0.3 : 0.15;
      } else {
        bloomPassRef.current.strength = 0.45;
        bloomPassRef.current.radius = 0.35;
        bloomPassRef.current.threshold = 0.87;
      }
    }
  }, [viewMode]);

  // Reset bloom setup flag and particle refs on view mode change (graph remounts via key)
  useEffect(() => {
    bloomSetupRef.current = false;
    bloomPassRef.current = null;
    neuroParticlesRef.current.clear();
    lightningArcsRef.current.clear();
  }, [viewMode]);

  // Brain region labels — add/remove from scene with mode toggle
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const scene = fg.scene() as THREE.Scene;

    // Remove old labels
    for (const sprite of neuroLabelsRef.current) scene.remove(sprite);
    neuroLabelsRef.current = [];

    if (viewMode !== "neuromorphic") return;

    // Add unique region labels
    const addedRegions = new Set<string>();
    for (const [, region] of Object.entries(BRAIN_REGIONS)) {
      if (addedRegions.has(region.name)) continue;
      addedRegions.add(region.name);
      const sprite = createRegionLabel(region.name, region.center, region.color);
      scene.add(sprite);
      neuroLabelsRef.current.push(sprite);
    }

    return () => {
      for (const sprite of neuroLabelsRef.current) scene.remove(sprite);
      neuroLabelsRef.current = [];
    };
  }, [viewMode]);

  // Neuromorphic: trigger firing for new nodes
  useEffect(() => {
    if (viewMode !== "neuromorphic") return;
    const now = performance.now();
    const firing = firingSystemRef.current;
    const adj = neuroAdjMapRef.current;

    for (const id of recentEntityIds) {
      if (!prevNewNodeIdsRef.current.has(id)) {
        firing.fire(id, now);
        const neighbors = adj.get(id) ?? [];
        firing.propagate(id, neighbors, now);
      }
    }
    // Also fire any isNew nodes
    for (const n of graphData.nodes) {
      if (n.isNew && !prevNewNodeIdsRef.current.has(n.id)) {
        firing.fire(n.id, now);
        const neighbors = adj.get(n.id) ?? [];
        firing.propagate(n.id, neighbors, now);
      }
    }
    prevNewNodeIdsRef.current = new Set([...recentEntityIds, ...graphData.nodes.filter(n => n.isNew).map(n => n.id)]);
  }, [viewMode, recentEntityIds, graphData.nodes]);

  // ── Mini-map ──────────────────────────────────────────────────────────────

  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const minimapBoundsRef = useRef({ minX: -400, maxX: 400, minZ: -400, maxZ: 400 });
  const minimapUpdateRef = useRef(0);

  const drawMinimap = useCallback(() => {
    const canvas = minimapCanvasRef.current;
    const fg = fgRef.current;
    if (!canvas || !fg || typeof fg.graphData !== "function") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const gNodes = fg.graphData().nodes as GraphNode[];
    const camera = fg.camera() as THREE.Camera;
    const W = canvas.width, H = canvas.height;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const n of gNodes) {
      if ((n.x ?? 0) < minX) minX = n.x ?? 0; if ((n.x ?? 0) > maxX) maxX = n.x ?? 0;
      if ((n.z ?? 0) < minZ) minZ = n.z ?? 0; if ((n.z ?? 0) > maxZ) maxZ = n.z ?? 0;
    }
    const pad = 60; minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
    minimapBoundsRef.current = { minX, maxX, minZ, maxZ };
    const rangeX = maxX - minX || 1, rangeZ = maxZ - minZ || 1;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(3,7,18,0.88)"; ctx.fillRect(0, 0, W, H);
    for (const n of gNodes) {
      const cx = ((n.x ?? 0) - minX) / rangeX * W, cy = ((n.z ?? 0) - minZ) / rangeZ * H;
      const r = n.type === "hub" ? 3.5 : n.type === "agent" ? 2.5 : 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = NODE_COLOR[n.type]; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
    }
    const camPos = (camera as THREE.PerspectiveCamera).position;
    const camDist = camPos.length();
    const vcx = (camPos.x - minX) / rangeX * W, vcy = (camPos.z - minZ) / rangeZ * H;
    const vw = Math.min(W * 0.9, (camDist / 4) / rangeX * W * 10), vh = vw * (H / W);
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1;
    ctx.strokeRect(vcx - vw / 2, vcy - vh / 2, vw, vh);
    ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.strokeRect(0, 0, W, H);
  }, []);

  const handleMinimapNavigate = useCallback((fracX: number, fracZ: number) => {
    const { minX, maxX, minZ, maxZ } = minimapBoundsRef.current;
    const x = minX + fracX * (maxX - minX), z = minZ + fracZ * (maxZ - minZ);
    fgRef.current?.cameraPosition({ x, y: 300, z: z + 200 }, { x, y: 0, z }, 900);
  }, []);

  // ── Main RAF loop ─────────────────────────────────────────────────────────

  const rafRef = useRef<number>(0);

  useEffect(() => {
    const nodeToHub = new Map<string, string>();
    for (const l of graphData.links) {
      if (l.type !== "clusters") continue;
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      nodeToHub.set(t, s);
    }

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      fpsTracker.tick(performance.now());
      const fg = fgRef.current;
      if (!fg) return;

      if (!bloomSetupRef.current) {
        setupBloom();
        try {
          fg.d3Force("charge")?.theta?.(0.9);
          fg.d3Force("charge")?.distanceMax?.(IS_MOBILE ? 120 : 600);
          if (IS_MOBILE) {
            fg.d3Force("charge")?.strength?.(-60);
            fg.d3Force("link")?.distance?.(30);
          }
        } catch { /* not ready */ }
      }

      const camera = fg.camera() as THREE.PerspectiveCamera;
      const camDist = camera.position.length();
      const newZoom: ZoomLevel = camDist > ZOOM_FAR ? "far" : camDist > ZOOM_MID ? "mid" : "close";
      if (newZoom !== zoomLevelRef.current) { zoomLevelRef.current = newZoom; setZoomLevel(newZoom); }

      _projMx.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projMx);

      const { run: runMesh, issue: issMesh } = instancedMeshRef.current;
      if (typeof fg.graphData !== "function") return;
      const gNodes = fg.graphData().nodes as GraphNode[];
      const hlIds = highlightedIdsRef.current;
      const path = pathResultRef.current;
      const cols = collapsedHubsRef.current;

      if ((runMesh || issMesh) && viewMode !== "neuromorphic") {
        let ri = 0, ii = 0;
        for (const n of gNodes) {
          if (n.type !== "run" && n.type !== "issue") continue;
          _vec3.set(n.x ?? 0, n.y ?? 0, n.z ?? 0);
          const inFrustum = _frustum.containsPoint(_vec3);
          const visibleByZoom = (n.type === "run" && newZoom === "close") || (n.type === "issue" && newZoom !== "far");
          const hubId = nodeToHub.get(n.id) ?? null;
          const collapsed = hubId ? cols.has(hubId) : false;
          const visible = inFrustum && visibleByZoom && !collapsed;

          if (collapsed && hubId) {
            const hub = gNodes.find(h => h.id === hubId);
            if (hub) {
              n.fx = THREE.MathUtils.lerp(n.x ?? hub.x ?? 0, hub.x ?? 0, 0.18);
              n.fy = THREE.MathUtils.lerp(n.y ?? hub.y ?? 0, hub.y ?? 0, 0.18);
              n.fz = THREE.MathUtils.lerp(n.z ?? hub.z ?? 0, hub.z ?? 0, 0.18);
            }
          } else if (n.fx !== undefined) { n.fx = undefined; n.fy = undefined; n.fz = undefined; }

          _dummy.position.copy(_vec3); _dummy.scale.setScalar(visible ? 1 : 0); _dummy.updateMatrix();

          if (n.type === "run" && runMesh) {
            _color.set(path?.nodeIds.has(n.id) ? "#22d3ee" : hlIds && !hlIds.has(n.id) ? "#1f2937" : NODE_COLOR.run);
            runMesh.setMatrixAt(ri, _dummy.matrix); runMesh.setColorAt(ri, _color); ri++;
          } else if (n.type === "issue" && issMesh) {
            _color.set(path?.nodeIds.has(n.id) ? "#22d3ee" : hlIds && !hlIds.has(n.id) ? "#1f2937" : NODE_COLOR.issue);
            issMesh.setMatrixAt(ii, _dummy.matrix); issMesh.setColorAt(ii, _color); ii++;
          }
        }
        if (runMesh) { runMesh.count = ri; runMesh.instanceMatrix.needsUpdate = true; if (runMesh.instanceColor) runMesh.instanceColor.needsUpdate = true; }
        if (issMesh) { issMesh.count = ii; issMesh.instanceMatrix.needsUpdate = true; if (issMesh.instanceColor) issMesh.instanceColor.needsUpdate = true; }
      }

      for (const n of gNodes) {
        if (n.type === "run" || n.type === "issue") continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj = (n as any).__threeObj as THREE.Object3D | undefined;
        if (!obj) continue;

        if (viewMode === "neuromorphic") {
          // In neuromorphic mode, all nodes are particle clouds — always visible
          obj.visible = true;

          // Animate particle orbital motion + firing (skip when FPS degraded on mobile)
          if (obj instanceof THREE.Points && !fpsTracker.degraded) {
            const time = performance.now() * 0.001;
            const fireIntensity = firingSystemRef.current.getIntensity(n.id, performance.now());
            animateParticleCluster(obj, time, fireIntensity);
          }

          // Apply brain-region attractor force (weak bias toward region center)
          const region = BRAIN_REGIONS[n.type];
          if (region && n.fx === undefined || n.fx === null) {
            const [rx, ry, rz] = region.center;
            const dx = rx - (n.x ?? 0);
            const dy = ry - (n.y ?? 0);
            const dz = rz - (n.z ?? 0);
            n.vx = (n.vx ?? 0) + dx * NEURO_ATTRACTOR_STRENGTH;
            n.vy = (n.vy ?? 0) + dy * NEURO_ATTRACTOR_STRENGTH;
            n.vz = (n.vz ?? 0) + dz * NEURO_ATTRACTOR_STRENGTH;
          }
        } else {
          const visibleByZoom = newZoom === "close" || newZoom === "mid" || (newZoom === "far" && (n.type === "hub" || n.type === "agent"));
          obj.visible = visibleByZoom;
          let targetColor: string, targetOpacity: number;
          if (path?.nodeIds.has(n.id)) { targetColor = "#22d3ee"; targetOpacity = 1.0; }
          else if (hlIds && !hlIds.has(n.id)) { targetColor = NODE_COLOR[n.type]; targetOpacity = 0.08; }
          else { targetColor = n.isNew ? NODE_COLOR_NEW : NODE_COLOR[n.type]; targetOpacity = 0.9; }
          _color.set(targetColor);
          obj.traverse((child: THREE.Object3D) => {
            if (child instanceof THREE.Mesh) { const mat = child.material as THREE.MeshLambertMaterial; mat.color.copy(_color); mat.opacity = targetOpacity; }
          });
        }
      }

      // Neuromorphic: also animate run/issue nodes that are particle clouds
      if (viewMode === "neuromorphic") {
        for (const n of gNodes) {
          if (n.type !== "run" && n.type !== "issue") continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const obj = (n as any).__threeObj as THREE.Object3D | undefined;
          if (!obj || !(obj instanceof THREE.Points)) continue;
          const time = performance.now() * 0.001;
          const fireIntensity = firingSystemRef.current.getIntensity(n.id, performance.now());
          animateParticleCluster(obj, time, fireIntensity);

          // Attractor force
          const region = BRAIN_REGIONS[n.type];
          if (region) {
            const [rx, ry, rz] = region.center;
            n.vx = (n.vx ?? 0) + (rx - (n.x ?? 0)) * NEURO_ATTRACTOR_STRENGTH;
            n.vy = (n.vy ?? 0) + (ry - (n.y ?? 0)) * NEURO_ATTRACTOR_STRENGTH;
            n.vz = (n.vz ?? 0) + (rz - (n.z ?? 0)) * NEURO_ATTRACTOR_STRENGTH;
          }
        }

        // Cleanup old firing events & update stats periodically
        const perfNow = performance.now();
        firingSystemRef.current.cleanup(perfNow);
        neuroStatsRef.current = {
          neurons: gNodes.length,
          synapses: graphData.links.length,
          active: firingSystemRef.current.activeCount(perfNow),
          rate: firingSystemRef.current.firingRate(),
          regions: firingSystemRef.current.regionActivity(gNodes, perfNow),
        };

        // Auto-fire: periodically trigger random link pulses (pause when FPS degraded)
        if (!fpsTracker.degraded && perfNow - lastAutoFireRef.current > AUTO_FIRE_INTERVAL_MS) {
          lastAutoFireRef.current = perfNow;
          const arcs = Array.from(lightningArcsRef.current.entries());
          if (arcs.length > 0) {
            const batch = Math.min(AUTO_FIRE_BATCH, arcs.length);
            for (let i = 0; i < batch; i++) {
              const idx = Math.floor(Math.random() * arcs.length);
              const [key, arc] = arcs[idx];
              if (arc.pulseT < 0) {
                triggerArcPulse(arc);
                // Also fire the target node's particle cluster
                const tgtId = key.split("|")[1];
                if (tgtId) {
                  firingSystemRef.current.fire(tgtId, perfNow);
                  const neighbors = neuroAdjMapRef.current.get(tgtId) ?? [];
                  firingSystemRef.current.propagate(tgtId, neighbors, perfNow);
                }
              }
            }
          }
        }
      }

      const now = performance.now();
      if (now - minimapUpdateRef.current > 100) {
        minimapUpdateRef.current = now;
        drawMinimap();
        // Update React state for stats HUD at reduced frequency
        if (viewMode === "neuromorphic") {
          setNeuroStats({ ...neuroStatsRef.current });
        }
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [setupBloom, drawMinimap, graphData.links, viewMode]);

  // Configure the renderer's built-in 3D controls once they exist so that
  // two-finger pinch-zoom is enabled and tuned for touch. react-force-graph
  // creates `controls()` after the first render frame, so we poll briefly.
  // Both TrackballControls (default) and OrbitControls expose rotateSpeed /
  // zoomSpeed; OrbitControls additionally exposes `touches.TWO` and
  // `screenSpacePanning`, which we set defensively for the day we flip
  // controlType.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const apply = () => {
      if (cancelled) return;
      const fg = fgRef.current;
      const controls = fg && typeof fg.controls === "function" ? fg.controls() : null;
      if (!controls) {
        if (++attempts < 60) requestAnimationFrame(apply);
        return;
      }
      // Common to TrackballControls + OrbitControls.
      if ("rotateSpeed" in controls) controls.rotateSpeed = 0.8;
      if ("zoomSpeed" in controls) controls.zoomSpeed = 1.2;
      // TrackballControls — make sure 2-finger pinch (TOUCH_ZOOM_PAN) isn't gated.
      if ("noZoom" in controls) controls.noZoom = false;
      if ("noPan" in controls) controls.noPan = false;
      if ("noRotate" in controls) controls.noRotate = false;
      // OrbitControls — set explicitly in case controlType is flipped later.
      if ("enableZoom" in controls) controls.enableZoom = true;
      if ("enablePan" in controls) controls.enablePan = true;
      if ("enableRotate" in controls) controls.enableRotate = true;
      if ("screenSpacePanning" in controls) controls.screenSpacePanning = true;
      // touches.TWO = DOLLY_PAN is OrbitControls' two-finger pinch+pan.
      // THREE.TOUCH.DOLLY_PAN is the numeric value 2 (THREE.TOUCH enum).
      // Casting via `as` keeps this hook ts-clean when controls() is the
      // TrackballControls type (which has no `touches` field).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyControls = controls as any;
      if (anyControls.touches) {
        // THREE.TOUCH: { ROTATE:0, PAN:1, DOLLY_PAN:2, DOLLY_ROTATE:3 }
        anyControls.touches.ONE = 0; // ROTATE
        anyControls.touches.TWO = 2; // DOLLY_PAN
      }
      // Dev-only diagnostic hook for the pinch regression test
      // (scripts/kg-pinch-verify.mjs). Stripped from prod builds.
      if (import.meta.env.DEV) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__kgFg = fg;
      }
    };
    requestAnimationFrame(apply);
    return () => {
      cancelled = true;
    };
  }, [viewMode]);

  const handleEngineStop = useCallback(() => {
    if (!IS_MOBILE) return;
    // Only zoom-to-fit once on initial load, not on every engine stop
    if (initialZoomDoneRef.current) return;
    initialZoomDoneRef.current = true;
    const fg = fgRef.current;
    if (!fg) return;
    // Zoom to fit with tight padding, then aggressively clamp camera for mobile.
    fg.zoomToFit(600, 20);
    setTimeout(() => {
      const fg2 = fgRef.current;
      if (!fg2) return;
      const camera = fg2.camera() as THREE.PerspectiveCamera;
      const dist = camera.position.length();
      // Force camera much closer — nodes should be pin-sized on 375px screens
      const target = Math.min(dist, MOBILE_MAX_CAMERA_DIST);
      if (dist > target) {
        const scale = target / dist;
        const p = camera.position;
        fg2.cameraPosition({ x: p.x * scale, y: p.y * scale, z: p.z * scale }, undefined, 500);
      }
    }, 700);
  }, []);

  const handleNodeClick = useCallback((node: GraphNode, event?: MouseEvent) => {
    if (event?.shiftKey && selectedNodeRef.current && selectedNodeRef.current.id !== node.id) { setPathEndNode(node); }
    else { setSelectedNode(prev => prev?.id === node.id ? null : node); setPathEndNode(null); }
    const dist = 70, { x = 0, y = 0, z = 0 } = node;
    fgRef.current?.cameraPosition({ x: x + dist, y: y + dist, z: z + dist }, { x, y, z }, 900);
  }, []);

  const nodeThreeObject = useCallback((node: GraphNode): THREE.Object3D => {
    if (viewMode === "neuromorphic") {
      const connCount = neuroAdjMapRef.current.get(node.id)?.length ?? 0;
      const cluster = createParticleCluster(node, connCount);
      neuroParticlesRef.current.set(node.id, cluster);
      return cluster;
    }
    // On mobile, render all nodes as real objects (no InstancedMesh optimization)
    if (!IS_MOBILE && (node.type === "run" || node.type === "issue")) return makePlaceholder(NODE_SIZE[node.type]);
    return makeNodeObject(node);
  }, [viewMode]);

  const linkColor = useCallback((link: GraphLink): string => {
    const s = typeof link.source === "object" ? link.source.id : link.source;
    const t = typeof link.target === "object" ? link.target.id : link.target;
    if (pathResultRef.current?.linkIds.has(`${s}|${t}`)) return "#22d3ee";
    const hlIds = highlightedIdsRef.current;
    if (hlIds && !(hlIds.has(s) && hlIds.has(t))) return "#1f293722";
    if (viewMode === "neuromorphic") {
      // Use region color with low opacity for synaptic look
      const srcNode = graphData.nodes.find(n => n.id === s);
      const region = srcNode ? BRAIN_REGIONS[srcNode.type] : null;
      return region ? region.color + "44" : "#ffffff22";
    }
    return LINK_COLOR[link.type];
  }, [viewMode, graphData.nodes]);

  // Boost particles for: (a) edges that lie on an active path highlight, and
  // (b) edges touching the hovered node — Later-style "traveling particle"
  // effect that emphasizes which connections light up on focus.
  // Build edge-count per node so highly-connected memories visually
  // dominate. Cap at 4× the base size — beyond that the force layout
  // shoves them off-screen and the visual stops paying off.
  const edgeCountByNode = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of graphData.links) {
      const s = typeof link.source === "object" ? link.source.id : link.source;
      const t = typeof link.target === "object" ? link.target.id : link.target;
      counts.set(s, (counts.get(s) ?? 0) + 1);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [graphData.links]);

  const sizedNodeVal = useCallback((node: GraphNode): number => {
    const base = NODE_SIZE[node.type] * (IS_MOBILE ? 5 : 1);
    const edges = edgeCountByNode.get(node.id) ?? 0;
    // Logarithmic scale so the first few connections matter a lot,
    // diminishing returns past ~16 edges. Capped at 4× base.
    const scale = Math.min(4, 1 + Math.log2(1 + edges) * 0.45);
    return base * scale;
  }, [edgeCountByNode]);

  const linkParticles = useCallback((link: GraphLink): number => {
    const s = typeof link.source === "object" ? link.source.id : link.source;
    const t = typeof link.target === "object" ? link.target.id : link.target;
    if (pathResultRef.current?.linkIds.has(`${s}|${t}`)) return 6;
    if (hoveredNode && (s === hoveredNode.id || t === hoveredNode.id)) return 4;
    return 2;
  }, [hoveredNode]);

  const linkParticleSpeed = useCallback((link: GraphLink): number => {
    const tgt = typeof link.target === "object" ? (link.target as GraphNode) : graphData.nodes.find(n => n.id === link.target);
    if (tgt?.type === "run" && tgt.startedAt) {
      const ageHours = (Date.now() - new Date(tgt.startedAt).getTime()) / 3_600_000;
      return Math.max(0.003, 0.013 * Math.exp(-ageHours / 36));
    }
    return 0.004;
  }, [graphData.nodes]);

  const linkParticleColor = useCallback((link: GraphLink): string => {
    const s = typeof link.source === "object" ? link.source.id : link.source;
    const t = typeof link.target === "object" ? link.target.id : link.target;
    return pathResultRef.current?.linkIds.has(`${s}|${t}`) ? "#22d3ee" : LINK_COLOR[link.type];
  }, []);

  // ── Lightning arc link rendering (neuromorphic mode) ──────────────────────

  const linkThreeObject = useCallback((link: GraphLink): THREE.Object3D => {
    const s = typeof link.source === "object" ? link.source.id : link.source;
    const t = typeof link.target === "object" ? link.target.id : link.target;
    const key = `${s}|${t}`;
    const arc = createLightningArc(link, graphData.nodes);
    lightningArcsRef.current.set(key, arc);
    return arc.group;
  }, [viewMode, graphData.nodes]);

  const linkPositionUpdate = useCallback((
    obj: THREE.Object3D | undefined,
    _coords: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } },
    link: GraphLink,
  ): boolean | undefined => {
    if (viewMode !== "neuromorphic" || !obj) return undefined;
    const s = typeof link.source === "object" ? link.source.id : link.source;
    const t = typeof link.target === "object" ? link.target.id : link.target;
    const key = `${s}|${t}`;
    const arc = lightningArcsRef.current.get(key);
    if (!arc) return undefined;

    _arcSrc.set(_coords.start.x, _coords.start.y, _coords.start.z);
    _arcTgt.set(_coords.end.x, _coords.end.y, _coords.end.z);
    const time = performance.now() * 0.001;
    updateLightningArc(arc, _arcSrc, _arcTgt, time);

    // Position the group at origin since positions are absolute
    obj.position.set(0, 0, 0);
    return true; // we handled positioning
  }, [viewMode]);

  const toggleHub = useCallback((hubId: string) => {
    setCollapsedHubs(prev => { const next = new Set(prev); if (next.has(hubId)) next.delete(hubId); else next.add(hubId); return next; });
  }, []);

  // ── Ingest mutation ────────────────────────────────────────────────────────

  const [ingestStatus, setIngestStatus] = useState<"idle" | "ingesting" | "done" | "error">("idle");
  const [ingestSummary, setIngestSummary] = useState<string | null>(null);

  const ingestMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCompanyId) return;
      const recentRuns = (runs as HeartbeatRun[]).filter((r) => r.status === "succeeded" || r.status === "failed").slice(0, 5);
      let totalCreated = 0, totalMerged = 0, totalEdges = 0;
      for (const r of recentRuns) {
        const result = await knowledgeGraphApi.ingestRun(selectedCompanyId, r.id);
        totalCreated += result.entitiesCreated; totalMerged += result.entitiesMerged; totalEdges += result.edgesCreated;
      }
      return { totalCreated, totalMerged, totalEdges, runsProcessed: recentRuns.length };
    },
    onMutate: () => { setIngestStatus("ingesting"); setIngestSummary(null); },
    onSuccess: (data) => {
      setIngestStatus("done");
      if (data) setIngestSummary(`${data.runsProcessed} runs → +${data.totalCreated} entities, ${data.totalEdges} edges`);
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeGraph.get(selectedCompanyId!) });
      setTimeout(() => setIngestStatus("idle"), 5000);
    },
    onError: () => { setIngestStatus("error"); setTimeout(() => setIngestStatus("idle"), 4000); },
  });

  /**
   * Export the company knowledge graph as an Obsidian zip.
   *
   * Mobile-safe approach: append a hidden anchor to the DOM, click it, then
   * remove it. We use target="_blank" + rel="noopener" so iOS Safari treats
   * the zip URL as an in-context save (its native download confirmation
   * sheet is dismissable) instead of trying to render it and trapping the
   * user in a modal they can't escape without force-closing the tab.
   *
   * Even with this fix the button is hidden on small viewports — the
   * import side of Obsidian only makes sense on desktop, and Tyler asked
   * for no Obsidian button at all on mobile.
   */
  const handleObsidianExport = useCallback(() => {
    if (!selectedCompanyId) return;
    const url = knowledgeGraphApi.exportObsidianUrl(selectedCompanyId);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paperclip-knowledge-graph.zip";
    a.target = "_blank";
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    requestAnimationFrame(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
    });
  }, [selectedCompanyId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const timeRangeMs = timeMax.getTime() - timeMin.getTime();
  const knowledgeCount = kgData?.entities.length ?? 0;

  // Camera helpers for the floating glass control panel. zoomToFit drives the
  // Fit button; Zoom in/out scale the camera distance about the current target;
  // Reset pulls back to the default fit + clears any active selection.
  const handleZoomIn = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const cam = fg.camera() as THREE.PerspectiveCamera;
    const p = cam.position;
    const scale = 0.8;
    fg.cameraPosition({ x: p.x * scale, y: p.y * scale, z: p.z * scale }, undefined, 300);
  }, []);
  const handleZoomOut = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const cam = fg.camera() as THREE.PerspectiveCamera;
    const p = cam.position;
    const scale = 1.25;
    fg.cameraPosition({ x: p.x * scale, y: p.y * scale, z: p.z * scale }, undefined, 300);
  }, []);
  const handleFitAll = useCallback(() => {
    fgRef.current?.zoomToFit(600, 30);
  }, []);
  const handleResetView = useCallback(() => {
    setSelectedNode(null);
    setPathEndNode(null);
    fgRef.current?.zoomToFit(600, 50);
  }, []);

  // v2 mobile gestures — single-tap / double-tap-fly / pull-down-reset.
  // Two-finger pinch + pan are delegated to the renderer's built-in
  // TrackballControls; we explicitly do NOT bind a pinch handler here
  // because preventing the default or running a parallel cameraPosition
  // tween fights the controls and kills pinch on iOS Safari + Android
  // Chrome (Tyler had to use the +/- buttons).
  useKnowledgeGraphGestures({
    canvasRef: containerRef,
    enabled: IS_MOBILE,
    onDoubleTap: (clientX, clientY) => {
      // Raycast at the tap coordinate via react-force-graph helpers.
      const fg = fgRef.current;
      if (!fg) return;
      // Convert screen → world via the camera's projection inverse.
      // react-force-graph exposes `screen2GraphCoords` for 2D; for 3D we
      // approximate by zooming to the closest visible node within 40px.
      const targetEl = containerRef.current;
      if (!targetEl) return;
      const rect = targetEl.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      let closest: GraphNode | null = null;
      let closestDist = 40 * 40;
      const cam = fg.camera() as THREE.PerspectiveCamera;
      for (const n of graphData.nodes) {
        if (typeof n.x !== "number" || typeof n.y !== "number" || typeof n.z !== "number") continue;
        const v = new THREE.Vector3(n.x, n.y, n.z).project(cam);
        const sx = ((v.x + 1) / 2) * rect.width;
        const sy = ((-v.y + 1) / 2) * rect.height;
        const dsq = (sx - localX) ** 2 + (sy - localY) ** 2;
        if (dsq < closestDist) {
          closestDist = dsq;
          closest = n;
        }
      }
      if (closest && typeof closest.x === "number") {
        fg.cameraPosition(
          { x: closest.x, y: closest.y!, z: (closest.z ?? 0) + 60 },
          closest as unknown as { x: number; y: number; z: number },
          1200,
        );
      }
    },
    onPullDownReset: handleResetView,
  });

  return (
    <div
      className="relative flex w-full flex-col overflow-hidden"
      style={{
        ...(IS_MOBILE
          ? { position: "fixed", left: 0, right: 0, bottom: 0, top: "calc(env(safe-area-inset-top) + 48px)" }
          : { height: "100dvh" }),
        // Modern v2 backdrop: deep base + radial gradients matching the rest
        // of the app, visible at the canvas edges (force-graph paints over the
        // center with its own backgroundColor, so this just frames it).
        background:
          "radial-gradient(circle at 18% 8%, rgba(167, 139, 250, 0.10), transparent 28rem)," +
          "radial-gradient(circle at 92% 12%, rgba(45, 212, 191, 0.08), transparent 26rem)," +
          "radial-gradient(circle at 50% 100%, rgba(134, 239, 172, 0.06), transparent 30rem)," +
          "#08090b",
      }}
    >
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0"
        style={{
          height: IS_MOBILE ? "100%" : "calc(100dvh - 3.5rem)",
          // Tell the browser not to claim pinch / pan for page-zoom or
          // scroll; the renderer's TrackballControls needs the raw
          // multitouch events.
          touchAction: "none",
        }}
      >
        {graphData.nodes.length > 0 && dimensions.width > 0 && dimensions.height > 0 ? (
          viewMode === "neuromorphic" ? (
            <ForceGraph3D<GraphNode, GraphLink>
              key={viewMode}
              ref={fgRef}
              width={dimensions.width}
              height={Math.max(dimensions.height, 1)}
              graphData={graphData}
              backgroundColor="rgba(8,9,11,0)"
              nodeLabel={(n) => `[${n.type.toUpperCase()}] ${n.label}`}
              nodeThreeObject={nodeThreeObject}
              nodeThreeObjectExtend={false}
              nodeVal={sizedNodeVal}
              linkColor={linkColor}
              linkWidth={0}
              linkCurvature={0}
              linkOpacity={0}
              linkDirectionalArrowLength={0}
              linkDirectionalArrowRelPos={1}
              linkDirectionalParticles={0}
              linkDirectionalParticleSpeed={linkParticleSpeed}
              linkDirectionalParticleWidth={IS_MOBILE ? 4 : 1.8}
              linkDirectionalParticleColor={linkParticleColor}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              linkThreeObject={linkThreeObject as any}
              linkThreeObjectExtend={false}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              linkPositionUpdate={linkPositionUpdate as any}
              onNodeClick={handleNodeClick}
              onNodeHover={(n) => setHoveredNode(n ?? null)}
              onBackgroundClick={() => { setSelectedNode(null); setPathEndNode(null); }}
              onEngineStop={handleEngineStop}
              enableNodeDrag
              enableNavigationControls
              showNavInfo={false}
              warmupTicks={IS_MOBILE ? 100 : (physicsReady ? 10 : 80)}
              cooldownTicks={IS_MOBILE ? 60 : (physicsReady ? 80 : 200)}
              d3AlphaDecay={IS_MOBILE ? 0.04 : 0.0228}
              d3VelocityDecay={IS_MOBILE ? 0.5 : 0.4}
            />
          ) : (
            <V2Renderer<GraphNode, GraphLink>
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              fgRef={fgRef}
              hoveredId={hoveredNode?.id ?? null}
              selectedId={selectedNode?.id ?? null}
              edgeCountByNode={edgeCountByNode}
              isMobile={IS_MOBILE}
              warmupTicks={IS_MOBILE ? 100 : (physicsReady ? 10 : 80)}
              cooldownTicks={IS_MOBILE ? 60 : (physicsReady ? 80 : 200)}
              d3AlphaDecay={IS_MOBILE ? 0.04 : 0.0228}
              d3VelocityDecay={IS_MOBILE ? 0.5 : 0.4}
              onNodeClick={handleNodeClick}
              onNodeHover={(n) => setHoveredNode(n ?? null)}
              onBackgroundClick={() => { setSelectedNode(null); setPathEndNode(null); }}
              onEngineStop={handleEngineStop}
              linkParticles={linkParticles}
              linkParticleSpeed={linkParticleSpeed}
              linkParticleColor={linkParticleColor}
              // Preserve path / dim-non-highlighted tinting from the page.
              linkColorOverride={(link) => {
                const s = typeof link.source === "object" ? link.source.id : link.source;
                const t = typeof link.target === "object" ? link.target.id : link.target;
                if (pathResultRef.current?.linkIds.has(`${s}|${t}`)) return "#22d3ee";
                const hlIds = highlightedIdsRef.current;
                if (hlIds && !(hlIds.has(s) && hlIds.has(t))) return "#1f293722";
                return null;
              }}
              // Page's InstancedMesh draws run/issue on desktop — let the
              // renderer return invisible placeholders for those.
              isPlaceholderNode={(n) => !IS_MOBILE && (n.type === "run" || n.type === "issue")}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading graph data…</div>
        )}
      </div>

      {/* Mobile sidebar toggle button */}
      {IS_MOBILE && sidebarCollapsed && (
        <button
          onClick={() => setSidebarCollapsed(false)}
          className="absolute left-2 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-gray-800 bg-gray-900/90 backdrop-blur-sm"
          style={{ top: "52px" }}
        >
          <PanelLeft className="h-4 w-4 text-gray-400" />
        </button>
      )}

      {/* Legend — pushed below app header + toolbar on mobile */}
      <div
        className="pointer-events-none absolute left-4 z-10 flex flex-col gap-2 rounded-md border border-gray-800 bg-gray-900/90 px-4 py-3 backdrop-blur-sm transition-transform duration-200"
        style={{
          ...(IS_MOBILE ? { top: "48px" } : { top: "16px" }),
          ...(IS_MOBILE && sidebarCollapsed ? { transform: "translateX(calc(-100% - 20px))" } : {}),
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Legend</p>
          {IS_MOBILE && (
            <button onClick={() => setSidebarCollapsed(true)} className="pointer-events-auto -mr-1 flex h-5 w-5 items-center justify-center rounded text-gray-500 hover:text-gray-300">
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {LEGEND.map(({ type, shape, label }) => (
          <div key={type} className="flex items-center gap-2">
            <span className="text-base leading-none" style={{ color: NODE_COLOR[type] }}>{shape}</span>
            <span className="text-xs text-gray-300">{label}</span>
          </div>
        ))}
        <div className="mt-1 border-t border-gray-800 pt-2 text-[10px] text-gray-500">
          {graphData.nodes.length} nodes · {graphData.links.length} edges
          {knowledgeCount > 0 && <span className="ml-1 text-cyan-500">· {knowledgeCount} extracted</span>}
        </div>
        <div className="text-[10px] text-gray-600 capitalize">Zoom: {zoomLevel}</div>
        {hubNodes.length > 0 && (
          <div className="mt-1 flex flex-col gap-1 border-t border-gray-800 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 pointer-events-none">Clusters</p>
            {hubNodes.map(hub => {
              const count = hubClusterCounts.get(hub.id) ?? 0;
              const collapsed = collapsedHubs.has(hub.id);
              return (
                <button key={hub.id} onClick={() => toggleHub(hub.id)} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left hover:bg-gray-800 transition-colors pointer-events-auto">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: NODE_COLOR.hub }} />
                  <span className="text-[11px] text-gray-300 truncate max-w-[110px]">{hub.label}</span>
                  <span className="ml-auto rounded bg-purple-900/60 px-1 text-[9px] text-purple-300">{collapsed ? `+${count}` : count}</span>
                  <span className="text-[9px] text-gray-600">{collapsed ? "▶" : "▼"}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Mini-map */}
      <div
        className="absolute bottom-20 left-4 z-10 rounded-md border border-gray-800 overflow-hidden shadow-lg transition-transform duration-200"
        style={IS_MOBILE && sidebarCollapsed ? { transform: "translateX(calc(-100% - 20px))" } : {}}
      >
        <div className="bg-gray-900/80 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-gray-600">Map</div>
        <Minimap canvasRef={minimapCanvasRef} onNavigate={handleMinimapNavigate} />
      </div>

      {/* Neuromorphic Stats HUD */}
      {viewMode === "neuromorphic" && (
        <div className="absolute right-4 top-4 z-10 w-52 rounded-md border border-purple-800/60 bg-gray-950/90 backdrop-blur-sm shadow-[0_0_20px_rgba(168,85,247,0.15)]">
          <div className="flex items-center gap-2 border-b border-purple-900/40 px-3 py-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-purple-400" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-purple-300">Neural Activity</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2">
            <div>
              <p className="text-[9px] uppercase tracking-wide text-gray-600">Neurons</p>
              <p className="text-sm font-medium tabular-nums text-gray-200">{neuroStats.neurons}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-gray-600">Synapses</p>
              <p className="text-sm font-medium tabular-nums text-gray-200">{neuroStats.synapses}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-gray-600">Active</p>
              <p className="text-sm font-medium tabular-nums text-green-400">{neuroStats.active}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-gray-600">Rate</p>
              <p className="text-sm font-medium tabular-nums text-cyan-400">{neuroStats.rate}<span className="text-[9px] text-gray-600">/min</span></p>
            </div>
          </div>
          {Object.keys(neuroStats.regions).length > 0 && (
            <div className="border-t border-purple-900/40 px-3 py-2">
              <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600">Region Activity</p>
              <div className="flex flex-col gap-1">
                {Object.entries(neuroStats.regions)
                  .filter(([, count]) => count > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([region, count]) => (
                    <div key={region} className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: NEURO_REGION_COLOR[region] ?? "#6b7280" }} />
                      <span className="flex-1 truncate text-[10px] text-gray-400">{region}</span>
                      <span className="text-[10px] tabular-nums text-gray-500">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      {IS_MOBILE ? (
        /* Mobile: full-width scrollable strip pinned just below the 56px app header */
        <div className="absolute left-0 right-0 z-20 flex items-center gap-1.5 overflow-x-auto border-b border-gray-800 bg-gray-950/95 px-2 py-1.5 backdrop-blur-sm" style={{ top: 0, WebkitOverflowScrolling: "touch", scrollbarWidth: "none" } as CSSProperties}>
          <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search…" className="min-w-0 w-28 shrink-0 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-gray-500" />
          {searchText && <button onClick={() => setSearchText("")} className="shrink-0 rounded p-0.5 text-gray-500"><X className="h-3 w-3" /></button>}
          <button onClick={() => setFilterOpen((v) => !v)} className={`shrink-0 flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${filterOpen ? "border-gray-600 bg-gray-700 text-gray-200" : "border-gray-700 bg-gray-900 text-gray-400"}`}>
            <SlidersHorizontal className="h-3 w-3" /> Filter
          </button>
          <button
            onClick={() => setViewMode(v => v === "standard" ? "neuromorphic" : "standard")}
            className={`shrink-0 flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${viewMode === "neuromorphic" ? "border-purple-500 bg-purple-900/60 text-purple-200" : "border-gray-700 bg-gray-900 text-gray-400"}`}
          >
            <Brain className="h-3 w-3" />
            {viewMode === "neuromorphic" ? "Neural" : "Std"}
          </button>
          <button onClick={() => generateHubs.mutate()} disabled={generateHubs.isPending || !selectedCompanyId} className="shrink-0 flex items-center gap-1 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-400 transition-colors disabled:opacity-40">
            <RefreshCw className={`h-3 w-3 ${generateHubs.isPending ? "animate-spin" : ""}`} />
            Hubs
          </button>
          <button onClick={() => ingestMutation.mutate()} disabled={ingestStatus === "ingesting" || !selectedCompanyId} className={["shrink-0 flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition-colors", ingestStatus === "ingesting" ? "cursor-not-allowed border-gray-700 bg-gray-800 text-gray-500" : ingestStatus === "done" ? "border-cyan-700 bg-cyan-900/50 text-cyan-300" : ingestStatus === "error" ? "border-red-700 bg-red-900/40 text-red-300" : "border-gray-700 bg-gray-900 text-gray-400"].join(" ")}>
            {ingestStatus === "ingesting" && <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-gray-600 border-t-cyan-400" />}
            {ingestStatus === "done" ? "✓" : ingestStatus === "error" ? "✗" : "⬇"} Ingest
          </button>
          {/* Obsidian export deliberately hidden on mobile — the zip is only
              useful on a desktop Obsidian install, and downloading large zips
              from a navigation trapped Tyler in an iOS Safari modal he
              couldn't escape. */}
        </div>
      ) : (
        /* Desktop: centered floating toolbar */
        <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2">
          <input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search nodes…" className="w-56 rounded-md border border-gray-700 bg-gray-900/95 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 backdrop-blur-sm outline-none focus:border-gray-500 focus:ring-0" />
          {searchText && <button onClick={() => setSearchText("")} className="rounded p-1 text-gray-500 hover:text-gray-300"><X className="h-3.5 w-3.5" /></button>}
          <button onClick={() => setFilterOpen((v) => !v)} className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs backdrop-blur-sm transition-colors ${filterOpen ? "border-gray-600 bg-gray-700/90 text-gray-200" : "border-gray-700 bg-gray-900/95 text-gray-400 hover:text-gray-200"}`}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
          </button>
          <button
            onClick={() => setViewMode(v => v === "standard" ? "neuromorphic" : "standard")}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium backdrop-blur-sm transition-colors ${viewMode === "neuromorphic" ? "border-purple-500 bg-purple-900/60 text-purple-200 shadow-[0_0_12px_rgba(168,85,247,0.3)]" : "border-gray-700 bg-gray-900/95 text-gray-400 hover:text-gray-200 hover:border-purple-600"}`}
            title="Toggle neuromorphic brain visualization"
          >
            <Brain className="h-3.5 w-3.5" />
            {viewMode === "neuromorphic" ? "Neural" : "Standard"}
          </button>
          <button onClick={() => generateHubs.mutate()} disabled={generateHubs.isPending || !selectedCompanyId} className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-900/95 px-2.5 py-1.5 text-xs text-gray-400 backdrop-blur-sm transition-colors hover:text-gray-200 disabled:opacity-40" title="Re-generate AI hubs from current issues">
            <RefreshCw className={`h-3.5 w-3.5 ${generateHubs.isPending ? "animate-spin" : ""}`} />
            {generateHubs.isPending ? "Generating…" : "Regen Hubs"}
          </button>
          <button onClick={() => ingestMutation.mutate()} disabled={ingestStatus === "ingesting" || !selectedCompanyId} className={["flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors backdrop-blur-sm", ingestStatus === "ingesting" ? "cursor-not-allowed border-gray-700 bg-gray-800 text-gray-500" : ingestStatus === "done" ? "border-cyan-700 bg-cyan-900/50 text-cyan-300" : ingestStatus === "error" ? "border-red-700 bg-red-900/40 text-red-300" : "border-gray-700 bg-gray-900/95 text-gray-400 hover:border-cyan-700 hover:text-cyan-300"].join(" ")}>
            {ingestStatus === "ingesting" && <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-cyan-400" />}
            {ingestStatus === "done" ? "✓ Ingested" : ingestStatus === "error" ? "✗ Failed" : "⬇ Ingest Runs"}
          </button>
          <button onClick={handleObsidianExport} disabled={!selectedCompanyId || knowledgeCount === 0} className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-900/95 px-2.5 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:border-purple-600 hover:text-purple-300 disabled:cursor-not-allowed disabled:opacity-40 backdrop-blur-sm">
            ⬢ Obsidian
          </button>
        </div>
      )}

      {ingestStatus === "done" && ingestSummary && (
        <div className="absolute right-4 top-14 z-10 rounded-md border border-cyan-800 bg-cyan-950/90 px-3 py-2 text-xs text-cyan-300 backdrop-blur-sm">{ingestSummary}</div>
      )}

      {/* Filter panel */}
      {filterOpen && (
        <div className={`absolute z-20 rounded-md border border-gray-800 bg-gray-900/98 p-4 shadow-xl backdrop-blur-sm ${IS_MOBILE ? "left-2 right-2 w-auto" : "left-1/2 top-14 w-80 -translate-x-1/2"}`} style={IS_MOBILE ? { top: "44px" } : undefined}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Filters</p>
            <button onClick={() => setFilterOpen(false)} className="text-gray-600 hover:text-gray-400"><X className="h-3.5 w-3.5" /></button>
          </div>
          <p className="mb-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide">Node types</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {(["agent", "issue", "run", "hub", "skill", "knowledge"] as NodeType[]).map((t) => (
              <button key={t} onClick={() => toggleType(t)} className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-colors ${typeFilters.has(t) ? "text-gray-100" : "text-gray-600 line-through"}`} style={{ backgroundColor: typeFilters.has(t) ? `${NODE_COLOR[t]}22` : undefined }}>
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: typeFilters.has(t) ? NODE_COLOR[t] : "#374151" }} />{t}
              </button>
            ))}
          </div>
          <p className="mb-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide">Issues</p>
          <div className="mb-3 flex flex-col gap-1">
            {[{ key: "showOpenIssues", label: "Open / In Progress" }, { key: "showClosedIssues", label: "Done / Cancelled" }].map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={statusFilters[key as keyof typeof statusFilters]} onChange={(e) => setStatusFilters((prev) => ({ ...prev, [key]: e.target.checked }))} className="h-3 w-3 accent-blue-500" />{label}
              </label>
            ))}
          </div>
          <p className="mb-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide">Runs</p>
          <div className="mb-3 flex flex-col gap-1">
            {[{ key: "showSuccessRuns", label: "Successful" }, { key: "showFailedRuns", label: "Failed / Error" }].map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={statusFilters[key as keyof typeof statusFilters]} onChange={(e) => setStatusFilters((prev) => ({ ...prev, [key]: e.target.checked }))} className="h-3 w-3 accent-green-500" />{label}
              </label>
            ))}
          </div>
          <p className="mb-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide">Run date range</p>
          <div className="flex items-center gap-2">
            <input type="date" value={runDateFrom} onChange={(e) => setRunDateFrom(e.target.value)} className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-gray-300 outline-none focus:border-gray-500" />
            <span className="text-[10px] text-gray-600">–</span>
            <input type="date" value={runDateTo} onChange={(e) => setRunDateTo(e.target.value)} className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-gray-300 outline-none focus:border-gray-500" />
          </div>
          {(runDateFrom || runDateTo) && <button onClick={() => { setRunDateFrom(""); setRunDateTo(""); }} className="mt-1.5 text-[10px] text-gray-600 hover:text-gray-400">Clear dates</button>}
        </div>
      )}

      {recentEntityIds.size > 0 && (
        <div className="absolute left-4 bottom-36 z-10 flex items-center gap-2 rounded-md border border-cyan-800 bg-cyan-950/90 px-3 py-1.5 text-xs text-cyan-300 backdrop-blur-sm">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
          {recentEntityIds.size} new {recentEntityIds.size === 1 ? "entity" : "entities"} added
        </div>
      )}

      {hoveredNode && !selectedNode && (
        <div className="pointer-events-none absolute bottom-20 left-1/2 z-10 -translate-x-1/2 rounded-md border border-gray-700 bg-gray-900/95 px-3 py-1.5 text-xs text-gray-200 backdrop-blur-sm">
          <span className="font-semibold capitalize" style={{ color: NODE_COLOR[hoveredNode.type] }}>{hoveredNode.type}</span>{" "}· {hoveredNode.label}
          {hoveredNode.status && <span className="ml-2 opacity-60">({hoveredNode.status})</span>}
          {hoveredNode.createdAt.getTime() > 0 && <span className="ml-2 text-gray-500">{formatTimelineDate(hoveredNode.createdAt)}</span>}
          {zoomLevel !== "close" && <span className="ml-1 text-gray-500">(zoom in for details)</span>}
        </div>
      )}

      {pathResult && (
        <div className="absolute top-14 left-1/2 z-10 -translate-x-1/2 flex items-center gap-2 rounded-md border border-cyan-800 bg-gray-900/95 px-3 py-2 text-xs text-cyan-300 backdrop-blur-sm">
          <span className="font-semibold">{selectedNode?.label}</span>
          <span className="text-gray-500">→</span>
          <span className="font-semibold">{pathEndNode?.label}</span>
          <span className="ml-2 rounded bg-cyan-900/40 px-2 py-0.5 text-cyan-400">{pathResult.hops} hop{pathResult.hops !== 1 ? "s" : ""}</span>
          <button onClick={() => setPathEndNode(null)} className="ml-1 text-gray-500 hover:text-gray-300">×</button>
        </div>
      )}
      {selectedNode && !pathResult && (
        <div className="pointer-events-none absolute top-14 left-1/2 z-10 -translate-x-1/2 text-[10px] text-gray-600 bg-gray-900/70 px-2 py-1 rounded backdrop-blur-sm">Shift+click another node to find shortest path</div>
      )}

      {/* Node detail sidebar */}
      {selectedNode && (
        <div className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col border-l border-gray-800 bg-gray-900/98 backdrop-blur-sm">
          <div className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-800 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: NODE_COLOR[selectedNode.type] }}>
                {selectedNode.type}{selectedNode.isNew && <span className="ml-1 rounded bg-cyan-900 px-1 text-cyan-400">new</span>}
              </p>
              <p className="mt-0.5 text-sm font-medium text-gray-100 leading-snug break-words">{selectedNode.label}</p>
              {selectedNode.status && <div className="mt-1"><StatusBadge status={selectedNode.status} /></div>}
            </div>
            <button onClick={() => { setSelectedNode(null); setPathEndNode(null); }} className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors p-1"><X className="h-4 w-4" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedNode.description && (
              <div className="mb-4">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Description</p>
                <p className="text-xs text-gray-400 leading-relaxed line-clamp-6">{selectedNode.description}</p>
              </div>
            )}
            {selectedNode.type === "hub" && (() => {
              const hub = hubs.find((h) => h.id === selectedNode.id);
              if (!hub?.topTerms.length) return null;
              return (
                <div className="mb-4">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Theme keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {hub.topTerms.map((term) => <span key={term} className="rounded bg-purple-900/40 px-1.5 py-0.5 text-[10px] text-purple-300">{term}</span>)}
                  </div>
                </div>
              );
            })()}
            {selectedNode.type === "run" && selectedNode.startedAt && (
              <div className="mb-4">
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Started</p>
                <p className="text-[10px] text-gray-600">{new Date(selectedNode.startedAt).toLocaleString()}</p>
              </div>
            )}
            {selectedNode.createdAt.getTime() > 0 && (
              <div className="mb-4">
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Created</p>
                <p className="text-[10px] text-gray-600">{formatTimelineDate(selectedNode.createdAt)}</p>
              </div>
            )}
            <div className="mb-4">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">ID</p>
              <p className="font-mono text-[10px] text-gray-600 break-all">{selectedNode.id}</p>
            </div>
            {nodeDetailPath(selectedNode) && (
              <div className="mb-4">
                <Link to={nodeDetailPath(selectedNode)!} className="flex w-full items-center justify-between rounded-md border border-gray-700 px-3 py-2 text-xs text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800">
                  <span>Open detail page</span><ChevronRight className="h-3.5 w-3.5 text-gray-500" />
                </Link>
              </div>
            )}
            {connectedNodes.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Connections ({connectedNodes.length})</p>
                <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
                  {connectedNodes.map(({ otherNode, direction, linkType }, i) => otherNode ? (
                    <button key={i} onClick={() => handleNodeClick(otherNode)} className="flex items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-800 transition-colors">
                      <span className="shrink-0 w-4 text-center text-[10px] text-gray-500">{direction}</span>
                      <span className="shrink-0 h-2 w-2 rounded-sm" style={{ backgroundColor: NODE_COLOR[otherNode.type] }} />
                      <span className="min-w-0 flex-1 truncate text-xs text-gray-300">{otherNode.label}</span>
                      <span className="shrink-0 text-[9px] uppercase text-gray-600">{linkType}</span>
                    </button>
                  ) : null)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`pointer-events-none absolute bottom-20 z-10 text-[10px] text-gray-600 text-right leading-relaxed ${selectedNode ? "right-84" : "right-4"}`}>
        Drag to rotate · Scroll to zoom · Click to select<br />Shift+click second node to find path
      </div>

      {/* Time-travel slider */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex h-14 items-center gap-3 border-t border-gray-800 bg-gray-900/95 px-4 backdrop-blur-sm">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Time</span>
        <span className="shrink-0 text-[10px] text-gray-600">{formatTimelineDate(timeMin)}</span>
        <div className="relative flex flex-1 items-center">
          {timelineEvents.map((ev, i) => {
            const pct = timeRangeMs > 0 ? ((ev.time - timeMin.getTime()) / timeRangeMs) * 100 : 0;
            return <div key={i} className="pointer-events-none absolute top-1/2 h-3 w-px -translate-y-1/2 bg-gray-600" style={{ left: `${pct}%` }} title={ev.label} />;
          })}
          <input type="range" min={timeMin.getTime()} max={timeMax.getTime()} step={Math.max(1000, Math.floor(timeRangeMs / 1000))} value={timeFilterMs ?? timeMax.getTime()} onChange={(e) => { const val = Number(e.target.value); setTimeFilterMs(val >= timeMax.getTime() - 1000 ? null : val); }} className="relative w-full cursor-pointer accent-cyan-500" />
        </div>
        <span className="shrink-0 text-[10px] text-gray-600">Now</span>
        {isTimeTraveling && <span className="shrink-0 rounded bg-cyan-950 px-2 py-0.5 text-[10px] font-medium text-cyan-400">{formatSliderLabel(timeFilterDate!)}</span>}
        {isTimeTraveling && <button onClick={() => setTimeFilterMs(null)} className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-[10px] text-gray-400 hover:text-gray-200">Reset</button>}
      </div>

      {/* v2 right-rail hover detail panel — replaces the inline 280px
          top-right card. 320px slide-in with auto-dismiss + entity pill
          + description + Related concepts. Hidden on mobile (its mobile
          mode renders a bottom sheet but the canvas is already tight
          there). */}
      {!IS_MOBILE ? (
        <KnowledgeGraphDetailPanel
          node={hoveredNode ? toDetailPanelNode(hoveredNode, edgeCountByNode.get(hoveredNode.id) ?? 0) : null}
          onRelatedClick={(id) => {
            const target = graphData.nodes.find((n) => n.id === id);
            if (target) handleNodeClick(target);
          }}
        />
      ) : null}

      {/* v2 floating glass camera-control panel. Spec §5 visual treatment
          (radius 18px, blur 20 + saturate 140%, 1px white-8% border,
          32px shadow). Bottom-right on desktop, raised above iOS home
          indicator on mobile. */}
      <KnowledgeGraphControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitAll={handleFitAll}
        onReset={handleResetView}
        mobile={IS_MOBILE}
      />

      {/* Vignette overlay — spec §4. Adds the calm radial falloff at the
          edges so the canvas reads as a depth field, not a flat plane. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.4) 100%)",
        }}
      />
    </div>
  );
}

/** Map the page's internal GraphNode to the v2 detail-panel shape. */
function toDetailPanelNode(node: GraphNode, edgeCount: number): DetailPanelNode {
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    description: node.description ?? null,
    createdAt: node.createdAt,
    edgeCount,
  };
}
