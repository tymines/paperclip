import { useEffect } from "react";
import { Mic } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { useBreadcrumbs } from "../context/BreadcrumbContext";

export function VoiceMemos() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Voice Memos" }]);
  }, [setBreadcrumbs]);

  return (
    <div className="space-y-6" data-pp-page="voice-memos">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">
          Voice Memos
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Drop voice memos here and Jarvis will transcribe, summarize, and
          route them into the right room or issue. Coming soon — this
          inbox is a Phase&nbsp;2 deliverable of the Jarvis state-of-the-art
          research stream.
        </p>
      </header>
      <EmptyState
        icon={Mic}
        message="Coming soon — drop voice memos here once the Phase 2 inbox ships."
      />
    </div>
  );
}
