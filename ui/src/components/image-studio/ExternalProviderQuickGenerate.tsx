/**
 * ExternalProviderQuickGenerate — replaces the dead external-provider cards with
 * an in-place generate panel. The provider's API model is pre-selected; a "Browse
 * templates" chip pulls the unified Library filtered to external_image_gen
 * templates on demand (no persistent empty Library tab). Generation backend for
 * external providers isn't wired yet, so Generate surfaces a clear notice.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BookMarked, Send, Loader2, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  imageStudioApi,
  type ImageProvider,
  type PromptTemplate,
} from "@/api/imageStudio";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UnifiedLibrary } from "./UnifiedLibrary";
import { type TemplateApply } from "./UseTemplatePicker";

/** Provider display name → the concrete API model it runs. */
const PROVIDER_API_MODEL: Record<string, string> = {
  "Nano Banana": "gemini-2.5-flash-image",
  OpenAI: "gpt-image-2",
  "BFL Flux": "flux-1.1-pro",
  "Recraft v3": "recraft-v3",
  "Ideogram v2": "ideogram-v2",
  Replicate: "flux-dev-lora",
};

const ASPECTS = ["1:1", "3:4", "4:3", "16:9", "9:16"] as const;

export function ExternalProviderQuickGenerate({
  provider,
  personas,
}: {
  provider: ImageProvider;
  personas: ImageProvider[];
}) {
  const apiModel = PROVIDER_API_MODEL[provider.name] ?? provider.model ?? "default";
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(4);
  const [aspect, setAspect] = useState("1:1");
  const [browsing, setBrowsing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const applyMut = useMutation({
    mutationFn: (args: { t: PromptTemplate; a: TemplateApply }) =>
      imageStudioApi.applyTemplate(args.t.id, {
        tool: "external_image_gen",
        model: args.a.model,
        persona_id: args.a.personaId,
      }),
    onSuccess: (res) => {
      setPrompt(res.prompt);
      setBrowsing(false);
    },
  });

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/10 p-3" data-testid="external-quick-generate">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick Generate</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" data-testid="external-model">
          {apiModel}
        </span>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        placeholder={`Describe the image for ${provider.name}…`}
        className="mb-2 w-full rounded-md border border-border bg-background p-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
        data-testid="external-prompt"
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Count
          <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center text-xs" />
        </label>
        <Select value={aspect} onValueChange={setAspect}>
          <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{ASPECTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => setBrowsing((b) => !b)}
          data-testid="external-browse-templates"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            browsing ? "border-indigo-400 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" : "border-border text-muted-foreground hover:border-indigo-300",
          )}
        >
          {browsing ? <ChevronUp className="h-3 w-3" /> : <BookMarked className="h-3 w-3" />}
          Browse templates
        </button>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => setNotice("External-provider generation isn't wired yet — prompt + params captured. Backend coming.")}
          data-testid="external-generate"
        >
          <Send className="mr-1.5 h-3.5 w-3.5" /> Generate {count}
        </Button>
      </div>

      {notice && <p className="mb-2 rounded-md border border-amber-300/60 bg-amber-50/60 p-2 text-[11px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" data-testid="external-notice">{notice}</p>}

      {/* Browse templates — unified Library filtered to external_image_gen */}
      {browsing && (
        <div className="mt-2 rounded-md border border-border bg-background p-2">
          {applyMut.isPending && (
            <div className="flex items-center gap-2 pb-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading template prompt…
            </div>
          )}
          <UnifiedLibrary
            personas={personas}
            defaultTool="external_image_gen"
            lockTool
            onApply={(t, a) => applyMut.mutate({ t, a })}
          />
        </div>
      )}
    </div>
  );
}
