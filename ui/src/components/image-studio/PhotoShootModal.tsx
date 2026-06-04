/**
 * PhotoShootModal — multi-category batch picker (ZC's PhotoShoot). Pick several
 * template categories and how many shots in each, then fire them all as one
 * batch through the existing Replicate worker. One submit, one cost meter.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Send, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  imageStudioApi,
  uploadUrl,
  type ImageProvider,
  type PromptTemplate,
} from "@/api/imageStudio";
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
import { findModel, DEFAULT_MODEL_ID } from "./models";

const QUANTITY_CHIPS = [5, 10, 15] as const;

function gradientFor(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, oklch(0.6 0.12 ${h}) 0%, oklch(0.5 0.13 ${(h + 60) % 360}) 100%)`;
}

export function PhotoShootModal({
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
  const [showExplicit, setShowExplicit] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const templatesQ = useQuery({
    queryKey: ["image-studio", "templates", persona.id],
    queryFn: () => imageStudioApi.listPromptTemplates(persona.id),
    enabled: open,
  });

  // Only templates with a structured preset make good PhotoShoot categories.
  const categories = useMemo(
    () =>
      (templatesQ.data?.templates ?? []).filter(
        (t) =>
          t.attributePreset &&
          Object.keys(t.attributePreset).length > 0 &&
          (showExplicit || t.contentRating !== "explicit"),
      ),
    [templatesQ.data, showExplicit],
  );

  const selectedCount = Object.values(counts).reduce((a, b) => a + b, 0);
  const selectedCats = Object.values(counts).filter((c) => c > 0).length;
  const model = findModel(DEFAULT_MODEL_ID);
  const totalCost = selectedCount * model.costPerImage;

  function setCount(id: string, value: number) {
    setCounts((prev) => {
      const next = { ...prev };
      if (prev[id] === value || value <= 0) delete next[id];
      else next[id] = value;
      return next;
    });
  }

  const fireMut = useMutation({
    mutationFn: () => {
      const cats = Object.entries(counts)
        .filter(([, c]) => c > 0)
        .map(([templateId, count]) => ({ templateId, count }));
      return imageStudioApi.batchGenerate(persona.id, {
        categories: cats,
        content_rating: showExplicit ? "explicit" : undefined,
      });
    },
    onSuccess: (res) => {
      onBatchStarted(res.batch_id);
      queryClient.invalidateQueries({ queryKey: ["image-studio", "generations", persona.id] });
      setCounts({});
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" data-testid="photoshoot-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-indigo-500" />
            {persona.name} · PhotoShoot
          </DialogTitle>
          <DialogDescription>
            Pick one or more categories and how many shots in each. They all fire as one batch.
          </DialogDescription>
        </DialogHeader>

        {/* SFW / 18+ toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {categories.length} categor{categories.length === 1 ? "y" : "ies"} available
          </span>
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
                  data-testid={`photoshoot-rating-${r}`}
                >
                  {r === "sfw" ? "SFW" : "18+"}
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {templatesQ.isLoading ? (
            <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading categories…
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {categories.map((t: PromptTemplate) => {
                const active = (counts[t.id] ?? 0) > 0;
                return (
                  <div
                    key={t.id}
                    data-testid={`photoshoot-cat-${t.id}`}
                    className={cn(
                      "overflow-hidden rounded-lg border transition-all duration-200",
                      active
                        ? "border-indigo-400 shadow-[0_0_0_2px_rgba(99,102,241,0.3)]"
                        : "border-border hover:border-indigo-300",
                    )}
                  >
                    <div className="relative aspect-[4/3] overflow-hidden">
                      {t.previewImagePath ? (
                        <img
                          src={uploadUrl(t.previewImagePath)}
                          alt={t.name}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full" style={{ background: gradientFor(t.category ?? t.name) }} />
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-5">
                        <span className="text-xs font-semibold text-white drop-shadow">{t.name}</span>
                      </div>
                      {active && (
                        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                      {t.contentRating === "explicit" && (
                        <span className="absolute left-1.5 top-1.5 rounded bg-red-600/90 px-1 text-[8px] font-semibold text-white">
                          18+
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 p-1.5">
                      {QUANTITY_CHIPS.map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setCount(t.id, q)}
                          data-testid={`photoshoot-qty-${t.id}-${q}`}
                          className={cn(
                            "flex-1 rounded px-1 py-0.5 text-[11px] font-medium transition-colors",
                            counts[t.id] === q
                              ? "bg-indigo-500 text-white"
                              : "bg-muted text-muted-foreground hover:bg-muted/70",
                          )}
                        >
                          {q}
                        </button>
                      ))}
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={counts[t.id] && !QUANTITY_CHIPS.includes(counts[t.id] as 5) ? counts[t.id] : ""}
                        onChange={(e) => setCount(t.id, Math.min(Number(e.target.value), 30))}
                        placeholder="…"
                        className="w-9 rounded border border-border bg-background px-1 py-0.5 text-center text-[11px]"
                        title="Custom quantity"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <span className="text-xs text-muted-foreground" data-testid="photoshoot-total">
            {selectedCount > 0 ? (
              <>
                <span className="font-semibold text-foreground">{selectedCount} images</span> across{" "}
                {selectedCats} categor{selectedCats === 1 ? "y" : "ies"} ·{" "}
                <Badge variant="secondary" className="ml-1">${totalCost.toFixed(2)}</Badge>
              </>
            ) : (
              "Pick a quantity on one or more categories"
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => fireMut.mutate()}
              disabled={selectedCount === 0 || fireMut.isPending}
              data-testid="photoshoot-fire"
            >
              {fireMut.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1.5 h-3.5 w-3.5" />
              )}
              Generate {selectedCount > 0 ? selectedCount : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
