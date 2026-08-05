// Story Bible codex panel (Spec v1 §4.1) — the structured canon store UI.
// 8 codex entity sections + typed Relationships + spoiler-gated Facts.
// §7: lock toggles call the human-only endpoints; locked entries show amber
// chips and refuse AI edits server-side. Honest 0159-pending states.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Lock, LockOpen, Trash2, ScrollText, Users2, Gem, Cog, Clock,
  GitBranch, Lightbulb, BookA, Link2, ShieldCheck, Sparkles, Inbox,
} from "lucide-react";

const API_BASE = "/api";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch { /* keep raw */ }
    throw new Error(msg || res.statusText);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────

interface CodexEntity {
  id: string;
  name: string;
  summary: string;
  details: Record<string, unknown>;
  locked: boolean;
  source: string;
  chapterNumber?: number | null;
  payoffState?: string;
  payoffChapter?: number | null;
  term?: string;
  definition?: string;
}

interface Relationship {
  id: string;
  fromEntityType: string;
  fromEntityId: string;
  toEntityType: string;
  toEntityId: string;
  type: string;
  arcStage: string;
  meter: number;
  rules: string[];
  locked: boolean;
}

interface Fact {
  id: string;
  statement: string;
  knownAsOf: number;
  provenance: string;
  locked: boolean;
}

interface WithheldFact {
  id: string;
  knownAsOf: number;
  provenance: string;
  locked: boolean;
}

interface QueueItem {
  id: string;
  kind: "fact" | "entity";
  entityType?: string;
  statement?: string;
  knownAsOf?: number;
  name?: string;
  summary?: string;
  sourceChapter: number;
  status: "pending" | "approved" | "rejected" | "skipped-locked";
}

const CODEX_SECTIONS = [
  { id: "lore", label: "Lore", icon: <ScrollText className="w-3 h-3" /> },
  { id: "factions", label: "Factions", icon: <Users2 className="w-3 h-3" /> },
  { id: "objects", label: "Objects", icon: <Gem className="w-3 h-3" /> },
  { id: "systems", label: "Systems", icon: <Cog className="w-3 h-3" /> },
  { id: "timeline", label: "Timeline", icon: <Clock className="w-3 h-3" /> },
  { id: "threads", label: "Threads", icon: <GitBranch className="w-3 h-3" /> },
  { id: "themes", label: "Themes", icon: <Lightbulb className="w-3 h-3" /> },
  { id: "glossary", label: "Glossary", icon: <BookA className="w-3 h-3" /> },
] as const;

export type CodexSectionId = (typeof CODEX_SECTIONS)[number]["id"] | "relationships" | "facts" | "review-queue";

const REL_ENTITY_TYPES = ["character", "location", "lore", "factions", "objects", "systems", "timeline", "threads", "themes", "glossary"];

// ── Small pieces ──────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const tone = source === "authored" ? "text-blue-300 border-blue-800"
    : source === "auto-extracted" ? "text-purple-300 border-purple-800"
    : "text-teal-300 border-teal-800";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tone}`}>{source}</span>;
}

function LockChip({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={locked ? "Locked — the AI never touches this. Click to unlock." : "Lock this entry (protects it from AI writes)"}
      className={locked ? "text-amber-400 hover:text-amber-300" : "text-gray-600 hover:text-gray-400"}
    >
      {locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
    </button>
  );
}

function MeterBar({ meter }: { meter: number }) {
  const pct = Math.abs(meter) / 2; // −100…+100 → 0…50 width each side
  return (
    <div className="relative w-24 h-1.5 bg-gray-800 rounded overflow-hidden" title={`Relationship meter: ${meter}`}>
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-700" />
      <div
        className={`absolute top-0 bottom-0 ${meter >= 0 ? "bg-green-500" : "bg-red-500"}`}
        style={meter >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
      />
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────

export function CodexPanel({ bookId, companySlug, currentChapter, activeSection, onSectionChange, showSectionPicker = true }: {
  bookId: string;
  companySlug: string;
  currentChapter?: number;
  activeSection?: CodexSectionId;
  onSectionChange?: (section: CodexSectionId) => void;
  showSectionPicker?: boolean;
}) {
  const [internalSection, setInternalSection] = useState<CodexSectionId>(activeSection ?? "lore");
  const section = activeSection ?? internalSection;
  const setSection = (next: CodexSectionId) => {
    if (activeSection === undefined) setInternalSection(next);
    onSectionChange?.(next);
  };
  const [entities, setEntities] = useState<CodexEntity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [knownFacts, setKnownFacts] = useState<Fact[]>([]);
  const [withheldFacts, setWithheldFacts] = useState<WithheldFact[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [factChapter, setFactChapter] = useState(currentChapter ?? 1);

  // Add-form state (shared shape; per-section extras read at submit)
  const [form, setForm] = useState<Record<string, string>>({});
  const [relForm, setRelForm] = useState({ fromEntityType: "character", fromEntityId: "", toEntityType: "character", toEntityId: "", type: "", arcStage: "", meter: "0", rules: "" });
  const [factForm, setFactForm] = useState({ statement: "", knownAsOf: String(currentChapter ?? 1) });

  const prefix = `/companies/${companySlug}/book-studio/books/${bookId}`;

  const load = useCallback(async () => {
    setError(null);
    try {
      if (section === "relationships") {
        const res = await apiFetch<{ available: boolean; relationships: Relationship[] }>(`${prefix}/codex-relationships`);
        setAvailable(res.available);
        setRelationships(res.relationships ?? []);
      } else if (section === "facts") {
        const res = await apiFetch<{ available: boolean; known: Fact[]; withheld: WithheldFact[] }>(`${prefix}/codex-facts?chapter=${factChapter}`);
        setAvailable(res.available);
        setKnownFacts(res.known ?? []);
        setWithheldFacts(res.withheld ?? []);
      } else if (section === "review-queue") {
        const res = await apiFetch<{ items: QueueItem[]; pendingCount: number }>(`${prefix}/bible-review-queue`);
        setQueueItems(res.items ?? []);
      } else {
        const res = await apiFetch<{ available: boolean; entities: CodexEntity[] }>(`${prefix}/codex/${section}`);
        setAvailable(res.available);
        setEntities(res.entities ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [prefix, section, factChapter]);

  useEffect(() => { load(); }, [load]);

  const entityName = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) map.set(e.id, e.name);
    return (id: string) => map.get(id) ?? id.slice(0, 8);
  }, [entities]);

  async function toggleLock(kind: "entity" | "relationship" | "fact", id: string, locked: boolean) {
    const url = kind === "entity" ? `${prefix}/codex/${section}/${id}`
      : kind === "relationship" ? `${prefix}/codex-relationships/${id}`
      : `${prefix}/codex-facts/${id}`;
    await apiFetch(url, { method: "PATCH", body: JSON.stringify({ locked: !locked }) }).catch((e) => setError(e.message));
    load();
  }

  async function remove(kind: "entity" | "relationship" | "fact", id: string, locked: boolean) {
    if (locked) { setError("This entry is locked — unlock it before deleting."); return; }
    if (!window.confirm("Delete this entry? This cannot be undone.")) return;
    const url = kind === "entity" ? `${prefix}/codex/${section}/${id}`
      : kind === "relationship" ? `${prefix}/codex-relationships/${id}`
      : `${prefix}/codex-facts/${id}`;
    await apiFetch(url, { method: "DELETE" }).catch((e) => setError(e.message));
    load();
  }

  async function submitEntity() {
    if (!form.name?.trim()) return;
    const body: Record<string, unknown> = { name: form.name.trim(), summary: form.summary ?? "" };
    if (section === "timeline" && form.chapterNumber) body.chapterNumber = Number(form.chapterNumber);
    if (section === "threads") { body.payoffState = form.payoffState || "open"; if (form.payoffChapter) body.payoffChapter = Number(form.payoffChapter); }
    if (section === "glossary") { body.term = form.term || form.name.trim(); body.definition = form.definition ?? ""; }
    await apiFetch(`${prefix}/codex/${section}`, { method: "POST", body: JSON.stringify(body) }).catch((e) => setError(e.message));
    setForm({}); setShowAdd(false); load();
  }

  async function submitRelationship() {
    await apiFetch(`${prefix}/codex-relationships`, {
      method: "POST",
      body: JSON.stringify({
        fromEntityType: relForm.fromEntityType, fromEntityId: relForm.fromEntityId.trim(),
        toEntityType: relForm.toEntityType, toEntityId: relForm.toEntityId.trim(),
        type: relForm.type, arcStage: relForm.arcStage,
        meter: Number(relForm.meter) || 0,
        rules: relForm.rules.split("\n").map((r) => r.trim()).filter(Boolean),
      }),
    }).catch((e) => setError(e.message));
    setRelForm({ fromEntityType: "character", fromEntityId: "", toEntityType: "character", toEntityId: "", type: "", arcStage: "", meter: "0", rules: "" });
    setShowAdd(false); load();
  }

  async function submitFact() {
    await apiFetch(`${prefix}/codex-facts`, {
      method: "POST",
      body: JSON.stringify({ statement: factForm.statement.trim(), knownAsOf: Number(factForm.knownAsOf) }),
    }).catch((e) => setError(e.message));
    setFactForm({ statement: "", knownAsOf: String(currentChapter ?? 1) });
    setShowAdd(false); load();
  }

  // ── Bible review queue (extraction proposes; Baily approves/rejects) ──
  async function extractFromChapter() {
    setExtracting(true);
    try {
      await apiFetch(`${prefix}/bible-extract`, {
        method: "POST",
        body: JSON.stringify({ chapterNumber: currentChapter ?? 1 }),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }

  async function resolveQueueItem(id: string, action: "approve" | "reject") {
    await apiFetch(`${prefix}/bible-review-queue/${id}/${action}`, { method: "POST" })
      .catch((e) => setError(e.message));
    load();
  }

  const inputCls = "w-full bg-gray-900 border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:border-blue-700 focus:outline-none";

  return (
    <div className="flex flex-col h-full">
      {/* Section picker */}
      {showSectionPicker && <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-gray-800 shrink-0">
        {CODEX_SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => { setSection(s.id); setShowAdd(false); }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] ${section === s.id ? "bg-blue-900/50 text-blue-300" : "text-gray-500 hover:text-gray-300"}`}
          >
            {s.icon}{s.label}
          </button>
        ))}
        <button onClick={() => { setSection("relationships"); setShowAdd(false); }} className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] ${section === "relationships" ? "bg-blue-900/50 text-blue-300" : "text-gray-500 hover:text-gray-300"}`}>
          <Link2 className="w-3 h-3" />Relationships
        </button>
        <button onClick={() => { setSection("facts"); setShowAdd(false); }} className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] ${section === "facts" ? "bg-blue-900/50 text-blue-300" : "text-gray-500 hover:text-gray-300"}`}>
          <ShieldCheck className="w-3 h-3" />Facts
        </button>
        <button onClick={() => { setSection("review-queue"); setShowAdd(false); }} className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] ${section === "review-queue" ? "bg-blue-900/50 text-blue-300" : "text-gray-500 hover:text-gray-300"}`}>
          <Inbox className="w-3 h-3" />Review Queue
        </button>
      </div>}

      {!available && (
        <div className="mx-3 mt-2 px-3 py-2 rounded border border-amber-800/60 bg-amber-950/30 text-amber-300 text-[11px]">
          Codex tables pending migration 0159 — entries appear once it is applied.
        </div>
      )}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded border border-red-800/60 bg-red-950/30 text-red-300 text-[11px] flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300 ml-2">✕</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {/* ── Entity sections ── */}
        {section !== "relationships" && section !== "facts" && section !== "review-queue" && (
          <>
            {entities.length === 0 && available && (
              <div className="text-xs text-gray-500 italic py-2">No entries yet — canon starts here.</div>
            )}
            {entities.map((e) => (
              <div key={e.id} className="border border-gray-800 rounded p-2.5 bg-gray-900/40">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-gray-200 truncate">{e.name}</span>
                    <SourceBadge source={e.source} />
                    {e.locked && <span className="text-[10px] text-amber-400">locked</span>}
                    {section === "threads" && (
                      <span className={`text-[10px] ${e.payoffState === "paid" ? "text-green-400" : e.payoffState === "abandoned" ? "text-gray-500" : "text-blue-300"}`}>
                        {e.payoffState}{e.payoffChapter ? ` · ch.${e.payoffChapter}` : ""}
                      </span>
                    )}
                    {section === "timeline" && e.chapterNumber != null && (
                      <span className="text-[10px] text-gray-500">ch.{e.chapterNumber}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <LockChip locked={e.locked} onToggle={() => toggleLock("entity", e.id, e.locked)} />
                    <button onClick={() => remove("entity", e.id, e.locked)} className="text-gray-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                {(e.summary || e.definition) && <p className="text-[11px] text-gray-400 mt-1 whitespace-pre-wrap">{e.definition || e.summary}</p>}
              </div>
            ))}
            {showAdd ? (
              <div className="border border-gray-700 rounded p-2.5 space-y-2 bg-gray-900/60">
                <input className={inputCls} placeholder="Name" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <textarea className={inputCls} rows={2} placeholder={section === "glossary" ? "Definition" : "Summary"} value={form.summary ?? ""} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
                {section === "timeline" && <input className={inputCls} placeholder="Chapter number (optional)" value={form.chapterNumber ?? ""} onChange={(e) => setForm({ ...form, chapterNumber: e.target.value })} />}
                {section === "threads" && (
                  <div className="flex gap-2">
                    <select className={inputCls} value={form.payoffState ?? "open"} onChange={(e) => setForm({ ...form, payoffState: e.target.value })}>
                      <option value="open">open</option><option value="paid">paid</option><option value="abandoned">abandoned</option>
                    </select>
                    <input className={inputCls} placeholder="Payoff chapter" value={form.payoffChapter ?? ""} onChange={(e) => setForm({ ...form, payoffChapter: e.target.value })} />
                  </div>
                )}
                {section === "glossary" && <input className={inputCls} placeholder="Term (defaults to name)" value={form.term ?? ""} onChange={(e) => setForm({ ...form, term: e.target.value })} />}
                <div className="flex gap-2">
                  <button onClick={submitEntity} className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded text-white">Add</button>
                  <button onClick={() => setShowAdd(false)} className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-1 py-1.5">
                <Plus className="w-3 h-3" /> Add {CODEX_SECTIONS.find((s) => s.id === section)?.label}
              </button>
            )}
          </>
        )}

        {/* ── Relationships (② typed, metered, rules) ── */}
        {section === "relationships" && (
          <>
            {relationships.length === 0 && available && (
              <div className="text-xs text-gray-500 italic py-2">No relationships yet — they become gate constraints.</div>
            )}
            {relationships.map((r) => (
              <div key={r.id} className="border border-gray-800 rounded p-2.5 bg-gray-900/40">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-200 min-w-0">
                    <span className="text-gray-500">{r.fromEntityType}·</span>{entityName(r.fromEntityId)}
                    <span className="text-blue-400 mx-1">→</span>
                    <span className="text-gray-500">{r.toEntityType}·</span>{entityName(r.toEntityId)}
                    {r.type && <span className="text-gray-500"> · {r.type}</span>}
                    {r.arcStage && <span className="text-purple-300"> · {r.arcStage}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <MeterBar meter={r.meter} />
                    <LockChip locked={r.locked} onToggle={() => toggleLock("relationship", r.id, r.locked)} />
                    <button onClick={() => remove("relationship", r.id, r.locked)} className="text-gray-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                {r.rules.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {r.rules.map((rule, i) => <li key={i} className="text-[11px] text-amber-300/80">⚑ {rule}</li>)}
                  </ul>
                )}
              </div>
            ))}
            {showAdd ? (
              <div className="border border-gray-700 rounded p-2.5 space-y-2 bg-gray-900/60">
                <div className="flex gap-2">
                  <select className={inputCls} value={relForm.fromEntityType} onChange={(e) => setRelForm({ ...relForm, fromEntityType: e.target.value })}>{REL_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  <input className={inputCls} placeholder="From entity ID" value={relForm.fromEntityId} onChange={(e) => setRelForm({ ...relForm, fromEntityId: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <select className={inputCls} value={relForm.toEntityType} onChange={(e) => setRelForm({ ...relForm, toEntityType: e.target.value })}>{REL_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  <input className={inputCls} placeholder="To entity ID" value={relForm.toEntityId} onChange={(e) => setRelForm({ ...relForm, toEntityId: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <input className={inputCls} placeholder="Type (e.g. secret allegiance)" value={relForm.type} onChange={(e) => setRelForm({ ...relForm, type: e.target.value })} />
                  <input className={inputCls} placeholder="Arc stage" value={relForm.arcStage} onChange={(e) => setRelForm({ ...relForm, arcStage: e.target.value })} />
                  <input className={inputCls} type="number" min={-100} max={100} placeholder="Meter" value={relForm.meter} onChange={(e) => setRelForm({ ...relForm, meter: e.target.value })} />
                </div>
                <textarea className={inputCls} rows={2} placeholder="Arc rules — one per line (gate constraints)" value={relForm.rules} onChange={(e) => setRelForm({ ...relForm, rules: e.target.value })} />
                <div className="flex gap-2">
                  <button onClick={submitRelationship} className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded text-white">Add</button>
                  <button onClick={() => setShowAdd(false)} className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-1 py-1.5">
                <Plus className="w-3 h-3" /> Add Relationship
              </button>
            )}
          </>
        )}

        {/* ── Facts (③ atomic · ④ spoiler-gated) ── */}
        {section === "facts" && (
          <>
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <span>Known as of chapter</span>
              <input
                type="number" min={1}
                className="w-16 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-200"
                value={factChapter}
                onChange={(e) => setFactChapter(Math.max(1, Number(e.target.value) || 1))}
              />
              <span>— the writer never sees beyond this.</span>
            </div>
            {knownFacts.map((f) => (
              <div key={f.id} className="border border-gray-800 rounded p-2.5 bg-gray-900/40 flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] text-gray-300">{f.statement}</p>
                  <div className="flex gap-2 mt-1">
                    <span className="text-[10px] text-gray-500">known ch.{f.knownAsOf}</span>
                    <SourceBadge source={f.provenance} />
                    {f.locked && <span className="text-[10px] text-amber-400">locked</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <LockChip locked={f.locked} onToggle={() => toggleLock("fact", f.id, f.locked)} />
                  <button onClick={() => remove("fact", f.id, f.locked)} className="text-gray-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
            {withheldFacts.length > 0 && (
              <div className="pt-1">
                <div className="text-[10px] uppercase tracking-wide text-gray-600 pb-1">Withheld from the writer (author-only)</div>
                <div className="flex flex-wrap gap-1.5">
                  {withheldFacts.map((f) => (
                    <span key={f.id} title="Withheld — statement hidden until its reveal chapter" className="text-[10px] px-2 py-1 rounded border border-purple-800/60 bg-purple-950/30 text-purple-300">
                      🙈 reveals ch.{f.knownAsOf}{f.locked ? " · 🔒" : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {showAdd ? (
              <div className="border border-gray-700 rounded p-2.5 space-y-2 bg-gray-900/60">
                <textarea className={inputCls} rows={2} placeholder="Atomic fact statement (one fact, not a paragraph)" value={factForm.statement} onChange={(e) => setFactForm({ ...factForm, statement: e.target.value })} />
                <input className={inputCls} type="number" min={1} placeholder="Known as of chapter" value={factForm.knownAsOf} onChange={(e) => setFactForm({ ...factForm, knownAsOf: e.target.value })} />
                <div className="flex gap-2">
                  <button onClick={submitFact} className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded text-white">Add fact</button>
                  <button onClick={() => setShowAdd(false)} className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-1 py-1.5">
                <Sparkles className="w-3 h-3" /> Add Fact
              </button>
            )}
          </>
        )}

        {/* ── Bible review queue (auto-extracted canon; Baily decides) ── */}
        {section === "review-queue" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-gray-500">Extraction only proposes — nothing enters canon without your approval.</p>
              <button
                onClick={extractFromChapter}
                disabled={extracting}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-purple-300 hover:text-purple-200 disabled:opacity-50"
              >
                <Sparkles className="w-3 h-3" />{extracting ? "Extracting…" : `Extract from ch.${currentChapter ?? 1}`}
              </button>
            </div>
            {queueItems.length === 0 && (
              <div className="text-xs text-gray-500 italic py-2">Queue is empty — extract from a landed chapter to propose canon.</div>
            )}
            {queueItems.map((item) => (
              <div key={item.id} className={`border rounded p-2.5 ${item.status === "pending" ? "border-gray-800 bg-gray-900/40" : "border-gray-800/50 opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-purple-800 text-purple-300">
                        {item.kind === "fact" ? "fact" : item.entityType}
                      </span>
                      <span className="text-[10px] text-gray-500">from ch.{item.sourceChapter}</span>
                      {item.status !== "pending" && <span className="text-[10px] text-gray-500">{item.status}</span>}
                    </div>
                    <p className="text-[11px] text-gray-300 mt-1">
                      {item.kind === "fact" ? item.statement : `${item.name} — ${item.summary}`}
                    </p>
                    {item.kind === "fact" && <span className="text-[10px] text-gray-500">known ch.{item.knownAsOf}</span>}
                  </div>
                  {item.status === "pending" && (
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => resolveQueueItem(item.id, "approve")} className="px-2 py-1 text-[11px] bg-green-800/60 hover:bg-green-700/60 text-green-200 rounded">Approve</button>
                      <button onClick={() => resolveQueueItem(item.id, "reject")} className="px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded">Reject</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
