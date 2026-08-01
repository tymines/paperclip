// Director's Deck — right inspector (Spec v1 §2, slice 3c).
// Gate (verdict + exception card + budget guard) · Rubric (8 dims from the
// latest baseline review run) · Notes (1a ReviewNotesPanel) · Canon
// (codex relationship meters + arc rules + context consulted).
import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ReviewNotesPanel } from "@/components/book-studio/ReviewNotesPanel";

const API_BASE = "/api";
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

interface ReviewRun {
  id: string;
  chapterNumber: number;
  scores?: Record<string, number>;
  verdict?: string;
  /** Critic provenance — e.g. "ares (agent lane)" or a configured model lane (Spec v1.4). */
  model?: string;
  reviewer?: string;
  createdAt: string;
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
}

const DIM_LABELS: Record<string, string> = {
  tension: "Tension", interiority: "Interiority", sensory: "Sensory",
  dialogueSubtext: "Dialogue subtext", pacing: "Pacing", voiceMatch: "Voice match",
  beatFulfillment: "Beat fulfillment", canonAdherence: "Canon adherence",
};
const PASS_THRESHOLD = 7; // mirrors server book-review.ts

export function DeckInspector({ bookId, companySlug, chapterNumber, chapterStatus, onJumpToBeats, onOpenDecisionInbox, onSelectChapter, onHighlightOffset, onRevisionAccepted }: {
  bookId: string;
  companySlug: string;
  chapterNumber: number | null;
  chapterStatus: string | null;
  onJumpToBeats: () => void;
  onOpenDecisionInbox: () => void;
  onSelectChapter: (n: number) => void;
  onHighlightOffset: (ch: number, s: number, e: number) => void;
  onRevisionAccepted: () => void;
}) {
  const [tab, setTab] = useState<"gate" | "rubric" | "notes" | "canon">("gate");
  const [runs, setRuns] = useState<ReviewRun[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const prefix = `/companies/${companySlug}/book-studio/books/${bookId}`;

  useEffect(() => {
    if (chapterNumber == null) return;
    apiFetch<{ reviewRuns?: ReviewRun[] }>(`${prefix}/annotations?chapterNumber=${chapterNumber}`)
      .then((r) => setRuns(r.reviewRuns ?? []))
      .catch(() => setRuns([]));
    apiFetch<{ relationships?: Relationship[] }>(`${prefix}/codex-relationships`)
      .then((r) => setRelationships(r.relationships ?? []))
      .catch(() => setRelationships([]));
  }, [prefix, chapterNumber, chapterStatus]);

  const latestRun = useMemo(() => runs.find((r) => r.chapterNumber === chapterNumber) ?? runs[0] ?? null, [runs, chapterNumber]);
  const scores = latestRun?.scores ?? {};
  const dims = Object.keys(DIM_LABELS).filter((d) => scores[d] != null);

  const verdict = chapterStatus === "exception" ? "FAIL" : chapterStatus === "queued" ? "PASS" : chapterStatus === "drafting" || chapterStatus === "draft-pending-review" ? "WORKING" : null;
  const verdictCls = verdict === "FAIL" ? "text-red-400" : verdict === "WORKING" ? "text-amber-400" : "text-emerald-400";

  return (
    <aside className="border-l border-white/5 bg-[#0d1016] min-w-0 overflow-auto flex flex-col" aria-label="Quality inspector">
      <div className="sticky top-0 bg-[#0d1016] z-10 border-b border-white/5">
        <div className="flex">
          {(["gate", "rubric", "notes", "canon"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.12em] border-b-2 ${tab === t ? "text-[#e0955a] border-[#e0955a]" : "text-gray-600 border-transparent hover:text-gray-400"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 flex-1">
        {tab === "gate" && (
          <>
            <div className="pb-3 mb-3 border-b border-white/5">
              {verdict ? (
                <>
                  <b className={`font-serif text-[22px] block ${verdictCls}`}>{verdict}</b>
                  <span className="text-[11px] text-gray-400">
                    {verdict === "FAIL" ? "1 canon exception · re-enters revision"
                      : verdict === "WORKING" ? "Pipeline running · gate evaluates when the draft lands"
                      : "All rubric ≥ threshold · zero canon violations · queued quietly"}
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-gray-600">No gate verdict yet — draft or re-run the gate.</span>
              )}
            </div>
            {latestRun && (
              <p className="text-[10px] text-gray-600 mb-3 leading-relaxed">
                writer <b className="text-gray-400">gemini / configured lane</b> · critic <b className="text-gray-400">{latestRun.model || "ares → configured lane"}</b> · run {latestRun.id.slice(0, 8)}
              </p>
            )}
            {chapterStatus === "exception" && (
              <div className="border border-white/15 rounded-lg bg-[#11151d] p-3 mb-3">
                <div className="flex gap-2.5 items-start mb-2">
                  <span className="w-5 h-5 rounded-full bg-red-400/10 border border-red-400/40 text-red-400 grid place-items-center font-black text-[11px] flex-none">!</span>
                  <div>
                    <strong className="text-[12.5px] block">Gate exception</strong>
                    <p className="text-[10px] text-gray-500 m-0">Canon check · see Notes for critic findings</p>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 mt-3">
                  <button className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide border border-white/15 rounded-md hover:bg-white/5" onClick={onJumpToBeats}>Open flagged beat →</button>
                  <button className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide border border-white/15 rounded-md hover:bg-white/5" onClick={() => setTab("notes")}>Review suggested revision (diff)</button>
                  <button className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide border border-[#e0955a44] text-[#e0955a] rounded-md hover:bg-[#e0955a22]" onClick={onOpenDecisionInbox}>Needs your decision</button>
                </div>
              </div>
            )}
            <p className="text-gray-600 text-[10px] mt-4">
              Passing chapters queue silently. Only exceptions interrupt review. NO_VERDICT halts and surfaces — it never silently passes.
            </p>
          </>
        )}

        {tab === "rubric" && (
          <>
            {dims.length === 0 ? (
              <p className="text-[11px] text-gray-600 italic">No rubric scores for this chapter yet — the baseline pass scores every landed draft.</p>
            ) : (
              <>
                <div className="flex items-baseline gap-2 mb-4">
                  <b className="font-serif text-[34px] font-semibold tabular-nums">
                    {Math.round(dims.reduce((a, d) => a + (scores[d] ?? 0), 0) / dims.length * 10)}
                  </b>
                  <span className="text-gray-600 text-[10.5px]">/100 · threshold {PASS_THRESHOLD * 10}</span>
                </div>
                {dims.map((d) => {
                  const v = (scores[d] ?? 0) * 10;
                  const low = (scores[d] ?? 0) < PASS_THRESHOLD;
                  return (
                    <div key={d} className="grid grid-cols-[88px_1fr_26px] gap-2 items-center mb-2 text-[10.5px]">
                      <label className={`truncate ${low ? "text-red-400" : "text-gray-400"}`}>{DIM_LABELS[d]}</label>
                      <span className="h-[3px] rounded bg-white/10 relative">
                        <i className={`absolute left-0 top-0 bottom-0 rounded ${low ? "bg-red-400" : "bg-[#e0955a]"}`} style={{ width: `${v}%` }} />
                        <span className="absolute -top-[3px] -bottom-[3px] w-px bg-amber-400" style={{ left: `${PASS_THRESHOLD * 10}%` }} />
                      </span>
                      <b className={`text-right tabular-nums ${low ? "text-red-400" : "text-gray-400"}`}>{v}</b>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}

        {tab === "notes" && (
          <ReviewNotesPanel
            bookId={bookId}
            companySlug={companySlug}
            onSelectChapter={onSelectChapter}
            onHighlightOffset={onHighlightOffset}
            onRevisionAccepted={onRevisionAccepted}
          />
        )}

        {tab === "canon" && (
          <>
            <div className="text-[9.5px] uppercase tracking-[0.16em] text-gray-500 font-bold mb-2.5">Relationship state</div>
            {relationships.length === 0 && <p className="text-[11px] text-gray-600 italic">No relationships yet — they become gate constraints.</p>}
            {relationships.map((r) => (
              <div key={r.id} className="mb-3">
                <div className="flex justify-between text-[11px] mb-1">
                  <span>{r.fromEntityType} → {r.toEntityType}{r.type ? ` · ${r.type}` : ""}</span>
                  <b className="tabular-nums">{r.meter > 0 ? `+${r.meter}` : r.meter}</b>
                </div>
                <div className="h-[3px] rounded bg-white/10 relative">
                  <span className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20" />
                  <i
                    className={`absolute top-0 bottom-0 rounded ${r.meter >= 0 ? "bg-[#b39dff]" : "bg-red-400"}`}
                    style={r.meter >= 0 ? { left: "50%", width: `${r.meter / 2}%` } : { right: "50%", width: `${-r.meter / 2}%` }}
                  />
                </div>
                {r.arcStage && <p className="text-[10px] text-gray-500 mt-1">stage: {r.arcStage}</p>}
                {r.rules.map((rule, i) => (
                  <div key={i} className="text-[10px] text-amber-400 border-l-2 border-amber-400 pl-2.5 py-1 mt-1">⚠ {rule}</div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
