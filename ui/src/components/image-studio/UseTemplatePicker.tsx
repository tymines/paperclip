/**
 * UseTemplatePicker — opens when a user clicks "Use Template" anywhere. Lets them
 * choose the Tool, Model (the template's compatible_models first, as
 * "Recommended"), and Persona before loading the template into that tool's
 * composer. Tyler's ask: "if I click a template I should be able to choose what
 * model I want it to run on."
 *
 * Power-user shortcut: hold Shift while clicking "Use Template" to skip this
 * dialog and apply with defaults (handled by the caller).
 */
import { useMemo, useState } from "react";
import { Wand2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ImageProvider, PromptTemplate } from "@/api/imageStudio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IMAGE_MODELS, DEFAULT_MODEL_ID } from "./models";
import { TOOLS, toolDef } from "./tools";

export interface TemplateApply {
  tool: string;
  model: string;
  personaId: string | null;
}

export function UseTemplatePicker({
  template,
  open,
  onOpenChange,
  personas,
  currentTool,
  currentPersonaId,
  onApply,
}: {
  template: PromptTemplate;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personas: ImageProvider[];
  currentTool?: string;
  currentPersonaId?: string | null;
  onApply: (apply: TemplateApply) => void;
}) {
  const applicable = template.applicableTools?.length ? template.applicableTools : ["photoshoot"];
  const toolOptions = useMemo(
    () => TOOLS.filter((t) => applicable.includes(t.key)),
    [applicable],
  );
  const [tool, setTool] = useState<string>(
    currentTool && applicable.includes(currentTool) ? currentTool : toolOptions[0]?.key ?? "photoshoot",
  );
  const def = toolDef(tool);

  const recommended = template.compatibleModels ?? [];
  const recommendedModels = IMAGE_MODELS.filter((m) => recommended.includes(m.id));
  const otherModels = IMAGE_MODELS.filter((m) => !recommended.includes(m.id));
  const [model, setModel] = useState<string>(recommended[0] ?? DEFAULT_MODEL_ID);

  const [personaId, setPersonaId] = useState<string>(currentPersonaId ?? personas[0]?.id ?? "");

  function apply() {
    onApply({ tool, model, personaId: def?.needsPersona ? personaId || null : null });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="use-template-picker">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-indigo-500" />
            Use "{template.name}"
          </DialogTitle>
          <DialogDescription>Choose where and how to run this template.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Tool */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tool</label>
            <Select value={tool} onValueChange={setTool}>
              <SelectTrigger data-testid="picker-tool"><SelectValue /></SelectTrigger>
              <SelectContent>
                {toolOptions.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}{!t.built && " (coming soon)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model — recommended first */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model</label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger data-testid="picker-model"><SelectValue /></SelectTrigger>
              <SelectContent>
                {recommendedModels.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="flex items-center gap-1 text-indigo-500">
                      <Star className="h-3 w-3" /> Recommended
                    </SelectLabel>
                    {recommendedModels.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectGroup>
                )}
                <SelectGroup>
                  {recommendedModels.length > 0 && <SelectLabel>All models</SelectLabel>}
                  {otherModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Persona (when the tool needs one) */}
          {def?.needsPersona && personas.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Persona</label>
              <Select value={personaId} onValueChange={setPersonaId}>
                <SelectTrigger data-testid="picker-persona"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {personas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {def && !def.built && (
            <p className={cn("rounded-md border border-amber-300/60 bg-amber-50/60 p-2 text-[11px] text-amber-700",
              "dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300")}>
              {def.label} isn't built yet — applying will load the prompt once the tool ships.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} data-testid="picker-apply">
            <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Use Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
