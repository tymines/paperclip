// Story Bible codex panel (Spec v1 §4.1) — the structured canon store UI.
// 8 codex entity sections + typed Relationships + spoiler-gated Facts.
// §7: lock toggles call the human-only endpoints; locked entries show amber
// chips and refuse AI edits server-side. Honest 0159-pending states.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Lock, LockOpen, Trash2, ScrollText, Users2, Gem, Cog, Clock,
  GitBranch, Lightbulb, BookA, Link2, ShieldCheck, Sparkles, Inbox, Edit3, Save, X,
} from "lucide-react";
import { InlineEntitySelector, type InlineEntityOption } from "../InlineEntitySelector";
import { GenerateDraftPanel, type BEntityType } from "./GenerateDraftPanel";

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
  revision: number;
  chapterNumber?: number | null;
  payoffState?: string;
  payoffChapter?: number | null;
  term?: string;
  definition?: string;
  updatedAt: string;
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
  revision: number;
  updatedAt: string;
}

interface RelationshipEntity {
  id: string;
  name: string;
}

interface Fact {
  id: string;
  statement: string;
  knownAsOf: number;
  provenance: string;
  locked: boolean;
  revision: number;
  entityRefs?: { entityType: string; entityId: string }[];
  sourceChapter?: number | null;
  sourceScene?: string;
  updatedAt: string;
}

interface WithheldFact {
  id: string;
  knownAsOf: number;
  provenance: string;
  locked: boolean;
}

type EditKind = "entity" | "relationship" | "fact";

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

function relationshipTypeLabel(entityType: string) {
  return entityType === "factions" ? "faction"
    : entityType === "objects" ? "object"
      : entityType === "systems" ? "system"
        : entityType === "threads" ? "thread"
          : entityType === "themes" ? "theme"
            : entityType;
}

function RelationshipEntityPicker({
  side,
  entityType,
  value,
  entities,
  onChange,
}: {
  side: "From" | "To";
  entityType: string;
  value: string;
  entities: RelationshipEntity[];
  onChange: (id: string) => void;
}) {
  const label = relationshipTypeLabel(entityType);
  const options: InlineEntityOption[] = entities.map((entity) => ({
    id: entity.id,
    label: entity.name,
    searchText: `${entity.name} ${label}`,
  }));

  return (
    <div className="min-w-0 flex-1">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-gray-500">{side} {label}</span>
      <InlineEntitySelector
        value={value}
        options={options}
        placeholder={`Choose ${label}`}
        noneLabel={`Choose ${label}`}
        searchPlaceholder={`Search ${label} names...`}
        emptyMessage={`No ${label} entries yet.`}
        onChange={onChange}
        className="w-full justify-between border-gray-800 bg-gray-900 px-2 py-1.5 text-xs text-gray-200"
        disablePortal
      />
    </div>
  );
}

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
  const [relationshipEntities, setRelationshipEntities] = useState<Record<string, RelationshipEntity[]>>({});
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [knownFacts, setKnownFacts] = useState<Fact[]>([]);
  const [withheldFacts, setWithheldFacts] = useState<WithheldFact[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [factChapter, setFactChapter] = useState(currentChapter ?? 1);

  // Add-form state (shared shape; per-section extras read at submit)
  const [form, setForm] = useState<Record<string, string>>({});
  const [relForm, setRelForm] = useState({ fromEntityType: "character", fromEntityId: "", toEntityType: "character", toEntityId: "", type: "", arcStage: "", meter: "0", rules: "" });
  const [factForm, setFactForm] = useState({ statement: "", knownAsOf: String(currentChapter ?? 1) });
  const [editing, setEditing] = useState<{ kind: EditKind; id: string; draft: Record<string, string>; expectedRevision: number } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const prefix = `/companies/${companySlug}/book-studio/books/${bookId}`;

  useEffect(() => { setShowGenerate(false); setEditing(null); }, [section, bookId, companySlug]);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (section === "relationships") {
        const [res, charactersRes, locationsRes, codexResults] = await Promise.all([
          apiFetch<{ available: boolean; relationships: Relationship[] }>(`${prefix}/codex-relationships`),
          apiFetch<{ characters?: RelationshipEntity[] }>(`${prefix}/characters`),
          apiFetch<{ "world-locations"?: RelationshipEntity[] }>(`${prefix}/world-locations`),
          Promise.all(CODEX_SECTIONS.map(async ({ id }) => ({
            id,
            entities: (await apiFetch<{ entities?: CodexEntity[] }>(`${prefix}/codex/${id}`)).entities ?? [],
          }))),
        ]);
        setAvailable(res.available);
        setRelationships(res.relationships ?? []);
        setRelationshipEntities({
          character: charactersRes.characters ?? [],
          location: locationsRes["world-locations"] ?? [],
          ...Object.fromEntries(codexResults.map((result) => [result.id, result.entities])),
        });
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
    for (const group of Object.values(relationshipEntities)) {
      for (const entity of group) map.set(entity.id, entity.name);
    }
    return (id: string) => map.get(id) ?? id.slice(0, 8);
  }, [entities, relationshipEntities]);

  async function toggleLock(kind: "entity" | "relationship" | "fact", id: string, locked: boolean) {
    const url = kind === "entity" ? `${prefix}/codex/${section}/${id}`
      : kind === "relationship" ? `${prefix}/codex-relationships/${id}`
      : `${prefix}/codex-facts/${id}`;
    const record = kind === "entity" ? entities.find((item) => item.id === id)
      : kind === "relationship" ? relationships.find((item) => item.id === id)
        : knownFacts.find((item) => item.id === id);
    if (!record) return;
    try {
      if (kind === "entity") {
        const result = await apiFetch<{ entity: CodexEntity }>(url, { method: "PATCH", body: JSON.stringify({ locked: !locked, expectedRevision: record.revision }) });
        setEntities((rows) => rows.map((row) => row.id === id ? result.entity : row));
      } else if (kind === "relationship") {
        const result = await apiFetch<{ relationship: Relationship }>(url, { method: "PATCH", body: JSON.stringify({ locked: !locked, expectedRevision: record.revision }) });
        setRelationships((rows) => rows.map((row) => row.id === id ? result.relationship : row));
      } else {
        const result = await apiFetch<{ fact: Fact }>(url, { method: "PATCH", body: JSON.stringify({ locked: !locked, expectedRevision: record.revision }) });
        setKnownFacts((rows) => rows.map((row) => row.id === id ? result.fact : row));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function beginEntityEdit(entity: CodexEntity) {
    setError(null);
    setEditing({ kind: "entity", id: entity.id, expectedRevision: entity.revision, draft: {
      name: entity.name, summary: entity.summary, details: JSON.stringify(entity.details ?? {}, null, 2),
      chapterNumber: entity.chapterNumber == null ? "" : String(entity.chapterNumber),
      payoffState: entity.payoffState ?? "open", payoffChapter: entity.payoffChapter == null ? "" : String(entity.payoffChapter),
      term: entity.term ?? entity.name, definition: entity.definition ?? "",
    } });
  }

  function beginRelationshipEdit(relationship: Relationship) {
    setError(null);
    setEditing({ kind: "relationship", id: relationship.id, expectedRevision: relationship.revision, draft: {
      fromEntityType: relationship.fromEntityType, fromEntityId: relationship.fromEntityId,
      toEntityType: relationship.toEntityType, toEntityId: relationship.toEntityId,
      type: relationship.type, arcStage: relationship.arcStage, meter: String(relationship.meter), rules: relationship.rules.join("\n"),
    } });
  }

  async function beginFactEdit(id: string) {
    setError(null);
    try {
      const result = await apiFetch<{ fact: Fact }>(`${prefix}/codex-facts/${id}`);
      const fact = result.fact;
      setEditing({ kind: "fact", id: fact.id, expectedRevision: fact.revision, draft: {
        statement: fact.statement, knownAsOf: String(fact.knownAsOf),
        entityRefs: JSON.stringify(fact.entityRefs ?? [], null, 2),
        sourceChapter: fact.sourceChapter == null ? "" : String(fact.sourceChapter), sourceScene: fact.sourceScene ?? "",
      } });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function saveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    setError(null);
    try {
      if (editing.kind === "entity") {
        const body: Record<string, unknown> = {
          name: editing.draft.name?.trim(), summary: editing.draft.summary ?? "",
          details: JSON.parse(editing.draft.details || "{}"), expectedRevision: editing.expectedRevision,
        };
        if (section === "timeline") body.chapterNumber = editing.draft.chapterNumber ? Number(editing.draft.chapterNumber) : null;
        if (section === "threads") {
          body.payoffState = editing.draft.payoffState;
          body.payoffChapter = editing.draft.payoffChapter ? Number(editing.draft.payoffChapter) : null;
        }
        if (section === "glossary") { body.term = editing.draft.term?.trim(); body.definition = editing.draft.definition ?? ""; }
        const result = await apiFetch<{ entity: CodexEntity }>(`${prefix}/codex/${section}/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        setEntities((rows) => rows.map((row) => row.id === editing.id ? result.entity : row));
      } else if (editing.kind === "relationship") {
        if (!editing.draft.fromEntityId?.trim() || !editing.draft.toEntityId?.trim()) {
          throw new Error("Choose both relationship entries by name before saving.");
        }
        const result = await apiFetch<{ relationship: Relationship }>(`${prefix}/codex-relationships/${editing.id}`, { method: "PATCH", body: JSON.stringify({
          fromEntityType: editing.draft.fromEntityType, fromEntityId: editing.draft.fromEntityId?.trim(),
          toEntityType: editing.draft.toEntityType, toEntityId: editing.draft.toEntityId?.trim(),
          type: editing.draft.type ?? "", arcStage: editing.draft.arcStage ?? "", meter: Number(editing.draft.meter),
          rules: (editing.draft.rules ?? "").split("\n").map((rule) => rule.trim()).filter(Boolean), expectedRevision: editing.expectedRevision,
        }) });
        setRelationships((rows) => rows.map((row) => row.id === editing.id ? result.relationship : row));
      } else {
        const result = await apiFetch<{ fact: Fact }>(`${prefix}/codex-facts/${editing.id}`, { method: "PATCH", body: JSON.stringify({
          statement: editing.draft.statement?.trim(), knownAsOf: Number(editing.draft.knownAsOf),
          entityRefs: JSON.parse(editing.draft.entityRefs || "[]"),
          sourceChapter: editing.draft.sourceChapter ? Number(editing.draft.sourceChapter) : null,
          sourceScene: editing.draft.sourceScene ?? "", expectedRevision: editing.expectedRevision,
        }) });
        setKnownFacts((rows) => rows.map((row) => row.id === editing.id ? result.fact : row));
        setWithheldFacts((rows) => rows.filter((row) => row.id !== editing.id));
        await load();
      }
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSavingEdit(false); }
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
    if (!relForm.fromEntityId.trim() || !relForm.toEntityId.trim()) {
      setError("Choose both relationship entries by name before adding the relationship.");
      return;
    }
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

  async function acceptGeneratedDraft(draft: Record<string, unknown>) {
    setError(null);
    try {
      if (section === "relationships") {
        await apiFetch(`${prefix}/codex-relationships`, {
          method: "POST",
          body: JSON.stringify({ ...draft, source: "co-created" }),
        });
      } else if (section === "facts") {
        await apiFetch(`${prefix}/codex-facts`, {
          method: "POST",
          body: JSON.stringify({ ...draft, provenance: "co-created" }),
        });
      } else if (section !== "review-queue") {
        await apiFetch(`${prefix}/codex/${section}`, {
          method: "POST",
          body: JSON.stringify({ ...draft, source: "co-created" }),
        });
      }
      setShowGenerate(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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

  const editField = (key: string, value: string) => setEditing((current) => current ? { ...current, draft: { ...current.draft, [key]: value } } : current);
  const editActions = editing && (
    <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-gray-800 bg-gray-900/95 pt-2">
      <button onClick={() => void saveEdit()} disabled={savingEdit} className="flex items-center gap-1 rounded bg-blue-700 px-3 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"><Save className="h-3 w-3" />{savingEdit ? "Saving…" : "Save"}</button>
      <button onClick={() => setEditing(null)} disabled={savingEdit} className="flex items-center gap-1 rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:text-white"><X className="h-3 w-3" />Cancel</button>
    </div>
  );

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
        {section !== "review-queue" && (
          <div className="border-b border-gray-800/70 pb-2">
            <button onClick={() => setShowGenerate((value) => !value)} className="flex items-center gap-1.5 px-1 py-1.5 text-xs text-purple-400 hover:text-purple-200">
              <Sparkles className="w-3 h-3" /> Generate with Calliope
            </button>
            {showGenerate && (
              <GenerateDraftPanel
                entityType={(section === "relationships" ? "relationship" : section === "facts" ? "fact" : section) as BEntityType}
                bookId={bookId}
                companySlug={companySlug}
                onDiscard={() => setShowGenerate(false)}
                onAccept={(draft) => void acceptGeneratedDraft(draft)}
              />
            )}
          </div>
        )}
        {/* ── Entity sections ── */}
        {section !== "relationships" && section !== "facts" && section !== "review-queue" && (
          <>
            {entities.length === 0 && available && (
              <div className="text-xs text-gray-500 italic py-2">No entries yet — canon starts here.</div>
            )}
            {entities.map((e) => editing?.kind === "entity" && editing.id === e.id ? (
              <div key={e.id} className="space-y-2 rounded border border-blue-700/60 bg-gray-900/70 p-2.5">
                <input aria-label="Name" className={inputCls} value={editing.draft.name ?? ""} onChange={(event) => editField("name", event.target.value)} />
                <textarea aria-label="Summary" className={inputCls} rows={3} value={editing.draft.summary ?? ""} onChange={(event) => editField("summary", event.target.value)} />
                <textarea aria-label="Details JSON" className={inputCls} rows={5} value={editing.draft.details ?? "{}"} onChange={(event) => editField("details", event.target.value)} />
                {section === "timeline" && <input aria-label="Chapter number" type="number" min={1} className={inputCls} value={editing.draft.chapterNumber ?? ""} onChange={(event) => editField("chapterNumber", event.target.value)} />}
                {section === "threads" && <div className="flex flex-wrap gap-2"><select aria-label="Payoff state" className={inputCls} value={editing.draft.payoffState ?? "open"} onChange={(event) => editField("payoffState", event.target.value)}><option value="open">open</option><option value="paid">paid</option><option value="abandoned">abandoned</option></select><input aria-label="Payoff chapter" type="number" min={1} className={inputCls} value={editing.draft.payoffChapter ?? ""} onChange={(event) => editField("payoffChapter", event.target.value)} /></div>}
                {section === "glossary" && <><input aria-label="Term" className={inputCls} value={editing.draft.term ?? ""} onChange={(event) => editField("term", event.target.value)} /><textarea aria-label="Definition" className={inputCls} rows={3} value={editing.draft.definition ?? ""} onChange={(event) => editField("definition", event.target.value)} /></>}
                {editActions}
              </div>
            ) : (
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
                    <button onClick={() => beginEntityEdit(e)} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-blue-300"><Edit3 className="h-3 w-3" />Edit</button>
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
            {relationships.map((r) => editing?.kind === "relationship" && editing.id === r.id ? (
              <div key={r.id} className="space-y-2 rounded border border-blue-700/60 bg-gray-900/70 p-2.5">
                <div className="grid gap-2 sm:grid-cols-[minmax(8rem,0.45fr)_minmax(0,1fr)]">
                  <select aria-label="From entity type" className={inputCls} value={editing.draft.fromEntityType} onChange={(event) => setEditing((current) => current ? { ...current, draft: { ...current.draft, fromEntityType: event.target.value, fromEntityId: "" } } : current)}>{REL_ENTITY_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
                  <RelationshipEntityPicker side="From" entityType={editing.draft.fromEntityType} value={editing.draft.fromEntityId} entities={relationshipEntities[editing.draft.fromEntityType] ?? []} onChange={(id) => editField("fromEntityId", id)} />
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(8rem,0.45fr)_minmax(0,1fr)]">
                  <select aria-label="To entity type" className={inputCls} value={editing.draft.toEntityType} onChange={(event) => setEditing((current) => current ? { ...current, draft: { ...current.draft, toEntityType: event.target.value, toEntityId: "" } } : current)}>{REL_ENTITY_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
                  <RelationshipEntityPicker side="To" entityType={editing.draft.toEntityType} value={editing.draft.toEntityId} entities={relationshipEntities[editing.draft.toEntityType] ?? []} onChange={(id) => editField("toEntityId", id)} />
                </div>
                <input aria-label="Relationship type" className={inputCls} value={editing.draft.type} onChange={(event) => editField("type", event.target.value)} />
                <input aria-label="Arc stage" className={inputCls} value={editing.draft.arcStage} onChange={(event) => editField("arcStage", event.target.value)} />
                <input aria-label="Relationship meter" type="number" min={-100} max={100} className={inputCls} value={editing.draft.meter} onChange={(event) => editField("meter", event.target.value)} />
                <textarea aria-label="Relationship rules" rows={4} className={inputCls} value={editing.draft.rules} onChange={(event) => editField("rules", event.target.value)} />
                {editActions}
              </div>
            ) : (
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
                    <button onClick={() => beginRelationshipEdit(r)} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-blue-300"><Edit3 className="h-3 w-3" />Edit</button>
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
                <div className="grid gap-2 sm:grid-cols-[minmax(8rem,0.45fr)_minmax(0,1fr)]">
                  <select aria-label="From entity type" className={inputCls} value={relForm.fromEntityType} onChange={(e) => setRelForm({ ...relForm, fromEntityType: e.target.value, fromEntityId: "" })}>{REL_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  <RelationshipEntityPicker side="From" entityType={relForm.fromEntityType} value={relForm.fromEntityId} entities={relationshipEntities[relForm.fromEntityType] ?? []} onChange={(id) => setRelForm({ ...relForm, fromEntityId: id })} />
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(8rem,0.45fr)_minmax(0,1fr)]">
                  <select aria-label="To entity type" className={inputCls} value={relForm.toEntityType} onChange={(e) => setRelForm({ ...relForm, toEntityType: e.target.value, toEntityId: "" })}>{REL_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  <RelationshipEntityPicker side="To" entityType={relForm.toEntityType} value={relForm.toEntityId} entities={relationshipEntities[relForm.toEntityType] ?? []} onChange={(id) => setRelForm({ ...relForm, toEntityId: id })} />
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
            {knownFacts.map((f) => editing?.kind === "fact" && editing.id === f.id ? (
              <div key={f.id} className="space-y-2 rounded border border-blue-700/60 bg-gray-900/70 p-2.5">
                <textarea aria-label="Fact statement" rows={3} className={inputCls} value={editing.draft.statement} onChange={(event) => editField("statement", event.target.value)} />
                <input aria-label="Known as of chapter" type="number" min={1} className={inputCls} value={editing.draft.knownAsOf} onChange={(event) => editField("knownAsOf", event.target.value)} />
                <textarea aria-label="Entity references JSON" rows={4} className={inputCls} value={editing.draft.entityRefs} onChange={(event) => editField("entityRefs", event.target.value)} />
                <input aria-label="Source chapter" type="number" min={1} className={inputCls} value={editing.draft.sourceChapter} onChange={(event) => editField("sourceChapter", event.target.value)} />
                <input aria-label="Source scene" className={inputCls} value={editing.draft.sourceScene} onChange={(event) => editField("sourceScene", event.target.value)} />
                {editActions}
              </div>
            ) : (
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
                  <button onClick={() => void beginFactEdit(f.id)} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-blue-300"><Edit3 className="h-3 w-3" />Edit</button>
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
                    <button key={f.id} onClick={() => void beginFactEdit(f.id)} title="Board-only edit; writer context remains gated" className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-purple-800/60 bg-purple-950/30 text-purple-300 hover:border-purple-500">
                      <Edit3 className="h-3 w-3" />Edit withheld · reveals ch.{f.knownAsOf}{f.locked ? " · locked" : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {editing?.kind === "fact" && withheldFacts.some((fact) => fact.id === editing.id) && (
              <div className="space-y-2 rounded border border-blue-700/60 bg-gray-900/70 p-2.5">
                <textarea aria-label="Fact statement" rows={3} className={inputCls} value={editing.draft.statement} onChange={(event) => editField("statement", event.target.value)} />
                <input aria-label="Known as of chapter" type="number" min={1} className={inputCls} value={editing.draft.knownAsOf} onChange={(event) => editField("knownAsOf", event.target.value)} />
                <textarea aria-label="Entity references JSON" rows={4} className={inputCls} value={editing.draft.entityRefs} onChange={(event) => editField("entityRefs", event.target.value)} />
                <input aria-label="Source chapter" type="number" min={1} className={inputCls} value={editing.draft.sourceChapter} onChange={(event) => editField("sourceChapter", event.target.value)} />
                <input aria-label="Source scene" className={inputCls} value={editing.draft.sourceScene} onChange={(event) => editField("sourceScene", event.target.value)} />
                {editActions}
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
