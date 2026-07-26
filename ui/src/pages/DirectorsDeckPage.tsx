// Director's Deck (Spec v1 §1–2) — the new Book Studio shell, slice 3a.
// Top bar + left rail wired to real data; the center embeds the existing
// ManuscriptEditor so full parity is preserved from day one (3b replaces it
// with the Beats/Prose/Context/Bible workspace, 3c adds the inspector +
// overlays). Mounted at /:company/book-deck alongside the classic page.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DeckTopBar, type DirectorMode } from "@/components/book-studio/deck/DeckTopBar";
import { DeckRail, type DeckChapter, type DeckBibleSection } from "@/components/book-studio/deck/DeckRail";
import { ManuscriptEditor } from "@/components/book-studio/ManuscriptEditor";
import { CodexPanel } from "@/components/book-studio/CodexPanel";
import { useCompany } from "../context/CompanyContext";

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

interface BookData { id: string; slug: string; title: string; metadata: Record<string, unknown> }
interface OutlineEntry { id: string; chapterNumber: number; title: string; locked: boolean }
interface ChapterRow { id: string; chapterNumber: number; title: string; content: string; locked: boolean }

const BIBLE_SECTION_DEFS = [
  { id: "overview", icon: "📕", label: "Overview" },
  { id: "characters", icon: "👤", label: "Characters" },
  { id: "world-locations", icon: "🏔️", label: "Locations" },
  { id: "style", icon: "🎨", label: "Style" },
  { id: "lore", icon: "📜", label: "Lore" },
  { id: "factions", icon: "⚑", label: "Factions" },
  { id: "objects", icon: "🗡️", label: "Objects" },
  { id: "systems", icon: "✦", label: "Systems" },
  { id: "timeline", icon: "🕰️", label: "Timeline" },
  { id: "threads", icon: "🧵", label: "Threads" },
  { id: "themes", icon: "💭", label: "Themes" },
  { id: "glossary", icon: "📖", label: "Glossary" },
  { id: "relationships", icon: "🔗", label: "Relationships" },
  { id: "facts", icon: "▪️", label: "Facts" },
];

const CODEX_TYPES = new Set(["lore", "factions", "objects", "systems", "timeline", "threads", "themes", "glossary"]);

export function DirectorsDeckPage() {
  const { selectedCompanyId } = useCompany();
  const companySlug = selectedCompanyId ?? "";

  const [books, setBooks] = useState<BookData[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [sectionCounts, setSectionCounts] = useState<Record<string, number | string>>({});
  const [reviewCount, setReviewCount] = useState(0);
  const [activeChapter, setActiveChapter] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [mode, setMode] = useState<DirectorMode>("co");
  const [showCodex, setShowCodex] = useState(false);

  const activeBook = useMemo(() => books.find((b) => b.id === activeBookId) ?? null, [books, activeBookId]);

  // ── load books ──
  useEffect(() => {
    if (!companySlug) return;
    apiFetch<{ books: BookData[] }>(`/companies/${companySlug}/book-studio/books`)
      .then(({ books: list }) => {
        setBooks(list);
        if (list.length && !activeBookId) setActiveBookId(list[0].id);
      })
      .catch(() => {});
  }, [companySlug]);

  // ── load per-book data ──
  const loadBookData = useCallback(async (bookId: string) => {
    const p = `/companies/${companySlug}/book-studio/books/${bookId}`;
    const [outlineRes, chaptersRes, charsRes, locsRes, styleRes, queueRes] = await Promise.allSettled([
      apiFetch<{ outline: OutlineEntry[] }>(`${p}/outline`),
      apiFetch<{ chapters: ChapterRow[] }>(`${p}/chapters`),
      apiFetch<{ characters: unknown[] }>(`${p}/characters`),
      apiFetch<{ "world-locations": unknown[] }>(`${p}/world-locations`),
      apiFetch<{ style: unknown[] }>(`${p}/style`),
      apiFetch<{ pendingCount: number }>(`${p}/bible-review-queue`),
    ]);
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
    setSectionCounts(counts);
    if (queueRes.status === "fulfilled") setReviewCount(queueRes.value.pendingCount ?? 0);
  }, [companySlug]);

  useEffect(() => {
    if (!activeBook) return;
    loadBookData(activeBook.id);
    const m = (activeBook.metadata?.directorMode as DirectorMode | undefined) ?? "co";
    setMode(m);
  }, [activeBookId]);

  // ── rail models ──
  const deckChapters: DeckChapter[] = useMemo(() => {
    const byNumber = new Map(chapters.map((c) => [c.chapterNumber, c]));
    const chapterStatus = (activeBook?.metadata?.chapterStatus ?? {}) as Record<string, string>;
    return outline
      .slice()
      .sort((a, b) => a.chapterNumber - b.chapterNumber)
      .map((o) => {
        const ch = byNumber.get(o.chapterNumber);
        const words = (ch?.content ?? "").split(/\s+/).filter(Boolean).length;
        const status = chapterStatus[String(o.chapterNumber)];
        const state: DeckChapter["state"] =
          status === "exception" ? "fail"
          : status === "queued" || (ch?.content ?? "").trim() ? "pass"
          : status === "drafting" || status === "draft-pending-review" ? "run"
          : "idle";
        return {
          chapterNumber: o.chapterNumber,
          title: o.title || ch?.title || `Chapter ${o.chapterNumber}`,
          state,
          meta: state === "pass" ? `Ready · ${words}w` : state === "fail" ? "Canon exception" : state === "run" ? "Working" : "Planned",
          score: null,
          locked: Boolean(ch?.locked || o.locked),
        };
      });
  }, [outline, chapters, activeBook]);

  const deckSections: DeckBibleSection[] = useMemo(() =>
    BIBLE_SECTION_DEFS.map((s) => {
      const count = sectionCounts[s.id] ?? 0;
      const n = typeof count === "number" ? count : 0;
      return { ...s, count, ready: s.id === "overview" ? "ok" : n > 2 ? "ok" : n > 0 ? "thin" : "none" };
    }), [sectionCounts]);

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

  return (
    <div className="grid grid-rows-[52px_1fr] h-full bg-[#0a0c10] text-[#ece9e2] font-sans">
      <DeckTopBar
        books={books.map(({ id, slug, title }) => ({ id, slug, title }))}
        activeBookId={activeBookId}
        onSelectBook={setActiveBookId}
        onNewBook={() => { /* 3b wires the creation prompt */ }}
        status={{
          ready: deckChapters.filter((c) => c.state === "pass").length,
          working: deckChapters.filter((c) => c.state === "run").length,
          exception: deckChapters.filter((c) => c.state === "fail").length,
        }}
        mode={mode}
        onModeChange={handleModeChange}
        onTaste={() => {}} onRunPlan={() => {}} onBrainstorm={() => {}}
        onMedia={() => {}} onExport={() => {}}
      />
      <div className="grid grid-cols-[272px_minmax(460px,1fr)] min-h-0">
        <DeckRail
          chapters={deckChapters}
          activeChapter={activeChapter}
          onSelectChapter={(n) => { setActiveChapter(n); setShowCodex(false); }}
          onUnlockChapter={handleUnlockChapter}
          sections={deckSections}
          activeSection={activeSection}
          onSelectSection={(id) => { setActiveSection(id); setShowCodex(true); }}
          reviewCount={reviewCount}
          onOpenReviewQueue={() => { setActiveSection("review-queue"); setShowCodex(true); }}
        />
        <main className="min-w-0 overflow-auto bg-[#0a0c10]">
          {showCodex && activeBook ? (
            <CodexPanel bookId={activeBook.id} companySlug={companySlug} currentChapter={activeChapter ?? 1} />
          ) : activeBook ? (
            <ManuscriptEditor
              bookId={activeBook.id}
              companySlug={companySlug}
              outlineEntries={outline as never}
              focusMode={false}
              onToggleFocus={() => {}}
              jumpToChapter={activeChapter}
              highlightRange={null}
              autonomyMode={mode === "act" ? "autopilot" : mode === "chapter" ? "assisted" : "manual"}
              contentRefreshKey={0}
              onChapterChange={setActiveChapter}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">Select or create a book</div>
          )}
        </main>
      </div>
    </div>
  );
}

export default DirectorsDeckPage;
