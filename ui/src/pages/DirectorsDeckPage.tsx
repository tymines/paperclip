// Director's Deck (Spec v1 §1–2) — the new Book Studio shell, slice 3a.
// Top bar + left rail wired to real data; the center embeds the existing
// ManuscriptEditor so full parity is preserved from day one (3b replaces it
// with the Beats/Prose/Context/Bible workspace, 3c adds the inspector +
// overlays). Mounted at /:company/book-deck alongside the classic page.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeckTopBar, type DirectorMode } from "@/components/book-studio/deck/DeckTopBar";
import { DeckRail, type DeckChapter, type DeckBibleSection } from "@/components/book-studio/deck/DeckRail";
import { DeckWorkspace, type Beat } from "@/components/book-studio/deck/DeckWorkspace";
import { DeckInspector } from "@/components/book-studio/deck/DeckInspector";
import { DecisionInbox, TasteSheet, RunPlanSheet, ExportSheet } from "@/components/book-studio/deck/DeckOverlays";
import { NewBookModal } from "@/components/book-studio/deck/NewBookModal";
import { CodexPanel, type CodexSectionId } from "@/components/book-studio/CodexPanel";
import { ChatDrawer } from "@/components/book-studio/ChatDrawer";
import { BookMediaPanel } from "@/components/book-studio/BookMediaPanel";
import { StoryBibleSectionEditor } from "@/components/book-studio/StoryBibleSectionEditor";
import { STORY_BIBLE_SECTIONS, isLegacyStoryBibleSection, isStoryBibleSectionId, type StoryBibleSectionId } from "@/components/book-studio/storyBibleSections";
import type { BookData } from "./BookWritingPage";
import { useCompany } from "../context/CompanyContext";

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

interface OutlineEntry { id: string; chapterNumber: number; title: string; locked: boolean; beats?: Beat[] }
interface ChapterRow { id: string; chapterNumber: number; title: string; content: string; locked: boolean }

const CODEX_TYPES = new Set(["lore", "factions", "objects", "systems", "timeline", "threads", "themes", "glossary"]);

function MobileSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const items = focusable(); if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => (focusable()[0] ?? dialogRef.current)?.focus());
    return () => { document.removeEventListener("keydown", onKeyDown); returnFocusRef.current?.focus(); };
  }, [onClose]);
  return <div className="fixed inset-0 z-[70] md:hidden" role="presentation">
    <button className="absolute inset-0 h-full w-full bg-black/65" aria-label={`Close ${title}`} onClick={onClose} />
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0d1016] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl">
      <header className="sticky top-0 z-10 flex min-h-12 items-center justify-between border-b border-white/10 bg-[#0d1016] px-4"><h2 className="font-serif text-lg">{title}</h2><button className="grid h-11 w-11 place-items-center rounded-md border border-white/15" onClick={onClose} aria-label={`Close ${title}`}>×</button></header>
      {children}
    </div>
  </div>;
}

export function DirectorsDeckPage() {
  const { selectedCompanyId } = useCompany();
  const companySlug = selectedCompanyId ?? "";

  const [books, setBooks] = useState<BookData[]>([]);
  const [booksLoading, setBooksLoading] = useState(true);
  const [booksError, setBooksError] = useState<string | null>(null);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [sectionCounts, setSectionCounts] = useState<Record<string, number | string>>({});
  const [reviewCount, setReviewCount] = useState(0);
  const [activeChapter, setActiveChapter] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<StoryBibleSectionId>("overview");
  const [centerMode, setCenterMode] = useState<"chapter" | "bible">("bible");
  const [mode, setMode] = useState<DirectorMode>("co");
  const [overlay, setOverlay] = useState<"inbox" | "taste" | "runplan" | "export" | null>(null);
  const [chatOpen, setChatOpen] = useState(() => {
    try { return localStorage.getItem("bookStudio.brainstormOpen") === "1"; } catch { return false; }
  });
  const [mediaOpen, setMediaOpen] = useState(false);
  const [newBookOpen, setNewBookOpen] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<"chapters" | "bible" | "inspect" | "tools" | null>(null);
  const [proseRefreshKey, setProseRefreshKey] = useState(0);
  const activeBookRequestRef = useRef<string | null>(null);

  const activeBook = useMemo(() => books.find((b) => b.id === activeBookId) ?? null, [books, activeBookId]);

  useEffect(() => {
    try { localStorage.setItem("bookStudio.brainstormOpen", chatOpen ? "1" : "0"); } catch { /* private mode */ }
  }, [chatOpen]);

  // ── load books ──
  useEffect(() => {
    if (!companySlug) { setBooks([]); setActiveBookId(null); setBooksLoading(false); return; }
    setBooksLoading(true);
    setBooksError(null);
    apiFetch<{ books: BookData[] }>(`/companies/${companySlug}/book-studio/books`)
      .then(({ books: list }) => {
        setBooks(list);
        setActiveBookId((current) => list.some((book) => book.id === current) ? current : list[0]?.id ?? null);
      })
      .catch((err) => { setBooks([]); setActiveBookId(null); setBooksError(err instanceof Error ? err.message : String(err)); })
      .finally(() => setBooksLoading(false));
  }, [companySlug]);

  // ── load per-book data ──
  const loadBookData = useCallback(async (bookId: string) => {
    activeBookRequestRef.current = bookId;
    setOutline([]);
    setChapters([]);
    setSectionCounts({});
    setReviewCount(0);
    const p = `/companies/${companySlug}/book-studio/books/${bookId}`;
    const [outlineRes, chaptersRes, charsRes, locsRes, styleRes, queueRes] = await Promise.allSettled([
      apiFetch<{ outline: OutlineEntry[] }>(`${p}/outline`),
      apiFetch<{ chapters: ChapterRow[] }>(`${p}/chapters`),
      apiFetch<{ characters: unknown[] }>(`${p}/characters`),
      apiFetch<{ "world-locations": unknown[] }>(`${p}/world-locations`),
      apiFetch<{ style: unknown[] }>(`${p}/style`),
      apiFetch<{ pendingCount: number }>(`${p}/bible-review-queue`),
    ]);
    if (activeBookRequestRef.current !== bookId) return;
    if (outlineRes.status === "fulfilled") setOutline(outlineRes.value.outline ?? []);
    if (chaptersRes.status === "fulfilled") setChapters(chaptersRes.value.chapters ?? []);
    const counts: Record<string, number | string> = {
      overview: "—",
      characters: charsRes.status === "fulfilled" ? charsRes.value.characters.length : 0,
      "world-locations": locsRes.status === "fulfilled" ? locsRes.value["world-locations"].length : 0,
      style: styleRes.status === "fulfilled" ? styleRes.value.style.length : 0,
    };
    // Codex counts (0159-gated: unavailable → "?")
    await Promise.all([...CODEX_TYPES].map(async (t) => {
      try {
        const r = await apiFetch<{ available: boolean; entities: unknown[] }>(`${p}/codex/${t}`);
        counts[t] = r.available ? r.entities.length : "?";
      } catch { counts[t] = "?"; }
    }));
    try {
      const r = await apiFetch<{ available: boolean; relationships: unknown[] }>(`${p}/codex-relationships`);
      counts.relationships = r.available ? r.relationships.length : "?";
    } catch { counts.relationships = "?"; }
    try {
      const r = await apiFetch<{ available: boolean; known: unknown[] }>(`${p}/codex-facts?chapter=9999`);
      counts.facts = r.available ? r.known.length : "?";
    } catch { counts.facts = "?"; }
    if (activeBookRequestRef.current !== bookId) return;
    setSectionCounts(counts);
    if (queueRes.status === "fulfilled") setReviewCount(queueRes.value.pendingCount ?? 0);
  }, [companySlug]);

  useEffect(() => {
    if (!activeBook) { activeBookRequestRef.current = null; setOutline([]); setChapters([]); setSectionCounts({}); return; }
    void loadBookData(activeBook.id);
    const m = (activeBook.metadata?.directorMode as DirectorMode | undefined) ?? "co";
    setMode(m);
  }, [activeBookId]);

  // ── rail models ──
  const deckChapters: DeckChapter[] = useMemo(() => {
    const byNumber = new Map(chapters.map((c) => [c.chapterNumber, c]));
    const outlineByNumber = new Map(outline.map((entry) => [entry.chapterNumber, entry]));
    const chapterStatus = (activeBook?.metadata?.chapterStatus ?? {}) as Record<string, string>;
    const chapterNumbers = new Set([
      ...outline.map((entry) => entry.chapterNumber),
      ...chapters.map((entry) => entry.chapterNumber),
    ]);
    return [...chapterNumbers]
      .sort((a, b) => a - b)
      .map((chapterNumber) => {
        const o = outlineByNumber.get(chapterNumber);
        const ch = byNumber.get(chapterNumber);
        const words = (ch?.content ?? "").split(/\s+/).filter(Boolean).length;
        const status = chapterStatus[String(chapterNumber)];
        const state: DeckChapter["state"] =
          status === "exception" ? "fail"
          : status === "queued" || (ch?.content ?? "").trim() ? "pass"
          : status === "drafting" || status === "draft-pending-review" ? "run"
          : "idle";
        return {
          chapterNumber,
          title: o?.title || ch?.title || `Chapter ${chapterNumber}`,
          state,
          meta: state === "pass" ? `Ready · ${words}w` : state === "fail" ? "Canon exception" : state === "run" ? "Working" : "Planned",
          score: null,
          locked: Boolean(ch?.locked || o?.locked),
        };
      });
  }, [outline, chapters, activeBook]);

  const deckSections: DeckBibleSection[] = useMemo(() =>
    STORY_BIBLE_SECTIONS.filter((s) => s.id !== "review-queue").map((s) => {
      const count = sectionCounts[s.id] ?? 0;
      const n = typeof count === "number" ? count : 0;
      return { ...s, count, ready: s.id === "overview" ? "ok" : n > 2 ? "ok" : n > 0 ? "thin" : "none" };
    }), [sectionCounts]);

  async function handleCreateBook(title: string) {
    // Create responses are wrapped — unwrap { book } (see BookWritingPage.createBook).
    const { book } = await apiFetch<{ book: BookData }>(`/companies/${companySlug}/book-studio/books`, {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    setBooks((prev) => [book, ...prev]);
    setActiveBookId(book.id);
  }

  function applyUpdatedBook(updated: BookData) {
    setBooks((current) => current.map((book) => book.id === updated.id ? updated : book));
  }

  async function handleRenameBook(title: string) {
    if (!activeBook) throw new Error("Select a book before renaming it.");
    const { book } = await apiFetch<{ book: BookData }>(`/companies/${companySlug}/book-studio/books/${activeBook.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    applyUpdatedBook(book);
  }

  async function handleModeChange(m: DirectorMode) {
    setMode(m);
    if (!activeBook) return;
    // Director Mode = the old autonomy dial, renamed (§2): co→manual,
    // chapter→assisted, act→autopilot — stored alongside the legacy field.
    const autonomyMode = m === "co" ? "manual" : m === "chapter" ? "assisted" : "autopilot";
    await apiFetch(`/companies/${companySlug}/book-studio/books/${activeBook.id}`, {
      method: "PATCH",
      body: JSON.stringify({ metadata: { directorMode: m, autonomyMode } }),
    }).catch(() => {});
  }

  async function handleUnlockChapter(n: number) {
    if (!activeBook) return;
    await apiFetch(`/companies/${companySlug}/book-studio/books/${activeBook.id}/chapters/${n}/lock`, {
      method: "PATCH",
      body: JSON.stringify({ locked: false }),
    }).catch(() => {});
    loadBookData(activeBook.id);
  }

  async function handleLockToggle(n: number, locked: boolean) {
    if (!activeBook) return;
    await apiFetch(`/companies/${companySlug}/book-studio/books/${activeBook.id}/chapters/${n}/lock`, {
      method: "PATCH",
      body: JSON.stringify({ locked }),
    }).catch(() => {});
    loadBookData(activeBook.id);
  }

  const activeOutline = useMemo(
    () => outline.find((o) => o.chapterNumber === activeChapter) ?? null,
    [outline, activeChapter],
  );
  const activeChapterLocked = useMemo(() => {
    const ch = chapters.find((c) => c.chapterNumber === activeChapter);
    return Boolean(ch?.locked || activeOutline?.locked);
  }, [chapters, activeOutline, activeChapter]);
  const chapterStatusMap = (activeBook?.metadata?.chapterStatus ?? {}) as Record<string, string>;

  return (
    <div className="grid h-full grid-rows-[52px_auto_1fr] md:grid-rows-[52px_1fr] bg-[#0a0c10] text-[#ece9e2] font-sans">
      <DeckTopBar
        books={books.map(({ id, slug, title }) => ({ id, slug, title }))}
        activeBookId={activeBookId}
        booksLoading={booksLoading}
        onSelectBook={setActiveBookId}
        onRenameBook={handleRenameBook}
        onNewBook={() => setNewBookOpen(true)}
        status={{
          ready: deckChapters.filter((c) => c.state === "pass").length,
          working: deckChapters.filter((c) => c.state === "run").length,
          exception: deckChapters.filter((c) => c.state === "fail").length,
        }}
        mode={mode}
        onModeChange={handleModeChange}
        onTaste={() => setOverlay("taste")}
        onRunPlan={() => setOverlay("runplan")}
        onBrainstorm={() => setChatOpen(true)}
        onMedia={() => setMediaOpen((open) => !open)}
        onExport={() => setOverlay("export")}
      />
      <nav className="grid grid-cols-4 gap-px border-b border-white/10 bg-[#0d1016] md:hidden" aria-label="Book tools">
        {(["chapters", "bible", "inspect", "tools"] as const).map((sheet) => <button key={sheet} className="min-h-11 px-1 text-[11px] font-semibold" onClick={() => setMobileSheet(sheet)}>{sheet === "bible" ? "Story Bible" : sheet[0].toUpperCase() + sheet.slice(1)}</button>)}
      </nav>
      <div className="grid grid-cols-1 lg:grid-cols-[272px_minmax(460px,1fr)_322px] md:grid-cols-[240px_minmax(0,1fr)] min-h-0">
        <div className="hidden md:block min-h-0">
          <DeckRail
            chapters={deckChapters}
            activeChapter={activeChapter}
            onSelectChapter={(n) => { setActiveChapter(n); setCenterMode("chapter"); }}
            onUnlockChapter={handleUnlockChapter}
            sections={deckSections}
            activeSection={activeSection}
            onSelectSection={(id) => { setActiveSection(id as StoryBibleSectionId); setCenterMode("bible"); }}
            reviewCount={reviewCount}
            onOpenReviewQueue={() => { setActiveSection("review-queue"); setCenterMode("bible"); }}
          />
        </div>
        <main className="min-w-0 overflow-hidden bg-[#0a0c10] flex flex-col">
          {centerMode === "bible" && activeBook && isLegacyStoryBibleSection(activeSection) ? (
            <div className="flex-1 overflow-auto"><StoryBibleSectionEditor key={`${activeBook.id}:${activeSection}`} companySlug={companySlug} book={activeBook} section={activeSection} onBookUpdated={applyUpdatedBook} onChanged={() => void loadBookData(activeBook.id)} /></div>
          ) : centerMode === "bible" && activeBook ? (
            <div className="flex-1 overflow-auto"><CodexPanel key={`${activeBook.id}:${activeSection}`} bookId={activeBook.id} companySlug={companySlug} currentChapter={activeChapter ?? 1} activeSection={activeSection as CodexSectionId} showSectionPicker={false} /></div>
          ) : activeBook && activeChapter != null ? (
            <div className="flex-1 min-h-0">
              <DeckWorkspace
                bookId={activeBook.id}
                bookSlug={activeBook.slug}
                companySlug={companySlug}
                chapterNumber={activeChapter}
                chapterTitle={activeOutline?.title || chapters.find((c) => c.chapterNumber === activeChapter)?.title || `Chapter ${activeChapter}`}
                outlineEntry={activeOutline ? { id: activeOutline.id, chapterNumber: activeOutline.chapterNumber, title: activeOutline.title, beats: activeOutline.beats ?? [] } : null}
                locked={activeChapterLocked}
                chapterStatus={chapterStatusMap[String(activeChapter)] ?? null}
                onLockToggle={() => handleLockToggle(activeChapter, !activeChapterLocked)}
                onNeedsRefresh={() => loadBookData(activeBook.id)}
                onOpenDecisionInbox={() => setOverlay("inbox")}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              {booksError ? `Could not load books: ${booksError}` : activeBook ? "Select a chapter in the queue" : "Select or create a book"}
            </div>
          )}
        </main>
        {activeBook && (
          <div className="hidden lg:block min-h-0">
            <DeckInspector
              bookId={activeBook.id}
              companySlug={companySlug}
              chapterNumber={activeChapter}
              chapterStatus={activeChapter != null ? chapterStatusMap[String(activeChapter)] ?? null : null}
              onJumpToBeats={() => { setCenterMode("chapter"); }}
              onOpenDecisionInbox={() => setOverlay("inbox")}
              onSelectChapter={(n) => { setActiveChapter(n); setCenterMode("chapter"); }}
              onHighlightOffset={() => { /* deep-link highlight lands with the Prose view rework */ }}
              onRevisionAccepted={() => { setProseRefreshKey((k) => k + 1); loadBookData(activeBook.id); }}
            />
          </div>
        )}
      </div>

      {/* overlays */}
      {newBookOpen && (
        <NewBookModal onClose={() => setNewBookOpen(false)} onCreate={handleCreateBook} />
      )}
      {overlay === "inbox" && activeBook && (
        <DecisionInbox
          bookId={activeBook.id}
          companySlug={companySlug}
          onClose={() => setOverlay(null)}
          onOpenChapter={(n) => { setActiveChapter(n); setCenterMode("chapter"); }}
        />
      )}
      {overlay === "taste" && activeBook && (
        <TasteSheet bookId={activeBook.id} companySlug={companySlug} metadata={activeBook.metadata ?? {}} onClose={() => setOverlay(null)} />
      )}
      {overlay === "runplan" && activeBook && (
        <RunPlanSheet bookId={activeBook.id} companySlug={companySlug} onClose={() => setOverlay(null)} onChanged={() => loadBookData(activeBook.id)} />
      )}
      {overlay === "export" && activeBook && (
        <ExportSheet bookId={activeBook.id} companySlug={companySlug} bookTitle={activeBook.title} chapterCount={outline.length} onClose={() => setOverlay(null)} />
      )}
      {activeBook && (
        <ChatDrawer
          bookId={activeBook.id}
          companySlug={companySlug}
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          activeBookTitle={activeBook.title}
          onBookChanged={(section, chapterNumber) => {
            if (section === "outline" && chapterNumber) { setActiveChapter(chapterNumber); setCenterMode("chapter"); }
            else if (section && isStoryBibleSectionId(section)) { setActiveSection(section); setCenterMode("bible"); }
            void loadBookData(activeBook.id);
          }}
        />
      )}
      {activeBook && <BookMediaPanel bookId={activeBook.id} bookTitle={activeBook.title} open={mediaOpen} onOpenChange={setMediaOpen} showLauncher={false} />}
      {mobileSheet === "chapters" && <MobileSheet title="Chapters" onClose={() => setMobileSheet(null)}><DeckRail chapters={deckChapters} activeChapter={activeChapter} onSelectChapter={(n) => { setActiveChapter(n); setCenterMode("chapter"); setMobileSheet(null); }} onUnlockChapter={handleUnlockChapter} sections={deckSections} activeSection={activeSection} onSelectSection={() => {}} reviewCount={reviewCount} onOpenReviewQueue={() => {}} mobileSection="chapters" /></MobileSheet>}
      {mobileSheet === "bible" && <MobileSheet title="Story Bible" onClose={() => setMobileSheet(null)}><DeckRail chapters={deckChapters} activeChapter={activeChapter} onSelectChapter={() => {}} onUnlockChapter={handleUnlockChapter} sections={deckSections} activeSection={activeSection} onSelectSection={(id) => { setActiveSection(id as StoryBibleSectionId); setCenterMode("bible"); setMobileSheet(null); }} reviewCount={reviewCount} onOpenReviewQueue={() => { setActiveSection("review-queue"); setCenterMode("bible"); setMobileSheet(null); }} mobileSection="bible" /></MobileSheet>}
      {mobileSheet === "inspect" && activeBook && <MobileSheet title="Inspect" onClose={() => setMobileSheet(null)}><div className="h-[70dvh]"><DeckInspector bookId={activeBook.id} companySlug={companySlug} chapterNumber={activeChapter} chapterStatus={activeChapter != null ? chapterStatusMap[String(activeChapter)] ?? null : null} onJumpToBeats={() => { setCenterMode("chapter"); setMobileSheet(null); }} onOpenDecisionInbox={() => { setMobileSheet(null); setOverlay("inbox"); }} onSelectChapter={(n) => { setActiveChapter(n); setCenterMode("chapter"); setMobileSheet(null); }} onHighlightOffset={() => {}} onRevisionAccepted={() => { setProseRefreshKey((k) => k + 1); void loadBookData(activeBook.id); }} /></div></MobileSheet>}
      {mobileSheet === "tools" && <MobileSheet title="Tools" onClose={() => setMobileSheet(null)}><div className="grid gap-2 p-4"><button className="min-h-11 rounded border border-white/15" onClick={() => { setNewBookOpen(true); setMobileSheet(null); }}>New Book</button><select className="min-h-11 rounded bg-[#171b24] px-3" value={mode} onChange={(e) => void handleModeChange(e.target.value as DirectorMode)} aria-label="Director mode"><option value="co">Co-writer</option><option value="chapter">Chapter</option><option value="act">Act</option></select><button className="min-h-11 rounded border border-white/15" onClick={() => { setOverlay("taste"); setMobileSheet(null); }}>Taste</button><button className="min-h-11 rounded border border-white/15" onClick={() => { setOverlay("runplan"); setMobileSheet(null); }}>Run Plan</button><button className="min-h-11 rounded border border-white/15" onClick={() => { setOverlay("export"); setMobileSheet(null); }}>Export</button><button className="min-h-11 rounded border border-white/15" onClick={() => { setChatOpen(true); setMobileSheet(null); }}>Brainstorm</button><button className="min-h-11 rounded border border-white/15" onClick={() => { setMediaOpen(true); setMobileSheet(null); }}>Media</button></div></MobileSheet>}
    </div>
  );
}

export default DirectorsDeckPage;
