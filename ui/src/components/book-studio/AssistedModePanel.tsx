/**
 * AssistedModePanel — "Suggest Next" button + AI suggestion card for assisted mode.
 * Calls POST /book-studio/books/:bookId/suggest-next, shows one suggestion, user accepts/rejects.
 */

import { useState, useRef } from "react";
import { Sparkles, X, Check, Loader2, RotateCcw } from "lucide-react";

// ── Inline apiFetch ──────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface Suggestion {
  action: "add_character" | "add_location" | "expand_chapter" | "add_style" | "add_outline";
  entityType: "character" | "world-location" | "style" | "outline";
  reason: string;
  suggestedData?: Record<string, unknown>;
}

export interface AssistedModePanelProps {
  bookId: string;
  companySlug: string;
}

const ACTION_LABELS: Record<Suggestion["action"], string> = {
  add_character: "adding a character",
  add_location: "adding a location",
  expand_chapter: "expanding a chapter",
  add_style: "adding a style entry",
  add_outline: "adding an outline chapter",
};

// ── Component ────────────────────────────────────────────────────────────────

export function AssistedModePanel({ bookId, companySlug }: AssistedModePanelProps) {
  const [state, setState] = useState<"idle" | "loading" | "suggestion" | "error" | "accepted">("idle");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const loadingGate = useRef(false);

  const handleSuggest = async () => {
    if (loadingGate.current) return;
    loadingGate.current = true;
    setState("loading");
    setErrorMessage("");

    try {
      const res = await apiFetch<Suggestion>(
        `/companies/${companySlug}/book-studio/books/${bookId}/suggest-next`,
        { method: "POST" },
      );
      setSuggestion(res);
      setState("suggestion");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(message);
      setState("error");
    } finally {
      loadingGate.current = false;
    }
  };

  const handleAccept = () => {
    setState("accepted");
    // ponytail: caller navigates to the relevant tab to create — suggestion data is pre-filled
  };

  const handleReject = () => {
    setSuggestion(null);
    setState("idle");
  };

  const handleRetry = () => {
    setState("idle");
  };

  return (
    <div className="border-b border-gray-800 bg-gray-900/70 px-5 py-3 shrink-0">
      {/* Idle: Suggest Next button */}
      {state === "idle" && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSuggest}
            className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500"
          >
            <Sparkles className="w-3 h-3" /> Suggest Next
          </button>
          <span className="text-[10px] text-gray-500">AI analyzes your bible and suggests the next action</span>
        </div>
      )}

      {/* Loading */}
      {state === "loading" && (
        <div className="flex items-center gap-2 text-xs text-purple-400">
          <Loader2 className="w-3 h-3 animate-spin" />
          Analyzing your story bible...
        </div>
      )}

      {/* Suggestion card */}
      {state === "suggestion" && suggestion && (
        <div className="rounded-md border border-purple-500/40 bg-gray-900/80 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span className="text-xs font-semibold text-purple-300">
                  I suggest <span className="text-purple-200">{ACTION_LABELS[suggestion.action] || suggestion.action}</span>
                </span>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">{suggestion.reason}</p>
              {suggestion.suggestedData && (
                <div className="mt-2 rounded border border-gray-700 bg-gray-950/50 p-2">
                  <pre className="text-[10px] text-gray-500 font-mono whitespace-pre-wrap break-all">
                    {JSON.stringify(suggestion.suggestedData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleAccept}
                className="flex items-center gap-1 rounded bg-green-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-600"
              >
                <Check className="w-3 h-3" /> Accept
              </button>
              <button
                onClick={handleReject}
                className="flex items-center gap-1 rounded border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-200"
              >
                <X className="w-3 h-3" /> Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Accepted confirmation */}
      {state === "accepted" && (
        <div className="flex items-center gap-2 text-xs text-green-400">
          <Check className="w-3 h-3" />
          Suggestion accepted! Navigate to the{" "}
          <span className="font-medium text-green-300">
            {suggestion?.entityType === "character" && "Characters"}
            {suggestion?.entityType === "world-location" && "World & Locations"}
            {suggestion?.entityType === "style" && "Style"}
            {suggestion?.entityType === "outline" && "Outline"}
          </span>{" "}
          tab to create it.
          <button
            onClick={handleRetry}
            className="ml-2 text-purple-400 hover:text-purple-200 underline"
          >
            Get another suggestion
          </button>
        </div>
      )}

      {/* Error */}
      {state === "error" && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-red-400">
            <X className="w-3 h-3" />
            {errorMessage}
          </div>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1 rounded border border-red-700 px-2 py-1 text-[10px] text-red-400 hover:text-red-300"
          >
            <RotateCcw className="w-2.5 h-2.5" /> Try Again
          </button>
        </div>
      )}
    </div>
  );
}

export default AssistedModePanel;
