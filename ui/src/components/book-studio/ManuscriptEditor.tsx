/**
 * ManuscriptEditor — markdown editor with chapter selector, autosave, focus mode, word count.
 * ponytail: textarea + dangerouslySetInnerHTML for preview, no editor lib.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Maximize, Minimize, Eye, Edit3 } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function ManuscriptEditor({ bookId, companySlug, outlineEntries, focusMode, onToggleFocus }: Props) {
  const chapters = [...outlineEntries].sort((a, b) => a.chapterNumber - b.chapterNumber);
  const [selectedCh, setSelectedCh] = useState(chapters[0]?.chapterNumber ?? null);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  const API_PREFIX = `/companies/${companySlug}/book-studio/books/${bookId}`;

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
        setSaveStatus("saved");
      })
      .catch(() => { if (!cancelled) setSaveStatus("error"); });
    return () => { cancelled = true; };
  }, [selectedCh, bookId]);

  // Autosave on content/title change (2s debounce)
  const save = useCallback(async (text: string, t: string) => {
    if (selectedCh == null) return;
    setSaveStatus("saving");
    try {
      await apiFetch(`${API_PREFIX}/chapters/${selectedCh}`, {
        method: "PATCH",
        body: JSON.stringify({ content: text, title: t }),
      });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, [selectedCh, bookId, companySlug]);

  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (selectedCh == null) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveStatus("saving");
    debounceRef.current = setTimeout(() => save(content, title), 2000);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [content, title]);

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const chapterTitle = chapters.find((c) => c.chapterNumber === selectedCh)?.title ?? `Chapter ${selectedCh}`;

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

      {/* Editor / Preview */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {preview ? (
          <div
            className="h-full overflow-y-auto p-5 prose prose-invert prose-sm max-w-none text-gray-200"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
          />
        ) : (
          <textarea
            className="w-full h-full resize-none bg-gray-950 px-5 py-4 text-sm text-gray-200 placeholder-gray-600 leading-relaxed focus:outline-none font-mono"
            placeholder="Write your manuscript here..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-gray-800 px-5 py-2 shrink-0">
        <span className="text-xs text-gray-600">
          {wordCount.toLocaleString()} words
        </span>
        <span className={cn(
          "text-xs",
          saveStatus === "saved" && "text-green-500",
          saveStatus === "saving" && "text-yellow-500",
          saveStatus === "error" && "text-red-500",
        )}>
          {saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving..." : "Save failed"}
        </span>
      </div>
    </div>
  );
}

export default ManuscriptEditor;
