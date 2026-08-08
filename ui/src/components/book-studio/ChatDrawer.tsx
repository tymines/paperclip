import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Archive, Loader2, RefreshCw, RotateCcw, Send, Sparkles, X } from "lucide-react";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, { headers: { "Content-Type": "application/json", ...options?.headers }, ...options });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text || response.statusText;
    try { message = JSON.parse(text).error ?? message; } catch { /* raw response */ }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export interface ChatMessage {
  turnId: string;
  userMessage: string;
  reply: string;
  messageId: string;
  userMessageId: string;
  createdAt: string;
  status: "pending" | "completed" | "failed";
  via?: "calliope";
  delegationId?: string;
  error?: string;
  retryable?: boolean;
  action?: { operation: string; section: string; destination: string; status: "applied" | "failed"; chapterNumber?: number };
}

interface ArchiveGroup { archivedAt: string; messages: ChatMessage[] }

export interface ChatDrawerProps {
  bookId: string;
  companySlug: string;
  isOpen: boolean;
  onClose: () => void;
  activeBookTitle?: string;
  onSendToDraft?: (entityType: string, data: Record<string, unknown>) => void;
  onBookChanged?: (section?: string, chapterNumber?: number) => void;
}

const draftKey = (companySlug: string, bookId: string) => `bookStudio.chatDraft:${companySlug}:${bookId}`;

function usePhoneViewport() {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return isPhone;
}

export function ChatDrawer({ bookId, companySlug, isOpen, onClose, activeBookTitle, onBookChanged }: ChatDrawerProps) {
  const isPhone = usePhoneViewport();
  const scope = `${companySlug}:${bookId}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadedScope, setLoadedScope] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archives, setArchives] = useState<ArchiveGroup[]>([]);
  const [archivesLoading, setArchivesLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyAbortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const visibleMessages = loadedScope === scope ? messages : [];
  const hasPending = visibleMessages.some((message) => message.status === "pending");

  useEffect(() => {
    try { setInput(localStorage.getItem(draftKey(companySlug, bookId)) ?? ""); } catch { setInput(""); }
    setArchiveOpen(false);
    setArchives([]);
    setSubmitting(false);
    setError(null);
  }, [companySlug, bookId]);

  useEffect(() => {
    try { localStorage.setItem(draftKey(companySlug, bookId), input); } catch { /* private mode */ }
  }, [companySlug, bookId, input]);

  const loadHistory = useCallback(async (quiet = false) => {
    if (!bookId) return;
    const requestedScope = `${companySlug}:${bookId}`;
    const controller = new AbortController();
    historyAbortRef.current?.abort();
    historyAbortRef.current = controller;
    if (!quiet) { setLoadedScope(""); setMessages([]); setError(null); setHistoryLoading(true); }
    try {
      const result = await apiFetch<{ messages: ChatMessage[] }>(`/companies/${companySlug}/book-studio/books/${bookId}/chat`, { signal: controller.signal });
      if (!controller.signal.aborted && scopeRef.current === requestedScope) {
        setLoadedScope(requestedScope);
        setMessages(result.messages ?? []);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!quiet && scopeRef.current === requestedScope) setError(err instanceof Error ? err.message : String(err));
    } finally { if (!quiet && !controller.signal.aborted && scopeRef.current === requestedScope) setHistoryLoading(false); }
  }, [bookId, companySlug]);

  useEffect(() => {
    if (!isOpen) return;
    void loadHistory();
    return () => historyAbortRef.current?.abort();
  }, [isOpen, loadHistory]);

  useEffect(() => {
    if (!isOpen || !hasPending) return;
    const timer = window.setInterval(() => void loadHistory(true), 2000);
    return () => window.clearInterval(timer);
  }, [isOpen, hasPending, loadHistory]);

  useEffect(() => {
    if (!isOpen || !isPhone) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = items(); if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => items()[0]?.focus());
    return () => { document.removeEventListener("keydown", onKeyDown); returnFocusRef.current?.focus(); };
  }, [isOpen, isPhone, onClose]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [visibleMessages]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight = 20;
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, lineHeight * 3), lineHeight * 10)}px`;
  }, [input]);

  async function send(message = input.trim()) {
    const text = message.trim();
    if (!text || submitting) return;
    const requestedScope = scope;
    const optimisticId = `pending:${crypto.randomUUID?.() ?? Date.now()}`;
    setInput("");
    setSubmitting(true);
    setError(null);
    setMessages((current) => [...current, { turnId: optimisticId, userMessage: text, reply: "", messageId: "", userMessageId: "", createdAt: new Date().toISOString(), status: "pending" }]);
    try {
      const result = await apiFetch<ChatMessage & { action?: ChatMessage["action"] }>(`/companies/${companySlug}/book-studio/books/${bookId}/chat`, { method: "POST", body: JSON.stringify({ message: text }) });
      if (scopeRef.current === requestedScope) {
        setMessages((current) => current.map((message) => message.turnId === optimisticId ? { ...message, ...result, userMessage: text, createdAt: message.createdAt } : message));
        await loadHistory(true);
        if (result.action?.status === "applied") onBookChanged?.(result.action.section, result.action.chapterNumber);
      }
    } catch (err) {
      if (scopeRef.current === requestedScope) {
        await loadHistory(true);
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (scopeRef.current === requestedScope) setSubmitting(false);
    }
  }

  async function retry(turnId: string) {
    if (submitting) return;
    const requestedScope = scope;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<{ action?: ChatMessage["action"] }>(`/companies/${companySlug}/book-studio/books/${bookId}/chat/${encodeURIComponent(turnId)}/retry`, { method: "POST" });
      if (scopeRef.current === requestedScope) {
        await loadHistory(true);
        if (result.action?.status === "applied") onBookChanged?.(result.action.section, result.action.chapterNumber);
      }
    } catch (err) {
      if (scopeRef.current === requestedScope) { await loadHistory(true); setError(err instanceof Error ? err.message : String(err)); }
    } finally {
      if (scopeRef.current === requestedScope) setSubmitting(false);
    }
  }

  async function reset() {
    if (resetting || hasPending) return;
    if (!window.confirm("Start a new conversation? This book's active transcript will be retained in read-only history. No book content will change.")) return;
    setResetting(true); setError(null);
    try {
      await apiFetch(`/companies/${companySlug}/book-studio/books/${bookId}/chat/reset`, { method: "POST" });
      setMessages([]); setLoadedScope(scope); setArchives([]); setArchiveOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setResetting(false); }
  }

  async function toggleArchives() {
    const next = !archiveOpen;
    setArchiveOpen(next);
    if (!next || archives.length) return;
    setArchivesLoading(true); setError(null);
    try {
      const result = await apiFetch<{ archives: ArchiveGroup[] }>(`/companies/${companySlug}/book-studio/books/${bookId}/chat/archives`);
      if (scopeRef.current === scope) setArchives(result.archives ?? []);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setArchivesLoading(false); }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:inset-auto" role="presentation">{isPhone && <button className="absolute inset-0 h-full w-full bg-black/65" onClick={onClose} aria-label="Close brainstorm" data-chat-backdrop />}<aside ref={drawerRef} {...(isPhone ? { role: "dialog", "aria-modal": true } : {})} aria-label="Calliope brainstorm" className="fixed inset-x-0 bottom-0 flex h-[82dvh] max-h-[calc(100dvh-env(safe-area-inset-top))] flex-col rounded-t-xl border-t border-gray-800 bg-gray-950 pb-[env(safe-area-inset-bottom)] shadow-2xl md:inset-y-[52px] md:left-auto md:right-0 md:h-auto md:w-[400px] md:rounded-none md:border-l md:border-t-0 md:pb-0" data-docked-chat>
      <header className="flex shrink-0 items-center justify-between border-b border-gray-800 px-4 py-3">
        <div><h3 className="flex items-center gap-2 text-sm font-semibold text-gray-200"><Sparkles className="h-3.5 w-3.5 text-purple-400" />Calliope — Brainstorm</h3>{activeBookTitle && <p className="mt-0.5 text-[10px] text-gray-500">{activeBookTitle}</p>}</div>
        <div className="flex items-center gap-1">
          <button onClick={() => void toggleArchives()} className="flex min-h-11 items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-500 hover:text-purple-300 md:min-h-0" aria-pressed={archiveOpen}><Archive className="h-3 w-3" />History</button>
          <button onClick={() => void reset()} disabled={resetting || hasPending} title={hasPending ? "Wait for the active Calliope turn to finish before starting a new conversation" : "Archive this transcript and start a new conversation"} className="flex min-h-11 items-center gap-1 rounded px-2 py-1 text-[10px] text-gray-500 hover:text-purple-300 disabled:opacity-40 md:min-h-0">{resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}New conversation</button>
          <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded text-gray-500 hover:text-gray-300 md:h-auto md:w-auto md:p-1" aria-label="Close brainstorm"><X className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3" aria-live="polite" aria-busy={hasPending}>
        {error && <div role="alert" className="mb-3 rounded-md border border-amber-800 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{error}</div>}
        {archiveOpen ? (
          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Archived conversations</h4>
            {archivesLoading && <p className="text-xs text-gray-500">Loading history…</p>}
            {!archivesLoading && archives.length === 0 && <p className="text-xs italic text-gray-500">No archived conversations for this book.</p>}
            {archives.map((archive) => <section key={archive.archivedAt} className="rounded-lg border border-gray-800 p-3"><h5 className="mb-3 text-[10px] text-gray-500">Archived {new Date(archive.archivedAt).toLocaleString()}</h5><div className="space-y-3">{archive.messages.map((message) => <div key={message.turnId}><p className="text-xs text-blue-200">You: {message.userMessage}</p>{message.reply && <p className="mt-1 whitespace-pre-wrap text-xs text-gray-400">Calliope: {message.reply}</p>}</div>)}</div></section>)}
          </div>
        ) : (
          <div className="space-y-3">
            {historyLoading && <div className="py-12 text-center text-xs text-gray-500">Loading conversation...</div>}
            {!historyLoading && loadedScope === scope && visibleMessages.length === 0 && <div className="py-12 text-center text-xs text-gray-500">Ask Calliope about this book. Each book keeps its own durable conversation.</div>}
            {visibleMessages.map((message) => <div key={message.turnId} className="space-y-2"><div className="flex justify-end"><div className="max-w-[88%] rounded-lg border border-blue-500/30 bg-blue-600/20 px-3 py-2"><p className="whitespace-pre-wrap text-xs text-blue-100">{message.userMessage}</p></div></div>{message.reply && <div className="flex justify-start"><div className="max-w-[88%] rounded-lg border border-gray-700 bg-gray-800 px-3 py-2"><p className="whitespace-pre-wrap text-xs text-gray-300">{message.reply}</p>{message.via === "calliope" && <p className="mt-1.5 text-[9px] text-purple-400/80">via Calliope ✦ live agent</p>}{message.action && <p className={`mt-1.5 text-[10px] ${message.action.status === "applied" ? "text-emerald-400" : "text-amber-400"}`}>{message.action.status === "applied" ? `Saved to ${message.action.destination}` : "No book content changed"}</p>}</div></div>}{message.status === "pending" && !message.reply && <div className="flex justify-start" role="status" aria-label="Calliope is thinking" data-calliope-working><div className="max-w-[88%] rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2.5 shadow-[0_0_18px_rgba(168,85,247,0.08)]"><div className="flex items-center gap-2 text-xs font-medium text-purple-200"><span className="relative flex h-5 w-5 items-center justify-center"><span className="absolute h-full w-full animate-ping rounded-full bg-purple-500/20" aria-hidden="true" /><Sparkles className="relative h-3.5 w-3.5 animate-pulse text-purple-400" aria-hidden="true" /></span><span>Calliope is thinking</span><span className="flex items-end gap-0.5" aria-hidden="true"><span className="h-1 w-1 animate-bounce rounded-full bg-purple-300 [animation-delay:-0.3s]" /><span className="h-1 w-1 animate-bounce rounded-full bg-purple-300 [animation-delay:-0.15s]" /><span className="h-1 w-1 animate-bounce rounded-full bg-purple-300" /></span></div><p className="mt-1 pl-7 text-[10px] text-gray-500">Working on your message. Her reply will appear here when it is ready.</p></div></div>}{message.status === "failed" && <div className="flex items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-300"><span>{message.error || "Calliope is unavailable. No reply was generated."}{message.retryable === false && " This turn may already have reached Calliope, so it cannot be retried safely."}</span>{message.retryable !== false && <button onClick={() => void retry(message.turnId)} disabled={submitting} className="flex shrink-0 items-center gap-1 rounded border border-amber-500/40 px-2 py-1 hover:bg-amber-500/10 disabled:opacity-40"><RefreshCw className="h-3 w-3" />Retry</button>}</div>}</div>)}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {!archiveOpen && <div className="shrink-0 border-t border-gray-800 px-4 py-3"><div className="flex items-end gap-2"><textarea ref={textareaRef} rows={3} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask about your book…" aria-label="Message Calliope" className="max-h-[200px] min-h-[60px] flex-1 resize-none overflow-y-auto rounded border border-gray-700 bg-gray-800/50 px-3 py-2 text-xs leading-5 text-gray-200 outline-none placeholder:text-gray-600 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20" /><button onClick={() => void send()} disabled={!input.trim() || submitting} aria-label="Send message" className="grid h-11 w-11 place-items-center rounded bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 md:h-auto md:w-auto md:p-2">{submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</button></div></div>}
    </aside></div>
  );
}

export default ChatDrawer;
