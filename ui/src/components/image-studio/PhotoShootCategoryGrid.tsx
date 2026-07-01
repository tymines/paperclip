/**
 * PhotoShootCategoryGrid — the multi-category picker grid, rendered in the
 * persona workbench's PhotoShoot tab.
 *
 * Features (ZenCreator parity): responsive 5/3/2-col grid, multi-preview carousel
 * (←/→ on hover when a card has >1 preview), per-card helper text, a "New" badge
 * on templates < 14 days old, and a sticky safe-area fire bar. Filtered by the
 * caller's SFW/18+ and Female/Male selections.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Check, ChevronLeft, ChevronRight, Sparkle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  imageStudioApi,
  uploadUrl,
  type ImageProvider,
  type PromptTemplate,
} from "@/api/imageStudio";
import { Button } from "@/components/ui/button";

const QUANTITY_CHIPS = [5, 10, 15] as const;
const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function gradientFor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, oklch(0.6 0.12 ${h}) 0%, oklch(0.5 0.13 ${(h + 60) % 360}) 100%)`;
}

function previewList(t: PromptTemplate): string[] {
  const arr = (t.previewImagePaths ?? []).filter(Boolean);
  if (arr.length > 0) return arr;
  return t.previewImagePath ? [t.previewImagePath] : [];
}

function isNew(t: PromptTemplate): boolean {
  const ts = new Date(t.createdAt).getTime();
  return Number.isFinite(ts) && Date.now() - ts < NEW_WINDOW_MS;
}

function CategoryCard({
  t,
  count,
  onSetCount,
}: {
  t: PromptTemplate;
  count: number;
  onSetCount: (value: number) => void;
}) {
  const previews = previewList(t);
  const [idx, setIdx] = useState(0);
  const active = count > 0;
  const hasCarousel = previews.length > 1;
  const cur = previews[Math.min(idx, previews.length - 1)];

  return (
    <div
      data-testid={`photoshoot-cat-${t.id}`}
      className={cn(
        "group overflow-hidden rounded-lg border transition-all duration-200",
        active ? "border-indigo-400 shadow-[0_0_0_2px_rgba(99,102,241,0.3)]" : "border-border hover:border-indigo-300",
      )}
    >
      <div className="relative aspect-[3/4] overflow-hidden">
        {cur ? (
          <img src={uploadUrl(cur)} alt={t.name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full" style={{ background: gradientFor(t.category ?? t.name) }} />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1 pt-6">
          <span className="text-xs font-semibold text-white drop-shadow">{t.name}</span>
        </div>
        {/* badges */}
        <div className="absolute left-1.5 top-1.5 flex gap-1">
          {t.contentRating === "explicit" && (
            <span className="rounded bg-red-600/90 px-1 text-[8px] font-semibold text-white">18+</span>
          )}
          {isNew(t) && (
            <span className="inline-flex items-center gap-0.5 rounded bg-indigo-500/90 px-1 text-[8px] font-semibold text-white" data-testid="new-badge">
              <Sparkle className="h-2 w-2" /> NEW
            </span>
          )}
        </div>
        {active && (
          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-white">
            <Check className="h-3 w-3" />
          </span>
        )}
        {/* carousel arrows (hover, >1 preview) */}
        {hasCarousel && (
          <>
            <button
              type="button"
              onClick={() => setIdx((i) => (i - 1 + previews.length) % previews.length)}
              className="absolute left-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-0.5 text-white group-hover:block"
              aria-label="Previous preview"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIdx((i) => (i + 1) % previews.length)}
              className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-0.5 text-white group-hover:block"
              aria-label="Next preview"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <div className="absolute bottom-7 left-1/2 hidden -translate-x-1/2 gap-1 group-hover:flex">
              {previews.map((_, i) => (
                <span key={i} className={cn("h-1 w-1 rounded-full", i === idx ? "bg-white" : "bg-white/40")} />
              ))}
            </div>
          </>
        )}
      </div>
      <div className="p-1.5">
        <div className="flex items-center gap-1">
          {QUANTITY_CHIPS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onSetCount(count === q ? 0 : q)}
              data-testid={`photoshoot-qty-${t.id}-${q}`}
              className={cn(
                "flex-1 rounded px-1 py-0.5 text-[11px] font-medium transition-colors",
                count === q ? "bg-indigo-500 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {q}
            </button>
          ))}
          <input
            type="number"
            min={0}
            max={30}
            value={count && !QUANTITY_CHIPS.includes(count as 5) ? count : ""}
            onChange={(e) => onSetCount(Math.min(Number(e.target.value), 30))}
            placeholder="…"
            className="w-9 rounded border border-border bg-background px-1 py-0.5 text-center text-[11px]"
            title="Custom quantity"
          />
        </div>
        <p className="mt-1 text-[9px] leading-tight text-muted-foreground">Choose how many to generate or enter your own</p>
      </div>
    </div>
  );
}

export function PhotoShootCategoryGrid({
  persona,
  showExplicit,
  gender,
  onBatchStarted,
}: {
  persona: ImageProvider;
  showExplicit: boolean;
  gender: "female" | "male";
  onBatchStarted: (batchId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [counts, setCounts] = useState<Record<string, number>>({});

  const templatesQ = useQuery({
    queryKey: ["image-studio", "templates", persona.id],
    queryFn: () => imageStudioApi.listPromptTemplates(persona.id),
  });

  const categories = useMemo(
    () =>
      (templatesQ.data?.templates ?? []).filter((t) => {
        const usable = (t.attributePreset && Object.keys(t.attributePreset).length > 0) || !!t.previewImagePath;
        const genderOk = !t.genderTargeting || t.genderTargeting === "any" || t.genderTargeting === gender;
        return usable && genderOk && (showExplicit || t.contentRating !== "explicit");
      }),
    [templatesQ.data, showExplicit, gender],
  );

  const selectedCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const selectedCats = Object.values(counts).filter((c) => c > 0).length;
  const totalCost = selectedCount * 0.04;

  function setCount(id: string, value: number) {
    setCounts((prev) => {
      const next = { ...prev };
      if (value <= 0) delete next[id];
      else next[id] = value;
      return next;
    });
  }

  const fireMut = useMutation({
    mutationFn: () =>
      imageStudioApi.batchGenerate(persona.id, {
        categories: Object.entries(counts).filter(([, c]) => c > 0).map(([templateId, count]) => ({ templateId, count })),
        content_rating: showExplicit ? "explicit" : undefined,
      }),
    onSuccess: (res) => {
      onBatchStarted(res.batch_id);
      queryClient.invalidateQueries({ queryKey: ["image-studio", "generations", persona.id] });
      setCounts({});
    },
  });

  return (
    <div data-testid="photoshoot-grid">
      {templatesQ.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading categories…
        </div>
      ) : categories.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">No categories match the current filters.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {categories.map((t) => (
            <CategoryCard key={t.id} t={t} count={counts[t.id] ?? 0} onSetCount={(v) => setCount(t.id, v)} />
          ))}
        </div>
      )}

      <div className="sticky bottom-0 z-10 mt-3 flex items-center justify-between gap-2 border-t border-border bg-card/95 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <span className="text-xs text-muted-foreground" data-testid="photoshoot-total">
          {selectedCount > 0 ? (
            <>
              <span className="font-semibold text-foreground">{selectedCount} images</span> · {selectedCats} categor{selectedCats === 1 ? "y" : "ies"} · ${totalCost.toFixed(2)}
            </>
          ) : (
            "Pick a quantity on one or more categories"
          )}
        </span>
        <Button onClick={() => fireMut.mutate()} disabled={selectedCount === 0 || fireMut.isPending} data-testid="photoshoot-fire">
          {fireMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
          Generate {selectedCount > 0 ? selectedCount : ""}
        </Button>
      </div>
    </div>
  );
}
