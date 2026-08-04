/**
 * ChatDrawer — Brainstorm Chat overlay drawer.
 * Fixed overlay, right:0, z-index above Review Notes pane.
 * Inline apiFetch pattern (no new API module).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Send, Loader2, RotateCcw, Sparkles } from "lucide-react";

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

interface ChatMessage {
  turnId: string;
  userMessage: string;
  reply: string;
  messageId: string;
  userMessageId: string;
  createdAt: string;
  status: "pending" | "completed" | "failed";
  /** Successful replies can only come from the live Calliope agent. */
  via?: "calliope";
  delegationId?: string;
  error?: string;
}

export interface ChatDrawerProps {
  bookId: string;
  companySlug: string;
  isOpen: boolean;
  onClose: () => void;
  activeBookTitle?: string;
  onSendToDraft?: (entityType: string, data: Record<string, unknown>) => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ChatDrawer({
  bookId,
  companySlug,
  isOpen,
  onClose,
  activeBookTitle,
  onSendToDraft,
}: ChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [sendingDraft, setSendingDraft] = useState<string | null>(null); // messageId being drafted
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scope = `${companySlug}:${bookId}`;
  const visibleMessages = loadedScope === scope ? messages : [];

  // Reload from the server for every open and book/company change.
  useEffect(() => {
    if (!isOpen || !bookId) return;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setLoadedScope(scope);
    setMessages([]);
    setResetError(null);
    setHistoryError(null);

    apiFetch<{ messages: ChatMessage[] }>(
      `/companies/${companySlug}/book-studio/books/${bookId}/chat`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!controller.signal.aborted) setMessages(res.messages || []);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to load chat history:", err);
        setHistoryError("Chat history could not be loaded. Retry by reopening this chat.");
      });
    return () => controller.abort();
  }, [isOpen, bookId, companySlug, scope]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visibleMessages]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Click-outside-to-close — ponytail: simple overlay click handler
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setLoading(true);

    // Optimistic user message
    const tempUser: ChatMessage = {
      turnId: `pending:${Date.now()}`,
      userMessage: text,
      reply: "",
      messageId: "",
      userMessageId: "",
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    setMessages((prev) => [...prev, tempUser]);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await apiFetch<{ turnId: string; reply: string; messageId: string; userMessageId: string; status: "completed"; via: "calliope"; delegationId?: string }>(
        `/companies/${companySlug}/book-studio/books/${bookId}/chat`,
        { method: "POST", body: JSON.stringify({ message: text }), signal: controller.signal },
      );

      // Update the optimistic message with reply
      setMessages((prev) => {
        const updated = [...prev];
        const idx = updated.findIndex((message) => message.turnId === tempUser.turnId);
        if (idx >= 0) {
          updated[idx] = {
            ...updated[idx],
            turnId: res.turnId,
            reply: res.reply,
            messageId: res.messageId,
            userMessageId: res.userMessageId,
            via: res.via,
            status: res.status,
            delegationId: res.delegationId,
          };
        }
        return updated;
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Mark last message as error
      setMessages((prev) => {
        const updated = [...prev];
        const idx = updated.findIndex((message) => message.turnId === tempUser.turnId);
        if (idx >= 0) {
          updated[idx] = {
            ...updated[idx],
            status: "failed",
            error: "Calliope is unavailable. No reply was generated. Please try again when she is back online.",
          };
        }
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (resetting) return;
    const confirmed = window.confirm(
      "Reset this chat? The current transcript will be archived and retained with this book; no book content will be deleted.",
    );
    if (!confirmed) return;
    setResetting(true);
    setResetError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await apiFetch(`/companies/${companySlug}/book-studio/books/${bookId}/chat/reset`, {
        method: "POST",
        signal: controller.signal,
      });
      setLoadedScope(scope);
      setMessages([]);
    } catch {
      setResetError("Chat reset could not be confirmed. The displayed transcript was not cleared; reload before retrying.");
    } finally {
      setResetting(false);
    }
  };

  const handleSendToDraft = async (messageId: string, entityType: string) => {
    if (!messageId) return;
    setSendingDraft(messageId);
    try {
      const res = await apiFetch<Record<string, unknown>>(
        `/companies/${companySlug}/book-studio/books/${bookId}/chat/${messageId}/to-draft`,
        { method: "POST", body: JSON.stringify({ target: entityType }) },
      );
      onSendToDraft?.(entityType, res);
    } catch (err) {
      console.error("Failed to send to draft:", err);
    } finally {
      setSendingDraft(null);
    }
  };

  if (!isOpen) return null;

  return (
    // ponytail: overlay handles click-outside
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={handleOverlayClick}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Drawer */}
      <div className="relative w-[380px] h-full bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              Calliope — Brainstorm
            </h3>
            {activeBookTitle && (
              <p className="text-[10px] text-gray-500 mt-0.5">{activeBookTitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleReset}
              disabled={resetting || loading}
              title="Archive this transcript and start a fresh chat"
              className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-500 hover:text-purple-300 disabled:opacity-40"
            >
              {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
              Reset chat
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-500 hover:text-gray-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {resetError && (
            <div role="alert" className="rounded-md border border-red-800 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {resetError}
            </div>
          )}
          {historyError && (
            <div role="alert" className="rounded-md border border-amber-800 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {historyError}
            </div>
          )}
          {visibleMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-2xl mb-2 opacity-30">💬</div>
              <p className="text-xs text-gray-500 leading-relaxed max-w-[240px]">
                Ask me anything about your book. I can help brainstorm characters, locations, style, and plot.
              </p>
            </div>
          )}

          {visibleMessages.map((msg) => (
            <div key={msg.turnId} className="space-y-2">
              {/* User message */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-lg bg-blue-600/20 border border-blue-500/30 px-3 py-2">
                  <p className="text-xs text-blue-100">{msg.userMessage}</p>
                </div>
              </div>

              {/* AI reply */}
              {msg.reply && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-lg bg-gray-800 border border-gray-700 px-3 py-2">
                    <p className="text-xs text-gray-300 whitespace-pre-wrap">{msg.reply}</p>
                    {/* Lane provenance: successful replies are always Calliope. */}
                    {msg.via === "calliope" && (
                      <p className="text-[9px] text-purple-400/80 mt-1.5">via Calliope ✦ live agent</p>
                    )}
                    {/* Send to Draft buttons */}
                    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-700/50">
                      {(["character", "location", "style", "outline"] as const).map((et) => (
                        <button
                          key={et}
                          onClick={() => handleSendToDraft(msg.messageId || msg.userMessageId, et)}
                          disabled={sendingDraft === msg.messageId || !msg.messageId}
                          className="rounded border border-gray-600 px-2 py-0.5 text-[10px] text-gray-400 hover:text-purple-300 hover:border-purple-500/50 disabled:opacity-40"
                        >
                          {sendingDraft === msg.messageId ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin inline mr-1" />
                          ) : null}
                          {et === "outline" ? "Outline" : et.charAt(0).toUpperCase() + et.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {msg.status === "pending" && !msg.reply && (
                <p className="text-[10px] text-gray-500">Waiting for Calliope…</p>
              )}
              {msg.status === "failed" && !msg.reply && (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-300">
                  {msg.error || "Calliope is unavailable. No reply was generated."}
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-gray-800 px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              className="flex-1 rounded border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
              placeholder="Ask about your book..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="rounded bg-purple-600 p-1.5 text-white hover:bg-purple-500 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatDrawer;
