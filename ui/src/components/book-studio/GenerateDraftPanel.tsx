/**
 * GenerateDraftPanel — AI generate button + draft preview for a story bible entity type.
 * Inline apiFetch pattern (no new API module).
 */

import { useState, useRef, useEffect } from "react";
import { Sparkles, X, Check, RotateCcw, Loader2 } from "lucide-react";

// ── Inline apiFetch (same pattern as BookWritingPage) ────────────────────────

/** True when a proxy (e.g. Cloudflare) answered with an HTML error page. */
function looksLikeHtml(text: string): boolean {
  const t = text.trimStart().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html") || t.includes("<head>");
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Never dump a raw gateway HTML page into the UI (acceptance finding #2):
    // prefer the JSON error field; otherwise a friendly status-based message.
    let message: string;
    try {
      const j = JSON.parse(text);
      message = (j.error || j.message || res.statusText || `HTTP ${res.status}`).slice(0, 300);
    } catch {
      message = looksLikeHtml(text) || !text
        ? res.status === 502 || res.status === 504
          ? "The server took too long to respond (gateway timeout). Long generations can trip the proxy — try again."
          : `Server error (HTTP ${res.status}). Try again in a moment.`
        : `API ${res.status}: ${text.slice(0, 200)}`;
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export type BEntityType = "character" | "location" | "world-rule" | "style" | "outline-beats";

export interface GenerateDraftPanelProps {
  entityType: BEntityType;
  bookId: string;
  companySlug: string;
  onAccept: (draft: Record<string, unknown>) => void;
  onDiscard: () => void;
  onError?: (err: Error) => void;
  initialDraft?: Record<string, unknown> | null;
  showGenerateButton?: boolean;
}

// ── Entity labels ────────────────────────────────────────────────────────────

const ENTITY_LABELS: Record<BEntityType, string> = {
  character: "Character",
  location: "Location",
  "world-rule": "World Rule",
  style: "Style",
  "outline-beats": "Outline Beats",
};

// ── Route helpers ────────────────────────────────────────────────────────────

function generateRoute(entityType: BEntityType): string {
  const map: Record<BEntityType, string> = {
    character: "/generate/character",
    location: "/generate/location",
    "world-rule": "/generate/world-rule",
    style: "/generate/style",
    "outline-beats": "/generate/outline-beats",
  };
  return map[entityType];
}

// ── Component ────────────────────────────────────────────────────────────────

export function GenerateDraftPanel({
  entityType,
  bookId,
  companySlug,
  onAccept,
  onDiscard,
  onError,
}: GenerateDraftPanelProps) {
  const [state, setState] = useState<"idle" | "loading" | "draft" | "error">("idle");
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const loadingGate = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleGenerate = async () => {
    if (loadingGate.current) return; // double-click guard
    loadingGate.current = true;
    setState("loading");
    setErrorMessage("");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const route = generateRoute(entityType);
      const doFetch = () =>
        apiFetch<{ draft: Record<string, unknown> }>(
          `/companies/${companySlug}/book-studio/books/${bookId}${route}`,
          { method: "POST", body: JSON.stringify({ prompt }), signal: controller.signal },
        );
      let res: { draft: Record<string, unknown> };
      try {
        res = await doFetch();
      } catch (firstErr: unknown) {
        // One automatic retry on transient gateway failures (finding #2 —
        // a 502 mid-generation succeeded on manual retry).
        const status = firstErr instanceof ApiError ? firstErr.status : 0;
        if (status !== 502 && status !== 503 && status !== 504) throw firstErr;
        await new Promise((r) => setTimeout(r, 1500));
        if (controller.signal.aborted) throw firstErr;
        res = await doFetch();
      }
      setDraft(res.draft);
      setState("draft");
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(message);
      setState("error");
      onError?.(err instanceof Error ? err : new Error(message));
    } finally {
      loadingGate.current = false;
    }
  };

  const handleAccept = () => {
    if (draft) onAccept(draft);
    setDraft(null);
    setState("idle");
  };

  const handleDiscard = () => {
    setDraft(null);
    setState("idle");
    onDiscard();
  };

  const renderDraftPreview = () => {
    if (!draft) return null;

    // ponytail: reuse card-component styling pattern
    return (
      <div className="rounded-md border border-purple-500/40 bg-gray-900/80 p-2.5 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">
          AI Draft — {ENTITY_LABELS[entityType]}
        </div>

        {/* Character draft */}
        {entityType === "character" && (
          <>
            <div className="text-sm font-medium text-gray-200">{(draft as Record<string, unknown>).name as string || "Unnamed"}</div>
            <div className="text-xs text-gray-400">{(draft as Record<string, unknown>).role as string || ""}</div>
            {(draft as Record<string, unknown>).description && (
              <p className="text-[11px] text-gray-500 leading-relaxed max-h-32 overflow-y-auto">
                {(draft as Record<string, unknown>).description as string}
              </p>
            )}
          </>
        )}

        {/* Location / World-rule draft */}
        {(entityType === "location" || entityType === "world-rule") && (
          <>
            <div className="text-sm font-medium text-gray-200">{(draft as Record<string, unknown>).name as string || "Unnamed"}</div>
            {(draft as Record<string, unknown>).description && (
              <p className="text-xs text-gray-500 leading-relaxed max-h-28 overflow-y-auto">
                {(draft as Record<string, unknown>).description as string}
              </p>
            )}
            {(draft as Record<string, unknown>).rules != null && (
              <div className="text-[10px] text-gray-600">
                {/* finding #4: render rule text, never raw serialized JSON */}
                Rules: {(() => {
                  const r = (draft as Record<string, unknown>).rules;
                  const text = typeof r === "string"
                    ? r
                    : Array.isArray(r)
                      ? r.map(String).join("; ")
                      : r && typeof r === "object"
                        ? Object.values(r as Record<string, unknown>).map(String).join("; ")
                        : String(r);
                  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
                })()}
              </div>
            )}
          </>
        )}

        {/* Style draft */}
        {entityType === "style" && (
          <>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>POV: {(draft as Record<string, unknown>).pov as string || "N/A"}</span>
              <span className="text-gray-600">·</span>
              <span>Tense: {(draft as Record<string, unknown>).tense as string || "N/A"}</span>
            </div>
            {(draft as Record<string, unknown>).sampleParagraph && (
              <p className="text-[11px] text-gray-500 italic line-clamp-2">
                "{(draft as Record<string, unknown>).sampleParagraph as string}"
              </p>
            )}
          </>
        )}

        {/* Outline-beats draft — supports multi-chapter { chapters: [...] } */}
        {entityType === "outline-beats" && (() => {
          const chapters: Record<string, unknown>[] = Array.isArray((draft as Record<string, unknown>).chapters)
            ? ((draft as Record<string, unknown>).chapters as Record<string, unknown>[])
            : [draft as Record<string, unknown>];
          return (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {chapters.length > 1 && (
                <div className="text-[10px] text-purple-300">{chapters.length} chapters</div>
              )}
              {chapters.map((ch, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Ch.{(ch.chapterNumber as number) || "?"}</span>
                    <span className="text-sm font-medium text-gray-200">{(ch.title as string) || "Untitled"}</span>
                  </div>
                  <div className="text-[10px] text-gray-600">
                    {Array.isArray(ch.beats) ? `${(ch.beats as unknown[]).length} beats` : "No beats"}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleAccept}
            className="flex items-center gap-1 rounded bg-green-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-green-600"
          >
            <Check className="w-2.5 h-2.5" /> Accept
          </button>
          <button
            onClick={handleDiscard}
            className="flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200"
          >
            <X className="w-2.5 h-2.5" /> Discard
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {/* Idle: prompt input + generate button */}
      {state === "idle" && (
        <div className="flex items-center gap-2">
          <input
            className="flex-1 rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
            placeholder={`Describe the ${ENTITY_LABELS[entityType].toLowerCase()} you want...`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleGenerate(); }}
          />
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || loadingGate.current}
            className="flex items-center gap-1 rounded bg-purple-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-purple-500 disabled:opacity-50 shrink-0"
          >
            <Sparkles className="w-3 h-3" /> Generate
          </button>
        </div>
      )}

      {/* Loading */}
      {state === "loading" && (
        <div className="flex items-center gap-2 text-xs text-purple-400 py-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          Generating {ENTITY_LABELS[entityType].toLowerCase()}...
        </div>
      )}

      {/* Draft preview */}
      {state === "draft" && renderDraftPreview()}

      {/* Error */}
      {state === "error" && (
        <div className="rounded-md border border-red-500/40 bg-red-950/30 p-2.5">
          <p className="text-xs text-red-400 mb-2">{errorMessage}</p>
          <button
            onClick={handleGenerate}
            className="flex items-center gap-1 rounded bg-red-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-600"
          >
            <RotateCcw className="w-2.5 h-2.5" /> Try Again
          </button>
        </div>
      )}
    </div>
  );
}

export default GenerateDraftPanel;
