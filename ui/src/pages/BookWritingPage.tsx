/**
 * Book Writing Page — AI-powered book authoring studio.
 *
 * Features:
 *   - Chapter management (create, edit, reorder, delete)
 *   - Genre / tone / length selection
 *   - Pipeline start + status polling (every 5s)
 *   - Placeholder panels for narration (ElevenLabs) and image (FAL)
 *
 * Pattern matches ImageStudio.tsx / AppDev.tsx — tanstack/react-query, CompanyContext.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Play,
  Square,
  SkipForward,
  RotateCcw,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Volume2,
  ImageIcon,
  Loader2,
  BookOpen,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { useCompany } from "../context/CompanyContext";
import { bookWritingApi, type PipelineStatus } from "../api/bookWriting";
import { cn } from "@/lib/utils";

// ── Constants ───────────────────────────────────────────────────────────────

const GENRES = [
  "Sci-Fi",
  "Fantasy",
  "Mystery",
  "Romance",
  "Thriller",
  "Literary",
  "Historical",
  "Horror",
  "Adventure",
  "Other",
] as const;

const LENGTHS = [
  "Short Story (~3k)",
  "Novella (~20k)",
  "Novel (~60k)",
  "Epic (~100k)",
] as const;

const TONES = [
  "Whimsical",
  "Gritty",
  "Academic",
  "Lyrical",
  "Minimalist",
  "Cinematic",
] as const;

const DEFAULT_TONE = "Cinematic";
const DEFAULT_GENRE = "Sci-Fi";
const DEFAULT_LENGTH = "Novella (~20k)";

// ── Chapter type ────────────────────────────────────────────────────────────

interface Chapter {
  id: string;
  title: string;
  content: string;
  wordCount: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    idle: "Idle",
    foundation: "Building Foundation",
    drafting: "Drafting",
    revision: "Revising",
    export: "Exporting",
    done: "Complete",
    failed: "Failed",
  };
  return labels[phase] ?? phase;
}

function phaseColor(phase: string): string {
  const colors: Record<string, string> = {
    idle: "text-gray-400",
    foundation: "text-yellow-400",
    drafting: "text-blue-400",
    revision: "text-purple-400",
    export: "text-green-400",
    done: "text-green-500",
    failed: "text-red-400",
  };
  return colors[phase] ?? "text-gray-400";
}

// ── Component ───────────────────────────────────────────────────────────────

export function BookWritingPage() {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? "";

  // ── Form state ──────────────────────────────────────────────────────────
  const [concept, setConcept] = useState("");
  const [genre, setGenre] = useState<string>(DEFAULT_GENRE);
  const [length, setLength] = useState<string>(DEFAULT_LENGTH);
  const [tone, setTone] = useState<string>(DEFAULT_TONE);
  const [authorName, setAuthorName] = useState("");

  // ── Pipeline state ─────────────────────────────────────────────────────
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);

  // ── Chapter state ───────────────────────────────────────────────────────
  const [chapters, setChapters] = useState<Chapter[]>([
    { id: generateId(), title: "Chapter 1", content: "", wordCount: 0 },
  ]);
  const [activeChapterId, setActiveChapterId] = useState<string>(
    chapters[0]?.id ?? "",
  );

  // ── Pipeline status polling ─────────────────────────────────────────────
  const {
    data: pipelineStatus,
    isLoading: statusLoading,
    error: statusError,
  } = useQuery<PipelineStatus>({
    queryKey: ["book-writing", "status", activePipelineId],
    queryFn: () => bookWritingApi.status(companyId, activePipelineId!),
    enabled: !!activePipelineId && !!companyId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.phase === "done" || data.phase === "failed") return false;
      return 5000;
    },
  });

  // ── Start pipeline mutation ─────────────────────────────────────────────
  const startMutation = useMutation({
    mutationFn: () =>
      bookWritingApi.start(companyId, {
        concept: concept.trim(),
        genre,
        length,
        tone,
        authorName: authorName.trim() || undefined,
      }),
    onSuccess: (data) => {
      if (data?.pipelineId) {
        setActivePipelineId(data.pipelineId);
      }
    },
  });

  // ── Cancel pipeline mutation ────────────────────────────────────────────
  const cancelMutation = useMutation({
    mutationFn: () => bookWritingApi.cancel(companyId, activePipelineId!),
    onSuccess: () => {
      setActivePipelineId(null);
    },
  });

  // ── Chapter handlers ────────────────────────────────────────────────────
  const activeChapter = chapters.find((c) => c.id === activeChapterId);

  const addChapter = () => {
    const newChapter: Chapter = {
      id: generateId(),
      title: `Chapter ${chapters.length + 1}`,
      content: "",
      wordCount: 0,
    };
    setChapters((prev) => [...prev, newChapter]);
    setActiveChapterId(newChapter.id);
  };

  const removeChapter = (id: string) => {
    if (chapters.length <= 1) return;
    setChapters((prev) => prev.filter((c) => c.id !== id));
    if (activeChapterId === id) {
      const idx = chapters.findIndex((c) => c.id === id);
      const next = chapters[Math.max(0, idx - 1)];
      if (next) setActiveChapterId(next.id);
    }
  };

  const moveChapter = (id: string, direction: 1 | -1) => {
    setChapters((prev) => {
      const idx = prev.findIndex((c) => c.id === id);
      if (idx === -1) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  };

  const updateChapter = (id: string, fields: Partial<Chapter>) => {
    setChapters((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              ...fields,
              wordCount:
                fields.content !== undefined
                  ? countWords(fields.content)
                  : c.wordCount,
            }
          : c,
      ),
    );
  };

  // ── Derived ─────────────────────────────────────────────────────────────
  const totalWordCount = chapters.reduce((sum, c) => sum + c.wordCount, 0);
  const isPipelineRunning =
    pipelineStatus &&
    pipelineStatus.phase !== "done" &&
    pipelineStatus.phase !== "failed" &&
    pipelineStatus.phase !== "idle";
  const canStart = concept.trim().length > 0 && !startMutation.isPending;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-blue-400" />
          <h1 className="text-lg font-semibold text-gray-100">
            Book Writing Studio
          </h1>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {totalWordCount.toLocaleString()} words
          </span>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="grid grid-cols-[320px_1fr_280px] gap-5 p-5 flex-1 min-h-0 overflow-hidden">
        {/* ── LEFT COLUMN: Config + Pipeline + Chapters ───────────────── */}
        <div className="flex flex-col gap-4 overflow-y-auto">
          {/* Configuration Card */}
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
              Configuration
            </h3>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Concept</label>
              <textarea
                className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 resize-none"
                rows={3}
                placeholder="Describe your book concept..."
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                disabled={!!activePipelineId}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Genre</label>
                <select
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  disabled={!!activePipelineId}
                >
                  {GENRES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Tone</label>
                <select
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200"
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  disabled={!!activePipelineId}
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Length</label>
                <select
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  disabled={!!activePipelineId}
                >
                  {LENGTHS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Author</label>
                <input
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
                  placeholder="Optional"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  disabled={!!activePipelineId}
                />
              </div>
            </div>
            <button
              className={cn(
                "w-full rounded-md px-4 py-2 text-sm font-medium flex items-center justify-center gap-2",
                canStart
                  ? "bg-blue-600 text-white hover:bg-blue-500"
                  : "bg-gray-800 text-gray-500 cursor-not-allowed",
              )}
              onClick={() => startMutation.mutate()}
              disabled={!canStart}
            >
              {startMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Starting...
                </>
              ) : activePipelineId ? (
                <>
                  <Play className="w-4 h-4" />
                  Pipeline Active
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Write Book
                </>
              )}
            </button>
            {activePipelineId && (
              <button
                className="w-full rounded-md border border-red-800 bg-red-950/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-900/30 flex items-center justify-center gap-2"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                <Square className="w-4 h-4" />
                {cancelMutation.isPending ? "Cancelling..." : "Cancel"}
              </button>
            )}
          </div>

          {/* Pipeline Status Card */}
          {activePipelineId && (
            <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
                Pipeline Status
              </h3>
              {statusLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading...
                </div>
              )}
              {statusError && (
                <div className="flex items-center gap-2 text-sm text-red-400">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Error fetching status
                </div>
              )}
              {pipelineStatus && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={cn("text-sm font-medium", phaseColor(pipelineStatus.phase))}>
                      {phaseLabel(pipelineStatus.phase)}
                    </span>
                    {pipelineStatus.estimatedMinutesRemaining > 0 && (
                      <span className="text-xs text-gray-500">
                        ~{pipelineStatus.estimatedMinutesRemaining}m remaining
                      </span>
                    )}
                  </div>
                  {pipelineStatus.phase === "done" && (
                    <div className="flex items-center gap-1.5 text-sm text-green-500">
                      <CheckCircle2 className="w-4 h-4" />
                      Complete
                    </div>
                  )}
                  {pipelineStatus.phase === "failed" && (
                    <div className="text-sm text-red-400">
                      {pipelineStatus.error ?? "Unknown error"}
                    </div>
                  )}
                  {pipelineStatus.score !== null && pipelineStatus.score !== undefined && (
                    <div className="text-xs text-gray-400">
                      Quality Score: {pipelineStatus.score.toFixed(2)}
                    </div>
                  )}
                  {pipelineStatus.logLines && pipelineStatus.logLines.length > 0 && (
                    <details className="text-xs">
                      <summary className="text-gray-500 cursor-pointer">Log</summary>
                      <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                        {pipelineStatus.logLines.map((line, i) => (
                          <div key={i} className="text-gray-500 font-mono text-[11px]">
                            {line}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Chapter List */}
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
                Chapters
              </h3>
              <button
                className="rounded-md bg-blue-600 text-white p-1.5 hover:bg-blue-500"
                onClick={addChapter}
                title="Add chapter"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1 max-h-[400px] overflow-y-auto">
              {chapters.map((ch, idx) => (
                <div
                  key={ch.id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm group",
                    ch.id === activeChapterId
                      ? "bg-blue-900/30 border border-blue-800/50"
                      : "hover:bg-gray-800/50 border border-transparent",
                  )}
                  onClick={() => setActiveChapterId(ch.id)}
                >
                  <span className="text-xs text-gray-500 w-5 shrink-0">
                    {idx + 1}.
                  </span>
                  <span className="flex-1 truncate text-gray-200">
                    {ch.title}
                  </span>
                  <span className="text-xs text-gray-500 shrink-0">
                    {ch.wordCount}
                  </span>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                    <button
                      className="p-0.5 rounded hover:bg-gray-700 text-gray-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveChapter(ch.id, -1);
                      }}
                      disabled={idx === 0}
                      title="Move up"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button
                      className="p-0.5 rounded hover:bg-gray-700 text-gray-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        moveChapter(ch.id, 1);
                      }}
                      disabled={idx === chapters.length - 1}
                      title="Move down"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <button
                      className="p-0.5 rounded hover:bg-red-900/50 text-red-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeChapter(ch.id);
                      }}
                      disabled={chapters.length <= 1}
                      title="Delete chapter"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── CENTER COLUMN: Chapter Editor ────────────────────────────── */}
        <div className="flex flex-col gap-4 overflow-y-auto">
          {activeChapter ? (
            <>
              {/* Title */}
              <input
                className="w-full rounded-md border border-gray-800 bg-gray-950 px-4 py-2 text-lg font-semibold text-gray-100 placeholder-gray-500"
                placeholder="Chapter title"
                value={activeChapter.title}
                onChange={(e) =>
                  updateChapter(activeChapter.id, { title: e.target.value })
                }
              />

              {/* Content */}
              <div className="flex-1 flex flex-col">
                <textarea
                  className="w-full flex-1 rounded-md border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-gray-200 placeholder-gray-500 resize-none font-mono leading-relaxed min-h-[300px]"
                  placeholder="Write your chapter content here..."
                  value={activeChapter.content}
                  onChange={(e) =>
                    updateChapter(activeChapter.id, { content: e.target.value })
                  }
                />
                <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                  <span>{activeChapter.wordCount.toLocaleString()} words</span>
                </div>
              </div>

              {/* Generation Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  className="rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-500 flex items-center gap-1.5"
                  disabled={!activePipelineId}
                >
                  <Play className="w-4 h-4" />
                  Write Chapter
                </button>
                <button
                  className="rounded-md border border-gray-700 text-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-800 flex items-center gap-1.5"
                  disabled={!activePipelineId}
                >
                  <SkipForward className="w-4 h-4" />
                  Continue
                </button>
                <button
                  className="rounded-md border border-gray-700 text-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-800 flex items-center gap-1.5"
                  disabled={!activePipelineId}
                >
                  <RotateCcw className="w-4 h-4" />
                  Rewrite
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-500">
                Select or create a chapter to begin editing.
              </p>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: Narration + Images ─────────────────────────── */}
        <div className="flex flex-col gap-4 overflow-y-auto">
          {/* Narration Preview */}
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider flex items-center gap-2">
              <Volume2 className="w-4 h-4" />
              Narration
            </h3>
            <div className="rounded-md border border-dashed border-gray-700 bg-gray-900/50 p-6 text-center">
              <Volume2 className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                ElevenLabs narration preview will appear here when a chapter is
                generated.
              </p>
              <p className="text-xs text-gray-600 mt-1">
                AI voice narration for audio publishing.
              </p>
            </div>
            <button
              className="w-full rounded-md border border-gray-700 text-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-800 flex items-center justify-center gap-1.5"
              disabled={!activePipelineId}
            >
              <Volume2 className="w-4 h-4" />
              Generate Narration
            </button>
          </div>

          {/* Image Generation */}
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200 uppercase tracking-wider flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              Illustrations
            </h3>
            <div className="rounded-md border border-dashed border-gray-700 bg-gray-900/50 p-6 text-center">
              <ImageIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                FAL-generated images will appear here.
              </p>
              <p className="text-xs text-gray-600 mt-1">
                Chapter illustrations, cover art, and scene visuals.
              </p>
            </div>
            <button
              className="w-full rounded-md border border-gray-700 text-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-800 flex items-center justify-center gap-1.5"
              disabled={!activePipelineId}
            >
              <ImageIcon className="w-4 h-4" />
              Generate Image
            </button>
          </div>

          {/* Output Preview */}
          {pipelineStatus?.phase === "done" && (
            <div className="rounded-lg border border-green-800/50 bg-green-950/20 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider">
                Artifacts
              </h3>
              <p className="text-xs text-green-500/80">
                PDF, ePub, audiobook, and cover art available.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BookWritingPage;
