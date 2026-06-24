/**
 * Fleet KB routes (additive, read-only).
 *
 * Surfaces the Obsidian "Fleet KB" vault (~/obsidian-fleet-kg/Fleet KB) — the
 * curated decisions + finished-work notes promoted from OpenViking by the
 * `fleet-kg-promote` job — to the Knowledge Graph tab.
 *
 * Pure filesystem reads. Does NOT touch OpenViking / QMD / memory-core, and
 * does not depend on the DB. The vault is the system of presentation; the
 * promote job remains the writer.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";

// ─── Vault location ──────────────────────────────────────────────────────────

function vaultRoot(): string {
  const override = process.env.FLEET_KB_PATH;
  if (override && override.trim()) {
    const v = override.trim();
    if (v === "~") return os.homedir();
    if (v.startsWith("~/")) return path.resolve(os.homedir(), v.slice(2));
    return v;
  }
  return path.resolve(os.homedir(), "obsidian-fleet-kg", "Fleet KB");
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface FleetNote {
  id: string; // filename without extension (matches [[wikilink]] target)
  title: string;
  date: string | null;
  category: string; // normalized key: "decision" | "completed" | ...
  categoryLabel: string; // folder name, e.g. "Decisions" / "Completed Work"
  tags: string[];
  agentId: string | null;
  source: string | null;
  sourceScope: string | null;
  promoted: string | null;
  wikilinks: string[];
  path: string; // relative to vault root
  body: string; // markdown body (front-matter stripped)
  excerpt: string;
  updatedAt: string; // file mtime ISO
}

type NodeKind = "note" | "index" | "agent" | "category";

interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  category?: string;
  agentId?: string | null;
  date?: string | null;
  noteId?: string; // for note nodes, equals id
}

interface GraphEdge {
  source: string;
  target: string;
  kind: "link" | "agent" | "category";
}

// ─── Front-matter + markdown helpers ─────────────────────────────────────────

function stripMd(s: string): string {
  return s.replace(/\*\*/g, "").replace(/[`*_]/g, "").trim();
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, "");
  const data: Record<string, unknown> = {};
  for (const line of fmBlock.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let val: string = (m[2] ?? "").trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      data[key] = inner.length
        ? inner.split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
        : [];
      continue;
    }
    val = val.replace(/^["']|["']$/g, "");
    data[key] = val;
  }
  return { data, body };
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.length) return [v];
  return [];
}

function extractWikilinks(body: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const target = m[1]!.trim();
    if (target) out.add(target);
  }
  return [...out];
}

function firstParagraph(body: string): string {
  const lines = body.split("\n");
  const chunks: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (chunks.length) break;
      continue;
    }
    if (t.startsWith("#") || t.startsWith(">") || t.startsWith("```") || t.startsWith("---")) {
      if (chunks.length) break;
      continue;
    }
    chunks.push(stripMd(t));
    if (chunks.join(" ").length > 220) break;
  }
  const text = chunks.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 240 ? text.slice(0, 237) + "…" : text;
}

function agentFromTags(tags: string[]): string | null {
  for (const t of tags) {
    const m = t.match(/^agent\/(.+)$/);
    if (m) return m[1]!;
  }
  return null;
}

// ─── Vault loading ───────────────────────────────────────────────────────────

function walkMarkdown(dir: string, vaultBase: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMarkdown(full, vaultBase, acc);
    else if (ent.isFile() && ent.name.endsWith(".md")) acc.push(full);
  }
}

function normalizeCategory(categoryLabel: string, fmCategory: unknown): string {
  const fm = typeof fmCategory === "string" ? fmCategory.toLowerCase().trim() : "";
  if (fm) return fm;
  const lbl = categoryLabel.toLowerCase();
  if (lbl.includes("decision")) return "decision";
  if (lbl.includes("completed")) return "completed";
  return lbl.replace(/\s+/g, "-") || "other";
}

function loadVault(): {
  root: string;
  exists: boolean;
  notes: FleetNote[];
  indexExists: boolean;
} {
  const root = vaultRoot();
  if (!fs.existsSync(root)) return { root, exists: false, notes: [], indexExists: false };

  const files: string[] = [];
  walkMarkdown(root, root, files);

  const notes: FleetNote[] = [];
  let indexExists = false;

  for (const file of files) {
    const rel = path.relative(root, file);
    const base = path.basename(file, ".md");
    if (base === "_Index") {
      indexExists = true;
      continue; // _Index handled as a synthetic hub node, not a note card
    }
    let raw: string;
    let mtime = new Date();
    try {
      raw = fs.readFileSync(file, "utf8");
      mtime = fs.statSync(file).mtime;
    } catch {
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    const categoryLabel = rel.includes(path.sep) ? rel.split(path.sep)[0]! : "";
    const tags = asStringArray(data.tags);
    const titleRaw = typeof data.title === "string" && data.title.trim() ? data.title : base;
    notes.push({
      id: base,
      title: stripMd(titleRaw) || base,
      date: typeof data.date === "string" ? data.date : null,
      category: normalizeCategory(categoryLabel, data.category),
      categoryLabel: categoryLabel || "Notes",
      tags,
      agentId: agentFromTags(tags),
      source: typeof data.source === "string" ? data.source : null,
      sourceScope: typeof data.source_scope === "string" ? data.source_scope : null,
      promoted: typeof data.promoted === "string" ? data.promoted : null,
      wikilinks: extractWikilinks(body),
      path: rel,
      body,
      excerpt: firstParagraph(body),
      updatedAt: mtime.toISOString(),
    });
  }

  // Newest first
  notes.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.title.localeCompare(b.title));
  return { root, exists: true, notes, indexExists };
}

// ─── Graph construction ──────────────────────────────────────────────────────

function buildGraph(notes: FleetNote[], indexExists: boolean): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const noteIds = new Set(notes.map((n) => n.id));

  const categoriesSeen = new Map<string, string>(); // key -> label
  const agentsSeen = new Set<string>();

  const INDEX_ID = "__index__";
  if (indexExists) nodes.push({ id: INDEX_ID, kind: "index", label: "Fleet KB Index" });

  for (const n of notes) {
    nodes.push({
      id: n.id,
      kind: "note",
      label: n.title,
      category: n.category,
      agentId: n.agentId,
      date: n.date,
      noteId: n.id,
    });
    if (!categoriesSeen.has(n.category)) categoriesSeen.set(n.category, n.categoryLabel);

    // wiki-link edges (note → note, or note → _Index hub)
    for (const link of n.wikilinks) {
      if (link === "_Index") {
        if (indexExists) edges.push({ source: n.id, target: INDEX_ID, kind: "link" });
      } else if (noteIds.has(link)) {
        edges.push({ source: n.id, target: link, kind: "link" });
      }
    }

    // category hub edge
    const catNodeId = `cat:${n.category}`;
    edges.push({ source: n.id, target: catNodeId, kind: "category" });

    // agent hub edge
    if (n.agentId) {
      agentsSeen.add(n.agentId);
      edges.push({ source: n.id, target: `agent:${n.agentId}`, kind: "agent" });
    }
  }

  for (const [key, label] of categoriesSeen) {
    nodes.push({ id: `cat:${key}`, kind: "category", label, category: key });
  }
  for (const agentId of agentsSeen) {
    nodes.push({ id: `agent:${agentId}`, kind: "agent", label: `agent ${agentId.slice(0, 6)}`, agentId });
  }

  return { nodes, edges };
}

function summarize(notes: FleetNote[]) {
  const cat = new Map<string, { key: string; label: string; count: number }>();
  const tag = new Map<string, number>();
  const agent = new Map<string, number>();
  for (const n of notes) {
    const c = cat.get(n.category) ?? { key: n.category, label: n.categoryLabel, count: 0 };
    c.count += 1;
    cat.set(n.category, c);
    for (const t of n.tags) tag.set(t, (tag.get(t) ?? 0) + 1);
    if (n.agentId) agent.set(n.agentId, (agent.get(n.agentId) ?? 0) + 1);
  }
  return {
    categories: [...cat.values()].sort((a, b) => b.count - a.count),
    tags: [...tag.entries()].map(([t, count]) => ({ tag: t, count })).sort((a, b) => b.count - a.count),
    agents: [...agent.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
  };
}

// ─── Router ──────────────────────────────────────────────────────────────────

export function fleetKbRoutes() {
  const router = Router();

  // Full graph + note metadata (bodies included; the vault is small ~85 notes).
  router.get("/fleet-kb/graph", (_req, res) => {
    const { root, exists, notes, indexExists } = loadVault();
    if (!exists) {
      res.status(200).json({
        available: false,
        vaultPath: root,
        noteCount: 0,
        notes: [],
        categories: [],
        tags: [],
        agents: [],
        graph: { nodes: [], edges: [] },
      });
      return;
    }
    const graph = buildGraph(notes, indexExists);
    const { categories, tags, agents } = summarize(notes);
    res.status(200).json({
      available: true,
      vaultPath: root,
      generatedAt: new Date().toISOString(),
      noteCount: notes.length,
      indexExists,
      notes,
      categories,
      tags,
      agents,
      graph,
    });
  });

  // Single note (raw markdown + parsed metadata + backlinks).
  router.get("/fleet-kb/notes/:id", (req, res) => {
    const { id } = req.params as { id: string };
    const { exists, notes } = loadVault();
    if (!exists) {
      res.status(404).json({ error: "Fleet KB vault not found" });
      return;
    }
    const note = notes.find((n) => n.id === id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }
    const backlinks = notes
      .filter((n) => n.id !== id && n.wikilinks.includes(id))
      .map((n) => ({ id: n.id, title: n.title, category: n.category }));
    const related = notes
      .filter((n) => n.id !== id && (n.agentId === note.agentId && note.agentId !== null || n.category === note.category))
      .slice(0, 10)
      .map((n) => ({ id: n.id, title: n.title, category: n.category, date: n.date }));
    res.status(200).json({ note, backlinks, related });
  });

  return router;
}
