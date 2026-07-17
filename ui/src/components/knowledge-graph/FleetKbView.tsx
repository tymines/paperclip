/**
 * FleetKbView — Obsidian-style reader for the Fleet KB vault, surfaced inside
 * the Knowledge Graph tab. Real data from GET /api/fleet-kb/graph (the
 * ~/obsidian-fleet-kg/Fleet KB vault promoted from OpenViking).
 *
 * Three panes: (left) search + category/tag browse + note list,
 * (center) 2D force-graph of notes + their links/tags/category hubs,
 * (right) markdown note reader with backlinks/related. Styled to match
 * Paperclip's dark v2 look — not a literal Obsidian clone.
 */
import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Search, Network, FileText, X, RefreshCw, Tag as TagIcon,
  Folder, Bot, Link2, BookOpen, Hash,
} from "lucide-react";
import { fleetKbApi, type FleetKbGraphNode, type FleetKbGraphEdge } from "../../api/knowledgeGraph";

// ─── Palette (matches the v2 graph accents) ──────────────────────────────────

const COLORS = {
  decision: "#a78bfa",
  completed: "#34d399",
  noteOther: "#94a3b8",
  index: "#fbbf24",
  agent: "#22d3ee",
  category: "#f472b6",
  edgeLink: "rgba(167,139,250,0.32)",
  edgeAgent: "rgba(34,211,238,0.22)",
  edgeCategory: "rgba(244,114,182,0.20)",
  edgeRelated: "rgba(96,165,250,0.30)", // synthesized note↔note relationships
};

function noteColor(category?: string): string {
  if (category === "decision") return COLORS.decision;
  if (category === "completed") return COLORS.completed;
  return COLORS.noteOther;
}

function nodeColor(n: FleetKbGraphNode): string {
  switch (n.kind) {
    case "index": return COLORS.index;
    case "agent": return COLORS.agent;
    case "category": return COLORS.category;
    default: return noteColor(n.category);
  }
}

function nodeRadius(n: FleetKbGraphNode): number {
  switch (n.kind) {
    case "index": return 11;
    case "category": return 9;
    case "agent": return 7;
    default: return 4.5;
  }
}

// ─── Deterministic force-directed layout ─────────────────────────────────────

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pt { x: number; y: number; }

function computeLayout(
  nodes: FleetKbGraphNode[],
  edges: FleetKbGraphEdge[],
  width: number,
  height: number,
): Map<string, Pt> {
  const rand = mulberry32(1337);
  const pos = new Map<string, Pt>();
  const vel = new Map<string, Pt>();
  const idx = new Map<string, number>();
  nodes.forEach((n, i) => {
    idx.set(n.id, i);
    const ang = (i / nodes.length) * Math.PI * 2;
    const r = 120 + rand() * 220;
    pos.set(n.id, { x: Math.cos(ang) * r + (rand() - 0.5) * 40, y: Math.sin(ang) * r + (rand() - 0.5) * 40 });
    vel.set(n.id, { x: 0, y: 0 });
  });

  // hubs get extra mass so spokes orbit them
  const mass = new Map<string, number>();
  for (const n of nodes) mass.set(n.id, n.kind === "note" ? 1 : 3.2);

  const validEdges = edges.filter((e) => pos.has(e.source) && pos.has(e.target));
  const REPULSE = 5200;
  const SPRING = 0.012;
  const SPRING_LEN = 90;
  const CENTER = 0.0016;
  const ITER = 480;

  for (let it = 0; it < ITER; it++) {
    const cooling = 1 - it / ITER;
    // repulsion (O(n^2), n≈90 → fine)
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!; const pa = pos.get(a.id)!; const va = vel.get(a.id)!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]!; const pb = pos.get(b.id)!;
        let dx = pa.x - pb.x, dy = pa.y - pb.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = (rand() - 0.5); dy = (rand() - 0.5); d2 = 0.01; }
        const d = Math.sqrt(d2);
        const f = REPULSE / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        const vb = vel.get(b.id)!;
        va.x += fx; va.y += fy;
        vb.x -= fx; vb.y -= fy;
      }
    }
    // springs — related/wikilink edges pull harder (scaled by weight) so
    // related notes cluster; hub edges stay soft so they don't flatten clusters.
    for (const e of validEdges) {
      const pa = pos.get(e.source)!, pb = pos.get(e.target)!;
      const va = vel.get(e.source)!, vb = vel.get(e.target)!;
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const strength = e.kind === "related"
        ? SPRING * (0.7 + (e.weight ?? 0.3) * 1.6)
        : e.kind === "link"
          ? SPRING * 1.4
          : SPRING * 0.85;
      const f = (d - SPRING_LEN) * strength;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      va.x += fx; va.y += fy;
      vb.x -= fx; vb.y -= fy;
    }
    // integrate + centering gravity
    for (const n of nodes) {
      const p = pos.get(n.id)!, v = vel.get(n.id)!;
      v.x -= p.x * CENTER; v.y -= p.y * CENTER;
      const m = mass.get(n.id)!;
      p.x += (v.x / m) * cooling;
      p.y += (v.y / m) * cooling;
      v.x *= 0.86; v.y *= 0.86;
    }
  }

  // normalize to viewport with padding
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const pad = 60;
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  for (const p of pos.values()) {
    p.x = (p.x - minX) * scale + pad;
    p.y = (p.y - minY) * scale + pad;
  }
  return pos;
}

// ─── Markdown helpers (Obsidian callout rendering) ───────────────────────────

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as any)) return extractText((node as any).props?.children);
  return "";
}

const CALLOUT_RE = /^\s*\[!(\w+)\]\s*(.*)$/s;

// ─── Component ───────────────────────────────────────────────────────────────

export function FleetKbView({ onBack }: { onBack: () => void }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["fleet-kb", "graph", "bodies"],
    queryFn: () => fleetKbApi.getGraph({ bodies: true }),
    staleTime: 60_000,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const notes = data?.notes ?? [];
  const graphNodes = data?.graph.nodes ?? [];
  const graphEdges = data?.graph.edges ?? [];

  // ── filtering ──────────────────────────────────────────────────────────────
  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter((n) => {
      if (activeCategory && n.category !== activeCategory) return false;
      if (activeTag && !n.tags.includes(activeTag)) return false;
      if (q) {
        const hay = (n.title + " " + n.body + " " + n.tags.join(" ")).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [notes, search, activeCategory, activeTag]);

  const matchedNoteIds = useMemo(() => new Set(filteredNotes.map((n) => n.id)), [filteredNotes]);
  const filtersActive = !!(search.trim() || activeCategory || activeTag);

  // ── layout ───────────────────────────────────────────────────────────────
  const W = 1000, H = 720;
  const layout = useMemo(() => {
    if (!graphNodes.length) return new Map<string, Pt>();
    return computeLayout(graphNodes, graphEdges, W, H);
  }, [graphNodes, graphEdges]);

  // adjacency for highlight
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of graphEdges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [graphEdges]);

  const focusId = hoverId ?? selectedId;
  const focusSet = useMemo(() => {
    if (!focusId) return null;
    const s = new Set<string>([focusId]);
    for (const n of neighbors.get(focusId) ?? []) s.add(n);
    return s;
  }, [focusId, neighbors]);

  // ── pan / zoom ──────────────────────────────────────────────────────────
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const k = Math.min(4, Math.max(0.4, v.k * factor));
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { ...v, k };
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      // keep cursor anchored
      const nx = cx - ((cx - v.x) * k) / v.k;
      const ny = cy - ((cy - v.y) * k) / v.k;
      return { x: nx, y: ny, k };
    });
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.sx, dy = e.clientY - drag.current.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    setView((v) => ({ ...v, x: drag.current!.ox + dx, y: drag.current!.oy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    drag.current = null;
  };

  // ── note detail fetch (backlinks/related) ─────────────────────────────────
  const { data: detail } = useQuery({
    queryKey: ["fleet-kb", "note", selectedId],
    queryFn: () => fleetKbApi.getNote(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  });

  // keyboard escape closes reader
  useEffect(() => {
    if (!selectedId) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectedId]);

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

  function clickNode(n: FleetKbGraphNode) {
    if (drag.current?.moved) return;
    if (n.kind === "note" && n.noteId) {
      setSelectedId(n.noteId);
    } else if (n.kind === "category" && n.category) {
      setActiveCategory((c) => (c === n.category ? null : n.category!));
    } else if (n.kind === "agent" && n.agentId) {
      setActiveTag((t) => (t === `agent/${n.agentId}` ? null : `agent/${n.agentId}`));
    }
  }

  // ── render guards ─────────────────────────────────────────────────────────
  const panel = "rgba(255,255,255,0.03)";
  const border = "1px solid rgba(255,255,255,0.08)";

  return (
    <div
      className="relative flex w-full overflow-hidden text-gray-200"
      style={{
        height: "100dvh",
        background:
          "radial-gradient(circle at 18% 8%, rgba(167,139,250,0.10), transparent 28rem)," +
          "radial-gradient(circle at 92% 12%, rgba(45,212,191,0.08), transparent 26rem)," +
          "#08090b",
      }}
    >
      {/* ── Left rail ─────────────────────────────────────────────────────── */}
      <aside className="flex h-full w-[300px] shrink-0 flex-col" style={{ borderRight: border, background: panel }}>
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <BookOpen size={18} style={{ color: COLORS.index }} />
          <div className="flex-1">
            <div className="text-sm font-semibold text-white">Fleet KB</div>
            <div className="text-[11px] text-gray-500">
              {data?.noteCount ?? 0} notes · promoted from OpenViking
            </div>
          </div>
          <button
            onClick={() => refetch()}
            title="Refresh"
            className="rounded p-1.5 text-gray-400 hover:bg-white/5 hover:text-white"
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
          </button>
        </div>

        {/* search */}
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ border, background: "rgba(255,255,255,0.04)" }}>
            <Search size={14} className="text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes…"
              className="w-full bg-transparent text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-gray-500 hover:text-white"><X size={13} /></button>
            )}
          </div>
        </div>

        {/* categories */}
        <div className="px-4 pb-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            <Folder size={12} /> Categories
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(data?.categories ?? []).map((c) => {
              const on = activeCategory === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => setActiveCategory(on ? null : c.key)}
                  className="rounded-full px-2.5 py-1 text-[11px] transition"
                  style={{
                    border: `1px solid ${on ? noteColor(c.key) : "rgba(255,255,255,0.1)"}`,
                    background: on ? `${noteColor(c.key)}22` : "transparent",
                    color: on ? noteColor(c.key) : "#cbd5e1",
                  }}
                >
                  <span style={{ color: noteColor(c.key) }}>●</span> {c.label} <span className="text-gray-500">{c.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* tags */}
        <div className="px-4 pb-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
            <TagIcon size={12} /> Tags
          </div>
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            {(data?.tags ?? []).slice(0, 14).map((t) => {
              const on = activeTag === t.tag;
              return (
                <button
                  key={t.tag}
                  onClick={() => setActiveTag(on ? null : t.tag)}
                  className="rounded px-1.5 py-0.5 text-[10px] transition"
                  style={{
                    border: `1px solid ${on ? COLORS.agent : "rgba(255,255,255,0.08)"}`,
                    background: on ? `${COLORS.agent}22` : "rgba(255,255,255,0.02)",
                    color: on ? COLORS.agent : "#94a3b8",
                  }}
                >
                  <Hash size={9} className="-mt-0.5 inline" />{t.tag} <span className="text-gray-600">{t.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* note list */}
        <div className="mt-1 flex-1 overflow-y-auto px-2 pb-4">
          <div className="px-2 py-1 text-[11px] text-gray-600">{filteredNotes.length} shown</div>
          {filteredNotes.map((n) => {
            const on = selectedId === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setSelectedId(n.id)}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                className="mb-1 block w-full rounded-md px-2.5 py-2 text-left transition"
                style={{ background: on ? "rgba(167,139,250,0.14)" : "transparent", border: on ? `1px solid ${noteColor(n.category)}66` : "1px solid transparent" }}
              >
                <div className="flex items-center gap-1.5">
                  <span style={{ color: noteColor(n.category), fontSize: 9 }}>●</span>
                  <span className="truncate text-[13px] font-medium text-gray-100">{n.title}</span>
                </div>
                <div className="mt-0.5 truncate pl-3 text-[10px] text-gray-500">{n.date} · {n.categoryLabel}</div>
              </button>
            );
          })}
        </div>

        <button
          onClick={onBack}
          className="m-3 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs text-gray-300 hover:bg-white/5"
          style={{ border }}
        >
          <Network size={13} /> Neural Graph
        </button>
      </aside>

      {/* ── Center: graph ─────────────────────────────────────────────────── */}
      <main className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 text-[11px] text-gray-400">
          <Network size={14} style={{ color: COLORS.decision }} />
          <span>Fleet KB graph — drag to pan, scroll to zoom, click a note to open</span>
        </div>

        {/* legend */}
        <div className="absolute right-4 top-4 z-10 rounded-lg p-2.5 text-[11px]" style={{ border, background: "rgba(8,9,11,0.7)" }}>
          {[
            ["Decision", COLORS.decision],
            ["Completed work", COLORS.completed],
            ["Agent", COLORS.agent],
            ["Category", COLORS.category],
            ["Index", COLORS.index],
          ].map(([label, c]) => (
            <div key={label} className="flex items-center gap-1.5 py-0.5">
              <span style={{ width: 8, height: 8, borderRadius: 99, background: c as string, display: "inline-block" }} />
              <span className="text-gray-300">{label}</span>
            </div>
          ))}
        </div>

        {isLoading && (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading Fleet KB…</div>
        )}
        {isError && (
          <div className="flex h-full items-center justify-center text-sm text-red-400">Failed to load Fleet KB vault.</div>
        )}
        {!isLoading && !isError && data?.available === false && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-gray-500">
            <div>Fleet KB vault not found.</div>
            <code className="text-[11px] text-gray-600">{data.vaultPath}</code>
          </div>
        )}

        {!isLoading && !isError && data?.available && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-full w-full cursor-grab active:cursor-grabbing"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={() => { if (!drag.current?.moved) { /* background click: keep selection */ } }}
          >
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* edges */}
              {graphEdges.map((e, i) => {
                const a = layout.get(e.source), b = layout.get(e.target);
                if (!a || !b) return null;
                const dim = focusSet ? !(focusSet.has(e.source) && focusSet.has(e.target)) : false;
                const filterDim = filtersActive &&
                  ((graphNodes.find((n) => n.id === e.source)?.kind === "note" && !matchedNoteIds.has(e.source)) ||
                   (graphNodes.find((n) => n.id === e.target)?.kind === "note" && !matchedNoteIds.has(e.target)));
                const col = e.kind === "agent" ? COLORS.edgeAgent
                  : e.kind === "category" ? COLORS.edgeCategory
                  : e.kind === "related" ? COLORS.edgeRelated
                  : COLORS.edgeLink;
                // synthesized relationships scale stroke by connection strength
                const baseW = e.kind === "related" ? 0.5 + (e.weight ?? 0.3) * 2.2 : 0.7;
                return (
                  <line
                    key={i}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={col}
                    strokeWidth={focusSet && !dim ? Math.max(1.4, baseW) : baseW}
                    opacity={dim || filterDim ? 0.06 : 1}
                  />
                );
              })}
              {/* nodes */}
              {graphNodes.map((n) => {
                const p = layout.get(n.id);
                if (!p) return null;
                const r = nodeRadius(n);
                const isFocus = focusId === n.id;
                const dim = focusSet ? !focusSet.has(n.id) : false;
                const filterDim = filtersActive && n.kind === "note" && !matchedNoteIds.has(n.id);
                const selected = selectedId === n.id;
                const showLabel = n.kind !== "note" || isFocus || selected || view.k > 2;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x},${p.y})`}
                    style={{ cursor: n.kind === "note" ? "pointer" : "pointer" }}
                    opacity={dim || filterDim ? 0.18 : 1}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => { ev.stopPropagation(); clickNode(n); }}
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId(null)}
                  >
                    {(selected || isFocus) && (
                      <circle r={r + 4} fill="none" stroke={nodeColor(n)} strokeWidth={1.5} opacity={0.6} />
                    )}
                    <circle
                      r={r}
                      fill={nodeColor(n)}
                      stroke={selected ? "#fff" : "rgba(0,0,0,0.45)"}
                      strokeWidth={selected ? 1.6 : 0.8}
                    />
                    {showLabel && (
                      <text
                        x={r + 3}
                        y={3}
                        fontSize={n.kind === "note" ? 8 : 10}
                        fill={n.kind === "note" ? "#cbd5e1" : nodeColor(n)}
                        style={{ pointerEvents: "none", fontWeight: n.kind === "note" ? 400 : 600 }}
                      >
                        {n.label.length > 38 ? n.label.slice(0, 36) + "…" : n.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </main>

      {/* ── Right: note reader ────────────────────────────────────────────── */}
      {selectedNote && (
        <aside
          className="flex h-full w-[440px] shrink-0 flex-col"
          style={{ borderLeft: border, background: "rgba(12,13,16,0.92)", backdropFilter: "blur(6px)" }}
        >
          <div className="flex items-start gap-2 px-5 pb-3 pt-4" style={{ borderBottom: border }}>
            <FileText size={16} className="mt-0.5 shrink-0" style={{ color: noteColor(selectedNote.category) }} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold leading-snug text-white">{selectedNote.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
                <span>{selectedNote.date}</span>
                <span
                  className="rounded px-1.5 py-0.5"
                  style={{ background: `${noteColor(selectedNote.category)}22`, color: noteColor(selectedNote.category) }}
                >
                  {selectedNote.categoryLabel}
                </span>
                {selectedNote.agentId && (
                  <span className="inline-flex items-center gap-1" style={{ color: COLORS.agent }}>
                    <Bot size={11} /> {selectedNote.agentId.slice(0, 8)}
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => setSelectedId(null)} className="rounded p-1 text-gray-500 hover:bg-white/5 hover:text-white">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {selectedNote.source && (
              <div className="mb-3 flex items-start gap-2 rounded-md px-3 py-2 text-[11px]" style={{ border, background: "rgba(255,255,255,0.02)" }}>
                <Link2 size={13} className="mt-0.5 shrink-0 text-gray-500" />
                <div className="min-w-0">
                  <div className="text-gray-500">Source (read-only, OpenViking)</div>
                  <code className="block break-all text-[10px] text-gray-400">{selectedNote.source}</code>
                </div>
              </div>
            )}

            <article className="fleet-kb-md text-[13px] leading-relaxed text-gray-300">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h1 className="mb-2 mt-3 text-lg font-bold text-white">{children}</h1>,
                  h2: ({ children }) => <h2 className="mb-1.5 mt-4 text-base font-semibold text-violet-200">{children}</h2>,
                  h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold text-gray-100">{children}</h3>,
                  p: ({ children }) => <p className="mb-2.5">{children}</p>,
                  ul: ({ children }) => <ul className="mb-2.5 ml-4 list-disc space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="mb-2.5 ml-4 list-decimal space-y-1">{children}</ol>,
                  a: ({ children }) => <span className="text-violet-300 underline decoration-dotted">{children}</span>,
                  code: ({ children }) => <code className="rounded bg-white/10 px-1 py-0.5 text-[11px] text-teal-200">{children}</code>,
                  pre: ({ children }) => <pre className="mb-3 overflow-x-auto rounded-lg bg-black/40 p-3 text-[11px] leading-snug text-gray-300" style={{ border }}>{children}</pre>,
                  blockquote: ({ children }) => {
                    const text = extractText(children);
                    const m = text.match(CALLOUT_RE);
                    if (m) {
                      const kind = m[1]!.toLowerCase();
                      const accent = kind === "warning" || kind === "danger" ? "#fbbf24" : COLORS.decision;
                      return (
                        <div className="mb-3 rounded-lg px-3 py-2" style={{ borderLeft: `3px solid ${accent}`, background: `${accent}14` }}>
                          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: accent }}>{kind}</div>
                          <div className="text-[12px] text-gray-300">{m[2]}</div>
                        </div>
                      );
                    }
                    return <blockquote className="mb-3 border-l-2 border-white/20 pl-3 text-gray-400">{children}</blockquote>;
                  },
                  table: ({ children }) => <table className="mb-3 w-full border-collapse text-[11px]">{children}</table>,
                  th: ({ children }) => <th className="px-2 py-1 text-left text-gray-300" style={{ border }}>{children}</th>,
                  td: ({ children }) => <td className="px-2 py-1" style={{ border }}>{children}</td>,
                }}
              >
                {selectedNote.body}
              </ReactMarkdown>
            </article>
          </div>

          {/* backlinks / related */}
          <div className="max-h-[34%] overflow-y-auto px-5 py-3" style={{ borderTop: border }}>
            {detail?.backlinks && detail.backlinks.length > 0 && (
              <div className="mb-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  <Link2 size={12} /> Backlinks ({detail.backlinks.length})
                </div>
                {detail.backlinks.map((b) => (
                  <button key={b.id} onClick={() => setSelectedId(b.id)} className="block w-full truncate rounded px-2 py-1 text-left text-[12px] text-gray-300 hover:bg-white/5">
                    <span style={{ color: noteColor(b.category) }}>●</span> {b.title}
                  </button>
                ))}
              </div>
            )}
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500">
              <Network size={12} /> Related
            </div>
            {(detail?.related ?? []).map((r) => (
              <button key={r.id} onClick={() => setSelectedId(r.id)} className="block w-full truncate rounded px-2 py-1 text-left text-[12px] text-gray-300 hover:bg-white/5">
                <span style={{ color: noteColor(r.category) }}>●</span> {r.title} <span className="text-gray-600">{r.date}</span>
              </button>
            ))}
            {!detail?.related?.length && !detail?.backlinks?.length && (
              <div className="text-[11px] text-gray-600">No linked notes.</div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

export default FleetKbView;
