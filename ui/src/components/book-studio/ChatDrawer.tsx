/**
 * ChatDrawer — Brainstorm Chat overlay drawer.
 * Fixed overlay, right:0, z-index above Review Notes pane.
 * Inline apiFetch pattern (no new API module).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Send, Loader2, Sparkles } from "lucide-react";

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
  userMessage: string;
  reply: string;
  messageId: string;
  userMessageId: string;
  createdAt: string;
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
  const [sendingDraft, setSendingDraft] = useState<string | null>(null); // messageId being drafted
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);

  // Fetch history on open
  useEffect(() => {
    if (!isOpen || !bookId || loadedRef.current) return;
    loadedRef.current = true;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    apiFetch<{ messages: ChatMessage[] }>(
      `/companies/${companySlug}/book-studio/books/${bookId}/chat`,
      { signal: controller.signal },
    )
      .then((res) => setMessages(res.messages || []))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Failed to load chat history:", err);
      });
  }, [isOpen, bookId, companySlug]);

  // Reset loaded flag on close
  useEffect(() => {
    if (!isOpen) {
      loadedRef.current = false;
    }
  }, [isOpen]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      userMessage: text,
      reply: "",
      messageId: "",
      userMessageId: "",
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUser]);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await apiFetch<{ reply: string; messageId: string; userMessageId: string }>(
        `/companies/${companySlug}/book-studio/books/${bookId}/chat`,
        { method: "POST", body: JSON.stringify({ message: text }), signal: controller.signal },
      );

      // Update the optimistic message with reply
      setMessages((prev) => {
        const updated = [...prev];
        const idx = updated.length - 1;
        if (idx >= 0) {
          updated[idx] = {
            ...updated[idx],
            reply: res.reply,
            messageId: res.messageId,
            userMessageId: res.userMessageId,
          };
        }
        return updated;
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Mark last message as error
      setMessages((prev) => {
        const updated = [...prev];
        const idx = updated.length - 1;
        if (idx >= 0) {
          updated[idx] = {
            ...updated[idx],
            reply: "Failed to get reply. Please try again.",
          };
        }
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSendToDraft = async (messageId: string, entityType: string) => {
    if (!messageId) return;
    setSendingDraft(messageId);
    try {
      const res = await apiFetch<Record<string, unknown>>(
        `/chat/${messageId}/to-draft?entityType=${entityType}`,
        { method: "POST" },
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
              Brainstorm Chat
            </h3>
            {activeBookTitle && (
              <p className="text-[10px] text-gray-500 mt-0.5">{activeBookTitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:text-gray-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-2xl mb-2 opacity-30">💬</div>
              <p className="text-xs text-gray-500 leading-relaxed max-w-[240px]">
                Ask me anything about your book. I can help brainstorm characters, locations, style, and plot.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className="space-y-2">
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
