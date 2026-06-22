import { useEffect } from "react";
import { Mic } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

export function VoiceMemos() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Voice Memos" }]);
  }, [setBreadcrumbs]);

  return (
    <div
      className="flex flex-col gap-6 bg-gradient-to-b from-background via-background to-primary/[0.03]"
      data-pp-page="voice-memos"
      data-pp-page-v2="voice-memos"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
          Voice Memos
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Drop voice memos here and Jarvis will transcribe, summarize, and
          route them into the right room or issue. Coming soon — this
          inbox is a Phase&nbsp;2 deliverable of the Jarvis state-of-the-art
          research stream.
        </p>
      </header>
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border/60 bg-gradient-to-br from-card to-card/40 px-6 py-16 text-center shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-background/60">
          <Mic className="h-6 w-6 text-muted-foreground/60" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">No voice memos yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Coming soon — drop voice memos here once the Phase&nbsp;2 inbox ships.
          </p>
        </div>
        <span className="rounded-full border border-[#F4B940]/30 bg-[#F4B940]/[0.08] px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-[#F4B940]">
          Phase 2 · Coming soon
        </span>
      </div>
    </div>
  );
}
