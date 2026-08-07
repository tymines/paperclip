/**
 * ManuscriptEditor — markdown editor with chapter selector, autosave, focus mode, word count.
 * ponytail: textarea + dangerouslySetInnerHTML for preview, no editor lib.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Maximize, Minimize, Eye, Edit3, Sparkles, Square, CheckCircle2, MessageSquare, Loader2, Lock, LockOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnnotationSidebar } from "./AnnotationSidebar";

interface OutlineEntry {
  id: string;
  chapterNumber: number;
  title: string;
  beats: Record<string, unknown>[];
  /** Spec v1 §7 — locked chapters refuse every AI write (server-enforced; this mirrors it for display). */
  locked?: boolean;
}

interface PassageLock {
  id: string;
  spanStart: number;
  spanEnd: number;
  note: string;
  stale: boolean;
}

interface Props {
  bookId: string;
  companySlug: string;
  outlineEntries: OutlineEntry[];
  focusMode: boolean;
  onToggleFocus: () => void;
  /** ponytail: external chapter jump (e.g. from review note click) */
  jumpToChapter?: number | null;
  /** ponytail: select a text range in the active chapter (from review note offset) */
  highlightRange?: { chapterNumber: number; startOffset: number; endOffset: number } | null;
  /** Writing autonomy dial (persisted in books.metadata.autonomyMode). */
  autonomyMode?: "manual" | "assisted" | "autopilot";
  /** Bump to force a prose reload (e.g. after an accepted revision proposal — Spec v1 §5.D). */
  contentRefreshKey?: number;
  /** Reports the currently open chapter (e.g. so Review defaults to "this chapter", §5.A). */
  onChapterChange?: (chapterNumber: number | null) => void;
}

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

// ponytail: minimal markdown → HTML (paragraphs, bold, italic, headers)
function markdownToHtml(md: string): string {
  return md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h4 class='text-sm font-semibold text-gray-200 mt-3 mb-1'>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3 class='text-base font-bold text-gray-100 mt-4 mb-2'>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2 class='text-lg font-bold text-gray-100 mt-4 mb-2'>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .split(/\n\n+/)
    .map((p) => `<p class='mb-2 leading-relaxed'>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

export function ManuscriptEditor({ bookId, companySlug, outlineEntries, focusMode, onToggleFocus, jumpToChapter, highlightRange, autonomyMode = "manual", contentRefreshKey = 0, onChapterChange }: Props) {
  const chapters = [...outlineEntries].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const [selectedCh, setSelectedCh] = useState<number | null>(chapters[0]?.chapterNumber ?? null);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // SSE draft streaming
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  // After a stream ends, suppress the trailing autosave: on `done` the server
  // already persisted; on cancel/error the partial draft must NOT be silently
  // saved. A real user edit (onChange) clears the flag and autosave resumes.
  const skipAutosaveRef = useRef(false);
  // Annotation sidebar + editor text selection (the annotation anchor)
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  // Assisted-mode mark-done
  const [markingDone, setMarkingDone] = useState(false);
  const [assistNotice, setAssistNotice] = useState<string | null>(null);
  // Spec v1 §7 LOCK — chapter lock + passage locks (human-only; AI write paths 409)
  const [chapterLocked, setChapterLocked] = useState(false);
  const [passageLocks, setPassageLocks] = useState<PassageLock[]>([]);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockNotice, setLockNotice] = useState<string | null>(null);

  const API_PREFIX = `/companies/${companySlug}/book-studio/books/${bookId}`;
  // Last content loaded from / saved to the server — used to detect whether
  // the user has local unsaved divergence before applying a background refresh.
  const lastLoadedRef = useRef<string>("");

  // Acceptance finding #5: selectedCh was initialized ONCE at mount, before
  // outlineEntries loaded — leaving the editor stuck on "No chapters yet"
  // until a manual book re-select. Keep it synced as the outline arrives.
  useEffect(() => {
    if (chapters.length === 0) return;
    if (selectedCh == null || !chapters.some((c) => c.chapterNumber === selectedCh)) {
      setSelectedCh(chapters[0].chapterNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineEntries]);

  // Load chapter content when selected chapter changes
  useEffect(() => {
    if (selectedCh == null) return;
    let cancelled = false;
    apiFetch<{ chapters: Array<{ chapterNumber: number; title: string; content: string }> }>(
      `${API_PREFIX}/chapters`
    )
      .then((res) => {
        if (cancelled) return;
        const ch = res.chapters?.find((c) => c.chapterNumber === selectedCh);
        setContent(ch?.content ?? "");
        setTitle(ch?.title ?? "");
        lastLoadedRef.current = ch?.content ?? "";
        setSaveStatus("saved");
      })
      .catch(() => { if (!cancelled) setSaveStatus("error"); });
    return () => { cancelled = true; };
  }, [selectedCh, bookId]);

  // Spec v1 §7 — load lock state (chapter + passage locks) per chapter.
  const refreshLocks = useCallback(() => {
    if (selectedCh == null) return;
    apiFetch<{ locked: boolean; passageLocks: PassageLock[]; available: boolean }>(
      `${API_PREFIX}/chapters/${selectedCh}/locks`
    )
      .then((res) => {
        setChapterLocked(res.locked ?? false);
        setPassageLocks(res.passageLocks ?? []);
      })
      .catch(() => { /* locks are advisory in the UI — the server enforces */ });
  }, [selectedCh, API_PREFIX]);

  useEffect(() => {
    setLockNotice(null);
    refreshLocks();
  }, [refreshLocks]);

  const toggleChapterLock = useCallback(async () => {
    if (selectedCh == null || lockBusy) return;
    setLockBusy(true); setLockNotice(null);
    const next = !chapterLocked;
    try {
      await apiFetch<{ chapterNumber: number; locked: boolean }>(
        `${API_PREFIX}/chapters/${selectedCh}/lock`,
        { method: "PATCH", body: JSON.stringify({ locked: next }) },
      );
      setChapterLocked(next);
      setLockNotice(next
        ? `🔒 Chapter ${selectedCh} locked — the AI will skip or ask, never overwrite.`
        : `🔓 Chapter ${selectedCh} unlocked — AI writes allowed again.`);
    } catch (e) {
      setLockNotice(`⛔ Lock change refused: ${(e as Error).message}`);
    } finally {
      setLockBusy(false);
    }
  }, [selectedCh, chapterLocked, lockBusy, API_PREFIX]);

  const lockPassage = useCallback(async () => {
    if (selectedCh == null || !selection || lockBusy) return;
    setLockBusy(true); setLockNotice(null);
    try {
      await apiFetch<{ lock: PassageLock }>(
        `${API_PREFIX}/chapters/${selectedCh}/passage-locks`,
        { method: "POST", body: JSON.stringify({ spanStart: selection.start, spanEnd: selection.end }) },
      );
      setSelection(null);
      setLockNotice("🔒 Passage locked — revisions overlapping it will ask before touching it.");
      refreshLocks();
    } catch (e) {
      setLockNotice(`⛔ Passage lock refused: ${(e as Error).message}`);
    } finally {
      setLockBusy(false);
    }
  }, [selectedCh, selection, lockBusy, API_PREFIX, refreshLocks]);

  const unlockPassage = useCallback(async (lockId: string) => {
    if (lockBusy) return;
    setLockBusy(true); setLockNotice(null);
    try {
      await apiFetch<void>(`${API_PREFIX}/passage-locks/${lockId}`, { method: "DELETE" });
      refreshLocks();
    } catch (e) {
      setLockNotice(`⛔ Unlock refused: ${(e as Error).message}`);
    } finally {
      setLockBusy(false);
    }
  }, [lockBusy, API_PREFIX, refreshLocks]);

  // Accepted revision proposal landed server-side (Spec v1 §5.D): reload the
  // open chapter — with the same never-clobber guard as the autopilot poll, so
  // unsaved local edits are never overwritten silently.
  useEffect(() => {
    if (contentRefreshKey === 0 || selectedCh == null) return;
    let cancelled = false;
    apiFetch<{ chapters: Array<{ chapterNumber: number; title: string; content: string }> }>(
      `${API_PREFIX}/chapters`
    )
      .then((res) => {
        if (cancelled) return;
        const ch = res.chapters?.find((c) => c.chapterNumber === selectedCh);
        const fresh = ch?.content ?? "";
        setContent((current) => {
          if (current === lastLoadedRef.current) {
            lastLoadedRef.current = fresh;
            if (ch?.title) setTitle(ch.title);
            return fresh;
          }
          return current; // local unsaved edits win — never clobber
        });
      })
      .catch(() => { /* transient — the next navigation reloads */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentRefreshKey]);

  // While Autopilot is writing chapters server-side, refresh the open chapter
  // so the editor tracks reality (finding #5) — but never clobber local edits:
  // only apply when the pane still matches the last server-loaded content.
  useEffect(() => {
    if (autonomyMode !== "autopilot" || selectedCh == null) return;
    const t = setInterval(async () => {
      if (streamingRef.current) return;
      try {
        const res = await apiFetch<{ chapters: Array<{ chapterNumber: number; title: string; content: string }> }>(
          `${API_PREFIX}/chapters`
        );
        const ch = res.chapters?.find((c) => c.chapterNumber === selectedCh);
        const fresh = ch?.content ?? "";
        setContent((current) => {
          if (fresh !== lastLoadedRef.current && current === lastLoadedRef.current) {
            lastLoadedRef.current = fresh;
            if (ch?.title) setTitle(ch.title);
            return fresh;
          }
          return current;
        });
      } catch { /* transient poll failure — next tick */ }
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autonomyMode, selectedCh, bookId]);

  // Jump to chapter from external signal (e.g. review note click)
  useEffect(() => {
    if (jumpToChapter != null && chapters.some((c) => c.chapterNumber === jumpToChapter)) {
      setSelectedCh(jumpToChapter);
    }
  }, [jumpToChapter]);

  // Report the open chapter upward (Review "this chapter" default, §5.A)
  useEffect(() => { onChapterChange?.(selectedCh); }, [selectedCh, onChapterChange]);

  // Highlight text range from external signal (e.g. review note offset click)
  useEffect(() => {
    if (!highlightRange || selectedCh !== highlightRange.chapterNumber) return;
    const ta = textareaRef.current;
    if (ta && !preview) {
      ta.focus();
      ta.setSelectionRange(highlightRange.startOffset, highlightRange.endOffset);
    }
  }, [highlightRange, selectedCh]);

  // Autosave on content/title change (2s debounce)
  const save = useCallback(async (text: string, t: string) => {
    if (selectedCh == null) return;
    setSaveStatus("saving");
    try {
      await apiFetch(`${API_PREFIX}/chapters/${selectedCh}`, {
        method: "PATCH",
        body: JSON.stringify({ content: text, title: t }),
      });
      lastLoadedRef.current = text;
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, [selectedCh, bookId, companySlug]);

  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (selectedCh == null) return;
    // While an AI draft streams in, the SERVER persists the final result —
    // suppress the editor autosave so partial prose is never PATCHed.
    if (streamingRef.current) return;
    // Post-stream: skip until the user actually edits (see skipAutosaveRef).
    if (skipAutosaveRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveStatus("saving");
    debounceRef.current = setTimeout(() => save(content, title), 2000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [content, title]);

  // AI writer lane: compile the approved bible → draft real prose for this
  // chapter, streamed token-by-token over SSE (write-prose/stream). On any
  // failure to open the stream, falls back to the non-streaming endpoint.
  // On completion the server has already persisted via the same path the
  // non-streaming route uses.
  const draftProse = useCallback(async () => {
    if (selectedCh == null || drafting) return;
    setDrafting(true); setDraftError(null); setAssistNotice(null);
    const hasProse = content.trim().length > 0;
    const qs = hasProse ? "?overwrite=1" : "";
    const ac = new AbortController();
    streamAbortRef.current = ac;
    let streamedAny = false;
    let gotDone = false;
    try {
      const res = await fetch(`${API_BASE}${API_PREFIX}/chapters/${selectedCh}/write-prose/stream${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: ac.signal,
      });
      const ctype = res.headers.get("content-type") ?? "";
      if (!res.ok || !res.body || !ctype.includes("text/event-stream")) {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          // Spec v1 §7: 409 LOCKED — the server refused an AI write on locked
          // content. Surface the lock state, not a generic failure.
          let lockedMsg: string | null = null;
          try {
            const body = JSON.parse(text) as { error?: string; details?: { code?: string } };
            if (body?.details?.code === "LOCKED") lockedMsg = body.error ?? "Chapter is locked.";
          } catch { /* non-JSON error body */ }
          if (lockedMsg) {
            setLockNotice(`⛔ ${lockedMsg}`);
            refreshLocks();
            return;
          }
          throw new Error(`API ${res.status}: ${text || res.statusText}`);
        }
        // Stream endpoint unavailable — non-streaming fallback (kept working).
        const fallback = await apiFetch<{ title: string; content: string }>(
          `${API_PREFIX}/chapters/${selectedCh}/write-prose${qs}`,
          { method: "POST", body: JSON.stringify({}) },
        );
        setContent(fallback.content ?? "");
        if (fallback.title) setTitle(fallback.title);
        lastLoadedRef.current = fallback.content ?? "";
        setSaveStatus("saved");
        return;
      }

      streamingRef.current = true;
      skipAutosaveRef.current = true; // stream path owns persistence
      setStreaming(true);
      setContent(""); // stream into a clean pane
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let ev = "message";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) ev = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          let parsed: Record<string, unknown> | null = null;
          try { parsed = JSON.parse(data); } catch { /* keep-alive frame */ }
          if (!parsed) continue;
          const j = parsed;
          if (ev === "delta") {
            streamedAny = true;
            const text = typeof j.text === "string" ? j.text : "";
            setContent((c) => c + text);
          } else if (ev === "done") {
            gotDone = true;
            setContent(typeof j.content === "string" ? j.content : "");
            if (typeof j.title === "string" && j.title) setTitle(j.title);
            lastLoadedRef.current = typeof j.content === "string" ? j.content : "";
            setSaveStatus("saved");
          } else if (ev === "error") {
            // Spec v1 §7 TOCTOU: locked mid-draft — the server discarded the draft.
            if (j.code === "LOCKED") {
              setLockNotice(`⛔ ${typeof j.message === "string" ? j.message : "Chapter was locked while drafting."}`);
              refreshLocks();
              throw new Error("__LOCKED__");
            }
            throw new Error(typeof j.message === "string" ? j.message : "Stream error");
          }
        }
      }
      if (!gotDone) throw new Error("Stream ended without completing — draft was NOT saved.");
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setDraftError(streamedAny
          ? "Draft cancelled — partial text shown but NOT saved (edit it to keep it)."
          : "Draft cancelled.");
      } else if ((e as Error).message === "__LOCKED__") {
        // Already surfaced via lockNotice + lock state refresh — no draft error.
      } else {
        setDraftError((e as Error).message || "Draft failed");
      }
    } finally {
      streamingRef.current = false;
      setStreaming(false);
      streamAbortRef.current = null;
      setDrafting(false);
    }
  }, [selectedCh, drafting, content, API_PREFIX, refreshLocks]);

  const cancelDraftStream = useCallback(() => {
    streamAbortRef.current?.abort();
  }, []);

  // Assisted mode: marking a chapter done triggers ONE next-chapter draft,
  // parked for review — the server decides based on the persisted dial.
  const markDone = useCallback(async () => {
    if (selectedCh == null || markingDone) return;
    setMarkingDone(true); setAssistNotice(null);
    try {
      const res = await apiFetch<{
        autonomyMode: string;
        nextDraft: { chapterNumber: number; title: string } | null;
        nextDraftSkipped: string | null;
        nextDraftError: string | null;
      }>(`${API_PREFIX}/chapters/${selectedCh}/mark-done`, { method: "POST", body: JSON.stringify({}) });
      if (res.nextDraft) {
        setAssistNotice(`Ch.${selectedCh} marked done — Ch.${res.nextDraft.chapterNumber} draft ("${res.nextDraft.title}") generated and parked for review.`);
      } else if (res.nextDraftError) {
        setAssistNotice(`Ch.${selectedCh} marked done — next-chapter draft failed: ${res.nextDraftError}`);
      } else if (res.nextDraftSkipped) {
        setAssistNotice(`Ch.${selectedCh} marked done — ${res.nextDraftSkipped}`);
      } else {
        setAssistNotice(`Ch.${selectedCh} marked done${res.autonomyMode === "manual" ? " (manual mode — nothing auto-generates)" : ""}.`);
      }
    } catch (e) {
      setAssistNotice(`Mark done failed: ${(e as Error).message}`);
    } finally {
      setMarkingDone(false);
    }
  }, [selectedCh, markingDone, API_PREFIX]);

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  // Empty-state copy lives in the editor BODY (not the header strip, where it
  // rendered squished into a skinny column — Tyler, 2026-07-12).
  const noChapters = chapters.length === 0;
  const chapterTitle = noChapters
    ? "Manuscript"
    : selectedCh == null
      ? "Loading chapter…"
      : (chapters.find((c) => c.chapterNumber === selectedCh)?.title ?? `Chapter ${selectedCh}`);

  return (
    <div className="@container/manuscript flex h-full min-h-0 min-w-0 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-gray-800 px-3 py-3 @min-[760px]/manuscript:flex-row @min-[760px]/manuscript:items-center @min-[760px]/manuscript:justify-between @min-[760px]/manuscript:gap-x-3 @min-[760px]/manuscript:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 @min-[760px]/manuscript:gap-3">
          {!noChapters && (
            <select
              className="min-w-0 max-w-[55%] flex-1 truncate rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-sm text-gray-200 focus:border-blue-500/50 focus:outline-none @min-[760px]/manuscript:max-w-72"
              value={selectedCh ?? ""}
              onChange={(e) => setSelectedCh(parseInt(e.target.value, 10) || null)}
            >
              {chapters.map((ch) => (
                <option key={ch.id} value={ch.chapterNumber}>
                  Ch.{ch.chapterNumber}: {ch.title}{(ch.locked || ch.chapterNumber === selectedCh && chapterLocked) ? " 🔒" : ""}
                </option>
              ))}
            </select>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-gray-100" title={chapterTitle}>{chapterTitle}</h2>
            <p className="text-xs text-gray-500 whitespace-nowrap">{noChapters ? "No chapters" : `${wordCount.toLocaleString()} words`}</p>
          </div>
          {!noChapters && selectedCh != null && (
            <button
              onClick={toggleChapterLock}
              disabled={lockBusy}
              title={chapterLocked
                ? "Unlock this chapter — allow AI writes again (human-only action)"
                : "Lock this chapter — the AI will skip or ask before touching it, never overwrite (Spec v1 §7)"}
              className={cn(
                "shrink-0 rounded-md border px-2 py-1.5 text-xs flex items-center gap-1",
                chapterLocked
                  ? "border-amber-500/50 bg-amber-600/15 text-amber-300 hover:bg-amber-600/25"
                  : "border-gray-700 text-gray-400 hover:text-gray-200",
              )}
            >
              {lockBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : chapterLocked ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
              {chapterLocked ? "Locked" : "Lock"}
            </button>
          )}
        </div>

        <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto pb-1 @min-[760px]/manuscript:w-auto @min-[760px]/manuscript:flex-wrap @min-[760px]/manuscript:justify-end @min-[760px]/manuscript:overflow-visible @min-[760px]/manuscript:pb-0 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
          <button
            onClick={draftProse}
            disabled={drafting || selectedCh == null || chapterLocked}
            title={chapterLocked
              ? "Chapter is locked 🔒 — the AI never writes locked content. Unlock it to draft."
              : content.trim() ? "Redraft this chapter with AI (overwrites) — streams tokens live" : "Draft this chapter with AI from the approved bible — streams tokens live"}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs flex items-center gap-1.5",
              chapterLocked ? "border-gray-800 text-gray-600 cursor-not-allowed" :
              drafting ? "border-blue-500/40 bg-blue-600/10 text-blue-300" : "border-blue-500/30 text-blue-300 hover:bg-blue-600/10",
            )}
          >
            {drafting ? <Loader2 className="w-3 h-3 animate-spin" /> : chapterLocked ? <Lock className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
            {streaming ? "Streaming…" : drafting ? "Drafting…" : content.trim() ? "Redraft" : "AI Draft"}
          </button>
          {selection && !preview && selectedCh != null && (
            <button
              onClick={lockPassage}
              disabled={lockBusy}
              title={`Lock the selected passage (${selection.end - selection.start} chars) — directed revisions overlapping it will ask first (Spec v1 §7)`}
              className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-600/10 flex items-center gap-1.5"
            >
              <Lock className="w-3 h-3" /> Lock passage
            </button>
          )}
          {streaming && (
            <button
              onClick={cancelDraftStream}
              title="Cancel the streaming draft (nothing is saved on cancel)"
              className="rounded-md border border-red-700 px-3 py-1.5 text-xs text-red-400 hover:text-red-200 hover:border-red-500 flex items-center gap-1.5"
            >
              <Square className="w-3 h-3" /> Cancel
            </button>
          )}
          <button
            onClick={markDone}
            disabled={markingDone || selectedCh == null || drafting}
            title={
              autonomyMode === "assisted"
                ? "Mark this chapter done — Assisted mode drafts the NEXT chapter and parks it for review"
                : "Mark this chapter done (in Assisted mode this also drafts the next chapter)"
            }
            className="rounded-md border border-green-700 px-3 py-1.5 text-xs text-green-400 hover:text-green-200 hover:border-green-500 disabled:opacity-50 flex items-center gap-1.5"
          >
            {markingDone ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            {markingDone ? "Marking…" : "Mark Done"}
          </button>
          <button
            onClick={() => setShowAnnotations(!showAnnotations)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs flex items-center gap-1.5",
              showAnnotations ? "bg-purple-600/20 border-purple-500/40 text-purple-300" : "border-gray-700 text-gray-400 hover:text-gray-200",
            )}
            title="Span-anchored annotations for this chapter"
          >
            <MessageSquare className="w-3 h-3" /> Annotations
          </button>
          <button
            onClick={() => setPreview(!preview)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs flex items-center gap-1.5",
              preview ? "bg-blue-600/20 border-blue-500/40 text-blue-300" : "border-gray-700 text-gray-400 hover:text-gray-200"
            )}
          >
            {preview ? <Edit3 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {preview ? "Edit" : "Preview"}
          </button>
          <button
            onClick={onToggleFocus}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs flex items-center gap-1.5",
              focusMode ? "bg-orange-600/20 border-orange-500/40 text-orange-300" : "border-gray-700 text-gray-400 hover:text-gray-200"
            )}
          >
            {focusMode ? <Minimize className="w-3 h-3" /> : <Maximize className="w-3 h-3" />}
            {focusMode ? "Exit Focus" : "Focus"}
          </button>
        </div>
      </div>

      {/* Spec v1 §7 — passage locks for the open chapter (amber; stale flagged) */}
      {passageLocks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-5 py-1.5 shrink-0">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">Locked passages</span>
          {passageLocks.map((l) => (
            <span
              key={l.id}
              title={`${l.note || "Locked passage"} — offsets ${l.spanStart}–${l.spanEnd}${l.stale ? " — chapter changed since this lock was set (stale anchor, still honored)" : ""}`}
              className={cn(
                "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]",
                l.stale ? "border-orange-500/40 text-orange-300" : "border-amber-500/40 text-amber-300",
              )}
            >
              <Lock className="w-2.5 h-2.5" />
              {l.spanStart}–{l.spanEnd}{l.stale ? " (stale)" : ""}
              <button
                onClick={() => unlockPassage(l.id)}
                disabled={lockBusy}
                title="Remove this passage lock (human-only)"
                className="ml-0.5 text-gray-500 hover:text-red-400"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Editor / Preview (+ annotation sidebar) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {noChapters ? (
            <div className="flex h-full items-center justify-center p-8">
              <div className="max-w-md text-center">
                <div className="mb-3 text-2xl opacity-40">✍️</div>
                <p className="text-sm font-medium text-gray-300">No chapters yet</p>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-500">
                  Add a chapter in the <span className="text-gray-300">Outline</span> tab —
                  or use <span className="text-gray-300">Generate with AI</span> there to draft
                  a full outline — and the manuscript editor will open on it.
                </p>
              </div>
            </div>
          ) : preview ? (
            <div
              className="h-full overflow-y-auto p-5 prose prose-invert prose-sm max-w-none break-words text-gray-200"
              dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
            />
          ) : (
            <textarea
              ref={textareaRef}
              className="w-full h-full resize-none bg-gray-950 px-5 py-4 text-sm text-gray-200 placeholder-gray-600 leading-relaxed focus:outline-none font-mono"
              placeholder="Write your manuscript here..."
              value={content}
              readOnly={streaming}
              onChange={(e) => {
                skipAutosaveRef.current = false; // real edit — autosave resumes
                setContent(e.target.value);
              }}
              onSelect={(e) => {
                const ta = e.currentTarget;
                setSelection(
                  ta.selectionStart !== ta.selectionEnd
                    ? { start: ta.selectionStart, end: ta.selectionEnd }
                    : null,
                );
              }}
            />
          )}
        </div>
        {showAnnotations && selectedCh != null && (
          <AnnotationSidebar
            bookId={bookId}
            companySlug={companySlug}
            chapterNumber={selectedCh}
            selection={selection}
            onJumpToSpan={(start, end) => {
              const ta = textareaRef.current;
              if (ta && !preview) {
                ta.focus();
                ta.setSelectionRange(start, end);
              }
            }}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-gray-800 px-5 py-2 shrink-0">
        <span className="text-xs text-gray-600">
          {lockNotice ? (
            <span className="text-amber-400">{lockNotice}</span>
          ) : draftError ? (
            <span className="text-red-500">{draftError}</span>
          ) : assistNotice ? (
            <span className="text-green-400">{assistNotice}</span>
          ) : (
            `${wordCount.toLocaleString()} words`
          )}
        </span>
        <span className={cn(
          "text-xs",
          streaming ? "text-blue-400" :
          saveStatus === "saved" ? "text-green-500" :
          saveStatus === "saving" ? "text-yellow-500" : "text-red-500",
        )}>
          {streaming ? "Streaming draft… (saved on completion)" : saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving..." : "Save failed"}
        </span>
      </div>
    </div>
  );
}

export default ManuscriptEditor;
