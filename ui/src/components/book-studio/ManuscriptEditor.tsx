/**
 * ManuscriptEditor — markdown editor with chapter selector, autosave, focus mode, word count.
 * ponytail: textarea + dangerouslySetInnerHTML for preview, no editor lib.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Maximize, Minimize, Eye, Edit3, Sparkles, Square, CheckCircle2, MessageSquare, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnnotationSidebar } from "./AnnotationSidebar";

interface OutlineEntry {
  id: string;
  chapterNumber: number;
  title: string;
  beats: Record<string, unknown>[];
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

export function ManuscriptEditor({ bookId, companySlug, outlineEntries, focusMode, onToggleFocus, jumpToChapter, highlightRange, autonomyMode = "manual" }: Props) {
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
      } else {
        setDraftError((e as Error).message || "Draft failed");
      }
    } finally {
      streamingRef.current = false;
      setStreaming(false);
      streamAbortRef.current = null;
      setDrafting(false);
    }
  }, [selectedCh, drafting, content, API_PREFIX]);

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
  const chapterTitle = selectedCh == null
    ? "No chapters yet — add one in the Outline tab to start writing"
    : (chapters.find((c) => c.chapterNumber === selectedCh)?.title ?? `Chapter ${selectedCh}`);

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <select
            className="rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50"
            value={selectedCh ?? ""}
            onChange={(e) => setSelectedCh(parseInt(e.target.value, 10) || null)}
          >
            {chapters.map((ch) => (
              <option key={ch.id} value={ch.chapterNumber}>
                Ch.{ch.chapterNumber}: {ch.title}
              </option>
            ))}
          </select>
          <div>
            <h2 className="text-sm font-semibold text-gray-100">{chapterTitle}</h2>
            <p className="text-xs text-gray-500">{wordCount.toLocaleString()} words</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={draftProse}
            disabled={drafting || selectedCh == null}
            title={content.trim() ? "Redraft this chapter with AI (overwrites) — streams tokens live" : "Draft this chapter with AI from the approved bible — streams tokens live"}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs flex items-center gap-1.5",
              drafting ? "border-blue-500/40 bg-blue-600/10 text-blue-300" : "border-blue-500/30 text-blue-300 hover:bg-blue-600/10",
            )}
          >
            {drafting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {streaming ? "Streaming…" : drafting ? "Drafting…" : content.trim() ? "Redraft" : "AI Draft"}
          </button>
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

      {/* Editor / Preview (+ annotation sidebar) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {preview ? (
            <div
              className="h-full overflow-y-auto p-5 prose prose-invert prose-sm max-w-none text-gray-200"
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
          {draftError ? (
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
