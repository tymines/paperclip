// Director's Deck — top bar (Spec v1 §2). Book switcher + cover thumb + New
// Book · live status line · Director Mode dial (per-book) · Taste · Run Plan ·
// Brainstorm ✦ · Media 🎬 · Export. Editorial dual-type: serif brand, sans data.
import React from "react";
import { Film, Sparkles } from "lucide-react";

export type DirectorMode = "co" | "chapter" | "act";

export interface DeckBook {
  id: string;
  slug: string;
  title: string;
}

export function DeckTopBar({ books, activeBookId, onSelectBook, onNewBook, status, mode, onModeChange, onTaste, onRunPlan, onBrainstorm, onMedia, onExport }: {
  books: DeckBook[];
  activeBookId: string | null;
  onSelectBook: (id: string) => void;
  onNewBook: () => void;
  status: { ready: number; working: number; exception: number } | null;
  mode: DirectorMode;
  onModeChange: (m: DirectorMode) => void;
  onTaste: () => void;
  onRunPlan: () => void;
  onBrainstorm: () => void;
  onMedia: () => void;
  onExport: () => void;
}) {
  const MODES: { id: DirectorMode; label: string; lvl: string }[] = [
    { id: "co", label: "Co-writer", lvl: "·1" },
    { id: "chapter", label: "Chapter", lvl: "·2" },
    { id: "act", label: "Act", lvl: "·3" },
  ];
  return (
    <header className="flex items-center gap-3.5 px-4 h-[52px] border-b border-white/5 bg-[#0a0c10] min-w-0">
      <div className="font-serif text-[15px] whitespace-nowrap">Book <em className="not-italic text-[#e0955a]">Studio</em></div>
      <span className="text-gray-600">/</span>
      <span className="w-4 h-[23px] rounded-sm border border-white/15 bg-gradient-to-br from-[#3a2c1e] to-[#6a3f2a] self-center" title="Cover — manage in Media" />
      <select
        className="bg-transparent border border-white/15 text-gray-200 rounded-md px-1.5 py-1 text-xs max-w-[170px]"
        value={activeBookId ?? ""}
        onChange={(e) => onSelectBook(e.target.value)}
        title="Switch book"
      >
        {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
      </select>
      <button className="hidden md:inline-flex items-center px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide border border-white/15 rounded-md hover:bg-white/5" onClick={onNewBook} title="Create a new book">+ New Book</button>
      <div className="flex-1" />
      {status && (
        <div className="hidden md:flex items-center gap-2 text-gray-400 text-[11.5px] whitespace-nowrap tabular-nums">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_3px_#5fce9b18]" />
          <span>{status.ready} ready · {status.working} working · {status.exception} exception</span>
        </div>
      )}
      <div className="hidden md:flex border border-white/15 rounded-md overflow-hidden" title="Director Mode autonomy — per-book">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => onModeChange(m.id)}
            className={`px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide border-r border-white/5 last:border-r-0 ${mode === m.id ? "bg-[#e0955a22] text-[#e0955a]" : "text-gray-500 hover:text-gray-300"}`}
          >
            {m.label} <span className="opacity-55 font-normal">{m.lvl}</span>
          </button>
        ))}
      </div>
      <button className="hidden md:inline-flex px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide border border-white/15 rounded-md hover:bg-white/5" onClick={onTaste} title="Taste profile — standing generation rules (visible, editable)">Taste</button>
      <button className="hidden md:inline-flex px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-[#e0955a] text-[#181008] hover:bg-[#eaa96f]" onClick={onRunPlan} title="Run Plan — approve before any autonomous drafting">Run Plan</button>
      <button className="w-[30px] h-[30px] grid place-items-center border border-white/15 rounded-md hover:bg-white/5" onClick={onBrainstorm} title="Brainstorm chat"><Sparkles className="w-3.5 h-3.5" /></button>
      <button className="w-[30px] h-[30px] grid place-items-center border border-white/15 rounded-md hover:bg-white/5" onClick={onMedia} title="Book media — cover, illustrations, trailer, narration, library"><Film className="w-3.5 h-3.5" /></button>
      <button className="hidden md:inline-flex px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide border border-white/15 rounded-md hover:bg-white/5" onClick={onExport} title="Export — Markdown · EPUB · PDF · Audiobook">Export</button>
    </header>
  );
}
