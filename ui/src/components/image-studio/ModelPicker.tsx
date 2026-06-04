/**
 * ModelPicker — tiered multi-model picker with per-model capability badges
 * (Filters Minimal/On, LoRA, Audio, max resolution, cost). Two view modes:
 * card mode (ZC default) and a sortable table mode (our improvement).
 */
import { useState } from "react";
import { LayoutGrid, Table2, Check, ShieldCheck, ShieldAlert, Layers, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  IMAGE_MODELS,
  MODEL_TIERS,
  findModel,
  type ImageModel,
  type ModelTier,
} from "./models";

type SortKey = "name" | "filters" | "maxResolution" | "lora" | "costPerImage";

function FilterBadge({ model }: { model: ImageModel }) {
  const minimal = model.filters === "Minimal";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-medium",
        minimal
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      )}
      title={`Safety filters: ${model.filters}`}
    >
      {minimal ? <ShieldCheck className="h-2.5 w-2.5" /> : <ShieldAlert className="h-2.5 w-2.5" />}
      {model.filters}
    </span>
  );
}

function CapBadges({ model }: { model: ImageModel }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <FilterBadge model={model} />
      <span className="rounded bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">
        {model.maxResolution}
      </span>
      {model.lora && (
        <span className="inline-flex items-center gap-0.5 rounded bg-indigo-500/10 px-1 py-px text-[9px] font-medium text-indigo-600 dark:text-indigo-400">
          <Layers className="h-2.5 w-2.5" />
          LoRA
        </span>
      )}
      {model.audio && (
        <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/10 px-1 py-px text-[9px] font-medium text-violet-600">
          <Volume2 className="h-2.5 w-2.5" />
          Audio
        </span>
      )}
    </div>
  );
}

function ModelCard({
  model,
  selected,
  onSelect,
}: {
  model: ImageModel;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`model-${model.id}`}
      aria-pressed={selected}
      className={cn(
        "relative rounded-lg border p-2.5 text-left transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-sm",
        selected
          ? "border-indigo-400 bg-indigo-500/5 shadow-[0_0_0_2px_rgba(99,102,241,0.3)]"
          : "border-border hover:border-indigo-300",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs font-semibold">
          {model.name}
          {model.wired && (
            <span className="rounded bg-emerald-500/15 px-1 text-[8px] font-semibold text-emerald-600">
              LIVE
            </span>
          )}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground">
          ${model.costPerImage.toFixed(3)}/img
        </span>
      </div>
      <p className="mb-1.5 line-clamp-1 text-[10px] text-muted-foreground">{model.description}</p>
      <CapBadges model={model} />
      {selected && (
        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-white">
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}

export function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [mode, setMode] = useState<"cards" | "table">("cards");
  const [sortKey, setSortKey] = useState<SortKey>("costPerImage");
  const [asc, setAsc] = useState(true);
  const selected = findModel(value);

  const sorted = [...IMAGE_MODELS].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return asc ? cmp : -cmp;
  });

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(true);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Model
        </span>
        <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setMode("cards")}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
              mode === "cards" ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
            data-testid="model-mode-cards"
          >
            <LayoutGrid className="h-3 w-3" /> Cards
          </button>
          <button
            type="button"
            onClick={() => setMode("table")}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
              mode === "table" ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
            data-testid="model-mode-table"
          >
            <Table2 className="h-3 w-3" /> Table
          </button>
        </div>
      </div>

      {mode === "cards" ? (
        <div className="space-y-2.5">
          {MODEL_TIERS.map((tier: ModelTier) => {
            const models = IMAGE_MODELS.filter((m) => m.tier === tier);
            if (models.length === 0) return null;
            return (
              <div key={tier}>
                <p className="mb-1 text-[10px] font-medium text-muted-foreground/80">{tier}</p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {models.map((m) => (
                    <ModelCard
                      key={m.id}
                      model={m}
                      selected={m.id === value}
                      onSelect={() => onChange(m.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-accent/20 text-[10px] uppercase text-muted-foreground">
              <tr>
                {(
                  [
                    ["name", "Model"],
                    ["filters", "Filters"],
                    ["maxResolution", "Max Res"],
                    ["lora", "LoRA"],
                    ["costPerImage", "Cost"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="cursor-pointer select-none px-2 py-1 font-semibold hover:text-foreground"
                  >
                    {label}
                    {sortKey === key ? (asc ? " ↑" : " ↓") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => onChange(m.id)}
                  data-testid={`model-row-${m.id}`}
                  className={cn(
                    "cursor-pointer border-t border-border transition-colors",
                    m.id === value ? "bg-indigo-500/10" : "hover:bg-muted/50",
                  )}
                >
                  <td className="px-2 py-1 font-medium">
                    {m.id === value && <Check className="mr-1 inline h-3 w-3 text-indigo-500" />}
                    {m.name}
                  </td>
                  <td className="px-2 py-1">
                    <FilterBadge model={m} />
                  </td>
                  <td className="px-2 py-1 text-muted-foreground">{m.maxResolution}</td>
                  <td className="px-2 py-1 text-muted-foreground">{m.lora ? "Yes" : "—"}</td>
                  <td className="px-2 py-1 font-mono">${m.costPerImage.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-1.5 text-[10px] text-muted-foreground/70">
        Selected: <span className="font-medium text-foreground">{selected.name}</span> ·{" "}
        {selected.wired
          ? "renders through this persona's trained LoRA"
          : "capability preview — Tier 1 renders via the persona LoRA"}
      </p>
    </div>
  );
}
