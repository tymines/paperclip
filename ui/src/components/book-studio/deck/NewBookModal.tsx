// Director's Deck — New Book modal (Book-tab fix). The "+ NEW BOOK" top-bar
// button used to fire a no-op stub; this modal is the real create flow:
// title input + Create/Cancel, non-empty validation, submit disabled while
// in flight, API errors surfaced inline (never silently swallowed).
import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function NewBookModal({ onClose, onCreate }: {
  onClose: () => void;
  /** Creates the book; must throw with a human-readable message on failure. */
  onCreate: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(t);
      onClose();
    } catch (e) {
      setError((e as Error).message || "Could not create the book");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <section
        className="w-[min(440px,100%)] bg-[#11151d] border border-white/15 rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="Create a new book"
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/5">
          <div>
            <b className="font-serif text-[15px] font-semibold">New book</b>
            <br />
            <span className="text-gray-500 text-[10.5px]">A fresh manuscript with its own bible, outline, and deck.</span>
          </div>
          <button className="w-[30px] h-[30px] grid place-items-center border border-white/15 rounded-md hover:bg-white/5" onClick={onClose} title="Close"><X className="w-3.5 h-3.5" /></button>
        </div>
        <form
          className="p-4 flex flex-col gap-3"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <input
            ref={inputRef}
            className="w-full bg-[#0d1016] border border-white/15 rounded-md text-gray-200 px-3 py-2 text-sm placeholder:text-gray-600 focus:border-[#e0955a66] outline-none"
            placeholder="Book title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
          {error && (
            <p className="m-0 text-[11.5px] text-red-400 border border-red-400/40 bg-red-400/10 rounded-md px-3 py-2" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide border border-white/15 rounded-md hover:bg-white/5"
              onClick={onClose}
              disabled={busy}
            >Cancel</button>
            <button
              type="submit"
              className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-md bg-[#e0955a] text-[#181008] hover:bg-[#eaa96f] disabled:opacity-40"
              disabled={busy || !title.trim()}
            >{busy ? "Creating…" : "Create"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
