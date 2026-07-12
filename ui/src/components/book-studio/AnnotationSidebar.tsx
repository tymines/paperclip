/**
 * AnnotationSidebar — span-anchored annotations for the chapter editor.
 *
 * Backed by book_annotations / book_review_runs (migration 0151, GATED — not
 * applied yet). The API reports `available: false` until the migration lands;
 * this component says so explicitly and never fabricates annotation state.
 * New notes written while unavailable fall back to books.metadata review notes
 * (the Review Notes panel), and the UI reports that too.
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, X, Check, Loader2, AlertTriangle, Sparkles, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types (mirror packages/shared/src/types/book.ts DTOs) ───────────────────

interface AnnotationDto {
  id: string;
  bookId: string;
  chapterId: string;
  chapterNumber: number;
  reviewRunId: string | null;
  spanStart: number | null;
  spanEnd: number | null;
  contentHash: string;
  kind: string;
  body: string;
  author: string;
  resolved: boolean;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ReviewRunDto {
  id: string;
  lens: string;
  reviewer: string;
  model: string;
  scope: string;
  summary: string;
  createdAt: string;
}

interface AnnotationsResponse {
  available: boolean;
  pendingMigration?: string;
  reason?: string;
  annotations: AnnotationDto[];
  reviewRuns: ReviewRunDto[];
}

const KINDS = ["note", "review", "suggestion"] as const;
const LENSES = ["canon", "voice", "continuity", "structure", "prose"] as const;

const KIND_COLORS: Record<string, string> = {
  note: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  review: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  suggestion: "bg-green-500/20 text-green-300 border-green-500/40",
};

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

interface Props {
  bookId: string;
  companySlug: string;
  chapterNumber: number;
  /** Current editor text selection (character offsets) — the add-annotation anchor. */
  selection: { start: number; end: number } | null;
  /** Jump the editor to an annotation's span. */
  onJumpToSpan?: (start: number, end: number) => void;
}

export function AnnotationSidebar({ bookId, companySlug, chapterNumber, selection, onJumpToSpan }: Props) {
  const [data, setData] = useState<AnnotationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formKind, setFormKind] = useState<string>("note");
  const [formBody, setFormBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [reviewLens, setReviewLens] = useState<string>("prose");
  const [reviewing, setReviewing] = useState(false);

  const API_PREFIX = `/companies/${companySlug}/book-studio/books/${bookId}`;

  const fetchAnnotations = useCallback(async () => {
    if (!bookId || !chapterNumber) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch<AnnotationsResponse>(
        `${API_PREFIX}/annotations?chapterNumber=${chapterNumber}`,
      );
      setData(res);
    } catch (err) {
      setLoadError((err as Error).message || "Failed to load annotations");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [bookId, companySlug, chapterNumber]);

  useEffect(() => { fetchAnnotations(); }, [fetchAnnotations]);

  const addAnnotation = async () => {
    if (!formBody.trim() || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ available: boolean; pendingMigration?: string; reason?: string }>(
        `${API_PREFIX}/annotations`,
        {
          method: "POST",
          body: JSON.stringify({
            chapterNumber,
            kind: formKind,
            body: formBody.trim(),
            ...(selection ? { spanStart: selection.start, spanEnd: selection.end } : {}),
          }),
        },
      );
      if (res.available === false) {
        setNotice("Saved as a fallback Review Note — annotations table pending migration 0151.");
      }
      setFormBody("");
      setShowForm(false);
      fetchAnnotations();
    } catch (err) {
      setNotice(`Failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleResolved = async (anno: AnnotationDto) => {
    try {
      await apiFetch(`${API_PREFIX}/annotations/${anno.id}`, {
        method: "PATCH",
        body: JSON.stringify({ resolved: !anno.resolved }),
      });
      fetchAnnotations();
    } catch (err) {
      setNotice(`Resolve failed: ${(err as Error).message}`);
    }
  };

  const deleteAnnotation = async (id: string) => {
    try {
      await apiFetch(`${API_PREFIX}/annotations/${id}`, { method: "DELETE" });
      fetchAnnotations();
    } catch (err) {
      setNotice(`Delete failed: ${(err as Error).message}`);
    }
  };

  const runReview = async () => {
    if (reviewing) return;
    setReviewing(true);
    setNotice(null);
    try {
      const res = await fetch(`${API_BASE}${API_PREFIX}/review-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterNumber, lens: reviewLens }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 503 && body?.pendingMigration === "0151") {
        setNotice("Review runs need the annotations table — pending migration 0151.");
      } else if (!res.ok) {
        setNotice(`Review failed: ${body?.error || res.statusText}`);
      } else {
        const n = Array.isArray(body?.annotations) ? body.annotations.length : 0;
        setNotice(`Review pass (${reviewLens}) done — ${n} finding${n === 1 ? "" : "s"}${body?.unanchored ? ` (${body.unanchored} unanchored)` : ""}.`);
        fetchAnnotations();
      }
    } catch (err) {
      setNotice(`Review failed: ${(err as Error).message}`);
    } finally {
      setReviewing(false);
    }
  };

  const annotations = data?.annotations ?? [];
  const unavailable = data !== null && data.available === false;
  const latestRun = data?.reviewRuns?.[0] ?? null;

  return (
    <aside className="w-72 shrink-0 flex flex-col border-l border-gray-800 min-h-0 bg-gray-950/60">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800 shrink-0">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Annotations · Ch.{chapterNumber}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchAnnotations}
            className="rounded p-1 text-gray-500 hover:text-gray-300"
            title="Refresh"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1 rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-200 hover:border-gray-600"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      {/* Pending-migration banner — never pretend the table exists */}
      {unavailable && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-amber-700/40 bg-amber-500/10 text-[10px] text-amber-300 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Annotations table pending migration 0151. New notes fall back to the Review Notes panel; span anchors, resolve state, and review runs activate once 0151 is applied.
          </span>
        </div>
      )}

      {/* Notices */}
      {notice && (
        <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900/60 text-[10px] text-gray-300 shrink-0">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-gray-500 hover:text-gray-300 shrink-0">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="px-3 py-2.5 border-b border-gray-800 bg-gray-900/50 shrink-0 space-y-2">
          <div className="text-[10px] text-gray-500">
            {selection
              ? `Anchored to selection (chars ${selection.start}–${selection.end})`
              : "No text selected — will be saved as a chapter-level note"}
          </div>
          <select
            className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200"
            value={formKind}
            onChange={(e) => setFormKind(e.target.value)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k} className="capitalize">{k}</option>
            ))}
          </select>
          <textarea
            className="w-full rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 placeholder-gray-600 resize-none"
            rows={3}
            placeholder="Annotation text..."
            value={formBody}
            onChange={(e) => setFormBody(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={addAnnotation}
              disabled={saving || !formBody.trim()}
              className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Check className="w-2.5 h-2.5" />} Save
            </button>
            <button
              onClick={() => { setShowForm(false); setFormBody(""); }}
              className="rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* AI review pass */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-800 shrink-0">
        <select
          className="rounded border border-gray-700 bg-gray-800/50 px-1.5 py-1 text-[10px] text-gray-200"
          value={reviewLens}
          onChange={(e) => setReviewLens(e.target.value)}
          title="Review lens"
        >
          {LENSES.map((l) => (
            <option key={l} value={l} className="capitalize">{l}</option>
          ))}
        </select>
        <button
          onClick={runReview}
          disabled={reviewing || unavailable}
          title={unavailable ? "Requires migration 0151" : `Run an AI ${reviewLens} review of this chapter`}
          className="flex items-center gap-1 rounded border border-purple-700 px-2 py-1 text-[10px] text-purple-400 hover:text-purple-200 hover:border-purple-500 disabled:opacity-50"
        >
          {reviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {reviewing ? "Reviewing…" : "Run review"}
        </button>
      </div>

      {/* Latest review run (book_review_runs groups a pass's annotations) */}
      {latestRun && (
        <div className="px-3 py-2 border-b border-gray-800 bg-gray-900/40 shrink-0">
          <p className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">
            Last review · {latestRun.lens} · {latestRun.scope || "book"} · {latestRun.model}
          </p>
          {latestRun.summary && (
            <p className="text-[10px] text-gray-400 leading-relaxed line-clamp-3" title={latestRun.summary}>
              {latestRun.summary}
            </p>
          )}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-gray-500 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </div>
        ) : loadError ? (
          <div className="p-4 text-xs text-red-400">{loadError}</div>
        ) : annotations.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-xs text-gray-500">
              {unavailable ? "No annotations (table pending migration 0151)." : "No annotations for this chapter yet."}
            </p>
            <p className="text-[10px] text-gray-600 mt-1">Select text and click Add to anchor a note.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {annotations.map((anno) => (
              <div key={anno.id} className={cn("px-3 py-2.5 group hover:bg-gray-900/30", anno.resolved && "opacity-50")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn(
                      "inline-block rounded-full border px-1.5 py-0.5 text-[9px] font-medium capitalize",
                      KIND_COLORS[anno.kind] || "bg-gray-500/20 text-gray-300 border-gray-500/40",
                    )}>
                      {anno.kind}
                    </span>
                    {anno.stale && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-300"
                        title="Chapter text changed since this annotation was anchored — the span may no longer match."
                      >
                        <AlertTriangle className="w-2.5 h-2.5" /> stale anchor
                      </span>
                    )}
                    {anno.author !== "user" && (
                      <span className="text-[9px] text-gray-600">{anno.author}</span>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={() => toggleResolved(anno)}
                      className={cn("rounded p-0.5", anno.resolved ? "text-green-400 hover:text-green-300" : "text-gray-500 hover:text-green-400")}
                      title={anno.resolved ? "Reopen" : "Resolve"}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => deleteAnnotation(anno.id)}
                      className="rounded p-0.5 text-gray-500 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <p
                  className={cn(
                    "text-xs text-gray-200 mt-1 leading-relaxed",
                    anno.spanStart !== null && !anno.stale && onJumpToSpan && "cursor-pointer hover:text-blue-300",
                  )}
                  onClick={() => {
                    if (anno.spanStart !== null && anno.spanEnd !== null && !anno.stale && onJumpToSpan) {
                      onJumpToSpan(anno.spanStart, anno.spanEnd);
                    }
                  }}
                  title={
                    anno.spanStart !== null
                      ? anno.stale
                        ? "Anchor is stale — jump disabled"
                        : "Click to highlight in editor"
                      : undefined
                  }
                >
                  {anno.body}
                </p>
                <p className="text-[9px] text-gray-600 mt-0.5">
                  {anno.spanStart !== null ? `chars ${anno.spanStart}–${anno.spanEnd}` : "chapter-level"}
                  {anno.resolved ? " · resolved" : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

export default AnnotationSidebar;
