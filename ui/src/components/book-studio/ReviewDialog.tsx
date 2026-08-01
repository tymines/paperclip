/**
 * ReviewDialog — Spec v1 §5.A: Review is ALWAYS available, in every mode.
 * Scope picker: this chapter (default) · pick a chapter · whole book
 * (per-chapter baseline passes, one report). Results show the critic's
 * PASS/FAIL/NO_VERDICT verdict, the 8-dim rubric scorecard (failures red),
 * and where the findings were stored. The critic annotates and scores only —
 * it never rewrites; revisions are Baily-directed from the notes panel.
 */

import { useState } from "react";
import { X, Loader2, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BaselineReviewReport, RunBaselineReviewResponse } from "@paperclipai/shared";

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
  return res.json();
}

interface Props {
  bookId: string;
  companySlug: string;
  /** Chapter numbers that have prose (reviewable). */
  chaptersWithProse: number[];
  /** Currently open chapter — the default scope. */
  currentChapter: number | null;
  onClose: () => void;
  /** Called after a completed review so notes/status refresh. */
  onReviewed?: () => void;
}

const VERDICT_STYLE: Record<string, { icon: typeof ShieldCheck; cls: string; label: string }> = {
  PASS: { icon: ShieldCheck, cls: "text-green-400 border-green-700 bg-green-500/10", label: "PASS" },
  FAIL: { icon: ShieldAlert, cls: "text-red-400 border-red-700 bg-red-500/10", label: "FAIL" },
  NO_VERDICT: { icon: ShieldQuestion, cls: "text-amber-400 border-amber-700 bg-amber-500/10", label: "NO VERDICT" },
};

export function ReviewDialog({ bookId, companySlug, chaptersWithProse, currentChapter, onClose, onReviewed }: Props) {
  const defaultChapter = currentChapter != null && chaptersWithProse.includes(currentChapter)
    ? currentChapter
    : chaptersWithProse[0] ?? null;
  const [scope, setScope] = useState<"chapter" | "book">("chapter");
  const [pickedChapter, setPickedChapter] = useState<number | null>(defaultChapter);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<BaselineReviewReport[] | null>(null);

  const API_PREFIX = `/companies/${companySlug}/book-studio/books/${bookId}`;

  const runReview = async () => {
    setRunning(true);
    setError(null);
    setReports(null);
    try {
      const body = scope === "book" ? { scope: "book" } : { scope: "chapter", chapterNumber: pickedChapter };
      const res = await apiFetch<RunBaselineReviewResponse>(`${API_PREFIX}/review`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setReports(res.reports ?? []);
      onReviewed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-lg border border-gray-700 bg-gray-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3 shrink-0">
          <h2 className="text-sm font-semibold text-gray-100">Review — baseline pass</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:text-gray-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {/* Scope picker */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Scope</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setScope("chapter")}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs",
                  scope === "chapter" ? "border-blue-600 bg-blue-600/15 text-blue-300" : "border-gray-700 text-gray-400 hover:text-gray-200",
                )}
              >
                {defaultChapter != null ? `This chapter (Ch.${defaultChapter})` : "This chapter"}
              </button>
              <button
                onClick={() => setScope("book")}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs",
                  scope === "book" ? "border-blue-600 bg-blue-600/15 text-blue-300" : "border-gray-700 text-gray-400 hover:text-gray-200",
                )}
              >
                Whole book ({chaptersWithProse.length} chapter{chaptersWithProse.length === 1 ? "" : "s"})
              </button>
            </div>
            {scope === "chapter" && chaptersWithProse.length > 1 && (
              <select
                value={pickedChapter ?? ""}
                onChange={(e) => setPickedChapter(Number(e.target.value))}
                className="w-full rounded-md border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-200"
              >
                {chaptersWithProse.map((n) => (
                  <option key={n} value={n}>Chapter {n}</option>
                ))}
              </select>
            )}
            <p className="text-[10px] text-gray-600">
              The critic (a different model than the writer) scores the rubric and fact-checks against the bible.
              It annotates only — it never rewrites.
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-red-800 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
          )}

          {/* Report */}
          {reports && (
            <div className="space-y-3">
              {reports.map((r) => {
                const v = VERDICT_STYLE[r.verdict] ?? VERDICT_STYLE.NO_VERDICT;
                const Icon = v.icon;
                return (
                  <div key={r.chapterNumber} className="rounded-md border border-gray-800 bg-gray-900/50 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-200">Chapter {r.chapterNumber}</span>
                      <span className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", v.cls)}>
                        <Icon className="w-3 h-3" /> {v.label}
                      </span>
                    </div>
                    {Object.keys(r.scores).length > 0 && (
                      <div className="grid grid-cols-4 gap-1.5">
                        {Object.entries(r.scores).map(([dim, score]) => {
                          const failed = r.failures.includes(dim);
                          return (
                            <div key={dim} className={cn(
                              "rounded border px-1.5 py-1 text-center",
                              failed ? "border-red-800 bg-red-500/10" : "border-gray-800",
                            )}>
                              <div className={cn("text-xs font-semibold", failed ? "text-red-400" : "text-gray-200")}>{score}</div>
                              <div className="text-[8px] text-gray-500 truncate" title={dim}>{dim}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {r.noVerdictReason && (
                      <p className="text-[10px] text-amber-400/90">No verdict: {r.noVerdictReason} — needs your decision.</p>
                    )}
                    {r.provenance.status === "degraded" && r.provenance.detail && (
                      <p className="text-[10px] text-amber-400/80">Critic degraded: {r.provenance.detail}</p>
                    )}
                    {r.summary && <p className="text-[11px] leading-relaxed text-gray-400">{r.summary}</p>}
                    <p className="text-[10px] text-gray-600">
                      {r.findings.length} finding{r.findings.length === 1 ? "" : "s"} → {r.stored === "annotations" ? "annotations" : "review notes"}
                      {" · "}critic: {r.provenance.agent}{r.provenance.model ? ` · ${r.provenance.model}` : ""}
                      {r.provenance.status === "degraded" ? " (degraded — no verdict)" : " (live)"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-800 px-4 py-3 shrink-0">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
          >
            Close
          </button>
          <button
            onClick={runReview}
            disabled={running || (scope === "chapter" && pickedChapter == null) || chaptersWithProse.length === 0}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {running && <Loader2 className="w-3 h-3 animate-spin" />}
            {running ? "Reviewing…" : "Run review"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReviewDialog;
