/**
 * ReviewNotesPanel — first-class review notes (Spec v1 §5.C/E):
 * provenance badges (Baily = the author's own · AI critic = the pipeline's),
 * open/resolved status, and ACTIONABLE notes: "Send to revision" creates a
 * directed revision job whose diff proposal is committed ONLY by Baily's
 * accept (§5.D — the AI never writes outside an accepted proposal).
 *
 * The old "Suggest Rewrite" decoy (it edited the note's own text, never the
 * manuscript — T0-7) is removed; every proposal now lands as a real diff
 * against manuscript prose through the revisions API.
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Edit3, X, Check, MessageSquare, Loader2, Send, CircleCheck, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────────────────────

interface ReviewNote {
  id: string;
  chapterNumber?: number;
  category: string;
  text: string;
  startOffset?: number;
  endOffset?: number;
  provenance?: "baily" | "ai-critic";
  status?: "open" | "resolved";
  linkedRevisionId?: string;
  createdAt: string;
  updatedAt: string;
}

interface Revision {
  id: string;
  chapterNumber: number;
  scope: "chapter" | "passage" | "canon-fix";
  spanStart?: number | null;
  spanEnd?: number | null;
  instruction: string;
  sourceNoteId?: string | null;
  originalText: string;
  proposedText: string;
  rationale: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

export const CATEGORIES = ["pacing", "character", "plot", "prose", "consistency"] as const;
export type Category = (typeof CATEGORIES)[number];

const CATEGORY_COLORS: Record<string, string> = {
  pacing: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
  character: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  plot: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  prose: "bg-green-500/20 text-green-300 border-green-500/40",
  consistency: "bg-orange-500/20 text-orange-300 border-orange-500/40",
};

// ── API ──────────────────────────────────────────────────────────────────────

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

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  bookId: string;
  companySlug: string;
  /** Collapsed to a slim rail (fit-in-viewport fix); parent owns the grid track width. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSelectChapter?: (chapterNumber: number) => void;
  /** ponytail: if a note has text offsets, clicking it calls this to highlight in editor */
  onHighlightOffset?: (chapterNumber: number, startOffset: number, endOffset: number) => void;
  /** Called after Baily accepts a revision — parent reloads the chapter prose (guarded). */
  onRevisionAccepted?: (chapterNumber: number) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ReviewNotesPanel({ bookId, companySlug, collapsed = false, onToggleCollapse, onSelectChapter, onHighlightOffset, onRevisionAccepted }: Props) {
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Form state
  const [formCategory, setFormCategory] = useState<Category>("prose");
  const [formText, setFormText] = useState("");
  const [formChapter, setFormChapter] = useState("");

  // Send-to-revision state
  const [directingNoteId, setDirectingNoteId] = useState<string | null>(null);
  const [directText, setDirectText] = useState("");
  const [directingBusy, setDirectingBusy] = useState(false);
  const [resolvingRevisionId, setResolvingRevisionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const API_PREFIX = `/companies/${companySlug}/book-studio/books/${bookId}`;

  // ── Fetch ──────────────────────────────────────────────────────────────
  const fetchNotes = useCallback(async () => {
    if (!bookId) return;
    try {
      const res = await apiFetch<{ notes: ReviewNote[] }>(`${API_PREFIX}/review-notes`);
      setNotes(res.notes ?? []);
    } catch {
      // silent — notes are best-effort UI
    }
  }, [bookId, companySlug]);

  const fetchRevisions = useCallback(async () => {
    if (!bookId) return;
    try {
      const res = await apiFetch<{ available: boolean; revisions: Revision[] }>(
        `${API_PREFIX}/revisions?status=pending`,
      );
      setRevisions(res.available ? (res.revisions ?? []) : []);
    } catch {
      // silent — pending proposals are best-effort UI
    }
  }, [bookId, companySlug]);

  useEffect(() => { fetchNotes(); fetchRevisions(); }, [fetchNotes, fetchRevisions]);

  // ── CRUD ───────────────────────────────────────────────────────────────
  const addNote = async () => {
    if (!formText.trim()) return;
    try {
      await apiFetch(`${API_PREFIX}/review-notes`, {
        method: "POST",
        body: JSON.stringify({
          category: formCategory,
          text: formText.trim(),
          chapterNumber: formChapter ? parseInt(formChapter, 10) : undefined,
        }),
      });
      setFormText("");
      setFormChapter("");
      setShowForm(false);
      fetchNotes();
    } catch { /* handled */ }
  };

  const updateNote = async (id: string, data: Partial<Pick<ReviewNote, "category" | "text" | "chapterNumber" | "status">>) => {
    try {
      await apiFetch(`${API_PREFIX}/review-notes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      setEditingId(null);
      fetchNotes();
    } catch { /* handled */ }
  };

  const deleteNote = async (id: string) => {
    try {
      await apiFetch(`${API_PREFIX}/review-notes/${id}`, { method: "DELETE" });
      fetchNotes();
    } catch { /* handled */ }
  };

  // ── Send to revision (§5.E — the real path; replaces the Suggest Rewrite decoy) ──
  const sendToRevision = async (note: ReviewNote) => {
    if (!note.chapterNumber) return;
    setDirectingBusy(true);
    setActionError(null);
    try {
      await apiFetch(`${API_PREFIX}/revisions`, {
        method: "POST",
        body: JSON.stringify({
          chapterNumber: note.chapterNumber,
          spanStart: note.startOffset,
          spanEnd: note.endOffset,
          instruction: directText.trim() || note.text,
          noteId: note.id,
        }),
      });
      setDirectingNoteId(null);
      setDirectText("");
      fetchRevisions();
      fetchNotes();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDirectingBusy(false);
    }
  };

  // ── Revision accept / reject (§5.D — Baily is the only decider) ─────────
  const resolveRevision = async (revision: Revision, decision: "accept" | "reject") => {
    setResolvingRevisionId(revision.id);
    setActionError(null);
    try {
      await apiFetch(`${API_PREFIX}/revisions/${revision.id}/${decision}`, { method: "POST" });
      fetchRevisions();
      fetchNotes();
      if (decision === "accept") onRevisionAccepted?.(revision.chapterNumber);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolvingRevisionId(null);
    }
  };

  // ── Filter ─────────────────────────────────────────────────────────────
  const filteredNotes = activeFilter
    ? notes.filter((n) => n.category === activeFilter)
    : notes;

  const openCount = notes.filter((n) => (n.status ?? "open") === "open").length + revisions.length;

  // ── Render ─────────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className="flex h-full flex-1 min-w-0 flex-col items-center gap-2 md:border-l border-gray-800 min-h-0 py-3">
        <button
          onClick={onToggleCollapse}
          title={`Expand review notes${openCount > 0 ? ` (${openCount} open)` : ""}`}
          className="relative rounded p-1.5 text-gray-500 hover:text-gray-200"
        >
          <MessageSquare className="w-4 h-4" />
          {openCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 rounded-full bg-blue-600 px-1 text-[8px] font-semibold leading-3 text-white">
              {openCount > 99 ? "99+" : openCount}
            </span>
          )}
        </button>
      </aside>
    );
  }
  return (
    <aside className="flex h-full flex-1 min-w-0 flex-col md:border-l border-gray-800 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-800 shrink-0">
        <h3 className="truncate text-xs font-semibold uppercase tracking-wider text-gray-400">
          Review Notes
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => { setShowForm(!showForm); setEditingId(null); }}
            className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 hover:border-gray-600"
          >
            <Plus className="w-3 h-3" /> Add Note
          </button>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              title="Collapse review notes"
              className="rounded p-1 text-gray-500 hover:text-gray-200"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Category filters */}
      <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-gray-800 shrink-0">
        <button
          className={cn(
            "rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
            activeFilter === null
              ? "bg-gray-500/20 text-gray-300 border-gray-500/40"
              : "border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600",
          )}
          onClick={() => setActiveFilter(null)}
        >
          All
        </button>
        {CATEGORIES.map((cat) => {
          const active = activeFilter === cat;
          return (
            <button
              key={cat}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors capitalize",
                active
                  ? CATEGORY_COLORS[cat]
                  : "border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600",
              )}
              onClick={() => setActiveFilter(active ? null : cat)}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {actionError && (
        <div className="mx-4 mt-2 shrink-0 rounded border border-red-800 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300">
          {actionError}
        </div>
      )}

      {/* Pending revision proposals — Baily's diff inbox (§5.D) */}
      {revisions.length > 0 && (
        <div className="border-b border-gray-800 shrink-0">
          <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wider text-amber-400">
            Revision proposals ({revisions.length}) — your call
          </p>
          <div className="divide-y divide-gray-800/50">
            {revisions.map((rev) => (
              <div key={rev.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => onSelectChapter?.(rev.chapterNumber)}
                    className="text-[10px] font-medium text-blue-400 hover:text-blue-300"
                  >
                    Ch.{rev.chapterNumber} · {rev.scope}
                  </button>
                  <span className="text-[9px] text-gray-600">{new Date(rev.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="mt-1 text-[11px] text-gray-300 italic">“{rev.instruction}”</p>
                <div className="mt-2 space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
                  {rev.scope === "passage" && rev.originalText ? (
                    <p className="max-h-20 overflow-y-auto text-xs leading-relaxed text-gray-500 line-through whitespace-pre-wrap">
                      {rev.originalText}
                    </p>
                  ) : (
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">Full-chapter rewrite</p>
                  )}
                  <p className="max-h-32 overflow-y-auto text-xs leading-relaxed text-green-400 whitespace-pre-wrap">
                    {rev.proposedText}
                  </p>
                  {rev.rationale && <p className="text-[10px] text-gray-500">{rev.rationale}</p>}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => resolveRevision(rev, "accept")}
                    disabled={resolvingRevisionId === rev.id}
                    className="flex items-center gap-1 rounded bg-green-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-green-600 disabled:opacity-50"
                  >
                    {resolvingRevisionId === rev.id ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Check className="w-2.5 h-2.5" />}
                    Accept — commit to manuscript
                  </button>
                  <button
                    onClick={() => resolveRevision(rev, "reject")}
                    disabled={resolvingRevisionId === rev.id}
                    className="rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/50 shrink-0">
          <div className="space-y-2">
            <select
              className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200"
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value as Category)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c} className="capitalize">{c}</option>
              ))}
            </select>
            <textarea
              className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 placeholder-gray-600 resize-none"
              rows={3}
              placeholder="Note text..."
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
            />
            <input
              className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 placeholder-gray-600"
              placeholder="Chapter number (optional)"
              type="number"
              min={1}
              value={formChapter}
              onChange={(e) => setFormChapter(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={addNote}
                className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-blue-500"
              >
                <Check className="w-3 h-3" /> Save
              </button>
              <button
                onClick={() => { setShowForm(false); setFormText(""); setFormChapter(""); }}
                className="rounded border border-gray-700 px-2.5 py-1 text-[10px] text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto">
        {filteredNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <div className="text-2xl mb-2 opacity-30">{notes.length === 0 ? "📝" : "🔍"}</div>
            <p className="text-xs text-gray-500">
              {notes.length === 0 ? "No review notes yet" : "No matching notes"}
            </p>
            <p className="text-[10px] text-gray-600 mt-1">
              {notes.length === 0 ? "Add your first note above" : "Try a different filter"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {filteredNotes.map((note) => {
              const resolved = (note.status ?? "open") === "resolved";
              return (
              <div key={note.id} className={cn("px-4 py-3 hover:bg-gray-900/30 group", resolved && "opacity-60")}>
                {editingId === note.id ? (
                  /* Edit mode */
                  <div className="space-y-2">
                    <select
                      className="w-full rounded border border-blue-500/40 bg-gray-800/50 px-2 py-1 text-xs text-gray-200"
                      value={note.category}
                      onChange={(e) => {
                        setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, category: e.target.value } : n)));
                      }}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c} className="capitalize">{c}</option>
                      ))}
                    </select>
                    <textarea
                      className="w-full rounded border border-blue-500/40 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 resize-none"
                      rows={2}
                      value={note.text}
                      onChange={(e) => {
                        setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, text: e.target.value } : n)));
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateNote(note.id, { category: note.category, text: note.text })}
                        className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500"
                      >
                        <Check className="w-2.5 h-2.5" /> Save
                      </button>
                      <button
                        onClick={() => { setEditingId(null); fetchNotes(); }}
                        className="rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200"
                      >
                        <X className="w-2.5 h-2.5" /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button
                          onClick={() => {
                            if (note.chapterNumber && onSelectChapter) onSelectChapter(note.chapterNumber);
                            if (note.chapterNumber !== undefined && note.startOffset !== undefined && note.endOffset !== undefined && onHighlightOffset) {
                              onHighlightOffset(note.chapterNumber, note.startOffset, note.endOffset);
                            }
                          }}
                          className={cn(
                            "inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0 mt-0.5 capitalize",
                            CATEGORY_COLORS[note.category] || "bg-gray-500/20 text-gray-300 border-gray-500/40",
                            (note.chapterNumber || (note.startOffset !== undefined)) && "cursor-pointer hover:brightness-110",
                          )}
                          title={note.chapterNumber ? `Jump to Chapter ${note.chapterNumber}` : undefined}
                        >
                          {note.category}
                        </button>
                        {/* Provenance (§5.C): the author's own notes vs the pipeline's */}
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[9px] shrink-0 mt-0.5",
                            (note.provenance ?? "baily") === "ai-critic"
                              ? "border-purple-700 text-purple-400"
                              : "border-gray-700 text-gray-500",
                          )}
                          title={(note.provenance ?? "baily") === "ai-critic" ? "Written by the critic lane" : "Your note"}
                        >
                          {(note.provenance ?? "baily") === "ai-critic" ? "AI critic" : "You"}
                        </span>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => updateNote(note.id, { status: resolved ? "open" : "resolved" })}
                          className="rounded p-0.5 text-gray-500 hover:text-green-400"
                          title={resolved ? "Reopen" : "Mark resolved"}
                        >
                          {resolved ? <Circle className="w-3 h-3" /> : <CircleCheck className="w-3 h-3" />}
                        </button>
                        {note.chapterNumber !== undefined && !resolved && (
                          <button
                            onClick={() => { setDirectingNoteId(directingNoteId === note.id ? null : note.id); setDirectText(note.text); }}
                            className="rounded p-0.5 text-gray-500 hover:text-amber-400"
                            title="Send to revision — direct the AI to fix this"
                          >
                            <Send className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditingId(note.id)}
                          className="rounded p-0.5 text-gray-500 hover:text-blue-400"
                          title="Edit"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => deleteNote(note.id)}
                          className="rounded p-0.5 text-gray-500 hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <p
                      className={cn(
                        "text-xs text-gray-200 mt-1.5 leading-relaxed",
                        resolved && "line-through",
                        note.startOffset !== undefined && onHighlightOffset && "cursor-pointer hover:text-blue-300",
                      )}
                      onClick={() => {
                        if (note.chapterNumber !== undefined && note.startOffset !== undefined && note.endOffset !== undefined && onHighlightOffset) {
                          onHighlightOffset(note.chapterNumber, note.startOffset, note.endOffset);
                        }
                      }}
                      title={note.startOffset !== undefined ? "Click to highlight in editor" : undefined}
                    >
                      {note.text}
                    </p>
                    {note.chapterNumber && (
                      <p className="text-[10px] text-gray-600 mt-0.5">Chapter {note.chapterNumber}</p>
                    )}
                    {note.startOffset !== undefined && (
                      <p className="text-[10px] text-gray-700 mt-0.5">
                        chars {note.startOffset}–{note.endOffset}
                      </p>
                    )}
                    {note.linkedRevisionId && (
                      <p className="text-[10px] text-amber-500/80 mt-0.5">↳ sent to revision</p>
                    )}

                    {/* Send-to-revision inline form (§5.E) */}
                    {directingNoteId === note.id && (
                      <div className="mt-2 border border-amber-500/30 rounded-md bg-amber-500/5 p-2.5 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Send className="w-3 h-3 text-amber-400" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                            Direct the revision
                          </span>
                        </div>
                        <textarea
                          className="w-full rounded border border-amber-500/40 bg-gray-900 px-2 py-1 text-xs text-gray-200 resize-none"
                          rows={2}
                          value={directText}
                          onChange={(e) => setDirectText(e.target.value)}
                          placeholder="Tell the writer exactly what to change…"
                        />
                        <p className="text-[9px] text-gray-600">
                          Produces a diff proposal against Ch.{note.chapterNumber}
                          {note.startOffset !== undefined ? " (this passage)" : " (whole chapter)"} — nothing is written until you accept it.
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => sendToRevision(note)}
                            disabled={directingBusy || !directText.trim()}
                            className="flex items-center gap-1 rounded bg-amber-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                          >
                            {directingBusy ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Send className="w-2.5 h-2.5" />}
                            Create proposal
                          </button>
                          <button
                            onClick={() => setDirectingNoteId(null)}
                            className="rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

export default ReviewNotesPanel;
