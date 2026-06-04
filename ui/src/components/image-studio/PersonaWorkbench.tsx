/**
 * PersonaWorkbench — the INLINE persona studio. Replaces the old GeneratePanel
 * slide-over + PhotoShootModal: everything lives directly inside the expanded
 * persona card, no overlays. Mobile-first — sections collapse to accordions on
 * small viewports and the Generate/PhotoShoot action bar sticks above the iOS
 * bottom nav (safe-area aware).
 *
 * Two tabs (Generate · PhotoShoot) share one obvious animated SFW/18+ toggle
 * that filters attribute_options + prompt_templates by content rating.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dice5,
  RotateCcw,
  Send,
  Loader2,
  Search,
  TriangleAlert,
  Info,
  Sliders,
  Save,
  ChevronDown,
  Camera,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePersistedModel } from "@/hooks/usePersistedModel";
import {
  imageStudioApi,
  type ImageProvider,
  type AttributeControl,
  type PromptTemplate,
  type Selections,
} from "@/api/imageStudio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { PhotoShootCategoryGrid } from "./PhotoShootCategoryGrid";
import { assemblePrompt, detectConflicts, randomizeSelections } from "./assemble";
import { findModel, DEFAULT_MODEL_ID, LORA_FEE, UPSCALE_FEE } from "./models";

const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16"] as const;

export function personaRating(persona: ImageProvider): "sfw" | "explicit" {
  const tw = String(persona.attributes?.["trigger_word"] ?? "");
  if (/nsfw/i.test(tw) || /nsfw/i.test(persona.name)) return "explicit";
  const fromParams = (persona.defaultParams as Record<string, unknown> | null)?.["content_rating"];
  return fromParams === "explicit" ? "explicit" : "sfw";
}

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

// ── Obvious, animated SFW / 18+ pill toggle ─────────────────────────────────
export function ExplicitToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Content rating"
      className="relative inline-flex h-7 w-[112px] items-center rounded-full border border-border bg-muted/50 p-0.5 text-[11px] font-semibold shadow-inner"
      data-testid="explicit-toggle"
    >
      {/* sliding knob */}
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 h-6 w-[54px] rounded-full shadow transition-all duration-300 ease-out",
          value
            ? "left-[54px] bg-gradient-to-r from-rose-500 to-red-500"
            : "left-0.5 bg-gradient-to-r from-emerald-500 to-green-500",
        )}
      />
      <button
        type="button"
        onClick={() => onChange(false)}
        data-testid="rating-sfw"
        className={cn(
          "relative z-10 flex-1 rounded-full py-0.5 transition-colors",
          value ? "text-muted-foreground" : "text-white",
        )}
      >
        SFW
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        data-testid="rating-explicit"
        className={cn(
          "relative z-10 flex-1 rounded-full py-0.5 transition-colors",
          value ? "text-white" : "text-muted-foreground",
        )}
      >
        18+
      </button>
    </div>
  );
}

// ── Mobile accordion wrapper for a control section ──────────────────────────
function AccordionSection({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between py-2.5"
        data-testid={`accordion-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <span className="flex items-center gap-2">
          {summary && <span className="max-w-[120px] truncate text-[11px] text-foreground/70">{summary}</span>}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>
      <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden pb-3">{children}</div>
      </div>
    </div>
  );
}

// ── Save-as-template (small dialog — the one remaining overlay, a brief form) ─
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
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sfw">SFW</SelectItem>
                <SelectItem value="explicit">NSFW (explicit)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {saveMut.isError && (
            <p className="text-xs text-red-600">{(saveMut.error as Error)?.message ?? "Failed to save template."}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={!name.trim() || saveMut.isPending}>
            {saveMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Generate inline (controls + preview/model/advanced/action) ──────────────
function GenerateInline({
  persona,
  showExplicit,
  rating,
  onBatchStarted,
  registerActions,
}: {
  persona: ImageProvider;
  showExplicit: boolean;
  rating: "sfw" | "explicit";
  onBatchStarted: (batchId: string) => void;
  registerActions: (a: { surpriseMe: () => void; reset: () => void }) => void;
}) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [selections, setSelections] = useState<Selections>({});
  const [defaultKeys, setDefaultKeys] = useState<Set<string>>(new Set());
  const [freeText, setFreeText] = useState("");
  const [search, setSearch] = useState("");
  // Model selection persists per persona × tool, defaulting to ⭐ Recommended.
  const [modelId, setModelId] = usePersistedModel(persona.id, "persona_generate");
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
    staleTime: 5 * 60_000,
  });
  const controls = useMemo(() => controlsQ.data?.controls ?? [], [controlsQ.data]);
  const orderedControls = useMemo(() => [...controls].sort((a, b) => a.sortOrder - b.sortOrder), [controls]);

  useEffect(() => {
    if (controls.length > 0 && !initialized.current) {
      const defs = defaultsFromPersona(controls, persona);
      setSelections(defs);
      setDefaultKeys(new Set(Object.keys(defs)));
      initialized.current = true;
    }
  }, [controls, persona]);

  const prompt = useMemo(() => assemblePrompt(persona, selections, freeText, controls), [persona, selections, freeText, controls]);
  const conflicts = useMemo(() => detectConflicts(selections, freeText, controls), [selections, freeText, controls]);
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
      next.delete(key);
      return next;
    });
  }
  function surpriseMe() {
    setSelections(randomizeSelections(controls, showExplicit));
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
  useEffect(() => { registerActions({ surpriseMe, reset }); });

  function useTemplate(t: PromptTemplate, apply?: { tool: string; model: string; personaId: string | null }) {
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
    if (apply?.model) setModelId(apply.model); // honor the picker's model choice
    setEditing(false);
    setSubTab("compose");
  }

  const [subTab, setSubTab] = useState<"compose" | "library">("compose");

  const generateMut = useMutation({
    mutationFn: () => {
      const ratingOut: "sfw" | "explicit" = showExplicit ? "explicit" : rating;
      const common = { lora_scale: loraScale, steps, aspect_ratio: aspectRatio, seed: seed.trim() === "" ? null : Number(seed), count, content_rating: ratingOut };
      return editing && editedPrompt.trim()
        ? imageStudioApi.generateBatch(persona.id, { prompt_text: editedPrompt.trim(), ...common })
        : imageStudioApi.generateBatch(persona.id, { selections, freeText, ...common });
    },
    onSuccess: (res) => {
      onBatchStarted(res.batch_id);
      queryClient.invalidateQueries({ queryKey: ["image-studio", "generations", persona.id] });
    },
  });

  const controlsBlock = controlsQ.isLoading ? (
    <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading controls…
    </div>
  ) : isMobile ? (
    // Mobile: collapsible accordions to cut vertical scroll
    <div>
      {orderedControls.map((control, i) => {
        const selValue = selections[control.key];
        const summary = selValue ? control.options.find((o) => o.value === selValue)?.label : undefined;
        return (
          <AccordionSection key={control.id} title={control.label} summary={summary} defaultOpen={i === 0}>
            <StructuredControlPanel
              control={control}
              value={selValue}
              onChange={(v) => setSelection(control.key, v)}
              showExplicit={showExplicit}
              search={search}
              isDefault={defaultKeys.has(control.key)}
              hideHeader
            />
          </AccordionSection>
        );
      })}
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
  );

  const rightRail = (
    <div className="flex flex-col gap-3">
      <PromptPreview prompt={prompt} editable={editing} editedValue={editedPrompt} onEditToggle={setEditing} onEditedChange={setEditedPrompt} />
      {conflicts.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-300/60 bg-amber-50/60 p-2 dark:border-amber-500/30 dark:bg-amber-500/10">
          {conflicts.map((c) => (
            <p key={c.controlKey} data-testid={`conflict-${c.controlKey}`} className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
              <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
              Free text mentions <b>{c.conflictingLabel}</b>, but {c.controlLabel} is <b>{c.selectedLabel}</b>.
            </p>
          ))}
        </div>
      )}
      <div>
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Free-text override</span>
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
      <details className="rounded-lg border border-border">
        <summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground">
          <Sliders className="h-3 w-3" /> Advanced
        </summary>
        <div className="space-y-3 px-2.5 pb-2.5">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">LoRA scale</span>
              <span className="font-mono text-[11px]">{loraScale.toFixed(2)}</span>
            </div>
            <input type="range" min={0.5} max={1.2} step={0.05} value={loraScale} onChange={(e) => setLoraScale(Number(e.target.value))} className="w-full accent-indigo-500" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Steps</span>
              <input type="number" min={1} max={50} value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs" />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Aspect</span>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger className="h-[30px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{ASPECT_RATIOS.map((ar) => <SelectItem key={ar} value={ar}>{ar}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Count</span>
              <input type="number" min={1} max={8} value={count} onChange={(e) => setCount(Math.min(Math.max(Number(e.target.value), 1), 8))} className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs" data-testid="count" />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">Seed (optional)</span>
            <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="random" className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs" />
          </label>
        </div>
      </details>
    </div>
  );

  return (
    <div>
      {/* Compose / Library sub-tabs */}
      <div className="mb-3 flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
        {(["compose", "library"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSubTab(s)}
            data-testid={`subtab-${s}`}
            className={cn("flex-1 rounded-md py-1 font-medium capitalize transition-colors", subTab === s ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {s === "compose" ? "Compose" : "Library"}
          </button>
        ))}
      </div>

      {subTab === "library" ? (
        <TemplateLibraryTab persona={persona} showExplicit={showExplicit} onUseTemplate={useTemplate} currentTool="persona_generate" />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-5">
          <div className="min-w-0">
            {!isMobile && (
              <div className="relative mb-3">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search options (e.g. blue, bun, beach)…" className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" data-testid="option-search" />
              </div>
            )}
            {controlsBlock}
          </div>
          <div className="mt-4 lg:mt-0">{rightRail}</div>
        </div>
      )}

      {/* Sticky generate bar (safe-area aware) */}
      <div className="sticky bottom-0 z-10 mt-3 flex items-center justify-between gap-2 border-t border-border bg-card/95 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex cursor-help items-center gap-1 text-xs text-muted-foreground" data-testid="cost-preview">
                <Info className="h-3 w-3" />
                {count} × ${model.costPerImage.toFixed(3)} = <span className="font-semibold text-foreground">${totalCost.toFixed(2)}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="text-[11px]">
              <div>Model ({model.name}): ${model.costPerImage.toFixed(3)}/img</div>
              <div>LoRA fee: ${LORA_FEE.toFixed(3)}/img (included)</div>
              <div>Upscale fee: ${UPSCALE_FEE.toFixed(3)}/img</div>
              <div className="mt-0.5 border-t border-border pt-0.5 font-semibold">{count} images → ${totalCost.toFixed(2)}</div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSaveOpen(true)} data-testid="save-template">
            <Save className="mr-1.5 h-3.5 w-3.5" /> Save
          </Button>
          <Button onClick={() => generateMut.mutate()} disabled={generateMut.isPending || (!prompt && !editedPrompt)} data-testid="generate-submit">
            {generateMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Generate {count}
          </Button>
        </div>
      </div>
      {generateMut.isError && (
        <p className="text-xs text-red-600">{(generateMut.error as Error)?.message ?? "Failed to start generation."}</p>
      )}

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
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["image-studio", "templates", persona.id] })}
      />
    </div>
  );
}

// ── Main inline workbench ───────────────────────────────────────────────────
export function PersonaWorkbench({
  persona,
  onBatchStarted,
}: {
  persona: ImageProvider;
  onBatchStarted: (batchId: string) => void;
}) {
  const rating = personaRating(persona);
  const [tab, setTab] = useState<"generate" | "photoshoot">("generate");
  const [showExplicit, setShowExplicit] = useState(rating === "explicit");
  const [gender, setGender] = useState<"female" | "male">("female");
  const actionsRef = useRef<{ surpriseMe: () => void; reset: () => void }>({ surpriseMe: () => {}, reset: () => {} });

  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-3 sm:p-4" data-testid="persona-workbench">
      {/* Header: tabs + the obvious SFW/18+ toggle always share the top row so
          the toggle is never clipped on mobile; Surprise/Reset wrap below. */}
      <div className="mb-3 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex self-start rounded-lg border border-border bg-muted/40 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setTab("generate")}
              data-testid="tab-generate"
              className={cn("flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors", tab === "generate" ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              <Wand2 className="h-3.5 w-3.5" /> Generate
            </button>
            <button
              type="button"
              onClick={() => setTab("photoshoot")}
              data-testid="tab-photoshoot"
              className={cn("flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors", tab === "photoshoot" ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              <Camera className="h-3.5 w-3.5" /> PhotoShoot
            </button>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:hidden">
              Content
            </span>
            <ExplicitToggle value={showExplicit} onChange={setShowExplicit} />
          </div>
        </div>
        {tab === "generate" && (
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => actionsRef.current.surpriseMe()} data-testid="surprise-me">
              <Dice5 className="mr-1.5 h-3.5 w-3.5" /> Surprise Me
            </Button>
            <Button variant="ghost" size="sm" onClick={() => actionsRef.current.reset()} data-testid="reset">
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
            </Button>
          </div>
        )}
      </div>

      {/* Keep both tabs mounted (display-toggle) so their state + the shared
          toggle filter survive tab switches. */}
      <div className={cn(tab === "generate" ? "block" : "hidden")}>
        <GenerateInline
          persona={persona}
          showExplicit={showExplicit}
          rating={rating}
          onBatchStarted={onBatchStarted}
          registerActions={(a) => (actionsRef.current = a)}
        />
      </div>
      <div className={cn(tab === "photoshoot" ? "block" : "hidden")}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">Pick categories + counts — they all fire as one batch.</p>
          <GenderFilter value={gender} onChange={setGender} />
        </div>
        <PhotoShootCategoryGrid persona={persona} showExplicit={showExplicit} gender={gender} onBatchStarted={onBatchStarted} />
      </div>
    </div>
  );
}

/** Female / Male filter chip row for the PhotoShoot category grid. */
export function GenderFilter({
  value,
  onChange,
}: {
  value: "female" | "male";
  onChange: (g: "female" | "male") => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5 text-[11px]" data-testid="gender-filter">
      {(["female", "male"] as const).map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onChange(g)}
          data-testid={`gender-${g}`}
          className={cn(
            "rounded px-2.5 py-0.5 font-medium capitalize transition-colors",
            value === g ? "bg-background shadow-sm" : "text-muted-foreground",
          )}
        >
          {g}
        </button>
      ))}
    </div>
  );
}
