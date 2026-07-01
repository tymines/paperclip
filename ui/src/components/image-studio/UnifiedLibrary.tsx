/**
 * UnifiedLibrary — aggregated, cross-tool template browser. Search + filter chips
 * (tool · content rating · persona), thumbnail grid, and a "Use Template" that
 * opens the model picker. Used by the Image Studio workbench's Library tab and
 * embedded under the external-provider "Browse templates" chip.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Wand2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  imageStudioApi,
  uploadUrl,
  type ImageProvider,
  type PromptTemplate,
} from "@/api/imageStudio";
import { UseTemplatePicker, type TemplateApply } from "./UseTemplatePicker";
import { TOOLS, toolLabel } from "./tools";

function gradientFor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, oklch(0.6 0.12 ${h}) 0%, oklch(0.52 0.13 ${(h + 50) % 360}) 100%)`;
}

export function UnifiedLibrary({
  personas,
  defaultTool,
  lockTool,
  onApply,
}: {
  personas: ImageProvider[];
  /** Initial tool filter. */
  defaultTool?: string;
  /** When true, hide the tool chips (the context fixes the tool). */
  lockTool?: boolean;
  onApply: (template: PromptTemplate, apply: TemplateApply) => void;
}) {
  const [tool, setTool] = useState<string | null>(defaultTool ?? null);
  const [rating, setRating] = useState<"all" | "sfw" | "explicit">("all");
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState<PromptTemplate | null>(null);

  const q = useQuery({
    queryKey: ["image-studio", "unified-templates", tool, rating, personaId],
    queryFn: () =>
      imageStudioApi.listTemplates({
        tool: tool ?? undefined,
        contentRating: rating === "all" ? undefined : rating,
        personaId: personaId ?? undefined,
      }),
  });
  const templates = q.data?.templates ?? [];

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return templates;
    return templates.filter((t) =>
      `${t.name} ${t.description ?? ""} ${(t.tags ?? []).join(" ")} ${t.category ?? ""}`
        .toLowerCase()
        .includes(term),
    );
  }, [templates, search]);

  const chip = (active: boolean) =>
    cn(
      "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
      active ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" : "bg-muted text-muted-foreground hover:bg-muted/70",
    );

  return (
    <div className="space-y-3" data-testid="unified-library">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all templates…"
          className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
          data-testid="library-search"
        />
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {!lockTool && (
          <div className="flex flex-wrap items-center gap-1" data-testid="library-tool-chips">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Tool</span>
            <button type="button" onClick={() => setTool(null)} className={chip(tool === null)}>All</button>
            {TOOLS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTool(t.key)} className={chip(tool === t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Rating</span>
          {(["all", "sfw", "explicit"] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRating(r)} className={chip(rating === r)}>
              {r === "all" ? "All" : r === "sfw" ? "SFW" : "18+"}
            </button>
          ))}
        </div>
        {personas.length > 1 && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Persona</span>
            <button type="button" onClick={() => setPersonaId(null)} className={chip(personaId === null)}>All</button>
            {personas.map((p) => (
              <button key={p.id} type="button" onClick={() => setPersonaId(p.id)} className={chip(personaId === p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      {q.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">No templates match.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((t) => (
            <div
              key={t.id}
              data-testid={`library-card-${t.id}`}
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm"
            >
              <div className="relative aspect-[3/4] overflow-hidden">
                {t.previewImagePath ? (
                  <img src={uploadUrl(t.previewImagePath)} alt={t.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
                ) : (
                  <div className="h-full w-full transition-transform duration-200 group-hover:scale-105" style={{ background: gradientFor(t.category ?? t.name) }} />
                )}
                {t.contentRating === "explicit" && (
                  <span className="absolute left-1 top-1 rounded bg-red-600/90 px-1 text-[8px] font-semibold text-white">18+</span>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-5">
                  <span className="text-[11px] font-semibold text-white drop-shadow">{t.name}</span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-1 p-2">
                <div className="flex flex-wrap gap-1">
                  {(t.applicableTools ?? []).slice(0, 2).map((tk) => (
                    <span key={tk} className="rounded bg-muted px-1 text-[8px] text-muted-foreground">{toolLabel(tk)}</span>
                  ))}
                </div>
                <button
                  type="button"
                  data-testid={`library-use-${t.id}`}
                  title="Click to choose tool + model · Shift-click to use defaults"
                  onClick={(e) => {
                    if (e.shiftKey) {
                      onApply(t, {
                        tool: t.applicableTools?.[0] ?? "photoshoot",
                        model: t.compatibleModels?.[0] ?? "general",
                        personaId: personas[0]?.id ?? null,
                      });
                    } else setPicking(t);
                  }}
                  className="mt-auto inline-flex items-center justify-center gap-1 rounded-md bg-indigo-500/10 px-2 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-500/20 dark:text-indigo-300"
                >
                  <Wand2 className="h-3 w-3" /> Use Template
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {picking && (
        <UseTemplatePicker
          template={picking}
          open={!!picking}
          onOpenChange={(o) => !o && setPicking(null)}
          personas={personas}
          currentTool={tool ?? undefined}
          currentPersonaId={personaId}
          onApply={(apply) => {
            onApply(picking, apply);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
