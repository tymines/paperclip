// Gym: reads the Obsidian vault's consolidation notes (deep-dreams + session-end
// reflections) to power the Learning Feed, and deterministically parses the
// "Proposed Improvements" tables into skill-change proposals for Tyler's review.
// NOTHING here executes a change — it only surfaces suggestions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONSOLIDATION_DIR = "08 - Consolidation";

// Mirror of fleet-kb.ts vault resolution (kept local to avoid cross-route coupling).
export function gymVaultRoot(): string {
  const override = process.env.FLEET_KB_PATH;
  if (override) {
    const v = override.trim();
    if (v === "~") return os.homedir();
    if (v.startsWith("~/") || v.startsWith("~\\")) return path.resolve(os.homedir(), v.slice(2));
    return v;
  }
  const windowsVault = "F:/Augi Vault";
  if (fs.existsSync(windowsVault)) return windowsVault;
  return path.resolve(os.homedir(), "obsidian-fleet-kg", "Fleet KB");
}

function parseFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4);
  const fm: Record<string, string> = {};
  for (const line of fmBlock.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m && m[2]) fm[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return { fm, body };
}

function extractSummary(body: string): string {
  for (const line of body.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#") || l.startsWith("|") || l.startsWith("-") || l.startsWith(">")) continue;
    return l.replace(/[*_`>]/g, "").slice(0, 280);
  }
  return "";
}

function listConsolidationFiles(): { file: string; rel: string; abs: string }[] {
  const dir = path.join(gymVaultRoot(), CONSOLIDATION_DIR);
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md")); } catch { return []; }
  return files.map((f) => ({ file: f, rel: `${CONSOLIDATION_DIR}/${f}`, abs: path.join(dir, f) }));
}

export interface FeedItem {
  id: string; agent: string; date: string; title: string;
  type: "deep-dream" | "session-end" | "handoff"; summary: string; path: string;
  sessionId: string;
}

export function readLearningFeed(): FeedItem[] {
  const items: FeedItem[] = [];
  for (const { file, rel, abs } of listConsolidationFiles()) {
    let raw = "";
    try { raw = fs.readFileSync(abs, "utf8"); } catch { continue; }
    const { fm, body } = parseFrontmatter(raw);
    const t = (fm.type || "").toLowerCase();
    const kind = t.includes("dream") ? "deep-dream" : t.includes("handoff") ? "handoff" : "session-end";
    items.push({
      id: file,
      agent: fm.source_agent || "Fleet",
      date: fm.created || "",
      title: fm.title || file.replace(/\.md$/i, ""),
      type: kind as FeedItem["type"],
      summary: extractSummary(body),
      path: rel,
      sessionId: fm.session_id || fm.session || "",
    });
  }
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return items;
}

export interface ParsedProposal {
  agent: string; targetType: "skill" | "soul" | "workflow"; targetName: string;
  title: string; detail: string; effort: string; valueNote: string; confidence: string;
  sourceFile: string; sourceRef: string;
}

// Parse the "## … Proposed Improvements" section's Skills/Souls/Workflow tables.
export function parseProposalsFromFile(relPath: string, raw: string): ParsedProposal[] {
  const { fm, body } = parseFrontmatter(raw);
  const agent = fm.source_agent || "Fleet";
  const confidence = fm.confidence || "";
  const lines = body.split("\n");

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+.*proposed improvements/i.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  const section = lines.slice(start + 1, end);

  const out: ParsedProposal[] = [];
  let targetType: ParsedProposal["targetType"] = "skill";
  let header: string[] | null = null;
  let rowSeq = 0;

  for (const line of section) {
    const sub = line.match(/^###\s+(.+)/);
    if (sub) {
      const name = sub[1].toLowerCase();
      targetType = name.includes("soul") ? "soul" : name.includes("workflow") ? "workflow" : "skill";
      header = null;
      continue;
    }
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length === 0) continue;
    if (cells.every((c) => c === "" || /^:?-+:?$/.test(c))) continue; // separator row
    if (!header) { header = cells.map((c) => c.toLowerCase()); continue; }

    const pick = (pred: (h: string) => boolean, fallback: number) => {
      const idx = header!.findIndex(pred);
      return (idx >= 0 ? cells[idx] : cells[fallback]) ?? "";
    };
    rowSeq++;
    const ref = (cells[0] && cells[0].length <= 8 ? cells[0] : `${targetType}-${rowSeq}`).trim();
    const title = pick((h) => h.includes("improvement") || h.includes("change") || h.includes("proposal") || h.includes("suggestion"), 1);
    const target = pick((h) => h.includes("target") || h.includes("skill") || h.includes("soul") || h.includes("file"), 2);
    const detail = pick((h) => h.includes("detail") || h.includes("description") || h.includes("diff") || h.includes("how") || h.includes("change"), 2);
    const effort = pick((h) => h.includes("effort"), 3);
    const valueNote = pick((h) => h.includes("value") || h.includes("benefit") || h.includes("reason") || h.includes("why"), 4);
    if (!title) continue;
    out.push({
      agent, targetType, targetName: target || targetType, title, detail,
      effort, valueNote, confidence, sourceFile: relPath, sourceRef: ref,
    });
  }
  return out;
}

export function generateProposals(): { proposals: ParsedProposal[] } {
  const proposals: ParsedProposal[] = [];
  for (const { rel, abs } of listConsolidationFiles()) {
    let raw = "";
    try { raw = fs.readFileSync(abs, "utf8"); } catch { continue; }
    proposals.push(...parseProposalsFromFile(rel, raw));
  }
  return { proposals };
}

// Read a single reflection file (vault-relative path constrained to the
// consolidation dir — no traversal). Returns null when outside/missing.
export function readReflection(rel: string): { path: string; content: string } | null {
  const clean = String(rel || "").replace(/\\/g, "/");
  if (!clean.startsWith(`${CONSOLIDATION_DIR}/`) || clean.includes("..")) return null;
  const abs = path.join(gymVaultRoot(), clean);
  try {
    return { path: clean, content: fs.readFileSync(abs, "utf8") };
  } catch {
    return null;
  }
}
