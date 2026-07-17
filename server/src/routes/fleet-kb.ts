/**
 * Fleet KB routes (additive, read-only).
 *
 * Surfaces the Obsidian vault (`F:/Augi Vault`) — the fleet-wide
 * knowledge graph of agent memories, decisions, research, and projects.
 *
 * Pure filesystem reads. Does NOT touch OpenViking / QMD / memory-core, and
 * does not depend on the DB. The vault is the system of presentation.
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
    if (v.startsWith("~\\")) return path.resolve(os.homedir(), v.slice(2));
    return v;
  }
  // Default: Windows vault (the canonical fleet knowledge store)
  const windowsVault = "F:/Augi Vault";
  if (fs.existsSync(windowsVault)) return windowsVault;
  // Fallback: old Box 1 path (legacy, ~82 notes)
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
      // Skip per-agent auto-generated _Index files (Plans/_index.md, Scripts/_index.md)
      // but include vault-level _Index files so noteCount reflects the full vault.
      if (rel.includes("/")) {
        indexExists = true;
        continue;
      }
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

// ─── Dreams (Obsidian vault consolidation logs) ──────────────────────────────

function consolidationArchiveDir(): string {
  // Env override: FLEET_CONSOLIDATION_PATH — same pattern as FLEET_KB_PATH
  const override = process.env.FLEET_CONSOLIDATION_PATH;
  if (override && override.trim()) {
    const v = override.trim();
    if (v === "~") return os.homedir();
    if (v.startsWith("~/")) return path.resolve(os.homedir(), v.slice(2));
    return v;
  }
  // Default: F:\Augi Vault\08 - Consolidation (resolved from vault root sibling)
  return path.resolve(vaultRoot(), "..", "08 - Consolidation");
}

function loadLatestDreams(): {
  date: string | null;
  content: string;
  dirsConsolidated: number | null;
  failures: number | null;
  noteCount: number;
  filename: string;
} | null {
  const dir = consolidationArchiveDir();
  if (!fs.existsSync(dir)) return null;

  const notes: { file: string; date: string; sortKey: string }[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const p = path.join(dir, f);
    try {
      const raw = fs.readFileSync(p, "utf8");
      const { data } = parseFrontmatter(raw);
      const fmDate = typeof data.created === "string" && data.created.trim()
        ? data.created.trim()
        : typeof data.date === "string" && data.date.trim()
          ? data.date.trim()
          : null;
      const filenameDate = f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
      const date = fmDate ?? filenameDate;
      const sortKey = date
        ? `${date}T${f}`
        : `0000-00-00T${f}`;
      notes.push({ file: p, date: date ?? "", sortKey });
    } catch { /* ignore unreadable */ }
  }

  if (notes.length === 0) return null;

  // Sort descending by date then filename
  notes.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  const latest = notes[0]!;
  const raw = fs.readFileSync(latest.file, "utf8");

  // Data-honesty: only report dirs/failures if the log actually states them.
  // Previously these were hardcoded to 0 and rendered in the HUD as if real.
  const dirsMatch = raw.match(/dirs[_\s-]*consolidated\D*?(\d+)/i);
  const failMatch = raw.match(/failures?\D*?(\d+)/i);

  return {
    date: latest.date || null,
    content: raw,
    dirsConsolidated: dirsMatch ? Number(dirsMatch[1]) : null,
    failures: failMatch ? Number(failMatch[1]) : null,
    noteCount: notes.length,
    filename: path.basename(latest.file),
  };
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

// Candidate generation: instead of scoring all O(n²) pairs (~512k at 1k notes,
// which blocked the event loop for seconds per request), only score pairs that
// can possibly share a real signal — a top distinctive term or a tag. Inverted
// posting lists over each note's top TF-IDF terms + its tags produce the
// candidate set; scoring semantics below are unchanged.
const TOP_TERMS_PER_DOC = 10;
const MAX_POSTING = 40; // terms present in >40 docs aren't distinctive enough to pair on
const MAX_TAG_POSTING = 80;

function candidatePairs(notes: FleetNote[], tfidf: Map<string, Map<string, number>>): Set<string> {
  const postings = new Map<string, string[]>();
  for (const n of notes) {
    const vec = tfidf.get(n.id);
    if (!vec) continue;
    const top = [...vec.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_TERMS_PER_DOC);
    for (const [term] of top) {
      const list = postings.get(`t:${term}`) ?? [];
      list.push(n.id);
      postings.set(`t:${term}`, list);
    }
    for (const tag of n.tags) {
      const list = postings.get(`g:${tag}`) ?? [];
      list.push(n.id);
      postings.set(`g:${tag}`, list);
    }
  }
  const pairs = new Set<string>();
  for (const [key, list] of postings) {
    const cap = key.startsWith("g:") ? MAX_TAG_POSTING : MAX_POSTING;
    if (list.length < 2 || list.length > cap) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!; const b = list[j]!;
        pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
    }
  }
  return pairs;
}

function synthesizeRelatedEdges(notes: FleetNote[], existingPairs: Set<string>): GraphEdge[] {
  const tfidf = buildTfIdf(notes);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const cands: Array<{ a: string; b: string; score: number }> = [];

  for (const key of candidatePairs(notes, tfidf)) {
    if (existingPairs.has(key)) continue; // already joined by an explicit wikilink
    const [idA, idB] = key.split("|") as [string, string];
    const na = byId.get(idA)!;
    const nb = byId.get(idB)!;

    const termScore = cosine(tfidf.get(idA)!, tfidf.get(idB)!);
    const tagsA = new Set(na.tags);
    let shared = 0;
    for (const t of nb.tags) if (tagsA.has(t)) shared++;

    // Require a real signal: shared distinctive terms OR a shared tag.
    // Same-category alone must NOT create an edge (would form category cliques).
    if (termScore < 0.08 && shared === 0) continue;

    const tagScore = Math.min(1, shared * 0.5);
    const sameCat = na.category === nb.category ? 0.12 : 0;
    const score = termScore + tagScore * 0.6 + sameCat;
    if (score < RELATED_MIN_SCORE) continue;
    cands.push({ a: idA, b: idB, score });
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

// ─── Cache ───────────────────────────────────────────────────────────────────
//
// The vault has grown to ~1,000 notes. Re-reading + re-parsing every file and
// re-synthesizing edges on EVERY request (the UI polls every 12s) blocked the
// event loop and shipped multi-MB payloads. Instead: a cheap stat-only scan
// produces a signature (file count + newest mtime + total bytes); the expensive
// load + graph build only reruns when the signature changes. `generatedAt` is
// the build time and stays stable while the vault is unchanged, so React Query
// structural sharing keeps object identity and the client's force layout does
// NOT re-heat on every poll.

interface VaultCache {
  signature: string;
  builtAt: string;
  root: string;
  exists: boolean;
  notes: FleetNote[];
  indexExists: boolean;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  summary: ReturnType<typeof summarize>;
}

let vaultCache: VaultCache | null = null;
let lastScanMs = 0;
const SCAN_MIN_INTERVAL_MS = 3_000;

function statSignature(root: string): string {
  let count = 0;
  let maxMtime = 0;
  let totalSize = 0;
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith(".md")) {
        try {
          const st = fs.statSync(full);
          count++;
          totalSize += st.size;
          if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
        } catch { /* ignore */ }
      }
    }
  };
  walk(root);
  return `${count}:${Math.round(maxMtime)}:${totalSize}`;
}

function getVaultCached(): VaultCache {
  const now = Date.now();
  if (vaultCache && now - lastScanMs < SCAN_MIN_INTERVAL_MS) return vaultCache;

  const root = vaultRoot();
  const signature = fs.existsSync(root) ? statSignature(root) : "missing";
  lastScanMs = now;
  if (vaultCache && vaultCache.signature === signature) return vaultCache;

  const { exists, notes, indexExists } = loadVault();
  const graph = exists ? buildGraph(notes, indexExists) : { nodes: [], edges: [] };
  const summary = exists ? summarize(notes) : { categories: [], tags: [], agents: [] };
  vaultCache = {
    signature,
    builtAt: new Date().toISOString(),
    root,
    exists,
    notes,
    indexExists,
    graph,
    summary,
  };
  return vaultCache;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export function fleetKbRoutes() {
  const router = Router();

  // Full graph + note metadata. Note BODIES are omitted by default — at ~1,000
  // notes they added ~5MB per poll. The KB reader passes ?bodies=1; the brain
  // view fetches individual bodies on demand via /fleet-kb/notes/:id.
  router.get("/fleet-kb/graph", (req, res) => {
    const cached = getVaultCached();
    if (!cached.exists) {
      res.status(200).json({
        available: false,
        vaultPath: cached.root,
        noteCount: 0,
        notes: [],
        categories: [],
        tags: [],
        agents: [],
        graph: { nodes: [], edges: [] },
      });
      return;
    }

    const includeBodies = req.query.bodies === "1" || req.query.bodies === "true";
    const etag = `"kg-${cached.signature}${includeBodies ? "-b" : ""}"`;
    res.set("ETag", etag);
    res.set("Cache-Control", "no-cache");
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    const notes = includeBodies
      ? cached.notes
      : cached.notes.map(({ body: _body, ...rest }) => rest);

    res.status(200).json({
      available: true,
      vaultPath: cached.root,
      generatedAt: cached.builtAt,
      noteCount: cached.notes.length,
      indexExists: cached.indexExists,
      notes,
      categories: cached.summary.categories,
      tags: cached.summary.tags,
      agents: cached.summary.agents,
      graph: cached.graph,
    });
  });

  // Single note (raw markdown + parsed metadata + backlinks).
  router.get("/fleet-kb/notes/:id", (req, res) => {
    const { id } = req.params as { id: string };
    const { exists, notes } = getVaultCached();
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

  // Latest OpenViking memory consolidation log (Dreams panel).
  router.get("/fleet-kb/dreams", (_req, res) => {
    const dreams = loadLatestDreams();
    if (!dreams) {
      res.status(200).json({ available: false, date: null, content: "", dirsConsolidated: null, failures: null, noteCount: 0, filename: null });
      return;
    }
    res.status(200).json({ available: true, ...dreams });
  });

  return router;
}
