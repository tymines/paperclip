/**
 * Book Studio — locked three-pane layout shell for AI-assisted book authoring.
 *
 * Left pane: Story Bible (Overview, Characters, World & Locations, Style, Outline, Manuscript)
 * Center pane: Manuscript editor with chapter navigation and toolbar
 * Right pane: Review Notes with category filters
 *
 * Layout: grid-cols-[1fr_2fr_1fr] (~25/50/25 split), non-resizable, full-height
 */

import { useState, useEffect, useCallback, useRef } from "react";
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
  AlertTriangle,
  Loader2,
  FileDown,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GenerateDraftPanel } from "@/components/book-studio/GenerateDraftPanel";
import { ChatDrawer } from "@/components/book-studio/ChatDrawer";
import { ErrorBoundary } from "@/components/book-studio/ErrorBoundary";
import { ManuscriptEditor } from "@/components/book-studio/ManuscriptEditor";
import { AssistedModePanel } from "@/components/book-studio/AssistedModePanel";
import { ReviewNotesPanel } from "@/components/book-studio/ReviewNotesPanel";
import { BookMediaPanel } from "@/components/book-studio/BookMediaPanel";

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
  metadata?: Record<string, unknown> | null;
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
  metadata?: Record<string, unknown> | null;
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
  metadata?: Record<string, unknown> | null;
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
  metadata?: Record<string, unknown> | null;
}

// ── Review Notes — now handled by ReviewNotesPanel component ─────────────

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

// ── CameraButton helper ────────────────────────────────────────────────────────

function CameraButton({ onClick, loading, title }: { onClick: () => void; loading: boolean; title: string }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={loading ? "rounded p-1 text-blue-400" : "rounded p-1 text-gray-500 hover:text-blue-400"}
      title={loading ? "Generating…" : title}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
    </button>
  );
}

async function generateBookImage(
  companySlug: string,
  endpointType: string,
  prompt: string,
  bookSlug: string,
  apiFetch: (url: string, opts?: RequestInit) => Promise<unknown>,
): Promise<string | null> {
  const prefix = `/companies/${companySlug}/book-studio/generate`;
  // Submit
  const res = await apiFetch(`${prefix}/${endpointType}`, {
    method: "POST",
    body: JSON.stringify({ prompt, bookSlug, aspectRatio: "1:1" }),
  }) as { predictionId: string; status: string };
  if (!res.predictionId) return null;
  // Poll (max 60s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await apiFetch(`${prefix}/poll/${res.predictionId}`) as { status: string; imageUrl?: string };
    if (poll.status === "completed" && poll.imageUrl) return poll.imageUrl;
    if (poll.status === "failed") return null;
  }
  return null;
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
  bookId: string;
  companySlug: string;
  bookSlug: string;
  onUpdate: (id: string, data: Partial<CharacterEntity>) => void;
  onDelete: (id: string) => void;
}

function CharacterCardComponent({ char, bookId, companySlug, bookSlug, onUpdate, onDelete }: CharacterCardProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(char.name);
  const [editRole, setEditRole] = useState(char.role);
  const [editDesc, setEditDesc] = useState(char.description);
  const [editVoiceCard, setEditVoiceCard] = useState(safeJsonStringify(char.voiceCard));
  const [editSource, setEditSource] = useState(char.source || "authored");
  const [deleting, setDeleting] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(false);

  const handleImageGenerate = async (endpointType: string, prompt: string) => {
    setImageGenerating(true);
    try {
      const imageUrl = await generateBookImage(companySlug, endpointType, prompt, bookSlug, apiFetch as (url: string, opts?: RequestInit) => Promise<unknown>);
      if (imageUrl) {
        onUpdate(char.id, { metadata: { ...((char.metadata as Record<string, unknown>) || {}), imageUrl } });
        // Show the image inline via a re-render (card reads char.metadata.imageUrl)
      }
    } catch { /* noop */ }
    setImageGenerating(false);
  };

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
        <CameraButton
          onClick={() => handleImageGenerate("image", `Character portrait of ${char.name}${char.role ? `, ${char.role}` : ""}${char.description ? `. ${char.description}` : ""}`)}
          loading={imageGenerating}
          title={`Generate image for ${char.name}`}
        />
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
  bookId: string;
  companySlug: string;
  bookSlug: string;
  onUpdate: (id: string, data: Partial<WorldLocationEntity>) => void;
  onDelete: (id: string) => void;
}

function LocationCardComponent({ loc, bookId, companySlug, bookSlug, onUpdate, onDelete }: LocationCardProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(loc.name);
  const [editDesc, setEditDesc] = useState(loc.description);
  const [editRules, setEditRules] = useState(safeJsonStringify(loc.rules));
  const [editSensory, setEditSensory] = useState(safeJsonStringify(loc.sensoryNotes));
  const [editSource, setEditSource] = useState(loc.source || "authored");
  const [deleting, setDeleting] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(false);

  const handleImageGenerate = async (endpointType: string, prompt: string) => {
    setImageGenerating(true);
    try {
      const imageUrl = await generateBookImage(companySlug, endpointType, prompt, bookSlug, apiFetch as (url: string, opts?: RequestInit) => Promise<unknown>);
      if (imageUrl) {
        onUpdate(loc.id, { metadata: { ...((loc.metadata as Record<string, unknown>) || {}), imageUrl } });
      }
    } catch { /* noop */ }
    setImageGenerating(false);
  };

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
        <CameraButton
          onClick={() => handleImageGenerate("image", `Scene of ${loc.name}${loc.description ? `: ${loc.description.slice(0, 80)}` : ""}`)}
          loading={imageGenerating}
          title={`Generate image for ${loc.name}`}
        />
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
  bookId: string;
  companySlug: string;
  bookSlug: string;
  onUpdate: (id: string, data: Partial<StyleEntity>) => void;
  onDelete: (id: string) => void;
}

function StyleCardComponent({ entry, bookId, companySlug, bookSlug, onUpdate, onDelete }: StyleCardProps) {
  const [editing, setEditing] = useState(false);
  const [editPov, setEditPov] = useState(entry.pov);
  const [editTense, setEditTense] = useState(entry.tense);
  const [editComps, setEditComps] = useState(entry.comps);
  const [editSample, setEditSample] = useState(entry.sampleParagraph);
  const [editCliches, setEditCliches] = useState((entry.bannedCliches || []).join(", "));
  const [editSource, setEditSource] = useState(entry.source || "authored");
  const [deleting, setDeleting] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(false);

  const handleImageGenerate = async (endpointType: string, prompt: string) => {
    setImageGenerating(true);
    try {
      const imageUrl = await generateBookImage(companySlug, endpointType, prompt, bookSlug, apiFetch as (url: string, opts?: RequestInit) => Promise<unknown>);
      if (imageUrl) {
        onUpdate(entry.id, { metadata: { ...((entry.metadata as Record<string, unknown>) || {}), imageUrl } });
      }
    } catch { /* noop */ }
    setImageGenerating(false);
  };

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
        <CameraButton
          onClick={() => handleImageGenerate("cover", `Book cover: ${entry.pov || "N/A"} ${entry.tense || ""}${entry.comps ? `, comps: ${entry.comps}` : ""}`)}
          loading={imageGenerating}
          title="Generate book cover"
        />
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
  bookId: string;
  companySlug: string;
  bookSlug: string;
  onUpdate: (id: string, data: Partial<OutlineEntity>) => void;
  onDelete: (id: string) => void;
}

function OutlineCardComponent({ entry, bookId, companySlug, bookSlug, onUpdate, onDelete }: OutlineCardProps) {
  const [editing, setEditing] = useState(false);
  const [editCh, setEditCh] = useState(String(entry.chapterNumber));
  const [editTitle, setEditTitle] = useState(entry.title);
  const [editBeats, setEditBeats] = useState(JSON.stringify(entry.beats || [], null, 2));
  const [editSource, setEditSource] = useState(entry.source || "authored");
  const [deleting, setDeleting] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(false);

  const handleImageGenerate = async (endpointType: string, prompt: string) => {
    setImageGenerating(true);
    try {
      const imageUrl = await generateBookImage(companySlug, endpointType, prompt, bookSlug, apiFetch as (url: string, opts?: RequestInit) => Promise<unknown>);
      if (imageUrl) {
        onUpdate(entry.id, { metadata: { ...((entry.metadata as Record<string, unknown>) || {}), imageUrl } });
      }
    } catch { /* noop */ }
    setImageGenerating(false);
  };

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
        <CameraButton
          onClick={() => handleImageGenerate("scene-illustration", `Scene illustration for chapter ${entry.chapterNumber}: ${entry.title || "Untitled"}${entry.beats && Array.isArray(entry.beats) && entry.beats.length > 0 ? `. Beats: ${JSON.stringify((entry.beats as Record<string, unknown>[]).slice(0, 2))}` : ""}`)}
          loading={imageGenerating}
          title={`Generate illustration for Ch.${entry.chapterNumber}`}
        />
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

// ── Overview Editor (inline, no separate file) ───────────────────────────

function OverviewEditor({
  book,
  loading,
  onUpdate,
}: {
  book: BookData | null;
  loading: boolean;
  onUpdate: (data: { title?: string; metadata?: Record<string, unknown> }) => void;
}) {
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Latch initial values from book on first load
  if (book && !initialized) {
    setEditTitle(book.title || "");
    setEditDesc((book.metadata?.description as string) || "");
    setInitialized(true);
  }

  // Reset when book changes
  useEffect(() => {
    if (book) {
      setEditTitle(book.title || "");
      setEditDesc((book.metadata?.description as string) || "");
      setInitialized(true);
    }
  }, [book?.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({ title: editTitle, metadata: { description: editDesc } });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4 text-xs text-gray-500">Loading...</div>;
  if (!book) return <div className="p-4 text-xs text-gray-500">Create a book to get started.</div>;

  return (
    <div className="p-4 space-y-3">
      <div className="rounded-md border border-gray-800 bg-gray-900/50 p-3 space-y-3">
        <EditableField label="Title" value={editTitle} onChange={setEditTitle} />
        <EditableField
          label="Description / Premise"
          value={editDesc}
          onChange={setEditDesc}
          multiline
          placeholder="What's this book about?"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function BookWritingPage() {
  const companySlug = "414c172d-7013-4728-b781-aad604d8e2d7"; // ponytail: hardcoded CID, use CompanyContext when multi-company
  const [activeBibleTab, setActiveBibleTab] = useState<StoryBibleTab>("overview");
  const [jumpToChapter, setJumpToChapter] = useState<number | null>(null);
  const [highlightRange, setHighlightRange] = useState<{ chapterNumber: number; startOffset: number; endOffset: number } | null>(null);

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

  // Spend tracking (from book metadata)
  const spendThisMonth = (activeBook?.metadata?.spendThisMonth as number) || 0;
  const spendBudget = (activeBook?.metadata?.spendBudget as number) || 50.0;
  const spendPercent = spendBudget > 0 ? (spendThisMonth / spendBudget) * 100 : 0;

  // Chat drawer state
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Assisted mode
  const [assistedMode, setAssistedMode] = useState(false);

  // Focus mode for manuscript editor
  const [focusMode, setFocusMode] = useState(false);

  // Autopilot state
  const [autopilotMode, setAutopilotMode] = useState(false);
  const [autopilotState, setAutopilotState] = useState<"idle" | "assembling" | "drafting" | "reviewing" | "revising" | "advancing" | "paused">("idle");
  const [autopilotPaused, setAutopilotPaused] = useState(false);
  const [showGuidanceInput, setShowGuidanceInput] = useState(false);
  const [guidanceText, setGuidanceText] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [autopilotPhase, setAutopilotPhase] = useState("");
  const [autopilotCurrentChapter, setAutopilotCurrentChapter] = useState(0);
  const [autopilotTotalChapters, setAutopilotTotalChapters] = useState(0);

  // Generate panel per-tab state (ponytail: simple booleans, not a map)
  const [showGenCharacter, setShowGenCharacter] = useState(false);
  const [showGenLocation, setShowGenLocation] = useState(false);
  const [showGenWorldRule, setShowGenWorldRule] = useState(false);
  const [showGenStyle, setShowGenStyle] = useState(false);
  const [showGenOutlineBeats, setShowGenOutlineBeats] = useState(false);

  // Export modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

  // Consistency check
  const [checkingConsistency, setCheckingConsistency] = useState(false);

  // Narration state
  const [narrating, setNarrating] = useState(false);
  const [narrateEstimate, setNarrateEstimate] = useState<{ chapters: number; totalChars: number; estimatedCostUsd: number; estimatedDurationSec: number } | null>(null);
  const [narrateComplete, setNarrateComplete] = useState<{ exportId: string; combinedPath: string } | null>(null);
  const [consistencyFindings, setConsistencyFindings] = useState<Array<{
    severity: string; category: string; description: string; suggestion: string;
  }> | null>(null);

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
    const res = await apiFetch<CharacterEntity>(`${API_PREFIX}/characters`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    setCharacters((prev) => [...prev, res]);
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
    const res = await apiFetch<WorldLocationEntity>(`${API_PREFIX}/world-locations`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    setLocations((prev) => [...prev, res]);
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
    const res = await apiFetch<StyleEntity>(`${API_PREFIX}/style`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    setStyleEntries((prev) => [...prev, res]);
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

  const updateBook = async (data: { title?: string; metadata?: Record<string, unknown> }) => {
    if (!activeBook) return;
    const res = await apiFetch<{ book: BookData }>(
      `/companies/${companySlug}/book-studio/books/${activeBook.id}`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
    setActiveBook(res.book);
    setBooksList((prev) => prev.map((b) => (b.id === res.book.id ? res.book : b)));
  };

  // ── Chat-to-draft state ──────────────────────────────────────────────────
  const [chatDraft, setChatDraft] = useState<{ entityType: string; data: Record<string, unknown> } | null>(null);
  const [showChatDraftPanel, setShowChatDraftPanel] = useState(false);

  // ── Autopilot handlers ───────────────────────────────────────────────────

  const getAutopilotBase = () => {
    if (!activeBook) return "";
    return `/companies/${companySlug}/book-studio/books/${activeBook.id}/autopilot`;
  };

  const handleAutopilotToggle = async () => {
    if (!activeBook) return;
    if (autopilotMode) {
      // Turning OFF: pause, clear polling, reset state
      setAutopilotMode(false);
      setAssistedMode(false);
      try {
        await apiFetch(`${getAutopilotBase()}/pause`, { method: "POST" });
      } catch (err) {
        console.error("Failed to pause autopilot:", err);
      }
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setAutopilotState("idle");
      setAutopilotPaused(false);
      setAutopilotPhase("");
      setAutopilotCurrentChapter(0);
      setAutopilotTotalChapters(0);
    } else {
      // Turning ON: start loop, begin polling
      setAutopilotMode(true);
      setAssistedMode(false);
      try {
        const res = await apiFetch<{ autopilot: { status: string; phase: string; paused: boolean } }>(
          `${getAutopilotBase()}/start`,
          { method: "POST", body: JSON.stringify({ budgetCents: 500, iterationCapPerChapter: 3 }) },
        );
        if (res.autopilot) {
          setAutopilotState(res.autopilot.status as "assembling" | "drafting" | "reviewing" | "revising" | "advancing" | "paused");
          setAutopilotPhase(res.autopilot.phase || "");
          setAutopilotPaused(res.autopilot.paused || false);
        }
      } catch (err) {
        console.error("Failed to start autopilot:", err);
        setAutopilotMode(false);
        return;
      }
      // Start polling every 5s
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await apiFetch<{ autopilot: { status: string; phase: string; currentChapter: number; totalChapters: number; paused: boolean } }>(
            `${getAutopilotBase()}/status`,
          );
          if (statusRes.autopilot) {
            setAutopilotState(statusRes.autopilot.status as any);
            setAutopilotPhase(statusRes.autopilot.phase || "");
            setAutopilotCurrentChapter(statusRes.autopilot.currentChapter || 0);
            setAutopilotTotalChapters(statusRes.autopilot.totalChapters || 0);
            setAutopilotPaused(statusRes.autopilot.paused || false);
          }
        } catch {
          // Silently handle poll errors
        }
      }, 5000);
    }
  };

  const handleAutopilotPauseResume = async () => {
    if (!activeBook) return;
    try {
      if (autopilotPaused) {
        const res = await apiFetch<{ autopilot: { status: string; paused: boolean } }>(
          `${getAutopilotBase()}/resume`,
          { method: "POST" },
        );
        if (res.autopilot) {
          setAutopilotState(res.autopilot.status as any);
          setAutopilotPaused(res.autopilot.paused || false);
        }
      } else {
        const res = await apiFetch<{ autopilot: { status: string; paused: boolean } }>(
          `${getAutopilotBase()}/pause`,
          { method: "POST" },
        );
        if (res.autopilot) {
          setAutopilotState(res.autopilot.status as any);
          setAutopilotPaused(res.autopilot.paused || false);
        }
      }
    } catch (err) {
      console.error("Failed to pause/resume autopilot:", err);
    }
  };

  const handleAutopilotSteer = async () => {
    if (!activeBook || !guidanceText.trim()) return;
    try {
      await apiFetch(`${getAutopilotBase()}/steer`, {
        method: "POST",
        body: JSON.stringify({ guidance: guidanceText.trim() }),
      });
      setShowGuidanceInput(false);
      setGuidanceText("");
    } catch (err) {
      console.error("Failed to steer autopilot:", err);
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // ── Export handlers ──────────────────────────────────────────────────────

  const handleNarrateEstimate = async () => {
    if (!activeBook) return;
    setNarrating(true);
    try {
      const res = await apiFetch<{ estimate: { chapters: number; totalChars: number; estimatedCostUsd: number; estimatedDurationSec: number }; requiresConfirm: boolean }>(
        `/companies/${companySlug}/book-studio/books/${activeBook.id}/narrate`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (res.estimate) setNarrateEstimate(res.estimate);
    } catch { /* handled by UI */ }
    setNarrating(false);
  };

  const handleNarrateConfirm = async () => {
    if (!activeBook) return;
    setNarrating(true);
    setNarrateEstimate(null);
    try {
      const res = await apiFetch<{ narration: { id: string; outputPath: string; metadata: Record<string, unknown> } }>(
        `/companies/${companySlug}/book-studio/books/${activeBook.id}/narrate`,
        { method: "POST", body: JSON.stringify({ confirm: true }) },
      );
      const slug = activeBook.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "";
      setNarrateComplete({ exportId: res.narration.id, combinedPath: `/companies/${companySlug}/book-studio/narration-audio/${slug}/${res.narration.id}/combined.mp3` });
    } catch { /* handled by UI */ }
    setNarrating(false);
  };

  const handleExportMarkdown = async () => {
    if (!activeBook) return;
    setExportingFormat("markdown");
    try {
      const res = await fetch(
        `/api/companies/${companySlug}/book-studio/books/${activeBook.id}/export/markdown`,
      );
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeBook.slug || "book"}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Markdown export failed:", err);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleCheckConsistency = async () => {
    if (!activeBook) return;
    setCheckingConsistency(true);
    setConsistencyFindings(null);
    try {
      const res = await fetch(
        `/api/companies/${companySlug}/book-studio/books/${activeBook.id}/check-consistency`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Check failed (${res.status})`);
      setConsistencyFindings(data.findings || []);
    } catch (err) {
      console.error("Consistency check failed:", err);
      setConsistencyFindings([{ severity: "error", category: "System", description: String(err), suggestion: "Try again later" }]);
    } finally {
      setCheckingConsistency(false);
    }
  };

  // ── Severity badge colors ───────────────────────────────────────────────

  const severityColors: Record<string, string> = {
    error: "bg-red-500/20 text-red-300 border-red-500/40",
    warning: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    info: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  };

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
              className={cn(
                "flex items-center gap-1.5 rounded-r-md px-3 py-1.5 relative",
                autopilotMode ? "bg-green-600/20 text-green-300" : "text-gray-400 hover:text-gray-200",
              )}
              onClick={handleAutopilotToggle}
              title={autopilotMode ? "Autopilot active — click to disable" : "Enable Autopilot mode"}
            >
              <Sparkles className="w-3 h-3" />
              Autopilot
              {autopilotMode && autopilotState !== "idle" && (
                <span className="absolute -top-1.5 -right-1 rounded bg-green-600 px-1 py-0 text-[8px] text-white font-medium animate-pulse">Live</span>
              )}
            </button>
          </div>
          {/* Autopilot status display */}
          {autopilotMode && autopilotState !== "idle" && (
            <span className="text-[11px] text-green-400/80 bg-green-600/10 rounded-md px-2 py-1 border border-green-700/30">
              {autopilotPaused ? (
                "⏸ Autopilot: Paused"
              ) : (
                <>Autopilot: {autopilotPhase || autopilotState}{autopilotCurrentChapter > 0 ? ` — Ch.${autopilotCurrentChapter}/${autopilotTotalChapters || "?"}` : ""}</>
              )}
            </span>
          )}
          <div className="flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-400">
            <span className={cn("inline-block h-2 w-2 rounded-full", (spendPercent ?? 0) >= 80 ? "bg-red-500" : (spendPercent ?? 0) >= 50 ? "bg-yellow-500" : "bg-green-500")} />
            ${spendThisMonth.toFixed(2)} / ${spendBudget.toFixed(2)}
          </div>
          <button
            onClick={handleAutopilotPauseResume}
            disabled={!autopilotMode}
            className={cn("rounded-md border px-3 py-1.5 text-xs flex items-center gap-1.5",
              autopilotMode ? "border-amber-700 text-amber-400 hover:text-amber-200" : "border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600",
            )}
            title={autopilotMode ? "Pause/Resume autopilot" : "Enable Autopilot mode"}
          >
            {autopilotPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            {autopilotPaused ? "Resume" : "Pause"}
          </button>
          {showGuidanceInput && autopilotMode ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={guidanceText}
                onChange={(e) => setGuidanceText(e.target.value)}
                placeholder="Type guidance for the AI..."
                className="rounded-md border border-purple-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 w-48 focus:outline-none focus:border-purple-500"
                onKeyDown={(e) => { if (e.key === "Enter") handleAutopilotSteer(); }}
              />
              <button
                onClick={handleAutopilotSteer}
                disabled={!guidanceText.trim()}
                className="rounded-md bg-purple-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-purple-600 disabled:opacity-50"
              >
                Submit
              </button>
              <button
                onClick={() => { setShowGuidanceInput(false); setGuidanceText(""); }}
                className="rounded-md border border-gray-700 px-2 py-1.5 text-xs text-gray-400 hover:text-gray-200"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { if (autopilotMode) setShowGuidanceInput(!showGuidanceInput); }}
              className={cn("rounded-md border px-3 py-1.5 text-xs flex items-center gap-1.5",
                autopilotMode ? "border-purple-700 text-purple-400 hover:text-purple-200" : "border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600",
              )}
              title={autopilotMode ? "Send steering guidance to autopilot" : "Enable Autopilot mode"}
            >
              <MessageSquare className="w-3 h-3" /> Steer
            </button>
          )}
          <button
            onClick={() => { if (autopilotMode) setAutopilotState("reviewing"); }}
            className={cn("rounded-md border px-3 py-1.5 text-xs flex items-center gap-1.5",
              autopilotMode ? "border-blue-700 text-blue-400 hover:text-blue-200" : "border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600",
            )}
            title={autopilotMode ? "Review current chapter draft" : "Enable Autopilot mode"}
          >
            <MessageSquare className="w-3 h-3" /> Review
          </button>
          <button
            onClick={() => setIsChatOpen(true)}
            className="rounded-md border border-purple-700 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-200 hover:border-purple-500 flex items-center gap-1.5"
          >
            <Sparkles className="w-3 h-3" /> Brainstorm
          </button>
          <button
            onClick={() => {
              setConsistencyFindings(null);
              setShowExportModal(true);
            }}
            className="rounded-md border border-amber-700 px-3 py-1.5 text-xs text-amber-400 hover:text-amber-200 hover:border-amber-500 flex items-center gap-1.5"
          >
            <AlertTriangle className="w-3 h-3" /> Check Consistency
          </button>
          <button
            onClick={handleNarrateEstimate}
            disabled={narrating}
            className="rounded-md border border-green-700 px-3 py-1.5 text-xs text-green-400 hover:text-green-200 hover:border-green-500 flex items-center gap-1.5 disabled:opacity-50"
          >
            {narrating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
            {narrating ? "Generating…" : "Narrate Book"}
          </button>
          <button
            onClick={() => setShowExportModal(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 flex items-center gap-1.5"
          >
            <Download className="w-3 h-3" /> Export
          </button>
        </div>

        {/* Narrate cost-confirm dialog */}
        {narrateEstimate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => setNarrateEstimate(null)} />
            <div className="relative w-96 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-gray-200">Generate Audiobook?</h3>
              <div className="space-y-1 text-xs text-gray-400">
                <div className="flex justify-between"><span>Chapters:</span><span className="text-gray-200">{narrateEstimate.chapters}</span></div>
                <div className="flex justify-between"><span>Characters:</span><span className="text-gray-200">{narrateEstimate.totalChars.toLocaleString()}</span></div>
                <div className="flex justify-between"><span>Est. duration:</span><span className="text-gray-200">{Math.ceil(narrateEstimate.estimatedDurationSec / 60)} min</span></div>
                <div className="flex justify-between"><span>Est. cost:</span><span className="text-green-400">${narrateEstimate.estimatedCostUsd}</span></div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setNarrateEstimate(null)} className="flex-1 rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">Cancel</button>
                <button onClick={handleNarrateConfirm} disabled={narrating} className="flex-1 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50 flex items-center justify-center gap-1.5">
                  {narrating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Generate (${narrateEstimate.estimatedCostUsd})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Narrate complete dialog */}
        {narrateComplete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => setNarrateComplete(null)} />
            <div className="relative w-96 bg-gray-950 border border-gray-700 rounded-lg shadow-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-gray-200">Audiobook Ready!</h3>
              <div className="flex gap-2">
                <a href={`/api${narrateComplete.combinedPath}`} target="_blank" rel="noreferrer" className="flex-1 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 flex items-center justify-center gap-1.5">
                  <Play className="w-3 h-3" /> Download MP3
                </a>
                <button onClick={() => setNarrateComplete(null)} className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">Close</button>
              </div>
            </div>
          </div>
        )}

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
              <OverviewEditor
                book={activeBook}
                loading={loading}
                onUpdate={updateBook}
              />
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
                          <CharacterCardComponent char={c} bookId={activeBook?.id ?? ""} companySlug={companySlug} bookSlug={activeBook?.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? ""} onUpdate={updateCharacter} onDelete={deleteCharacter} />
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
                          <LocationCardComponent loc={l} bookId={activeBook?.id ?? ""} companySlug={companySlug} bookSlug={activeBook?.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? ""} onUpdate={updateLocation} onDelete={deleteLocation} />
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
                          <StyleCardComponent entry={s} bookId={activeBook?.id ?? ""} companySlug={companySlug} bookSlug={activeBook?.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? ""} onUpdate={updateStyle} onDelete={deleteStyle} />
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
                          <OutlineCardComponent entry={o} bookId={activeBook?.id ?? ""} companySlug={companySlug} bookSlug={activeBook?.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? ""} onUpdate={updateOutline} onDelete={deleteOutline} />
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
            jumpToChapter={jumpToChapter}
            highlightRange={highlightRange}
          />
        </div>

        {/* RIGHT PANE — Review Notes */}
        {!focusMode && activeBook && (
          <ReviewNotesPanel
            bookId={activeBook.id}
            companySlug={companySlug}
            onSelectChapter={(ch) => setJumpToChapter(ch)}
            onHighlightOffset={(ch, start, end) => setHighlightRange({ chapterNumber: ch, startOffset: start, endOffset: end })}
          />
        )}
      </div>

      {/* Book Media drawer (Fable, additive — fixed-position, layout-independent) */}
      {activeBook && <BookMediaPanel bookId={activeBook.id} />}

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

      {/* Export Modal */}
      {showExportModal && (
        <ExportModalContent
          activeBook={activeBook}
          companySlug={companySlug}
          exportingFormat={exportingFormat}
          consistencyFindings={consistencyFindings}
          checkingConsistency={checkingConsistency}
          onClose={() => setShowExportModal(false)}
          onExportMarkdown={handleExportMarkdown}
          onCheckConsistency={handleCheckConsistency}
          severityColors={severityColors}
        />
      )}
      </div>
    </ErrorBoundary>
  );
}

// ── Export Modal (inline, no separate file) ──────────────────────────────────

interface ExportModalContentProps {
  activeBook: BookData | null;
  companySlug: string;
  exportingFormat: string | null;
  consistencyFindings: Array<{ severity: string; category: string; description: string; suggestion: string }> | null;
  checkingConsistency: boolean;
  onClose: () => void;
  onExportMarkdown: () => void;
  onCheckConsistency: () => void;
  severityColors: Record<string, string>;
}

const EXPORT_FORMATS = [
  { key: "markdown", label: "Markdown", ext: ".md", active: true, hint: null },
  { key: "epub", label: "EPUB", ext: ".epub", active: false, hint: "Install epub-gen npm package to enable" },
  { key: "pdf", label: "PDF", ext: ".pdf", active: false, hint: "Install pandoc to enable" },
  { key: "audiobook", label: "Audiobook", ext: ".mp3", active: false, hint: "Set TTS_API_KEY to enable" },
] as const;

function ExportModalContent({
  activeBook,
  exportingFormat,
  consistencyFindings,
  checkingConsistency,
  onClose,
  onExportMarkdown,
  onCheckConsistency,
  severityColors,
}: ExportModalContentProps) {
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={handleOverlayClick}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-[540px] max-h-[80vh] bg-gray-950 border border-gray-700 rounded-lg shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4 shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">Export &amp; Consistency Check</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Export Formats</h3>
            <div className="space-y-2">
              {EXPORT_FORMATS.map((fmt) => (
                <div
                  key={fmt.key}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-4 py-3",
                    fmt.active ? "border-gray-700 bg-gray-900/50" : "border-gray-800 bg-gray-900/30 opacity-60",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <FileDown className={cn("w-4 h-4", fmt.active ? "text-blue-400" : "text-gray-600")} />
                    <div>
                      <span className="text-sm font-medium text-gray-200">{fmt.label}</span>
                      <span className="text-xs text-gray-500 ml-1.5">{fmt.ext}</span>
                    </div>
                  </div>
                  {fmt.active ? (
                    <button
                      onClick={onExportMarkdown}
                      disabled={exportingFormat === "markdown"}
                      className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {exportingFormat === "markdown" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Download className="w-3 h-3" />
                      )}
                      {exportingFormat === "markdown" ? "Downloading..." : "Download"}
                    </button>
                  ) : (
                    <span className="text-[10px] text-gray-500 cursor-default" title={fmt.hint ?? undefined}>
                      Coming soon
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Bible Consistency</h3>
            <button
              onClick={onCheckConsistency}
              disabled={checkingConsistency || !activeBook}
              className="rounded-md border border-amber-700 px-4 py-2 text-xs text-amber-400 hover:text-amber-200 hover:border-amber-500 disabled:opacity-50 flex items-center gap-2"
            >
              {checkingConsistency ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
              {checkingConsistency ? "Checking..." : "Check Consistency"}
            </button>

            {consistencyFindings !== null && (
              <div className="mt-3 space-y-2">
                {consistencyFindings.length === 0 ? (
                  <div className="rounded-md border border-green-500/30 bg-green-500/5 px-4 py-3 text-xs text-green-300">
                    ✅ No consistency issues found. Manuscript matches the story bible.
                  </div>
                ) : (
                  consistencyFindings.map((f, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-md border px-4 py-3",
                        f.severity === "error" ? "border-red-500/30 bg-red-500/5"
                          : f.severity === "warning" ? "border-amber-500/30 bg-amber-500/5"
                          : "border-blue-500/30 bg-blue-500/5",
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", severityColors[f.severity] || severityColors.info)}>
                          {f.severity}
                        </span>
                        <span className="text-[10px] text-gray-500">{f.category}</span>
                      </div>
                      <p className="text-xs text-gray-300">{f.description}</p>
                      {f.suggestion && <p className="text-[11px] text-gray-500 mt-1 italic">→ {f.suggestion}</p>}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default BookWritingPage;
