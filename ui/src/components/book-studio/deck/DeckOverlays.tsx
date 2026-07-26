// Director's Deck — overlays (Spec v1 §2, slice 3c).
// Your call (decision inbox: pending revisions + bible queue + exceptions) ·
// Taste profile (visible/editable standing rules) · Run Plan (autopilot
// status + start/pause/resume/steer) · Export sheet (4 formats + narrate).
import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

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
    throw new Error(msg || res.statusText);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

function Sheet({ title, sub, onClose, wide, children }: { title: string; sub?: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <section
        className={`${wide ? "w-[min(720px,100%)]" : "w-[min(560px,100%)]"} max-h-[86dvh] overflow-auto bg-[#11151d] border border-white/15 rounded-2xl shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/5">
          <div>
            <b className="font-serif text-[15px] font-semibold">{title}</b>
            {sub && <><br /><span className="text-gray-500 text-[10.5px]">{sub}</span></>}
          </div>
          <button className="w-[30px] h-[30px] grid place-items-center border border-white/15 rounded-md hover:bg-white/5" onClick={onClose}><X className="w-3.5 h-3.5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </section>
    </div>
  );
}

// ── Your call — the decision inbox (§6.1) ──────────────────────────────

interface Revision {
  id: string;
  chapterNumber: number;
  status: string;
  instruction?: string;
  scope?: string;
  createdAt?: string;
}

export function DecisionInbox({ bookId, companySlug, onClose, onOpenChapter }: {
  bookId: string;
  companySlug: string;
  onClose: () => void;
  onOpenChapter: (n: number) => void;
}) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const prefix = `/companies/${companySlug}/book-studio/books/${bookId}`;

  useEffect(() => {
    apiFetch<{ revisions?: Revision[] }>(`${prefix}/revisions`)
      .then((r) => setRevisions((r.revisions ?? []).filter((v) => v.status === "pending")))
      .catch(() => setRevisions([]));
    apiFetch<{ pendingCount?: number }>(`${prefix}/bible-review-queue`)
      .then((r) => setQueueCount(r.pendingCount ?? 0))
      .catch(() => {});
  }, [prefix]);

  return (
    <Sheet title="Your call" sub="Every pending decision across the book — nothing here is decided until you pick" onClose={onClose}>
      {revisions.length === 0 && queueCount === 0 && (
        <p className="text-xs text-gray-500 italic">Inbox zero — no pending decisions.</p>
      )}
      {revisions.map((r) => (
        <button
          key={r.id}
          className="block w-full text-left p-3 border border-white/15 rounded-lg hover:border-[#e0955a] mb-2 bg-transparent"
          onClick={() => { onOpenChapter(r.chapterNumber); onClose(); }}
        >
          <b className="block text-[12.5px]">Revision proposal · ch.{r.chapterNumber}</b>
          <small className="text-gray-500 text-[11px]">{r.scope ?? "chapter"} scope · {r.instruction ?? "directed revision"} — accept or reject from the Notes tab</small>
        </button>
      ))}
      {queueCount > 0 && (
        <div className="p-3 border border-amber-400/40 rounded-lg text-amber-300 text-[12px]">
          📥 {queueCount} bible review-queue proposal{queueCount > 1 ? "s" : ""} pending — open the Codex → Review Queue to approve or reject.
        </div>
      )}
    </Sheet>
  );
}

// ── Taste profile ───────────────────────────────────────────────────────

export function TasteSheet({ bookId, companySlug, metadata, onClose }: {
  bookId: string;
  companySlug: string;
  metadata: Record<string, unknown>;
  onClose: () => void;
}) {
  const [rules, setRules] = useState<string[]>(() => (metadata.tasteRules as string[]) ?? []);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const prefix = `/companies/${companySlug}/book-studio/books/${bookId}`;

  async function save(next: string[]) {
    setRules(next);
    setSaved(false);
    await apiFetch(prefix, { method: "PATCH", body: JSON.stringify({ metadata: { tasteRules: next } }) })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })
      .catch(() => {});
  }

  return (
    <Sheet title="Taste profile" sub="Standing generation rules — visible and editable, no invisible drift" onClose={onClose}>
      {rules.length === 0 && <p className="text-xs text-gray-500 italic mb-3">No standing rules yet — add your first below.</p>}
      {rules.map((r, i) => (
        <div key={i} className="flex items-start justify-between gap-3 border-b border-white/5 py-2.5">
          <span className="text-[12.5px]">{r}</span>
          <button className="text-gray-600 hover:text-red-400 text-xs" onClick={() => save(rules.filter((_, j) => j !== i))}>🗑</button>
        </div>
      ))}
      <div className="flex gap-2 mt-4">
        <input
          className="flex-1 bg-transparent border border-white/15 rounded-lg text-gray-200 px-3 py-2 text-xs"
          placeholder='e.g. "Never have Kaelen apologize directly"'
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { save([...rules, draft.trim()]); setDraft(""); } }}
        />
        <button className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-[#e0955a] text-[#181008]" onClick={() => { if (draft.trim()) { save([...rules, draft.trim()]); setDraft(""); } }}>Add</button>
      </div>
      {saved && <p className="text-emerald-400 text-[11px] mt-2">Saved</p>}
    </Sheet>
  );
}

// ── Run Plan (autopilot control) ────────────────────────────────────────

interface AutopilotStatus {
  status?: string;
  phase?: string;
  currentChapter?: number;
  totalChapters?: number;
  chapters?: { chapterNumber: number; status: string }[];
  spendCents?: number;
}

export function RunPlanSheet({ bookId, companySlug, onClose, onChanged }: {
  bookId: string;
  companySlug: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [guidance, setGuidance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const prefix = `/companies/${companySlug}/book-studio/books/${bookId}/autopilot`;

  const refresh = () => apiFetch<AutopilotStatus>(`${prefix}/status`).then(setStatus).catch(() => setStatus(null));
  useEffect(() => { refresh(); }, []);

  async function act(action: "start" | "pause" | "resume" | "steer") {
    setError(null);
    try {
      await apiFetch(`${prefix}/${action}`, {
        method: "POST",
        body: JSON.stringify(action === "steer" ? { guidance } : {}),
      });
      if (action === "steer") setGuidance("");
      refresh();
      onChanged();
    } catch (e) { setError((e as Error).message); }
  }

  const running = status?.status === "running";
  const paused = status?.status === "paused";

  return (
    <Sheet title="Run Plan — Act autopilot (Level 3)" sub="No drafting happens outside an approved plan" onClose={onClose} wide>
      <div className="flex gap-3 flex-wrap text-[10.5px] text-gray-400 mb-4 tabular-nums">
        <span>status: <b className="text-gray-200">{status?.status ?? "idle"}</b></span>
        {status?.phase && <span>phase: <b className="text-gray-200">{status.phase}</b></span>}
        {status?.currentChapter != null && <span>chapter: <b className="text-gray-200">{status.currentChapter}/{status.totalChapters ?? "?"}</b></span>}
        {status?.spendCents != null && <span>spend: <b className="text-gray-200">${(status.spendCents / 100).toFixed(2)}</b></span>}
      </div>
      {(status?.chapters ?? []).length > 0 && (
        <div className="mb-4">
          {status!.chapters!.map((c) => (
            <div key={c.chapterNumber} className="flex justify-between border-b border-white/5 py-1.5 text-[11.5px]">
              <span>Ch.{c.chapterNumber}</span>
              <span className={c.status === "complete" ? "text-emerald-400" : c.status === "pending" ? "text-gray-500" : "text-amber-400"}>{c.status}</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        className="w-full bg-transparent border border-white/15 rounded-lg text-gray-200 p-2.5 text-xs min-h-14 mb-3"
        placeholder="Steer the run (optional): tone, focus, what to watch…"
        value={guidance}
        onChange={(e) => setGuidance(e.target.value)}
      />
      {error && <p className="text-red-400 text-[11px] mb-3">{error}</p>}
      <div className="flex gap-2">
        {!running && !paused && (
          <button className="flex-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-[#e0955a] text-[#181008]" onClick={() => act("start")}>Approve & start run</button>
        )}
        {running && <button className="flex-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide border border-white/15 rounded-md" onClick={() => act("pause")}>Pause run</button>}
        {paused && <button className="flex-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-[#e0955a] text-[#181008]" onClick={() => act("resume")}>Resume run</button>}
        <button className="flex-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide border border-white/15 rounded-md disabled:opacity-40" disabled={!guidance.trim()} onClick={() => act("steer")}>Steer</button>
      </div>
      <p className="text-gray-600 text-[10px] mt-3">Locked chapters are skipped and reported loudly — never silently written.</p>
    </Sheet>
  );
}

// ── Export sheet ────────────────────────────────────────────────────────

export function ExportSheet({ bookId, companySlug, bookTitle, chapterCount, onClose }: {
  bookId: string;
  companySlug: string;
  bookTitle: string;
  chapterCount: number;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefix = `/companies/${companySlug}/book-studio/books/${bookId}`;

  async function run(format: string) {
    setBusy(format);
    setError(null);
    try {
      if (format === "audiobook") {
        await apiFetch(`${prefix}/narrate`, { method: "POST", body: JSON.stringify({}) });
        setError("Audiobook dispatched — the combined MP3 lands in Media → Library.");
      } else {
        await apiFetch(`${prefix}/export`, { method: "POST", body: JSON.stringify({ format }) });
        window.open(`${API_BASE}${prefix}/export/${format}`, "_blank");
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  const rows: [string, string][] = [["Markdown", ".md"], ["EPUB", ".epub"], ["PDF", ".pdf"], ["Audiobook", ".mp3"]];
  return (
    <Sheet title="Export & consistency" sub={`${bookTitle} · ${chapterCount} chapters`} onClose={onClose}>
      {rows.map(([label, ext]) => (
        <div key={label} className="flex items-center gap-3 border-b border-white/5 py-2.5">
          <div className="flex-1">
            <b className="text-xs block">{label}</b>
            <small className="text-gray-600 text-[10px]">{ext}</small>
          </div>
          <button
            className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide rounded-md bg-[#e0955a] text-[#181008] disabled:opacity-40"
            disabled={busy != null}
            onClick={() => run(label.toLowerCase() === "audiobook" ? "audiobook" : ext.slice(1))}
          >
            {busy ? "…" : label === "Audiobook" ? "Generate" : "Download"}
          </button>
        </div>
      ))}
      {error && <p className={`text-[11px] mt-3 ${error.startsWith("Audiobook") ? "text-emerald-400" : "text-red-400"}`}>{error}</p>}
      <div className="border-l-2 border-white/15 pl-3.5 py-2 mt-4">
        <b className="text-xs">Consistency engine</b>
        <p className="text-[11px] text-gray-500 mt-0.5">Canon vs codex facts · timeline · character-knowledge (spoiler data) · dropped threads · POV/tense — hidden until the T2 engine lands.</p>
      </div>
    </Sheet>
  );
}
