// Director's Deck — center workspace (Spec v1 §2, slice 3b).
// Chapter header (serif title + structure chips + lock toggle) · stage spine
// (Compile→Draft→Critique→Revise→De-AI→Canon→Gate) · four views: Beats
// (editable steering cards) · Prose (existing ManuscriptEditor) · Context
// ("what the writer saw" — consulted entities + spoiler-gated facts) · Bible
// (2b CodexPanel) · bottom bar: Your call · Draft Fast/Craft · Re-run gate.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import { ManuscriptEditor } from "@/components/book-studio/ManuscriptEditor";
import { CodexPanel } from "@/components/book-studio/CodexPanel";

const API_BASE = "/api";
async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch { /* raw */ }
    const err = new Error(msg || res.statusText) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export interface Beat { kind?: string; description?: string; text?: string; beat?: string; flagged?: boolean }

interface ContextPacket {
  usedCharacters: string[];
  usedLocations: string[];
  hasStyle: boolean;
  hasBeat: boolean;
  usedFacts: string[];
  withheldFacts: { id: string; knownAsOf: number }[];
}

const STAGES = ["Compile", "Draft", "Critique", "Revise", "De-AI", "Canon", "Gate"] as const;

function beatText(b: Beat): string {
  return String(b.description ?? b.text ?? b.beat ?? "");
}

export function DeckWorkspace({ bookId, bookSlug, companySlug, chapterNumber, chapterTitle, outlineEntry, locked, chapterStatus, onLockToggle, onNeedsRefresh, onOpenDecisionInbox }: {
  bookId: string;
  bookSlug: string;
  companySlug: string;
  chapterNumber: number;
  chapterTitle: string;
  outlineEntry: { id: string; chapterNumber: number; title: string; beats: Beat[] } | null;
  locked: boolean;
  chapterStatus: string | null;
  onLockToggle: () => void;
  onNeedsRefresh: () => void;
  onOpenDecisionInbox: () => void;
}) {
  const [view, setView] = useState<"beats" | "prose" | "context" | "bible">("beats");
  const [beats, setBeats] = useState<Beat[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [packet, setPacket] = useState<ContextPacket | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draftMenu, setDraftMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const prefix = `/companies/${companySlug}/book-studio/books/${bookId}`;

  useEffect(() => { setBeats(outlineEntry?.beats ?? []); }, [outlineEntry?.id, chapterNumber]);

  useEffect(() => {
    if (view !== "context") return;
    apiFetch<ContextPacket>(`${prefix}/chapters/${chapterNumber}/context-packet`)
      .then(setPacket).catch(() => setPacket(null));
  }, [view, chapterNumber, prefix]);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2200); }

  const saveBeats = useCallback(async (next: Beat[]) => {
    if (!outlineEntry) return;
    setBeats(next);
    await apiFetch(`${prefix}/outline/${outlineEntry.id}`, {
      method: "PATCH",
      body: JSON.stringify({ beats: next.map((b) => ({ kind: b.kind ?? "Beat", description: beatText(b) })) }),
    }).then(() => flash("Beats saved")).catch((e) => flash(e.status === 409 ? "🔒 Chapter locked — beats refuse edits" : `Save failed: ${e.message}`));
  }, [outlineEntry, prefix]);

  function moveBeat(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= beats.length) return;
    const next = beats.slice();
    [next[i], next[j]] = [next[j], next[i]];
    saveBeats(next);
  }

  async function draft(kind: "fast" | "craft") {
    setDraftMenu(false);
    setBusy(kind);
    try {
      if (kind === "fast") {
        await apiFetch(`${prefix}/chapters/${chapterNumber}/write-prose?overwrite=1`, { method: "POST", body: JSON.stringify({}) });
        flash("Fast draft landed · baseline pass queued");
      } else {
        // Craft = SSE stream; consume to completion.
        const res = await fetch(`${API_BASE}${prefix}/chapters/${chapterNumber}/write-prose/stream?overwrite=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          let msg = t; try { msg = JSON.parse(t).error ?? t; } catch { /* raw */ }
          throw new Error(msg);
        }
        await res.body?.cancel().catch(() => {});
        flash("Craft draft complete · full pipeline");
      }
      setRefreshKey((k) => k + 1);
      onNeedsRefresh();
    } catch (e) {
      flash((e as Error).message?.includes("lock") || (e as { status?: number }).status === 409
        ? "⛔ Chapter is locked — draft refused. Unlock it, or answer the Locked-Content card."
        : `Draft failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function rerunGate() {
    setBusy("gate");
    try {
      const res = await apiFetch<{ reports?: { verdict?: string }[] }>(`${prefix}/review`, {
        method: "POST",
        body: JSON.stringify({ scope: "chapter", chapterNumber }),
      });
      flash(`Gate re-run: ${res.reports?.[0]?.verdict ?? "done"}`);
      onNeedsRefresh();
    } catch (e) { flash(`Gate failed: ${(e as Error).message}`); }
    finally { setBusy(null); }
  }

  // Stage spine states from chapter status (read-only history).
  const stageStates = useMemo(() => {
    if (chapterStatus === "exception") return ["done", "done", "done", "done", "done", "fail", ""] as const;
    if (chapterStatus === "queued") return ["done", "done", "done", "done", "done", "done", "done"] as const;
    if (chapterStatus === "drafting") return ["done", "current", "", "", "", "", ""] as const;
    if (chapterStatus === "draft-pending-review") return ["done", "done", "current", "", "", "", ""] as const;
    return ["", "", "", "", "", "", ""] as const;
  }, [chapterStatus]);

  const stageCls = (s: string) =>
    s === "done" ? "text-emerald-400" : s === "current" ? "text-amber-400 animate-pulse" : s === "fail" ? "text-red-400" : "text-gray-600";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header */}
      <div className="sticky top-0 bg-[#0a0c10] z-10 px-5 pt-4 pb-3 border-b border-white/5">
        <div className="text-[9.5px] uppercase tracking-[0.16em] text-gray-500 font-bold">
          Chapter {chapterNumber} · {beats.length} beats{chapterStatus ? ` · ${chapterStatus}` : ""}
        </div>
        <h1 className="font-serif text-2xl font-semibold mt-1 inline">{chapterTitle}</h1>
        <button
          className={`ml-2 align-middle ${locked ? "opacity-100" : "opacity-50 hover:opacity-90"}`}
          onClick={onLockToggle}
          title={locked ? "Chapter locked — every AI write path refuses or asks. Click to unlock (human-only)." : "Lock chapter — AI can never overwrite its prose or beats"}
        >
          {locked ? <Lock className="w-4 h-4 inline text-amber-400" /> : <LockOpen className="w-4 h-4 inline" />}
        </button>
        <p className="text-gray-600 text-[11.5px] mt-0.5">
          {locked ? "🔒 Locked — AI skips or asks, never overwrites (even ?overwrite) · " : ""}
          {chapterStatus === "exception" ? "1 exception requires a decision" : chapterStatus === "queued" ? "Passed the gate · queued for manuscript" : "Beat plan"}
        </p>
        {/* stage spine */}
        <div className="flex items-center mt-3.5">
          {STAGES.map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 && <div className={`flex-1 h-px mx-2 min-w-2 ${stageStates[i] === "done" || stageStates[i - 1] === "done" ? "bg-emerald-400/30" : "bg-white/10"}`} />}
              <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold ${stageCls(stageStates[i])}`}>
                <i className={`w-[19px] h-[19px] rounded-full border grid place-items-center text-[9px] not-italic font-bold ${stageStates[i] === "done" ? "bg-emerald-400/10 border-emerald-400/40" : stageStates[i] === "fail" ? "bg-red-400/10 border-red-400/50" : stageStates[i] === "current" ? "bg-amber-400/10 border-amber-400/50" : "border-white/15"}`}>
                  {stageStates[i] === "done" ? "✓" : stageStates[i] === "fail" ? "✗" : i + 1}
                </i>
                {s}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* view tabs */}
      <div className="flex gap-5 border-b border-white/5 px-5 bg-[#0a0c10] sticky top-0 z-[9]">
        {(["beats", "prose", "context", "bible"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`bg-transparent py-2.5 font-serif text-sm border-b-2 ${view === v ? "text-[#ece9e2] border-[#e0955a]" : "text-gray-600 border-transparent hover:text-gray-400"}`}
          >
            {v === "bible" ? "Bible" : v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* views */}
      <div className="flex-1 overflow-auto px-5 py-4 min-h-0">
        {view === "beats" && (
          <div>
            <div className="flex items-baseline justify-between border-b border-white/5 pb-2 mb-3">
              <h2 className="font-serif text-[15px] font-semibold">Chapter beats</h2>
              <span className="text-[10.5px] text-gray-600">The steering wheel · edit beats, release prose</span>
            </div>
            {beats.length === 0 && <p className="text-xs text-gray-600 italic">No beats yet for this chapter.</p>}
            {beats.map((b, i) => (
              <article key={i} className={`grid grid-cols-[44px_1fr_auto] gap-3.5 py-3 border-b border-white/5 ${b.flagged ? "bg-gradient-to-r from-red-400/10 to-transparent" : ""}`}>
                <div className="font-serif text-[26px] text-white/15 text-right leading-tight tabular-nums">{String(i + 1).padStart(2, "0")}</div>
                <div>
                  <div className="flex gap-2 items-center mb-1">
                    <span className="text-[9.5px] uppercase tracking-[0.16em] text-[#b39dff] font-extrabold">{b.kind ?? "Beat"}</span>
                    {b.flagged && <span className="text-[9px] border border-red-400/40 text-red-400 rounded px-1.5 py-px">Canon conflict</span>}
                  </div>
                  {editing === i ? (
                    <textarea
                      autoFocus
                      className="w-full bg-[#0d1016] border border-[#e0955a44] rounded-md text-gray-200 p-2 text-xs min-h-16"
                      defaultValue={beatText(b)}
                      onBlur={(e) => { const next = beats.slice(); next[i] = { ...b, description: e.target.value }; setEditing(null); saveBeats(next); }}
                    />
                  ) : (
                    <p className="text-[12.5px] text-[#d5d2c9] max-w-[70ch] m-0">{beatText(b)}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <button className="w-6 h-6 rounded-md border border-white/15 text-gray-500 hover:text-gray-200 text-[11px]" onClick={() => setEditing(editing === i ? null : i)} title="Edit">✎</button>
                  <button className="w-6 h-6 rounded-md border border-white/15 text-gray-500 hover:text-gray-200 text-[11px]" onClick={() => moveBeat(i, -1)} title="Move up">↑</button>
                  <button className="w-6 h-6 rounded-md border border-white/15 text-gray-500 hover:text-gray-200 text-[11px]" onClick={() => moveBeat(i, 1)} title="Move down">↓</button>
                </div>
              </article>
            ))}
            <button
              className="w-full mt-3 py-2.5 border border-dashed border-white/15 rounded-lg text-gray-600 hover:text-gray-300 text-[11.5px]"
              onClick={() => saveBeats([...beats, { kind: "New beat", description: "Describe the change, choice, or consequence this beat must deliver." }])}
            >＋ Add beat</button>
          </div>
        )}

        {view === "prose" && (
          <ManuscriptEditor
            bookId={bookId}
            companySlug={companySlug}
            outlineEntries={(outlineEntry ? [outlineEntry] : []) as never}
            focusMode={false}
            onToggleFocus={() => {}}
            jumpToChapter={chapterNumber}
            highlightRange={null}
            autonomyMode="manual"
            contentRefreshKey={refreshKey}
            onChapterChange={() => {}}
          />
        )}

        {view === "context" && (
          <div>
            <div className="flex items-baseline justify-between border-b border-white/5 pb-2 mb-3">
              <h2 className="font-serif text-[15px] font-semibold">What the writer saw</h2>
              <span className="text-[10.5px] text-gray-600">Compiled packet · spoiler-filtered for Ch.{chapterNumber}</span>
            </div>
            {!packet && <p className="text-xs text-gray-600 italic">Compiling packet…</p>}
            {packet && (
              <>
                {packet.usedCharacters.map((c) => (
                  <div key={c} className="border-l-2 border-white/15 pl-3.5 py-2 mb-3">
                    <b className="text-xs">{c}</b><span className="text-[9px] rounded px-1.5 py-px ml-2 bg-emerald-400/10 text-emerald-400">consulted</span>
                  </div>
                ))}
                {packet.usedLocations.map((l) => (
                  <div key={l} className="border-l-2 border-white/15 pl-3.5 py-2 mb-3">
                    <b className="text-xs">{l}</b><span className="text-[9px] rounded px-1.5 py-px ml-2 bg-emerald-400/10 text-emerald-400">location</span>
                  </div>
                ))}
                {packet.usedFacts.map((f, i) => (
                  <div key={i} className="border-l-2 border-white/15 pl-3.5 py-2 mb-3">
                    <b className="text-xs">{f}</b><span className="text-[9px] rounded px-1.5 py-px ml-2 bg-emerald-400/10 text-emerald-400">canon fact · entered packet</span>
                  </div>
                ))}
                {packet.withheldFacts.map((f) => (
                  <div key={f.id} className="border-l-2 border-dashed border-white/15 pl-3.5 py-2 mb-3 opacity-75">
                    <b className="text-xs">Fact #{f.id.slice(0, 4)} · reveals ch.{f.knownAsOf}</b>
                    <span className="text-[9px] rounded px-1.5 py-px ml-2 bg-red-400/10 text-red-400">withheld</span>
                    <p className="text-[11px] text-gray-600 mt-0.5">Spoiler-gated — stripped from the Ch.{chapterNumber} packet at assembly. Statement stays author-only until reveal.</p>
                  </div>
                ))}
                {!packet.usedCharacters.length && !packet.usedFacts.length && !packet.withheldFacts.length && (
                  <p className="text-xs text-gray-600 italic">No bible context compiled for this chapter yet — the writer drafts from the premise.</p>
                )}
              </>
            )}
          </div>
        )}

        {view === "bible" && <CodexPanel bookId={bookId} companySlug={companySlug} currentChapter={chapterNumber} />}
      </div>

      {/* bottom bar */}
      <div className="sticky bottom-0 flex gap-2 px-5 py-3 bg-gradient-to-b from-transparent to-[#0a0c10] z-[8]">
        <button className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide border border-white/15 rounded-md hover:bg-white/5" onClick={onOpenDecisionInbox} title="Open your pending decisions">Your call</button>
        <div className="relative">
          <button className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-[#e0955a] text-[#181008] hover:bg-[#eaa96f] disabled:opacity-40" disabled={busy != null} onClick={(e) => { e.stopPropagation(); setDraftMenu((v) => !v); }}>
            {busy === "fast" || busy === "craft" ? "Drafting…" : "Draft ▾"}
          </button>
          {draftMenu && (
            <div className="absolute bottom-[calc(100%+6px)] left-0 bg-[#161b25] border border-white/15 rounded-lg p-1 flex flex-col gap-0.5 min-w-[210px] shadow-2xl z-20">
              <button className="text-left px-3 py-2 rounded-md hover:bg-white/5 text-xs" onClick={() => draft("fast")}><b>Fast draft</b><small className="block text-gray-500 text-[10px]">single pass → gate · cheaper</small></button>
              <button className="text-left px-3 py-2 rounded-md hover:bg-white/5 text-xs" onClick={() => draft("craft")}><b>Craft draft</b><small className="block text-gray-500 text-[10px]">full pipeline: critique → revise → de-AI → canon → gate</small></button>
            </div>
          )}
        </div>
        <button className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide border border-white/15 rounded-md hover:bg-white/5 disabled:opacity-40" disabled={busy != null} onClick={rerunGate}>
          {busy === "gate" ? "Running…" : "Re-run gate"}
        </button>
      </div>

      {toast && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 bg-[#161b25] border border-white/15 text-gray-200 px-4 py-2 rounded-lg text-xs shadow-2xl z-50">{toast}</div>
      )}
    </div>
  );
}
