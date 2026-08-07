// Director's Deck — top bar (Spec v1 §2). Book switcher + cover thumb + New
// Book · live status line · Director Mode dial (per-book) · Taste · Run Plan ·
// Brainstorm ✦ · Media 🎬 · Export. Editorial dual-type: serif brand, sans data.
import React, { useEffect, useMemo, useState } from "react";
import { Film, Inbox, Pencil, Sparkles, X } from "lucide-react";

export type DirectorMode = "co" | "chapter" | "act";

export interface DeckBook {
  id: string;
  slug: string;
  title: string;
}

export function DeckTopBar({ books, activeBookId, booksLoading = false, onSelectBook, onRenameBook, onNewBook, status, mode, onModeChange, onTaste, onRunPlan, reviewCount, onReviewQueue, onBrainstorm, onMedia, onExport }: {
  books: DeckBook[];
  activeBookId: string | null;
  booksLoading?: boolean;
  onSelectBook: (id: string) => void;
  onRenameBook: (title: string) => Promise<void>;
  onNewBook: () => void;
  status: { ready: number; working: number; exception: number } | null;
  mode: DirectorMode;
  onModeChange: (m: DirectorMode) => void;
  onTaste: () => void;
  onRunPlan: () => void;
  reviewCount: number;
  onReviewQueue: () => void;
  onBrainstorm: () => void;
  onMedia: () => void;
  onExport: () => void;
}) {
  const activeBook = useMemo(() => books.find((book) => book.id === activeBookId) ?? null, [books, activeBookId]);
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    setRenameTitle(activeBook?.title ?? "");
    setRenameError(null);
    setRenaming(false);
  }, [activeBook?.id, activeBook?.title]);

  async function submitRename(event: React.FormEvent) {
    event.preventDefault();
    const title = renameTitle.trim();
    if (!title) {
      setRenameError("Title cannot be empty.");
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    try {
      await onRenameBook(title);
      setRenaming(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenameSaving(false);
    }
  }

  const MODES: { id: DirectorMode; label: string; lvl: string }[] = [
    { id: "co", label: "Co-writer", lvl: "·1" },
    { id: "chapter", label: "Chapter", lvl: "·2" },
    { id: "act", label: "Act", lvl: "·3" },
  ];
  return (
    <header className="flex min-h-[52px] min-w-0 shrink-0 flex-wrap items-center gap-2 overflow-visible border-b border-white/5 bg-[#0a0c10] px-2 py-2 @min-[1320px]/deck:flex-nowrap @min-[1320px]/deck:gap-3.5 @min-[1320px]/deck:px-4">
      <div className="font-serif text-[15px] whitespace-nowrap text-white">Book <em className="not-italic text-white">Studio</em></div>
      <span className="text-gray-600">/</span>
      <span className="h-[23px] w-4 shrink-0 self-center rounded-sm border border-white/15 bg-gradient-to-br from-[#3a2c1e] to-[#6a3f2a]" title="Cover — manage in Media" />
      <select
        className="min-w-0 flex-1 truncate rounded-md border border-white/20 bg-[#171b24] px-2 py-1 text-xs text-white shadow-sm outline-none focus:border-[#e0955a] focus:ring-2 focus:ring-[#e0955a]/30 disabled:cursor-not-allowed disabled:bg-[#10131a] disabled:text-gray-600 @min-[1320px]/deck:max-w-[170px] @min-[1320px]/deck:flex-none"
        value={activeBookId ?? ""}
        onChange={(e) => onSelectBook(e.target.value)}
        disabled={booksLoading || books.length === 0}
        aria-label="Active book"
        title="Switch book"
      >
        {booksLoading && <option value="">Loading books…</option>}
        {!booksLoading && books.length === 0 && <option value="">No books yet</option>}
        {books.map((b) => <option className="bg-[#171b24] text-white" key={b.id} value={b.id}>{b.title}</option>)}
      </select>
      <button disabled={!activeBook || booksLoading} onClick={() => setRenaming(true)} className="grid h-[28px] w-[28px] shrink-0 place-items-center rounded-md border border-white/15 text-gray-400 hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-[#e0955a]/40 disabled:opacity-35" title="Rename active book" aria-label="Rename active book"><Pencil className="h-3 w-3" /></button>
      <button className="hidden shrink-0 items-center whitespace-nowrap rounded-md border border-white/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide hover:bg-white/5 @min-[980px]/deck:inline-flex" onClick={onNewBook} title="Create a new book">+ New Book</button>
      <div className="flex-1" />
      {status && (
        <div className="hidden shrink-0 items-center gap-2 whitespace-nowrap text-[11.5px] text-gray-400 tabular-nums @min-[980px]/deck:flex">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_3px_#5fce9b18]" />
          <span>{status.ready} ready · {status.working} working · {status.exception} exception</span>
        </div>
      )}
      <div className="hidden shrink-0 overflow-hidden rounded-md border border-white/15 @min-[980px]/deck:flex" title="Director Mode autonomy — per-book">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onModeChange(m.id)}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide border-r border-white/5 last:border-r-0 ${mode === m.id ? "bg-[#e0955a22] text-[#e0955a]" : "text-gray-500 hover:text-gray-300"}`}
          >
            {m.label} <span className="opacity-55 font-normal">{m.lvl}</span>
          </button>
        ))}
      </div>
      <button className="hidden shrink-0 whitespace-nowrap rounded-md border border-white/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide hover:bg-white/5 @min-[980px]/deck:inline-flex" onClick={onTaste} title="Taste profile — standing generation rules (visible, editable)">Taste</button>
      <button className="hidden shrink-0 whitespace-nowrap rounded-md bg-[#e0955a] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#181008] hover:bg-[#eaa96f] @min-[980px]/deck:inline-flex" onClick={onRunPlan} title="Run Plan — approve before any autonomous drafting">Run Plan</button>
      <button className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-amber-400/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-300 hover:bg-amber-400/10 @min-[980px]/deck:inline-flex" onClick={onReviewQueue} title="Open the Book Studio review queue">
        <Inbox className="h-3.5 w-3.5" /> Review{reviewCount > 0 ? ` (${reviewCount})` : ""}
      </button>
      <button className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-white/15 hover:bg-white/5 @min-[1320px]/deck:h-[30px] @min-[1320px]/deck:w-[30px]" onClick={onBrainstorm} title="Brainstorm chat" aria-label="Brainstorm"><Sparkles className="w-3.5 h-3.5" /></button>
      <button className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-white/15 hover:bg-white/5 @min-[1320px]/deck:h-[30px] @min-[1320px]/deck:w-[30px]" onClick={onMedia} title="Book media — cover, illustrations, trailer, narration, library" aria-label="Media"><Film className="w-3.5 h-3.5" /></button>
      <button className="hidden shrink-0 whitespace-nowrap rounded-md border border-white/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide hover:bg-white/5 @min-[980px]/deck:inline-flex" onClick={onExport} title="Export — Markdown · EPUB · PDF · Audiobook">Export</button>
      {renaming && activeBook && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="rename-book-title">
          <form onSubmit={submitRename} className="w-full max-w-sm rounded-xl border border-white/15 bg-[#141821] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="rename-book-title" className="font-serif text-lg text-white">Rename book</h2>
              <button type="button" onClick={() => setRenaming(false)} className="text-gray-500 hover:text-white" aria-label="Cancel rename"><X className="h-4 w-4" /></button>
            </div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500" htmlFor="rename-book-input">Display title</label>
            <input id="rename-book-input" autoFocus value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} className="w-full rounded-md border border-white/15 bg-[#0d1016] px-3 py-2 text-sm text-white outline-none focus:border-[#e0955a] focus:ring-2 focus:ring-[#e0955a]/30" />
            {renameError && <p role="alert" className="mt-2 text-xs text-red-300">{renameError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(false)} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">Cancel</button>
              <button type="submit" disabled={renameSaving || !renameTitle.trim()} className="rounded-md bg-[#e0955a] px-3 py-1.5 text-xs font-semibold text-[#181008] disabled:opacity-40">{renameSaving ? "Saving…" : "Save title"}</button>
            </div>
          </form>
        </div>
      )}
    </header>
  );
}
