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
  kind: "link" | "agent" | "category" | "related";
  weight?: number;
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

// ─── Note-to-note relationship synthesis ─────────────────────────────────────
//
// The vault's explicit wikilinks mostly point at `_Index`, which made the graph
// a hub-and-spoke star. To surface the *real* web of relationships we synthesize
// note→note edges from: shared distinctive terms (TF-IDF cosine), shared tags,
// and same category. Edges are capped per node and weighted by strength so the
// result is a legible cluster web, not a hairball.

const STOPWORDS = new Set([
  "the","and","for","are","but","not","you","all","any","can","had","her","was",
  "one","our","out","get","has","him","his","how","new","now","old","see","two",
  "way","who","did","its","let","put","say","she","too","use","that","this","with",
  "from","they","will","would","there","their","what","which","when","make","like",
  "time","just","know","take","into","your","some","could","them","than","then",
  "been","were","also","have","more","most","such","only","over","very","work",
  "note","notes","fleet","paperclip","agent","task","tasks","using","used","via",
  "etc","each","other","these","those","being","after","before","while","where",
  "because","should","between","both","under","once","here","does","done","made",
  "need","needs","want","https","http","com","www",
]);

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || raw.length > 24) continue;
    if (/^\d+$/.test(raw)) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

// L2-normalized TF-IDF vectors keyed by note id. Title terms are weighted 2x.
function buildTfIdf(notes: FleetNote[]): Map<string, Map<string, number>> {
  const docTokens = new Map<string, string[]>();
  const df = new Map<string, number>();
  for (const n of notes) {
    const tokens = [...tokenize(n.title), ...tokenize(n.title), ...tokenize(n.body)];
    docTokens.set(n.id, tokens);
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = notes.length || 1;
  const vectors = new Map<string, Map<string, number>>();
  for (const [id, tokens] of docTokens) {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const vec = new Map<string, number>();
    let norm = 0;
    for (const [t, freq] of tf) {
      const dfreq = df.get(t) ?? 1;
      // Drop terms in ≥60% of docs (not distinctive) — keeps clusters meaningful.
      if (dfreq >= N * 0.6) continue;
      const idf = Math.log((N + 1) / (dfreq + 0.5));
      const w = (1 + Math.log(freq)) * idf;
      if (w <= 0) continue;
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    vectors.set(id, vec);
  }
  return vectors;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const w2 = large.get(t);
    if (w2) dot += w * w2; // vectors are L2-normalized → dot product is cosine
  }
  return dot;
}

const RELATED_MAX_PER_NODE = 6;
const RELATED_MIN_SCORE = 0.12;

function synthesizeRelatedEdges(notes: FleetNote[], existingPairs: Set<string>): GraphEdge[] {
  const tfidf = buildTfIdf(notes);
  const cands: Array<{ a: string; b: string; score: number }> = [];

  for (let i = 0; i < notes.length; i++) {
    const na = notes[i]!;
    const va = tfidf.get(na.id)!;
    const tagsA = new Set(na.tags);
    for (let j = i + 1; j < notes.length; j++) {
      const nb = notes[j]!;
      const key = na.id < nb.id ? `${na.id}|${nb.id}` : `${nb.id}|${na.id}`;
      if (existingPairs.has(key)) continue; // already joined by an explicit wikilink

      const termScore = cosine(va, tfidf.get(nb.id)!);
      let shared = 0;
      for (const t of nb.tags) if (tagsA.has(t)) shared++;

      // Require a real signal: shared distinctive terms OR a shared tag.
      // Same-category alone must NOT create an edge (would form category cliques).
      if (termScore < 0.08 && shared === 0) continue;

      const tagScore = Math.min(1, shared * 0.5);
      const sameCat = na.category === nb.category ? 0.12 : 0;
      const score = termScore + tagScore * 0.6 + sameCat;
      if (score < RELATED_MIN_SCORE) continue;
      cands.push({ a: na.id, b: nb.id, score });
    }
  }

  // Greedy strongest-first with a per-node degree cap → legible web, not hairball.
  cands.sort((x, y) => y.score - x.score);
  const degree = new Map<string, number>();
  const edges: GraphEdge[] = [];
  for (const c of cands) {
    const da = degree.get(c.a) ?? 0;
    const db = degree.get(c.b) ?? 0;
    if (da >= RELATED_MAX_PER_NODE || db >= RELATED_MAX_PER_NODE) continue;
    degree.set(c.a, da + 1);
    degree.set(c.b, db + 1);
    edges.push({ source: c.a, target: c.b, kind: "related", weight: Math.round(c.score * 100) / 100 });
  }
  return edges;
}

function buildGraph(notes: FleetNote[], indexExists: boolean): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const noteIds = new Set(notes.map((n) => n.id));

  const categoriesSeen = new Map<string, string>(); // key -> label
  const agentsSeen = new Set<string>();
  const wikiPairs = new Set<string>(); // note↔note pairs already joined by an explicit wikilink

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

    // Explicit note → note wikilinks (strong, authored relationships). The
    // near-ubiquitous note → _Index spoke is intentionally dropped: nearly every
    // note links _Index, which made the whole graph a hub-and-spoke star.
    for (const link of n.wikilinks) {
      if (link === "_Index") continue;
      if (noteIds.has(link)) {
        edges.push({ source: n.id, target: link, kind: "link" });
        const key = n.id < link ? `${n.id}|${link}` : `${link}|${n.id}`;
        wikiPairs.add(key);
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
    // Root the category hubs under the index (a handful of edges) rather than
    // wiring every single note to the index.
    if (indexExists) edges.push({ source: INDEX_ID, target: `cat:${key}`, kind: "category" });
  }
  for (const agentId of agentsSeen) {
    nodes.push({ id: `agent:${agentId}`, kind: "agent", label: `agent ${agentId.slice(0, 6)}`, agentId });
  }

  // Synthesized note↔note relationships — the real "web" that clusters related
  // decisions and finished-work notes (shared terms / tags / category).
  edges.push(...synthesizeRelatedEdges(notes, wikiPairs));

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
