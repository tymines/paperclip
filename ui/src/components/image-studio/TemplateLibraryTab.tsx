/**
 * TemplateLibraryTab — per-tool curated template library (ZC's "Library [New]"
 * tab). Category chips + 18+ toggle + thumbnail grid + one-click "Use Template"
 * that loads the template's attribute preset into the composer for further edits
 * before firing.
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

function gradientFor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, oklch(0.6 0.12 ${h}) 0%, oklch(0.52 0.13 ${(h + 50) % 360}) 100%)`;
}

export function TemplateLibraryTab({
  persona,
  showExplicit,
  onUseTemplate,
}: {
  persona: ImageProvider;
  showExplicit: boolean;
  onUseTemplate: (template: PromptTemplate) => void;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const templatesQ = useQuery({
    queryKey: ["image-studio", "templates", persona.id],
    queryFn: () => imageStudioApi.listPromptTemplates(persona.id),
  });
  const templates = templatesQ.data?.templates ?? [];

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) if (t.category) set.add(t.category);
    return Array.from(set).sort();
  }, [templates]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (!showExplicit && t.contentRating === "explicit") return false;
      if (category && t.category !== category) return false;
      if (q && !(`${t.name} ${t.description ?? ""} ${(t.tags ?? []).join(" ")}`.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [templates, showExplicit, category, search]);

  return (
    <div className="space-y-3" data-testid="template-library">
      {/* Search + category chips */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates…"
          className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setCategory(null)}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
            category === null ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" : "bg-muted text-muted-foreground hover:bg-muted/70",
          )}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize transition-colors",
              category === c ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            {c.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {templatesQ.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          No templates match. {!showExplicit && "Toggle 18+ to see explicit templates."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {visible.map((t) => (
            <div
              key={t.id}
              data-testid={`template-card-${t.id}`}
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-sm"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                {t.previewImagePath ? (
                  <img
                    src={uploadUrl(t.previewImagePath)}
                    alt={t.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                ) : (
                  <div
                    className="h-full w-full transition-transform duration-200 group-hover:scale-105"
                    style={{ background: gradientFor(t.category ?? t.name) }}
                  />
                )}
                {t.contentRating === "explicit" && (
                  <span className="absolute left-1 top-1 rounded bg-red-600/90 px-1 text-[8px] font-semibold text-white">
                    18+
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-2">
                <span className="truncate text-xs font-semibold">{t.name}</span>
                {t.description && (
                  <p className="line-clamp-2 text-[10px] text-muted-foreground">{t.description}</p>
                )}
                <button
                  type="button"
                  data-testid={`use-template-${t.id}`}
                  onClick={() => onUseTemplate(t)}
                  className="mt-auto inline-flex items-center justify-center gap-1 rounded-md bg-indigo-500/10 px-2 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-500/20 dark:text-indigo-300"
                >
                  <Wand2 className="h-3 w-3" />
                  Use Template
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
