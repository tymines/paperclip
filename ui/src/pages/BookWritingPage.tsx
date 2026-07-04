/**
 * Book Studio — locked three-pane layout shell for AI-assisted book authoring.
 *
 * Left pane: Story Bible (Overview, Characters, World & Locations, Style, Outline, Manuscript)
 * Center pane: Manuscript editor with chapter navigation and toolbar
 * Right pane: Review Notes with category filters
 *
 * Layout: grid-cols-[1fr_2fr_1fr] (~25/50/25 split), non-resizable, full-height
 */

import { useState, useEffect, useCallback } from "react";
import {
  BookOpen,
  User,
  MapPin,
  Palette,
  List,
  FileText,
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Pen,
  MessageSquare,
  RotateCcw,
  Download,
  Sparkles,
  X,
  ChevronDown,
  ChevronUp,
  Plus,
  Lock,
  Unlock,
  Trash2,
  Save,
  Edit3,
  Camera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GenerateDraftPanel } from "@/components/book-studio/GenerateDraftPanel";
import { ChatDrawer } from "@/components/book-studio/ChatDrawer";
import { ErrorBoundary } from "@/components/book-studio/ErrorBoundary";
import { ManuscriptEditor } from "@/components/book-studio/ManuscriptEditor";
import { AssistedModePanel } from "@/components/book-studio/AssistedModePanel";

// ── Types ───────────────────────────────────────────────────────────────────

type StoryBibleTab =
  | "overview"
  | "characters"
  | "world"
  | "style"
  | "outline"
  | "manuscript";

interface BibleTabDef {
  id: StoryBibleTab;
  label: string;
  icon: React.ReactNode;
}

const BIBLE_TABS: BibleTabDef[] = [
  { id: "overview", label: "Overview", icon: <BookOpen className="w-3.5 h-3.5" /> },
  { id: "characters", label: "Characters", icon: <User className="w-3.5 h-3.5" /> },
  { id: "world", label: "World & Locations", icon: <MapPin className="w-3.5 h-3.5" /> },
  { id: "style", label: "Style", icon: <Palette className="w-3.5 h-3.5" /> },
  { id: "outline", label: "Outline", icon: <List className="w-3.5 h-3.5" /> },
  { id: "manuscript", label: "Manuscript", icon: <FileText className="w-3.5 h-3.5" /> },
];

// ── API data types ──────────────────────────────────────────────────────────

interface BookData {
  id: string;
  companyId: string;
  slug: string;
  title: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface CharacterEntity {
  id: string;
  bookId: string;
  name: string;
  role: string;
  description: string;
  voiceCard: Record<string, unknown>;
  locked: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface WorldLocationEntity {
  id: string;
  bookId: string;
  name: string;
  description: string;
  rules: Record<string, unknown>;
  sensoryNotes: Record<string, unknown>;
  locked: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface StyleEntity {
  id: string;
  bookId: string;
  pov: string;
  tense: string;
  comps: string;
  sampleParagraph: string;
  bannedCliches: string[];
  locked: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

interface OutlineEntity {
  id: string;
  bookId: string;
  chapterNumber: number;
  title: string;
  beats: Record<string, unknown>[];
  locked: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
}

// ── Review Notes (static mock for now) ──────────────────────────────────────

interface Note {
  id: string;
  category: string;
  label: string;
  description: string;
}

const REVIEW_NOTES: Note[] = [
  { id: "1", category: "Canon", label: "Canon conflict — Ch.3 vs Ch.1", description: "Character says they've never been to the coast, but Chapter 1 opens at the seaside." },
  { id: "2", category: "Voice", label: "Voice drift in dialogue", description: "Mara's dialogue shifts from formal to slang between paragraphs." },
  { id: "3", category: "Continuity", label: "Timeline gap", description: "Three days pass between Ch.2 and Ch.3 with no explanation." },
  { id: "4", category: "Structure", label: "Pacing dip in middle", description: "Ch.4 exposition runs 800 words without action or dialogue." },
  { id: "5", category: "Prose", label: "Overused adverb cluster", description: "Word 'suddenly' appears 12 times in Ch.5 alone." },
  { id: "6", category: "Canon", label: "Magic system rule broken", description: "Character casts a spell without the required focus object." },
];

const CATEGORY_COLORS: Record<string, string> = {
  Canon: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  Voice: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  Continuity: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  Structure: "bg-green-500/20 text-green-300 border-green-500/40",
  Prose: "bg-red-500/20 text-red-300 border-red-500/40",
};

const CATEGORY_PILLS = ["Canon", "Voice", "Continuity", "Structure", "Prose"] as const;

const SOURCE_BADGE_COLORS: Record<string, string> = {
  authored: "bg-green-500/20 text-green-300 border-green-500/40",
  co_created: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  imported: "bg-orange-500/20 text-orange-300 border-orange-500/40",
};

const SOURCE_OPTIONS = [
  { value: "authored", label: "Authored" },
  { value: "co_created", label: "Co-Created" },
  { value: "imported", label: "Imported" },
] as const;

const READINESS_TARGETS = { characters: 3, locations: 3, outline: 5 } as const;

// ── Helper: safe JSON parse / stringify ──────────────────────────────────────

function safeJsonParse(s: string): Record<string, unknown> {
  if (!s.trim()) return {};
  try { const v = JSON.parse(s); return typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {}; }
  catch { return {}; }
}

function safeJsonStringify(v: Record<string, unknown>): string {
  try { return JSON.stringify(v, null, 2); }
  catch { return "{}"; }
}

// ── API helpers ─────────────────────────────────────────────────────────────

const API_BASE = "/api";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ── Collapsible Section ──────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-800 last:border-b-0">
      <button
        className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-200"
        onClick={() => setOpen(!open)}
      >
        <span>
          {title} <span className="text-gray-600">({count})</span>
        </span>
        {open ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

// ── Source Badge ────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const colors = SOURCE_BADGE_COLORS[source] || "bg-gray-500/20 text-gray-300 border-gray-500/40";
  return (
    <span className={cn("inline-block rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider", colors)}>
      {source}
    </span>
  );
}

// ── Editable Text Field ──────────────────────────────────────────────────────

function EditableField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="mb-2">
      <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">{label}</label>
      {multiline ? (
        <textarea
          className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-blue-500/50"
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <input
          className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

// ── Character Card ──────────────────────────────────────────────────────────

interface CharacterCardProps {
  char: CharacterEntity;
  onUpdate: (id: string, data: Partial<CharacterEntity>) => void;
  onDelete: (id: string) => void;
}

function CharacterCardComponent({ char, onUpdate, onDelete }: CharacterCardProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(char.name);
  const [editRole, setEditRole] = useState(char.role);
  const [editDesc, setEditDesc] = useState(char.description);
  const [editVoiceCard, setEditVoiceCard] = useState(safeJsonStringify(char.voiceCard));
  const [editSource, setEditSource] = useState(char.source || "authored");
  const [deleting, setDeleting] = useState(false);

  const initials = char.name
    .split(" ")
    .map((n) => n[0])
    .join("");

  const handleSave = () => {
    onUpdate(char.id, {
      name: editName, role: editRole, description: editDesc,
      voiceCard: safeJsonParse(editVoiceCard), source: editSource,
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditName(char.name);
    setEditRole(char.role);
    setEditDesc(char.description);
    setEditVoiceCard(safeJsonStringify(char.voiceCard));
    setEditSource(char.source || "authored");
    setEditing(false);
  };

  const handleToggleLock = () => {
    onUpdate(char.id, { locked: !char.locked });
  };

  if (editing) {
    return (
      <div className="rounded-md border border-blue-500/40 bg-gray-900/80 p-2.5">
        <EditableField label="Name" value={editName} onChange={setEditName} />
        <EditableField label="Role" value={editRole} onChange={setEditRole} />
        <EditableField label="Description" value={editDesc} onChange={setEditDesc} multiline />
        <EditableField label="Voice Card (JSON)" value={editVoiceCard} onChange={setEditVoiceCard} multiline placeholder="{}" />
        <div className="mb-2">
          <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">Source</label>
          <select className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50" value={editSource} onChange={(e) => setEditSource(e.target.value)}>
            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <button onClick={handleSave} className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500">
            <Save className="w-2.5 h-2.5" /> Save
          </button>
          <button onClick={handleCancel} className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200">
            <X className="w-2.5 h-2.5" /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-gray-800 bg-gray-900/50 p-2.5 group">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs font-semibold text-gray-400">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200 truncate">{char.name}</span>
          <SourceBadge source={char.source} />
        </div>
        <div className="text-xs text-gray-500">{char.role}</div>
        {char.description && (
          <p className="text-[11px] text-gray-400 mt-1 leading-relaxed line-clamp-2">{char.description}</p>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleToggleLock}
          className={cn(
            "rounded p-1",
            char.locked ? "text-yellow-400 hover:text-yellow-300" : "text-gray-500 hover:text-gray-300",
          )}
          title={char.locked ? "Unlock" : "Lock"}
        >
          {char.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
        </button>
        <button
          onClick={() => setEditing(true)}
          className="rounded p-1 text-gray-500 hover:text-blue-400"
          title="Edit"
        >
          <Edit3 className="w-3 h-3" />
        </button>
        <button
          onClick={() => setDeleting(true)}
          className="rounded p-1 text-gray-500 hover:text-red-400"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
        <button
          className="rounded p-1 text-gray-600 hover:text-gray-400 cursor-not-allowed"
          title="Coming soon — real image generation in next phase"
          disabled
        >
          <Camera className="w-3 h-3" />
        </button>
      </div>

      {/* Delete confirmation overlay */}
      {deleting && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-gray-950/90 z-10">
          <div className="text-center">
            <p className="text-xs text-gray-300 mb-2">Delete "{char.name}"?</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => { onDelete(char.id); setDeleting(false); }}
                className="rounded bg-red-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-red-500"
              >
                Delete
              </button>
              <button
                onClick={() => setDeleting(false)}
                className="rounded border border-gray-700 px-2.5 py-1 text-[10px] text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── World Location Card ─────────────────────────────────────────────────────

interface LocationCardProps {
  loc: WorldLocationEntity;
  onUpdate: (id: string, data: Partial<WorldLocationEntity>) => void;
  onDelete: (id: string) => void;
}

function LocationCardComponent({ loc, onUpdate, onDelete }: LocationCardProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(loc.name);
  const [editDesc, setEditDesc] = useState(loc.description);
  const [editRules, setEditRules] = useState(safeJsonStringify(loc.rules));
  const [editSensory, setEditSensory] = useState(safeJsonStringify(loc.sensoryNotes));
  const [editSource, setEditSource] = useState(loc.source || "authored");
  const [deleting, setDeleting] = useState(false);

  const handleSave = () => {
    onUpdate(loc.id, {
      name: editName, description: editDesc,
      rules: safeJsonParse(editRules), sensoryNotes: safeJsonParse(editSensory), source: editSource,
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditName(loc.name);
    setEditDesc(loc.description);
    setEditRules(safeJsonStringify(loc.rules));
    setEditSensory(safeJsonStringify(loc.sensoryNotes));
    setEditSource(loc.source || "authored");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-md border border-blue-500/40 bg-gray-900/80 p-2.5">
        <EditableField label="Name" value={editName} onChange={setEditName} />
        <EditableField label="Description" value={editDesc} onChange={setEditDesc} multiline />
        <EditableField label="Rules (JSON)" value={editRules} onChange={setEditRules} multiline placeholder="{}" />
        <EditableField label="Sensory Notes (JSON)" value={editSensory} onChange={setEditSensory} multiline placeholder="{}" />
        <div className="mb-2">
          <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">Source</label>
          <select className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50" value={editSource} onChange={(e) => setEditSource(e.target.value)}>
            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <button onClick={handleSave} className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500">
            <Save className="w-2.5 h-2.5" /> Save
          </button>
          <button onClick={handleCancel} className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200">
            <X className="w-2.5 h-2.5" /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-gray-800 bg-gray-900/50 p-2.5 group relative">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-900/50 text-sm">
        🏔️
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200 truncate">{loc.name}</span>
          <SourceBadge source={loc.source} />
        </div>
        {loc.description && (
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{loc.description}</p>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onUpdate(loc.id, { locked: !loc.locked })}
          className={cn("rounded p-1", loc.locked ? "text-yellow-400" : "text-gray-500 hover:text-gray-300")}
        >
          {loc.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
        </button>
        <button onClick={() => setEditing(true)} className="rounded p-1 text-gray-500 hover:text-blue-400">
          <Edit3 className="w-3 h-3" />
        </button>
        <button onClick={() => setDeleting(true)} className="rounded p-1 text-gray-500 hover:text-red-400">
          <Trash2 className="w-3 h-3" />
        </button>
        <button
          className="rounded p-1 text-gray-600 hover:text-gray-400 cursor-not-allowed"
          title="Coming soon — real image generation in next phase"
          disabled
        >
          <Camera className="w-3 h-3" />
        </button>
      </div>

      {deleting && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-gray-950/90 z-10">
          <div className="text-center">
            <p className="text-xs text-gray-300 mb-2">Delete "{loc.name}"?</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => { onDelete(loc.id); setDeleting(false); }} className="rounded bg-red-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-red-500">Delete</button>
              <button onClick={() => setDeleting(false)} className="rounded border border-gray-700 px-2.5 py-1 text-[10px] text-gray-400 hover:text-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Style Card ──────────────────────────────────────────────────────────────

interface StyleCardProps {
  entry: StyleEntity;
  onUpdate: (id: string, data: Partial<StyleEntity>) => void;
  onDelete: (id: string) => void;
}

function StyleCardComponent({ entry, onUpdate, onDelete }: StyleCardProps) {
  const [editing, setEditing] = useState(false);
  const [editPov, setEditPov] = useState(entry.pov);
  const [editTense, setEditTense] = useState(entry.tense);
  const [editComps, setEditComps] = useState(entry.comps);
  const [editSample, setEditSample] = useState(entry.sampleParagraph);
  const [editCliches, setEditCliches] = useState((entry.bannedCliches || []).join(", "));
  const [editSource, setEditSource] = useState(entry.source || "authored");
  const [deleting, setDeleting] = useState(false);

  const handleSave = () => {
    onUpdate(entry.id, {
      pov: editPov, tense: editTense, comps: editComps, sampleParagraph: editSample,
      bannedCliches: editCliches.split(",").map((s) => s.trim()).filter(Boolean),
      source: editSource,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-md border border-blue-500/40 bg-gray-900/80 p-2.5">
        <EditableField label="POV" value={editPov} onChange={setEditPov} />
        <EditableField label="Tense" value={editTense} onChange={setEditTense} />
        <EditableField label="Comparisons" value={editComps} onChange={setEditComps} />
        <EditableField label="Sample Paragraph" value={editSample} onChange={setEditSample} multiline />
        <EditableField label="Banned Clichés (comma-separated)" value={editCliches} onChange={setEditCliches} placeholder="suddenly, very unique" />
        <div className="mb-2">
          <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">Source</label>
          <select className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50" value={editSource} onChange={(e) => setEditSource(e.target.value)}>
            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <button onClick={handleSave} className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"><Save className="w-2.5 h-2.5" /> Save</button>
          <button onClick={() => setEditing(false)} className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200"><X className="w-2.5 h-2.5" /> Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-gray-800 bg-gray-900/50 p-2.5 group relative">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium text-gray-200">{entry.pov || "N/A"}</span>
        <span className="text-gray-600">·</span>
        <span className="text-xs text-gray-400">{entry.tense || "N/A"}</span>
        <SourceBadge source={entry.source} />
      </div>
      {entry.comps && <p className="text-[11px] text-gray-500 mb-1">Comps: {entry.comps}</p>}
      {entry.sampleParagraph && (
        <p className="text-[11px] text-gray-400 italic line-clamp-2">"{entry.sampleParagraph}"</p>
      )}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onUpdate(entry.id, { locked: !entry.locked })} className={cn("rounded p-1", entry.locked ? "text-yellow-400" : "text-gray-500 hover:text-gray-300")}>
          {entry.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
        </button>
        <button onClick={() => setEditing(true)} className="rounded p-1 text-gray-500 hover:text-blue-400"><Edit3 className="w-3 h-3" /></button>
        <button onClick={() => setDeleting(true)} className="rounded p-1 text-gray-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
        <button
          className="rounded p-1 text-gray-600 hover:text-gray-400 cursor-not-allowed"
          title="Coming soon — real image generation in next phase"
          disabled
        >
          <Camera className="w-3 h-3" />
        </button>
      </div>
      {deleting && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-gray-950/90 z-10">
          <div className="text-center">
            <p className="text-xs text-gray-300 mb-2">Delete this style entry?</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => { onDelete(entry.id); setDeleting(false); }} className="rounded bg-red-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-red-500">Delete</button>
              <button onClick={() => setDeleting(false)} className="rounded border border-gray-700 px-2.5 py-1 text-[10px] text-gray-400 hover:text-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Outline Card ────────────────────────────────────────────────────────────

interface OutlineCardProps {
  entry: OutlineEntity;
  onUpdate: (id: string, data: Partial<OutlineEntity>) => void;
  onDelete: (id: string) => void;
}

function OutlineCardComponent({ entry, onUpdate, onDelete }: OutlineCardProps) {
  const [editing, setEditing] = useState(false);
  const [editCh, setEditCh] = useState(String(entry.chapterNumber));
  const [editTitle, setEditTitle] = useState(entry.title);
  const [editBeats, setEditBeats] = useState(JSON.stringify(entry.beats || [], null, 2));
  const [editSource, setEditSource] = useState(entry.source || "authored");
  const [deleting, setDeleting] = useState(false);

  const handleSave = () => {
    let beats: Record<string, unknown>[] = [];
    try { const p = JSON.parse(editBeats); if (Array.isArray(p)) beats = p; } catch { /* use empty */ }
    onUpdate(entry.id, {
      chapterNumber: parseInt(editCh, 10) || 1, title: editTitle,
      beats, source: editSource,
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-md border border-blue-500/40 bg-gray-900/80 p-2.5">
        <EditableField label="Chapter #" value={editCh} onChange={setEditCh} />
        <EditableField label="Title" value={editTitle} onChange={setEditTitle} />
        <EditableField label="Beats (JSON array)" value={editBeats} onChange={setEditBeats} multiline placeholder="[]" />
        <div className="mb-2">
          <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">Source</label>
          <select className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50" value={editSource} onChange={(e) => setEditSource(e.target.value)}>
            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <button onClick={handleSave} className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"><Save className="w-2.5 h-2.5" /> Save</button>
          <button onClick={() => setEditing(false)} className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200"><X className="w-2.5 h-2.5" /> Cancel</button>
        </div>
      </div>
    );
  }

  const beatCount = Array.isArray(entry.beats) ? entry.beats.length : 0;

  return (
    <div className="rounded-md border border-gray-800 bg-gray-900/50 p-2.5 group relative">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-500">Ch.{entry.chapterNumber}</span>
        <span className="text-sm font-medium text-gray-200 truncate">{entry.title || "Untitled"}</span>
        <SourceBadge source={entry.source} />
      </div>
      {beatCount > 0 && (
        <span className="text-[10px] text-gray-600">{beatCount} beat{beatCount > 1 ? "s" : ""}</span>
      )}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onUpdate(entry.id, { locked: !entry.locked })} className={cn("rounded p-1", entry.locked ? "text-yellow-400" : "text-gray-500 hover:text-gray-300")}>
          {entry.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
        </button>
        <button onClick={() => setEditing(true)} className="rounded p-1 text-gray-500 hover:text-blue-400"><Edit3 className="w-3 h-3" /></button>
        <button onClick={() => setDeleting(true)} className="rounded p-1 text-gray-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
        <button
          className="rounded p-1 text-gray-600 hover:text-gray-400 cursor-not-allowed"
          title="Coming soon — real image generation in next phase"
          disabled
        >
          <Camera className="w-3 h-3" />
        </button>
      </div>
      {deleting && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-gray-950/90 z-10">
          <div className="text-center">
            <p className="text-xs text-gray-300 mb-2">Delete Ch.{entry.chapterNumber}?</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => { onDelete(entry.id); setDeleting(false); }} className="rounded bg-red-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-red-500">Delete</button>
              <button onClick={() => setDeleting(false)} className="rounded border border-gray-700 px-2.5 py-1 text-[10px] text-gray-400 hover:text-gray-200">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create Form Components ──────────────────────────────────────────────────

function CreateCharacterForm({ onSave, onCancel }: { onSave: (data: { name: string; role: string; description: string; voiceCard: Record<string, unknown>; source: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [desc, setDesc] = useState("");
  const [voiceCard, setVoiceCard] = useState("{}");
  const [source, setSource] = useState("authored");
  return (
    <div className="rounded-md border border-blue-500/40 bg-gray-900/80 p-2.5 mb-2">
      <EditableField label="Name" value={name} onChange={setName} placeholder="Character name" />
      <EditableField label="Role" value={role} onChange={setRole} placeholder="e.g. Protagonist" />
      <EditableField label="Description" value={desc} onChange={setDesc} multiline placeholder="Brief description" />
      <EditableField label="Voice Card (JSON)" value={voiceCard} onChange={setVoiceCard} multiline placeholder="{}" />
      <div className="mb-2">
        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">Source</label>
        <select className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50" value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button onClick={() => onSave({ name, role, description: desc, voiceCard: safeJsonParse(voiceCard), source })} disabled={!name.trim()} className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-50">
          <Plus className="w-2.5 h-2.5" /> Create
        </button>
        <button onClick={onCancel} className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200">
          <X className="w-2.5 h-2.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

function CreateLocationForm({ onSave, onCancel }: { onSave: (data: { name: string; description: string; rules: Record<string, unknown>; sensoryNotes: Record<string, unknown>; source: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [rules, setRules] = useState("{}");
  const [sensory, setSensory] = useState("{}");
  const [source, setSource] = useState("authored");
  return (
    <div className="rounded-md border border-blue-500/40 bg-gray-900/80 p-2.5 mb-2">
      <EditableField label="Name" value={name} onChange={setName} placeholder="Location name" />
      <EditableField label="Description" value={desc} onChange={setDesc} multiline placeholder="Description" />
      <EditableField label="Rules (JSON)" value={rules} onChange={setRules} multiline placeholder="{}" />
      <EditableField label="Sensory Notes (JSON)" value={sensory} onChange={setSensory} multiline placeholder="{}" />
      <div className="mb-2">
        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">Source</label>
        <select className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50" value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button onClick={() => onSave({ name, description: desc, rules: safeJsonParse(rules), sensoryNotes: safeJsonParse(sensory), source })} disabled={!name.trim()} className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-50">
          <Plus className="w-2.5 h-2.5" /> Create
        </button>
        <button onClick={onCancel} className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200">
          <X className="w-2.5 h-2.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

function CreateStyleForm({ onSave, onCancel }: { onSave: (data: { pov: string; tense: string; comps: string; sampleParagraph: string; bannedCliches: string[]; source: string }) => void; onCancel: () => void }) {
  const [pov, setPov] = useState("");
  const [tense, setTense] = useState("");
  const [comps, setComps] = useState("");
  const [sample, setSample] = useState("");
  const [cliches, setCliches] = useState("");
  const [source, setSource] = useState("authored");
  return (
    <div className="rounded-md border border-blue-500/40 bg-gray-900/80 p-2.5 mb-2">
      <EditableField label="POV" value={pov} onChange={setPov} placeholder="e.g. Third Person Limited" />
      <EditableField label="Tense" value={tense} onChange={setTense} placeholder="e.g. Past" />
      <EditableField label="Comparisons" value={comps} onChange={setComps} placeholder="e.g. Brandon Sanderson meets Ursula Le Guin" />
      <EditableField label="Sample Paragraph" value={sample} onChange={setSample} multiline placeholder="A short sample of your prose style" />
      <EditableField label="Banned Clichés (comma-separated)" value={cliches} onChange={setCliches} placeholder="suddenly, very unique" />
      <div className="mb-2">
        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">Source</label>
        <select className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50" value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button onClick={() => onSave({ pov, tense, comps, sampleParagraph: sample, bannedCliches: cliches.split(",").map((s) => s.trim()).filter(Boolean), source })} className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500">
          <Plus className="w-2.5 h-2.5" /> Create
        </button>
        <button onClick={onCancel} className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200">
          <X className="w-2.5 h-2.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

function CreateOutlineForm({ onSave, onCancel }: { onSave: (data: { chapterNumber: number; title: string; beats: Record<string, unknown>[]; source: string }) => void; onCancel: () => void }) {
  const [ch, setCh] = useState("1");
  const [title, setTitle] = useState("");
  const [beats, setBeats] = useState("[]");
  const [source, setSource] = useState("authored");
  return (
    <div className="rounded-md border border-blue-500/40 bg-gray-900/80 p-2.5 mb-2">
      <EditableField label="Chapter #" value={ch} onChange={setCh} />
      <EditableField label="Title" value={title} onChange={setTitle} placeholder="Chapter title" />
      <EditableField label="Beats (JSON array)" value={beats} onChange={setBeats} multiline placeholder="[]" />
      <div className="mb-2">
        <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-0.5">Source</label>
        <select className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50" value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button onClick={() => {
          let parsed: Record<string, unknown>[] = [];
          try { const p = JSON.parse(beats); if (Array.isArray(p)) parsed = p; } catch { /* use empty */ }
          onSave({ chapterNumber: parseInt(ch, 10) || 1, title, beats: parsed, source });
        }} className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500">
          <Plus className="w-2.5 h-2.5" /> Create
        </button>
        <button onClick={onCancel} className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200">
          <X className="w-2.5 h-2.5" /> Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function BookWritingPage() {
  const companySlug = "414c172d-7013-4728-b781-aad604d8e2d7"; // ponytail: hardcoded CID, use CompanyContext when multi-company
  const [activeBibleTab, setActiveBibleTab] = useState<StoryBibleTab>("overview");
  const [activeFilterPills, setActiveFilterPills] = useState<Set<string>>(new Set());

  // Data state
  const [booksList, setBooksList] = useState<BookData[]>([]);
  const [activeBook, setActiveBook] = useState<BookData | null>(null);
  const [characters, setCharacters] = useState<CharacterEntity[]>([]);
  const [locations, setLocations] = useState<WorldLocationEntity[]>([]);
  const [styleEntries, setStyleEntries] = useState<StyleEntity[]>([]);
  const [outlineEntries, setOutlineEntries] = useState<OutlineEntity[]>([]);
  const [loading, setLoading] = useState(true);

  // Create panel state
  const [showCreateCharacter, setShowCreateCharacter] = useState(false);
  const [showCreateLocation, setShowCreateLocation] = useState(false);
  const [showCreateStyle, setShowCreateStyle] = useState(false);
  const [showCreateOutline, setShowCreateOutline] = useState(false);

  // Chat drawer state
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Assisted mode
  const [assistedMode, setAssistedMode] = useState(false);

  // Focus mode for manuscript editor
  const [focusMode, setFocusMode] = useState(false);

  // Generate panel per-tab state (ponytail: simple booleans, not a map)
  const [showGenCharacter, setShowGenCharacter] = useState(false);
  const [showGenLocation, setShowGenLocation] = useState(false);
  const [showGenWorldRule, setShowGenWorldRule] = useState(false);
  const [showGenStyle, setShowGenStyle] = useState(false);
  const [showGenOutlineBeats, setShowGenOutlineBeats] = useState(false);

  // ── Data fetching ──────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!companySlug) return;
    setLoading(true);
    try {
      const { books: bList } = await apiFetch<{ books: BookData[] }>(
        `/companies/${companySlug}/book-studio/books`
      );
      setBooksList(bList);
      const book = bList[0] || null;
      setActiveBook(book);

      if (book) {
        const [charsRes, locsRes, styleRes, outlineRes] = await Promise.all([
          apiFetch<{ characters: CharacterEntity[] }>(
            `/companies/${companySlug}/book-studio/books/${book.id}/characters`
          ),
          apiFetch<{ "world-locations": WorldLocationEntity[] }>(
            `/companies/${companySlug}/book-studio/books/${book.id}/world-locations`
          ),
          apiFetch<{ style: StyleEntity[] }>(
            `/companies/${companySlug}/book-studio/books/${book.id}/style`
          ),
          apiFetch<{ outline: OutlineEntity[] }>(
            `/companies/${companySlug}/book-studio/books/${book.id}/outline`
          ),
        ]);
        setCharacters(charsRes.characters || []);
        setLocations(locsRes["world-locations"] || []);
        setStyleEntries(styleRes.style || []);
        setOutlineEntries(outlineRes.outline || []);
      }
    } catch (err) {
      console.error("Failed to load book studio data:", err);
    } finally {
      setLoading(false);
    }
  }, [companySlug]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── CRUD helpers ───────────────────────────────────────────────────────

  const API_PREFIX = `/companies/${companySlug}/book-studio/books/${activeBook?.id}`;

  const updateCharacter = async (id: string, data: Partial<CharacterEntity>) => {
    await apiFetch(`${API_PREFIX}/characters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, ...data } : c)));
  };

  const deleteCharacter = async (id: string) => {
    await apiFetch(`${API_PREFIX}/characters/${id}`, { method: "DELETE" });
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  };

  const createCharacter = async (data: { name: string; role: string; description: string; voiceCard: Record<string, unknown>; source: string }) => {
    const res = await apiFetch<{ character: CharacterEntity }>(`${API_PREFIX}/characters`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    setCharacters((prev) => [...prev, res.character]);
    setShowCreateCharacter(false);
  };

  const updateLocation = async (id: string, data: Partial<WorldLocationEntity>) => {
    await apiFetch(`${API_PREFIX}/world-locations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    setLocations((prev) => prev.map((l) => (l.id === id ? { ...l, ...data } : l)));
  };

  const deleteLocation = async (id: string) => {
    await apiFetch(`${API_PREFIX}/world-locations/${id}`, { method: "DELETE" });
    setLocations((prev) => prev.filter((l) => l.id !== id));
  };

  const createLocation = async (data: { name: string; description: string; rules: Record<string, unknown>; sensoryNotes: Record<string, unknown>; source: string }) => {
    const res = await apiFetch<{ "world-location": WorldLocationEntity }>(`${API_PREFIX}/world-locations`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    setLocations((prev) => [...prev, res["world-location"]]);
    setShowCreateLocation(false);
  };

  const updateStyle = async (id: string, data: Partial<StyleEntity>) => {
    await apiFetch(`${API_PREFIX}/style/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    setStyleEntries((prev) => prev.map((s) => (s.id === id ? { ...s, ...data } : s)));
  };

  const deleteStyle = async (id: string) => {
    await apiFetch(`${API_PREFIX}/style/${id}`, { method: "DELETE" });
    setStyleEntries((prev) => prev.filter((s) => s.id !== id));
  };

  const createStyle = async (data: { pov: string; tense: string; comps: string; sampleParagraph: string; bannedCliches: string[]; source: string }) => {
    const res = await apiFetch<{ "style-entry": StyleEntity }>(`${API_PREFIX}/style`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    setStyleEntries((prev) => [...prev, res["style-entry"]]);
    setShowCreateStyle(false);
  };

  const updateOutline = async (id: string, data: Partial<OutlineEntity>) => {
    await apiFetch(`${API_PREFIX}/outline/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    setOutlineEntries((prev) => prev.map((o) => (o.id === id ? { ...o, ...data } : o)));
  };

  const deleteOutline = async (id: string) => {
    await apiFetch(`${API_PREFIX}/outline/${id}`, { method: "DELETE" });
    setOutlineEntries((prev) => prev.filter((o) => o.id !== id));
  };

  const createOutline = async (data: { chapterNumber: number; title: string; beats: Record<string, unknown>[]; source: string }) => {
    const res = await apiFetch<{ "outline-entry": OutlineEntity }>(`${API_PREFIX}/outline`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    setOutlineEntries((prev) => [...prev, res["outline-entry"]]);
    setShowCreateOutline(false);
  };

  // ── Derived ────────────────────────────────────────────────────────────

  const togglePill = (pill: string) => {
    setActiveFilterPills((prev) => {
      const next = new Set(prev);
      if (next.has(pill)) next.delete(pill);
      else next.add(pill);
      return next;
    });
  };

  const filteredNotes =
    activeFilterPills.size === 0
      ? REVIEW_NOTES
      : REVIEW_NOTES.filter((n) => activeFilterPills.has(n.category));

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary>
      <div className="h-full flex flex-col bg-gray-950 text-gray-100">
      {/* ── Top Bar ────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-gray-800 px-5 py-3 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-xs font-bold tracking-[0.2em] text-gray-500 uppercase">
            PAPERCLIP
          </span>
          <span className="text-gray-700">/</span>
          <h1 className="text-sm font-semibold text-gray-100">Book Studio</h1>
          <span className="text-gray-700">·</span>
          <span className="text-sm text-gray-400 italic">
            {activeBook?.title || (loading ? "Loading..." : "No book selected")}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* ── Mode toggle: Manual | Assisted | Autopilot ── */}
          <div className="flex items-center rounded-md border border-gray-700 text-xs">
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-l-md px-3 py-1.5 border-r border-gray-700",
                !assistedMode ? "bg-blue-600/20 text-blue-300" : "text-gray-400 hover:text-gray-200",
              )}
              onClick={() => setAssistedMode(false)}
            >
              <Pen className="w-3 h-3" />
              Manual
            </button>
            <button
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 border-r border-gray-700",
                assistedMode ? "bg-purple-600/20 text-purple-300" : "text-gray-400 hover:text-gray-200",
              )}
              onClick={() => setAssistedMode(true)}
            >
              <Sparkles className="w-3 h-3" />
              Assisted
            </button>
            <button
              className="flex items-center gap-1.5 rounded-r-md px-3 py-1.5 text-gray-600 cursor-not-allowed relative"
              disabled
              title="Coming soon"
            >
              <Sparkles className="w-3 h-3" />
              Autopilot
              <span className="absolute -top-1.5 -right-1 rounded bg-gray-700 px-1 py-0 text-[8px] text-gray-400 font-medium">Soon</span>
            </button>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-400">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            $24.50 / $50.00
          </div>
          <button className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600 flex items-center gap-1.5">
            <Pause className="w-3 h-3" /> Pause
          </button>
          <button className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600 flex items-center gap-1.5">
            <Play className="w-3 h-3" /> Steer
          </button>
          <button className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600 flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3" /> Review
          </button>
          <button
            onClick={() => setIsChatOpen(true)}
            className="rounded-md border border-purple-700 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-200 hover:border-purple-500 flex items-center gap-1.5"
          >
            <Sparkles className="w-3 h-3" /> Brainstorm
          </button>
          <button className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 flex items-center gap-1.5">
            <Download className="w-3 h-3" /> Export
          </button>
        </div>
      </header>

      {/* ── Assisted Mode Suggestion Panel ── */}
      {assistedMode && activeBook && (
        <AssistedModePanel
          bookId={activeBook.id}
          companySlug={companySlug}
        />
      )}

      {/* ── Three-Pane Layout ──────────────────────────────────────────── */}
      <div className={cn("flex-1 min-h-0", focusMode ? "" : "grid grid-cols-[1fr_2fr_1fr]")}>
        {/* LEFT PANE — Story Bible */}
        {!focusMode && (
        <aside className="flex flex-col border-r border-gray-800 min-h-0">
          {/* ── Readiness Bar ──────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-800 bg-gray-900/70 shrink-0 text-[10px]">
            <div className={cn("flex items-center gap-1", characters.length >= READINESS_TARGETS.characters ? "text-green-400" : "text-yellow-400")}>
              <User className="w-3 h-3" />
              <span>Characters {characters.length}/{READINESS_TARGETS.characters}</span>
            </div>
            <span className="text-gray-700">|</span>
            <div className={cn("flex items-center gap-1", locations.length >= READINESS_TARGETS.locations ? "text-green-400" : "text-yellow-400")}>
              <MapPin className="w-3 h-3" />
              <span>Locations {locations.length}/{READINESS_TARGETS.locations}</span>
            </div>
            <span className="text-gray-700">|</span>
            <div className={cn("flex items-center gap-1", styleEntries.length >= 1 ? "text-green-400" : "text-red-400")}>
              <Palette className="w-3 h-3" />
              <span>Style {styleEntries.length >= 1 ? "✓" : "✗"}</span>
            </div>
            <span className="text-gray-700">|</span>
            <div className={cn("flex items-center gap-1", outlineEntries.length >= READINESS_TARGETS.outline ? "text-green-400" : "text-yellow-400")}>
              <List className="w-3 h-3" />
              <span>Outline {outlineEntries.length}/{READINESS_TARGETS.outline}</span>
            </div>
          </div>
          <div className="flex border-b border-gray-800 shrink-0 overflow-x-auto">
            {BIBLE_TABS.map((tab) => (
              <button
                key={tab.id}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium whitespace-nowrap border-b-2 transition-colors",
                  activeBibleTab === tab.id
                    ? "border-blue-500 text-blue-300"
                    : "border-transparent text-gray-500 hover:text-gray-300",
                )}
                onClick={() => setActiveBibleTab(tab.id)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Overview Tab */}
            {activeBibleTab === "overview" && (
              <div className="p-4 space-y-3">
                <div className="rounded-md border border-gray-800 bg-gray-900/50 p-3">
                  <h3 className="text-sm font-semibold text-gray-200 mb-1">
                    {activeBook?.title || "Untitled Book"}
                  </h3>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    {loading ? "Loading..." : activeBook ? "A writing project in Book Studio." : "Create a book to get started."}
                  </p>
                </div>
              </div>
            )}

            {/* Characters Tab */}
            {activeBibleTab === "characters" && (
              <div>
                {showCreateCharacter && (
                  <div className="px-4 pt-3">
                    <CreateCharacterForm
                      onSave={createCharacter}
                      onCancel={() => setShowCreateCharacter(false)}
                    />
                  </div>
                )}
                <div className="px-4 py-2.5 border-b border-gray-800">
                  <CollapsibleSection title="Characters" count={characters.length}>
                    {characters.length === 0 ? (
                      <div className="text-xs text-gray-500 italic py-2">No characters yet. Add your first one.</div>
                    ) : (
                      characters.map((c) => (
                        <div key={c.id} className="relative">
                          <CharacterCardComponent char={c} onUpdate={updateCharacter} onDelete={deleteCharacter} />
                        </div>
                      ))
                    )}
                  </CollapsibleSection>
                </div>
                <div className="px-4 pb-4 pt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowCreateCharacter(true)}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5"
                    >
                      <Plus className="w-3 h-3" /> Add Character
                    </button>
                    <button
                      onClick={() => setShowGenCharacter(!showGenCharacter)}
                      className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-200 px-3 py-1.5"
                    >
                      <Sparkles className="w-3 h-3" /> Generate with AI
                    </button>
                  </div>
                  {showGenCharacter && activeBook && (
                    <div className="px-1">
                      <GenerateDraftPanel
                        entityType="character"
                        bookId={activeBook.id}
                        companySlug={companySlug}
                        onAccept={(draft) => {
                          createCharacter({
                            name: (draft.name as string) || "New Character",
                            role: (draft.role as string) || "",
                            description: (draft.description as string) || "",
                            voiceCard: (draft.voiceCard as Record<string, unknown>) || {},
                            source: "co_created",
                          });
                          setShowGenCharacter(false);
                        }}
                        onDiscard={() => setShowGenCharacter(false)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* World & Locations Tab */}
            {activeBibleTab === "world" && (
              <div>
                {showCreateLocation && (
                  <div className="px-4 pt-3">
                    <CreateLocationForm
                      onSave={createLocation}
                      onCancel={() => setShowCreateLocation(false)}
                    />
                  </div>
                )}
                <div className="px-4 py-2.5 border-b border-gray-800">
                  <CollapsibleSection title="Locations" count={locations.length}>
                    {locations.length === 0 ? (
                      <div className="text-xs text-gray-500 italic py-2">No locations yet. Add your first one.</div>
                    ) : (
                      locations.map((l) => (
                        <div key={l.id} className="relative">
                          <LocationCardComponent loc={l} onUpdate={updateLocation} onDelete={deleteLocation} />
                        </div>
                      ))
                    )}
                  </CollapsibleSection>
                </div>
                <div className="px-4 pb-4 pt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowCreateLocation(true)}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5"
                    >
                      <Plus className="w-3 h-3" /> Add Location
                    </button>
                    <button
                      onClick={() => setShowGenLocation(!showGenLocation)}
                      className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-200 px-3 py-1.5"
                    >
                      <Sparkles className="w-3 h-3" /> Generate with AI
                    </button>
                  </div>
                  {showGenLocation && activeBook && (
                    <div className="px-1">
                      <GenerateDraftPanel
                        entityType="location"
                        bookId={activeBook.id}
                        companySlug={companySlug}
                        onAccept={(draft) => {
                          createLocation({
                            name: (draft.name as string) || "New Location",
                            description: (draft.description as string) || "",
                            rules: (draft.rules as Record<string, unknown>) || {},
                            sensoryNotes: (draft.sensoryNotes as Record<string, unknown>) || {},
                            source: "co_created",
                          });
                          setShowGenLocation(false);
                        }}
                        onDiscard={() => setShowGenLocation(false)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Style Tab */}
            {activeBibleTab === "style" && (
              <div>
                {showCreateStyle && (
                  <div className="px-4 pt-3">
                    <CreateStyleForm
                      onSave={createStyle}
                      onCancel={() => setShowCreateStyle(false)}
                    />
                  </div>
                )}
                <div className="px-4 py-2.5 border-b border-gray-800">
                  <CollapsibleSection title="Style Entries" count={styleEntries.length}>
                    {styleEntries.length === 0 ? (
                      <div className="text-xs text-gray-500 italic py-2">No style entries yet. Add your first one.</div>
                    ) : (
                      styleEntries.map((s) => (
                        <div key={s.id} className="relative">
                          <StyleCardComponent entry={s} onUpdate={updateStyle} onDelete={deleteStyle} />
                        </div>
                      ))
                    )}
                  </CollapsibleSection>
                </div>
                <div className="px-4 pb-4 pt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowCreateStyle(true)}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5"
                    >
                      <Plus className="w-3 h-3" /> Add Style Entry
                    </button>
                    <button
                      onClick={() => setShowGenStyle(!showGenStyle)}
                      className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-200 px-3 py-1.5"
                    >
                      <Sparkles className="w-3 h-3" /> Generate with AI
                    </button>
                  </div>
                  {showGenStyle && activeBook && (
                    <div className="px-1">
                      <GenerateDraftPanel
                        entityType="style"
                        bookId={activeBook.id}
                        companySlug={companySlug}
                        onAccept={(draft) => {
                          createStyle({
                            pov: (draft.pov as string) || "",
                            tense: (draft.tense as string) || "",
                            comps: (draft.comps as string) || "",
                            sampleParagraph: (draft.sampleParagraph as string) || "",
                            bannedCliches: Array.isArray(draft.bannedCliches) ? (draft.bannedCliches as string[]) : [],
                            source: "co_created",
                          });
                          setShowGenStyle(false);
                        }}
                        onDiscard={() => setShowGenStyle(false)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Outline Tab */}
            {activeBibleTab === "outline" && (
              <div>
                {showCreateOutline && (
                  <div className="px-4 pt-3">
                    <CreateOutlineForm
                      onSave={createOutline}
                      onCancel={() => setShowCreateOutline(false)}
                    />
                  </div>
                )}
                <div className="px-4 py-2.5 border-b border-gray-800">
                  <CollapsibleSection title="Chapters" count={outlineEntries.length}>
                    {outlineEntries.length === 0 ? (
                      <div className="text-xs text-gray-500 italic py-2">No outline entries yet. Add your first chapter.</div>
                    ) : (
                      outlineEntries.map((o) => (
                        <div key={o.id} className="relative">
                          <OutlineCardComponent entry={o} onUpdate={updateOutline} onDelete={deleteOutline} />
                        </div>
                      ))
                    )}
                  </CollapsibleSection>
                </div>
                <div className="px-4 pb-4 pt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowCreateOutline(true)}
                      className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5"
                    >
                      <Plus className="w-3 h-3" /> Add Chapter
                    </button>
                    <button
                      onClick={() => setShowGenOutlineBeats(!showGenOutlineBeats)}
                      className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-200 px-3 py-1.5"
                    >
                      <Sparkles className="w-3 h-3" /> Generate with AI
                    </button>
                  </div>
                  {showGenOutlineBeats && activeBook && (
                    <div className="px-1">
                      <GenerateDraftPanel
                        entityType="outline-beats"
                        bookId={activeBook.id}
                        companySlug={companySlug}
                        onAccept={(draft) => {
                          createOutline({
                            chapterNumber: (draft.chapterNumber as number) || 1,
                            title: (draft.title as string) || "New Chapter",
                            beats: Array.isArray(draft.beats) ? (draft.beats as Record<string, unknown>[]) : [],
                            source: "co_created",
                          });
                          setShowGenOutlineBeats(false);
                        }}
                        onDiscard={() => setShowGenOutlineBeats(false)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Manuscript Tab */}
            {activeBibleTab === "manuscript" && (
              <div className="flex items-center justify-center h-full p-8">
                <div className="text-center">
                  <div className="text-2xl mb-3 opacity-40">📄</div>
                  <p className="text-sm text-gray-400">{outlineEntries.length} chapter{outlineEntries.length !== 1 ? "s" : ""} outlined</p>
                  <p className="text-xs text-gray-600 mt-1">Select a chapter in the editor</p>
                </div>
              </div>
            )}
          </div>
        </aside>
        )}

        {/* CENTER PANE — Manuscript */}
        <div className="flex flex-col min-h-0">
          <ManuscriptEditor
            bookId={activeBook?.id ?? ""}
            companySlug={companySlug}
            outlineEntries={outlineEntries}
            focusMode={focusMode}
            onToggleFocus={() => setFocusMode(!focusMode)}
          />
        </div>

        {/* RIGHT PANE — Review Notes */}
        {!focusMode && (
        <aside className="flex flex-col border-l border-gray-800 min-h-0">
          <div className="px-4 py-3 border-b border-gray-800 shrink-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Review Notes
            </h3>
          </div>

          <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-gray-800 shrink-0">
            {CATEGORY_PILLS.map((pill) => {
              const active = activeFilterPills.has(pill);
              const colorClasses = CATEGORY_COLORS[pill];
              return (
                <button
                  key={pill}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
                    active
                      ? colorClasses
                      : "border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600",
                  )}
                  onClick={() => togglePill(pill)}
                >
                  {pill}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredNotes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="text-2xl mb-2 opacity-30">✅</div>
                <p className="text-xs text-gray-500">No matching notes</p>
                <p className="text-[10px] text-gray-600 mt-1">Try selecting a different filter</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-800/50">
                {filteredNotes.map((note) => (
                  <div key={note.id} className="px-4 py-3 hover:bg-gray-900/30 group">
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={cn(
                          "inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0 mt-0.5",
                          CATEGORY_COLORS[note.category],
                        )}
                      >
                        {note.category}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-gray-200 mt-1.5">{note.label}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{note.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
        )}
      </div>

      {/* BOTTOM BAR */}
      <footer className="flex items-center gap-4 border-t border-gray-800 px-5 py-3 shrink-0 bg-gray-950/80 backdrop-blur-sm">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 shrink-0">
          Rewrite Proposal
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-300 truncate">
            <span className="text-gray-600 line-through mr-2">Mara watched it spiral down through the amber light</span>
            <span className="text-green-400">Mara watched the petal spiral through amber light</span>
          </p>
          <p className="text-[10px] text-gray-600 mt-0.5">Suggested: tighter prose, active voice, removes redundant "down"</p>
        </div>
        <button className="rounded-md bg-green-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-600 flex items-center gap-1.5">
          <Check className="w-3 h-3" /> Accept
        </button>
        <button className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600">
          Reject
        </button>
        <button className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-600 flex items-center gap-1.5">
          <Pen className="w-3 h-3" /> Edit
        </button>
      </footer>

      {/* Chat Drawer Overlay */}
      {activeBook && (
        <ChatDrawer
          bookId={activeBook.id}
          companySlug={companySlug}
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          activeBookTitle={activeBook.title}
        />
      )}
      </div>
    </ErrorBoundary>
  );
}

export default BookWritingPage;
