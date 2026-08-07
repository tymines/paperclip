// Director's Deck — left rail (Spec v1 §2). Manuscript queue as a table of
// contents (serif index numerals, hairline separators), bible codex sections
// with counts + readiness dots + lock markers, review-queue inbox.
import React from "react";
import { Inbox } from "lucide-react";

export interface DeckChapter {
  chapterNumber: number;
  title: string;
  state: "pass" | "run" | "fail" | "idle";
  meta: string;
  score: number | null;
  locked: boolean;
}

export interface DeckBibleSection {
  id: string;
  icon: string;
  label: string;
  count: number | string;
  ready: "ok" | "thin" | "none";
  locks?: number;
}

const DOT: Record<DeckChapter["state"], string> = {
  pass: "bg-emerald-400",
  run: "bg-amber-400 animate-pulse",
  fail: "bg-red-400 animate-pulse",
  idle: "bg-white/20",
};

export function DeckRail({ chapters, activeChapter, onSelectChapter, onUnlockChapter, sections, activeSection, onSelectSection, reviewCount, onOpenReviewQueue, mobileSection, viewMode, onViewModeChange }: {
  chapters: DeckChapter[];
  activeChapter: number | null;
  onSelectChapter: (n: number) => void;
  onUnlockChapter: (n: number) => void;
  sections: DeckBibleSection[];
  activeSection: string | null;
  onSelectSection: (id: string) => void;
  reviewCount: number;
  onOpenReviewQueue: () => void;
  mobileSection?: "chapters" | "bible";
  viewMode?: "chapters" | "bible";
  onViewModeChange?: (mode: "chapters" | "bible") => void;
}) {
  const ready = chapters.filter((c) => c.state === "pass").length;
  const working = chapters.filter((c) => c.state === "run").length;
  const exceptions = chapters.filter((c) => c.state === "fail").length;
  const planned = chapters.filter((c) => c.state === "idle").length;
  const activeRailView = mobileSection ?? viewMode ?? "chapters";
  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-white/5 bg-[#0d1016]" aria-label="Chapter queue and story bible">
      {!mobileSection && (
        <div className="grid shrink-0 grid-cols-2 border-b border-white/10 p-1" role="tablist" aria-label="Book navigation">
          <button
            type="button"
            role="tab"
            aria-selected={activeRailView === "chapters"}
            onClick={() => onViewModeChange?.("chapters")}
            className={`min-h-9 rounded-md px-2 text-[11px] font-semibold ${activeRailView === "chapters" ? "bg-[#e0955a22] text-[#e6ad80]" : "text-gray-500 hover:bg-white/5 hover:text-gray-300"}`}
          >
            Chapters <span className="tabular-nums opacity-70">{chapters.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeRailView === "bible"}
            onClick={() => onViewModeChange?.("bible")}
            className={`min-h-9 rounded-md px-2 text-[11px] font-semibold ${activeRailView === "bible" ? "bg-[#b39dff22] text-[#c9baff]" : "text-gray-500 hover:bg-white/5 hover:text-gray-300"}`}
          >
            Story Bible <span className="tabular-nums opacity-70">{sections.length + 1}</span>
          </button>
        </div>
      )}
      {activeRailView === "chapters" && <><div className="shrink-0 bg-[#0d1016] px-4 pt-3.5 pb-2.5 border-b border-white/5 z-10">
        <div className="text-[9.5px] uppercase tracking-[0.16em] text-gray-500 font-bold">Manuscript queue</div>
        <div className="flex items-baseline justify-between mt-1">
          <strong className="font-serif text-base font-semibold">Chapters</strong>
          <span className="text-gray-500 text-[10.5px] tabular-nums">{chapters.length} total</span>
        </div>
        {chapters.length === 0 ? (
          <div className="mt-2 text-[10.5px] text-gray-500">No chapters yet. Add an outline or manuscript chapter to begin.</div>
        ) : <div className="flex flex-wrap gap-x-3.5 gap-y-1 mt-2 text-[10.5px] text-gray-400 tabular-nums">
          <span><b className="text-emerald-400 text-[13px] mr-1">{ready}</b>ready</span>
          <span><b className="text-amber-400 text-[13px] mr-1">{working}</b>working</span>
          <span><b className="text-red-400 text-[13px] mr-1">{exceptions}</b>exception</span>
          {planned > 0 && <span><b className="text-gray-300 text-[13px] mr-1">{planned}</b>planned</span>}
        </div>}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto">
        {chapters.map((c) => (
          <button
            key={c.chapterNumber}
            onClick={() => onSelectChapter(c.chapterNumber)}
            className={`grid grid-cols-[30px_1fr_auto] gap-2.5 items-baseline w-full text-left px-4 py-2 border-b border-white/5 hover:bg-white/5 ${mobileSection ? "min-h-11 md:min-h-0" : ""} ${activeChapter === c.chapterNumber ? "bg-gradient-to-r from-[#e0955a22] to-transparent" : ""}`}
          >
            <span className={`font-serif text-[15px] text-right tabular-nums ${activeChapter === c.chapterNumber ? "text-[#e0955a]" : "text-gray-600"}`}>
              {String(c.chapterNumber).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <strong className={`block text-xs font-semibold truncate ${c.state === "fail" ? "text-red-400" : ""}`}>{c.title}</strong>
              <small className="text-gray-600 text-[10px]">{c.meta}{c.score != null ? ` · ${c.score}` : ""}</small>
            </span>
            <span className="flex items-center gap-1.5">
              {c.locked && (
                <span
                  className="text-[10px] cursor-pointer"
                  title="Locked — AI can never overwrite this chapter, even on directed revision. Click to unlock (human-only)."
                  onClick={(e) => { e.stopPropagation(); onUnlockChapter(c.chapterNumber); }}
                >🔒</span>
              )}
              <span className={`w-1.5 h-1.5 rounded-full ${DOT[c.state]}`} />
            </span>
          </button>
        ))}
      </nav></>}
      {activeRailView === "bible" && <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 border-b border-white/5 bg-[#0d1016] px-4 pt-3.5 pb-2.5">
          <div className="text-[9.5px] uppercase tracking-[0.16em] text-gray-500 font-bold">Story bible · codex</div>
          <div className="flex items-baseline justify-between mt-1">
            <strong className="font-serif text-base font-semibold">Bible + overview</strong>
            <span className="text-gray-500 text-[10.5px] tabular-nums">readiness {sections.filter((s) => s.ready === "ok").length}/{sections.length}</span>
          </div>
        </div>
        {sections.map((s) => (
          <button
            key={s.id}
            data-section-id={s.id}
            onClick={() => onSelectSection(s.id)}
            className={`flex items-center gap-2.5 w-full px-4 py-1.5 text-left border-b border-white/5 hover:bg-white/5 ${mobileSection ? "min-h-11 md:min-h-0" : ""} ${activeSection === s.id ? "bg-gradient-to-r from-[#b39dff14] to-transparent" : ""}`}
            aria-current={activeSection === s.id ? "page" : undefined}
          >
            <span className="w-[18px] text-center text-[11px] opacity-80">{s.icon}</span>
            <span className="flex-1 text-[11.5px] truncate">{s.label}</span>
            {s.locks != null && s.locks > 0 && <span className="text-amber-400 text-[9.5px]" title={`${s.locks} locked`}>🔒{s.locks}</span>}
            <span className="text-[10px] text-gray-600 tabular-nums">{s.count}</span>
            <span className={`w-[5px] h-[5px] rounded-full ${s.ready === "ok" ? "bg-emerald-400" : s.ready === "thin" ? "bg-amber-400" : "bg-white/20"}`} />
          </button>
        ))}
        <button
          data-section-id="review-queue"
          onClick={onOpenReviewQueue}
          className={`flex items-center gap-2.5 w-full px-4 py-2.5 text-left border-t border-white/10 text-amber-400 text-[11.5px] hover:bg-[#e5b45e16] ${mobileSection ? "min-h-11 md:min-h-0" : ""} ${activeSection === "review-queue" ? "bg-gradient-to-r from-[#e5b45e20] to-transparent" : ""}`}
          aria-current={activeSection === "review-queue" ? "page" : undefined}
          title="Bible review queue — extraction only proposes; nothing enters canon without your click"
        >
          <Inbox className="w-3.5 h-3.5" /> Review queue
          <span className="ml-auto border border-amber-400 rounded-lg px-1.5 text-[10px] font-bold">{reviewCount}</span>
        </button>
      </div>}
    </aside>
  );
}
