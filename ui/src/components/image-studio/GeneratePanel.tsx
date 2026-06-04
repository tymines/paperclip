/**
 * GeneratePanel — the structured-control Generate experience. Replaces the old
 * single-textarea modal with a slide-over (right rail on desktop, slide-up sheet
 * on mobile) that compiles clicked attributes into a live prompt.
 *
 * Better-than-ZC touches: live prompt preview, edit-prompt escape hatch,
 * persona-default pre-fill, soft conflict warnings, live cost preview with
 * breakdown, a model picker with card/table modes, an option search bar, a
 * per-tool Library tab, and a polished dark theme with selection microinteractions.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dice5,
  RotateCcw,
  Send,
  Loader2,
  Search,
  Sparkles,
  TriangleAlert,
  Info,
  Sliders,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  imageStudioApi,
  type ImageProvider,
  type AttributeControl,
  type PromptTemplate,
  type Selections,
} from "@/api/imageStudio";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StructuredControlPanel } from "./StructuredControlPanel";
import { PromptPreview } from "./PromptPreview";
import { ModelPicker } from "./ModelPicker";
import { TemplateLibraryTab } from "./TemplateLibraryTab";
import { assemblePrompt, detectConflicts, randomizeSelections } from "./assemble";
import { findModel, DEFAULT_MODEL_ID, LORA_FEE, UPSCALE_FEE } from "./models";

const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16"] as const;

function personaRating(persona: ImageProvider): "sfw" | "explicit" {
  const tw = String(persona.attributes?.["trigger_word"] ?? "");
  if (/nsfw/i.test(tw) || /nsfw/i.test(persona.name)) return "explicit";
  const fromParams = (persona.defaultParams as Record<string, unknown> | null)?.["content_rating"];
  return fromParams === "explicit" ? "explicit" : "sfw";
}

/** Build the initial selections from a persona's stored attribute defaults. */
function defaultsFromPersona(controls: AttributeControl[], persona: ImageProvider): Selections {
  const attrs = persona.attributes ?? {};
  const out: Selections = {};
  for (const c of controls) {
    const raw = attrs[c.key] ?? attrs[`default_${c.key}`];
    const value = typeof raw === "string" ? raw : undefined;
    if (value && c.options.some((o) => o.value === value)) out[c.key] = value;
  }
  return out;
}

/** Save the current structured selections (+ compiled prompt) as a reusable
 *  library template. This is how Tyler creates his own (incl. NSFW) templates. */
function SaveStructuredTemplateDialog({
  persona,
  open,
  onOpenChange,
  selections,
  prompt,
  aspectRatio,
  loraScale,
  steps,
  rating,
  onSaved,
}: {
  persona: ImageProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selections: Selections;
  prompt: string;
  aspectRatio: string;
  loraScale: number;
  steps: number;
  rating: "sfw" | "explicit";
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [contentRating, setContentRating] = useState<"sfw" | "explicit">(rating);

  useEffect(() => {
    if (open) {
      setName("");
      setCategory("");
      setContentRating(rating);
    }
  }, [open, rating]);

  const saveMut = useMutation({
    mutationFn: () =>
      imageStudioApi.createPromptTemplate(persona.id, {
        name: name.trim(),
        template_text: prompt,
        attribute_preset: selections,
        category: category.trim() || undefined,
        content_rating: contentRating,
        gender_targeting: "female",
        default_aspect_ratio: aspectRatio,
        default_lora_scale: loraScale,
        default_steps: steps,
      }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-4 w-4 text-indigo-500" />
            Save as template
          </DialogTitle>
          <DialogDescription>
            Saves the current attribute selections to the Library for one-click reuse.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="st-name">Name</Label>
            <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Poolside 18+" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-cat">Category</Label>
            <Input id="st-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="beach, tease, office…" />
          </div>
          <div className="space-y-1.5">
            <Label>Content rating</Label>
            <Select value={contentRating} onValueChange={(v) => setContentRating(v as "sfw" | "explicit")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sfw">SFW</SelectItem>
                <SelectItem value="explicit">NSFW (explicit)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {saveMut.isError && (
            <p className="text-xs text-red-600">
              {(saveMut.error as Error)?.message ?? "Failed to save template."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={!name.trim() || saveMut.isPending}>
            {saveMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GeneratePanel({
  persona,
  open,
  onOpenChange,
  onBatchStarted,
}: {
  persona: ImageProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBatchStarted: (batchId: string) => void;
}) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const rating = personaRating(persona);

  const [tab, setTab] = useState<"compose" | "library">("compose");
  const [selections, setSelections] = useState<Selections>({});
  const [defaultKeys, setDefaultKeys] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [showExplicit, setShowExplicit] = useState(rating === "explicit");
  const [search, setSearch] = useState("");
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [count, setCount] = useState(4);
  const [loraScale, setLoraScale] = useState(1.0);
  const [steps, setSteps] = useState(28);
  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [seed, setSeed] = useState("");
  const [editing, setEditing] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const initialized = useRef(false);

  const controlsQ = useQuery({
    queryKey: ["image-studio", "attribute-controls"],
    queryFn: () => imageStudioApi.getAttributeControls(),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const controls = useMemo(() => controlsQ.data?.controls ?? [], [controlsQ.data]);

  // Pre-fill selections from the persona's defaults once the catalog loads.
  useEffect(() => {
    if (open && controls.length > 0 && !initialized.current) {
      const defs = defaultsFromPersona(controls, persona);
      setSelections(defs);
      setDefaultKeys(new Set(Object.keys(defs)));
      initialized.current = true;
    }
    if (!open) initialized.current = false;
  }, [open, controls, persona]);

  const prompt = useMemo(
    () => assemblePrompt(persona, selections, freeText, controls),
    [persona, selections, freeText, controls],
  );
  const conflicts = useMemo(
    () => detectConflicts(selections, freeText, controls),
    [selections, freeText, controls],
  );

  const model = findModel(modelId);
  const totalCost = count * model.costPerImage;

  function setSelection(key: string, value: string | undefined) {
    setSelections((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setDefaultKeys((prev) => {
      const next = new Set(prev);
      next.delete(key); // an explicit click is no longer a "default"
      return next;
    });
  }

  function surpriseMe() {
    const r = randomizeSelections(controls, showExplicit);
    setSelections(r);
    setDefaultKeys(new Set());
    setEditing(false);
  }

  function reset() {
    const defs = defaultsFromPersona(controls, persona);
    setSelections(defs);
    setDefaultKeys(new Set(Object.keys(defs)));
    setFreeText("");
    setEditing(false);
  }

  function useTemplate(t: PromptTemplate) {
    const preset = t.attributePreset ?? {};
    setSelections((prev) => ({ ...prev, ...preset }));
    setDefaultKeys((prev) => {
      const next = new Set(prev);
      for (const k of Object.keys(preset)) next.delete(k);
      return next;
    });
    if (t.defaultAspectRatio) setAspectRatio(t.defaultAspectRatio);
    if (t.defaultLoraScale != null) setLoraScale(Number(t.defaultLoraScale));
    if (t.defaultSteps != null) setSteps(t.defaultSteps);
    setEditing(false);
    setTab("compose");
  }

  const generateMut = useMutation({
    mutationFn: () => {
      const ratingOut: "sfw" | "explicit" = showExplicit ? "explicit" : rating;
      const common = {
        lora_scale: loraScale,
        steps,
        aspect_ratio: aspectRatio,
        seed: seed.trim() === "" ? null : Number(seed),
        count,
        content_rating: ratingOut,
      };
      return editing && editedPrompt.trim()
        ? imageStudioApi.generateBatch(persona.id, { prompt_text: editedPrompt.trim(), ...common })
        : imageStudioApi.generateBatch(persona.id, { selections, freeText, ...common });
    },
    onSuccess: (res) => {
      onBatchStarted(res.batch_id);
      queryClient.invalidateQueries({ queryKey: ["image-studio", "generations", persona.id] });
      onOpenChange(false);
    },
  });

  const orderedControls = useMemo(
    () => [...controls].sort((a, b) => a.sortOrder - b.sortOrder),
    [controls],
  );

  // ── Right rail (preview + model + settings + generate) ────────────────────
  const rightRail = (
    <div className="flex flex-col gap-3" data-testid="generate-right-rail">
      <PromptPreview
        prompt={prompt}
        editable={editing}
        editedValue={editedPrompt}
        onEditToggle={setEditing}
        onEditedChange={setEditedPrompt}
      />

      {conflicts.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-300/60 bg-amber-50/60 p-2 dark:border-amber-500/30 dark:bg-amber-500/10">
          {conflicts.map((c) => (
            <p
              key={c.controlKey}
              data-testid={`conflict-${c.controlKey}`}
              className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300"
            >
              <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
              Your free text mentions <b>{c.conflictingLabel}</b>, but {c.controlLabel} is set to{" "}
              <b>{c.selectedLabel}</b>.
            </p>
          ))}
        </div>
      )}

      <div>
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Free-text override
        </span>
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          rows={2}
          placeholder="Add detail — appends after the structured prompt"
          className="w-full rounded-md border border-border bg-background p-2 font-mono text-[11px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
          data-testid="free-text"
        />
      </div>

      <ModelPicker value={modelId} onChange={setModelId} />

      {/* Advanced settings */}
      <details className="rounded-lg border border-border" open>
        <summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground">
          <Sliders className="h-3 w-3" /> Advanced
        </summary>
        <div className="space-y-3 px-2.5 pb-2.5">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">LoRA scale</span>
              <span className="font-mono text-[11px]">{loraScale.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={1.2}
              step={0.05}
              value={loraScale}
              onChange={(e) => setLoraScale(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Steps</span>
              <input
                type="number"
                min={1}
                max={50}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Aspect</span>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger className="h-[30px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((ar) => (
                    <SelectItem key={ar} value={ar}>
                      {ar}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Count</span>
              <input
                type="number"
                min={1}
                max={8}
                value={count}
                onChange={(e) => setCount(Math.min(Math.max(Number(e.target.value), 1), 8))}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                data-testid="count"
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">Seed (optional)</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="random"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            />
          </label>
        </div>
      </details>

      {/* Cost preview + Generate */}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="flex cursor-help items-center gap-1 text-xs text-muted-foreground"
                data-testid="cost-preview"
              >
                <Info className="h-3 w-3" />
                {count} × ${model.costPerImage.toFixed(3)} ={" "}
                <span className="font-semibold text-foreground">${totalCost.toFixed(2)}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="text-[11px]">
              <div>Model ({model.name}): ${model.costPerImage.toFixed(3)}/img</div>
              <div>LoRA fee: ${LORA_FEE.toFixed(3)}/img (included)</div>
              <div>Upscale fee: ${UPSCALE_FEE.toFixed(3)}/img</div>
              <div className="mt-0.5 border-t border-border pt-0.5 font-semibold">
                {count} images → ${totalCost.toFixed(2)}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSaveOpen(true)}
            data-testid="save-template"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>
          <Button
            onClick={() => generateMut.mutate()}
            disabled={generateMut.isPending || (!prompt && !editedPrompt)}
            data-testid="generate-submit"
          >
            {generateMut.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            Generate {count}
          </Button>
        </div>
      </div>
      {generateMut.isError && (
        <p className="text-xs text-red-600">
          {(generateMut.error as Error)?.message ?? "Failed to start generation."}
        </p>
      )}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "h-[94vh] rounded-t-xl" : "w-full sm:max-w-3xl",
        )}
        data-testid="generate-panel"
      >
        <SheetTitle className="sr-only">{persona.name} · Generate</SheetTitle>
        <SheetDescription className="sr-only">
          Build a prompt from structured attribute controls and fire a batch.
        </SheetDescription>
        {/* Header */}
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 shrink-0 text-indigo-500" />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{persona.name} · Generate</h2>
              <p className="hidden text-[11px] text-muted-foreground sm:block">
                Click attributes to build a prompt — preview updates live
              </p>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "ml-1 shrink-0",
                rating === "explicit"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                  : "border-green-200 bg-green-50 text-green-700 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300",
              )}
            >
              {rating === "explicit" ? "NSFW" : "SFW"}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={surpriseMe} data-testid="surprise-me">
              <Dice5 className="mr-1.5 h-3.5 w-3.5" />
              Surprise Me
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} data-testid="reset">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Left: tabs (Compose / Library) */}
          <div className="flex flex-col overflow-hidden border-border lg:border-r">
            <Tabs value={tab} onValueChange={(v) => setTab(v as "compose" | "library")} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                <TabsList>
                  <TabsTrigger value="compose" data-testid="tab-compose">Compose</TabsTrigger>
                  <TabsTrigger value="library" data-testid="tab-library">Library</TabsTrigger>
                </TabsList>
                {/* SFW / Explicit toggle */}
                <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-[11px]">
                  {(["sfw", "explicit"] as const).map((r) => {
                    const active = (r === "explicit") === showExplicit;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setShowExplicit(r === "explicit")}
                        className={cn(
                          "rounded px-2 py-0.5 font-medium transition-colors",
                          active ? "bg-background shadow-sm" : "text-muted-foreground",
                        )}
                        data-testid={`rating-${r}`}
                      >
                        {r === "sfw" ? "SFW" : "18+"}
                      </button>
                    );
                  })}
                </div>
              </div>

              <TabsContent value="compose" className="flex-1 overflow-y-auto px-4 py-3">
                {/* Search over the option grid */}
                <div className="relative mb-3">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search options (e.g. blue, bun, beach)…"
                    className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    data-testid="option-search"
                  />
                </div>

                {controlsQ.isLoading ? (
                  <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading controls…
                  </div>
                ) : (
                  <div className="space-y-5">
                    {orderedControls.map((control) => (
                      <StructuredControlPanel
                        key={control.id}
                        control={control}
                        value={selections[control.key]}
                        onChange={(v) => setSelection(control.key, v)}
                        showExplicit={showExplicit}
                        search={search}
                        isDefault={defaultKeys.has(control.key)}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="library" className="flex-1 overflow-y-auto px-4 py-3">
                <TemplateLibraryTab
                  persona={persona}
                  showExplicit={showExplicit}
                  onUseTemplate={useTemplate}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Right rail */}
          <div className="overflow-y-auto bg-muted/10 p-4">{rightRail}</div>
        </div>

        <SaveStructuredTemplateDialog
          persona={persona}
          open={saveOpen}
          onOpenChange={setSaveOpen}
          selections={selections}
          prompt={prompt}
          aspectRatio={aspectRatio}
          loraScale={loraScale}
          steps={steps}
          rating={showExplicit ? "explicit" : rating}
          onSaved={() =>
            queryClient.invalidateQueries({ queryKey: ["image-studio", "templates", persona.id] })
          }
        />
      </SheetContent>
    </Sheet>
  );
}
