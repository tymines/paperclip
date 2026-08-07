import { useState } from "react";
import {
  Check,
  Film,
  ImageIcon,
  Layers,
  LayoutGrid,
  Star,
  Table2,
  UserCheck,
  UserRoundX,
} from "lucide-react";
import type { ImageStudioProviderCapabilityState } from "@/api/imageStudio";
import { cn } from "@/lib/utils";
import {
  PROVIDER_ORDER,
  IMAGE_MODELS,
  findModel,
  modelsByProvider,
  type ImageModel,
  type ProviderHost,
} from "./models";

type SortKey = "name" | "providerHost" | "mediaKind" | "identityMethod" | "price";

function ProviderChip({ model }: { model: ImageModel }) {
  return (
    <span
      data-testid={`provider-chip-${model.providerHost}`}
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-semibold"
      style={{
        backgroundColor: `${model.providerColor}1a`,
        color: model.providerColor,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: model.providerColor }}
      />
      {model.providerName}
    </span>
  );
}

function CapabilityBadges({ model }: { model: ImageModel }) {
  const trainedIdentity = model.identityMethod === "trained_persona_identity";
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-medium",
          trainedIdentity
            ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        {trainedIdentity ? (
          <UserCheck className="h-2.5 w-2.5" />
        ) : (
          <UserRoundX className="h-2.5 w-2.5" />
        )}
        {trainedIdentity ? "Trained identity" : "Identity not guaranteed"}
      </span>
      {model.supportsLora && (
        <span className="inline-flex items-center gap-0.5 rounded bg-indigo-500/10 px-1 py-px text-[9px] font-medium text-indigo-600 dark:text-indigo-400">
          <Layers className="h-2.5 w-2.5" /> LoRA input
        </span>
      )}
      <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">
        {model.mediaKind === "video" ? (
          <Film className="h-2.5 w-2.5" />
        ) : (
          <ImageIcon className="h-2.5 w-2.5" />
        )}
        {model.mediaKind}
      </span>
    </div>
  );
}

function priceLabel(model: ImageModel): string {
  if (!model.priceEstimate) return "Estimate unavailable";
  return `Est. $${model.priceEstimate.amountUsd.toFixed(3)}/${model.priceEstimate.unit}`;
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
  const title = model.disabledReason ??
    (model.priceEstimate
      ? `Estimate source: ${model.priceEstimate.source}; observed ${model.priceEstimate.observedAt}`
      : undefined);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!model.enabled}
      data-testid={`model-${model.id}`}
      aria-pressed={selected}
      aria-describedby={!model.enabled ? `model-reason-${model.id}` : undefined}
      title={title}
      className={cn(
        "relative rounded-lg border p-2.5 text-left transition-all duration-200",
        model.enabled && "hover:-translate-y-0.5 hover:shadow-sm",
        !model.enabled && "cursor-not-allowed opacity-60",
        selected
          ? "border-indigo-400 bg-indigo-500/5 shadow-[0_0_0_2px_rgba(99,102,241,0.3)]"
          : "border-border",
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2 pr-5">
        <span className="flex items-center gap-1 text-xs font-semibold">
          {model.name}
          <span
            className={cn(
              "rounded px-1 text-[8px] font-semibold uppercase",
              model.enabled
                ? "bg-emerald-500/15 text-emerald-600"
                : "bg-muted text-muted-foreground",
            )}
          >
            {model.enabled ? "Credential verified" : model.readiness.replace(/_/g, " ")}
          </span>
        </span>
        <span className="text-[10px] font-medium text-muted-foreground">
          {priceLabel(model)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <CapabilityBadges model={model} />
        <ProviderChip model={model} />
      </div>
      {!model.enabled && model.disabledReason && (
        <p
          id={`model-reason-${model.id}`}
          className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-300"
        >
          {model.disabledReason}
        </p>
      )}
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
  models,
  providers = [],
  loading = false,
}: {
  value: string;
  onChange: (id: string) => void;
  models?: ImageModel[];
  providers?: ImageStudioProviderCapabilityState[];
  loading?: boolean;
}) {
  const resolvedModels = models ?? IMAGE_MODELS;
  const [mode, setMode] = useState<"cards" | "table">("cards");
  const [sortKey, setSortKey] = useState<SortKey>("price");
  const [ascending, setAscending] = useState(true);
  const selected = findModel(value, resolvedModels);

  const sorted = [...resolvedModels].sort((a, b) => {
    const av = sortKey === "price" ? a.priceEstimate?.amountUsd ?? Number.POSITIVE_INFINITY : a[sortKey];
    const bv = sortKey === "price" ? b.priceEstimate?.amountUsd ?? Number.POSITIVE_INFINITY : b[sortKey];
    const comparison =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
    return ascending ? comparison : -comparison;
  });

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAscending((current) => !current);
    else {
      setSortKey(key);
      setAscending(true);
    }
  }

  function availabilityLabel(value: boolean | null): string {
    return value === null ? "unknown" : value ? "yes" : "no";
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading server capabilities...</p>;
  }
  if (resolvedModels.length === 0) {
    return (
      <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        No generation capabilities are currently available from the server.
      </div>
    );
  }

  return (
    <div data-testid="model-picker">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Server capabilities
        </span>
        <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setMode("cards")}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
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
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
              mode === "table" ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
            data-testid="model-mode-table"
          >
            <Table2 className="h-3 w-3" /> Table
          </button>
        </div>
      </div>

      {mode === "cards" ? (
        <div className="space-y-3.5">
          {PROVIDER_ORDER.map((host: ProviderHost) => {
            const provider = providers.find((entry) => entry.host === host);
            const providerModels = modelsByProvider(resolvedModels, host);
            if (!provider && providerModels.length === 0) return null;
            const featured = providerModels.filter(
              (model) => model.recommended || model.providerFeatured,
            );
            const alternatives = providerModels.filter(
              (model) => !model.recommended && !model.providerFeatured,
            );
            const color = provider?.color ?? providerModels[0]?.providerColor ?? "#64748b";
            const label = provider?.name ?? providerModels[0]?.providerName ?? host;

            return (
              <div key={host} data-testid={`provider-group-${host}`}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2 border-b border-border/60 pb-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-xs font-bold" style={{ color }}>{label}</span>
                  {provider && (
                    <span className="text-[10px] text-muted-foreground">
                      configured: {availabilityLabel(provider.configured)} | credential verified:{" "}
                      {availabilityLabel(provider.credentialVerified)} | catalog:{" "}
                      {provider.catalogAvailable === null
                        ? "unknown"
                        : provider.catalogAvailable
                          ? "available"
                          : "unavailable"}
                    </span>
                  )}
                  {provider?.disabledReason && (
                    <span className="text-[10px] text-amber-700 dark:text-amber-300">
                      {provider.disabledReason}
                    </span>
                  )}
                </div>
                {[...featured, ...alternatives].map((model) => (
                  <div key={model.id} className="mb-1.5">
                    {(model.recommended || model.providerFeatured) && (
                      <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        {model.recommended ? "Recommended identity route" : "Provider default"}
                      </p>
                    )}
                    <ModelCard
                      model={model}
                      selected={model.id === value}
                      onSelect={() => onChange(model.id)}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-[720px] w-full text-left text-[11px]">
            <thead className="bg-accent/20 text-[10px] uppercase text-muted-foreground">
              <tr>
                {(
                  [
                    ["name", "Model"],
                    ["providerHost", "Provider"],
                    ["mediaKind", "Media"],
                    ["identityMethod", "Identity"],
                    ["price", "Estimate"],
                  ] as [SortKey, string][]
                ).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="cursor-pointer select-none px-2 py-1 font-semibold hover:text-foreground"
                  >
                    {label}{sortKey === key ? (ascending ? " up" : " down") : ""}
                  </th>
                ))}
                <th className="px-2 py-1 font-semibold">Availability</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((model) => (
                <tr
                  key={model.id}
                  onClick={() => model.enabled && onChange(model.id)}
                  data-testid={`model-row-${model.id}`}
                  aria-disabled={!model.enabled}
                  title={model.disabledReason ?? undefined}
                  className={cn(
                    "border-t border-border",
                    model.enabled ? "cursor-pointer hover:bg-muted/50" : "cursor-not-allowed opacity-60",
                    model.id === value && "bg-indigo-500/10",
                  )}
                >
                  <td className="px-2 py-1 font-medium">{model.name}</td>
                  <td className="px-2 py-1"><ProviderChip model={model} /></td>
                  <td className="px-2 py-1 text-muted-foreground">{model.mediaKind}</td>
                  <td className="px-2 py-1 text-muted-foreground">
                    {model.identityMethod === "trained_persona_identity"
                      ? "Trained persona"
                      : "Not guaranteed"}
                  </td>
                  <td className="px-2 py-1 font-mono">{priceLabel(model)}</td>
                  <td className="px-2 py-1 text-muted-foreground">
                    {model.enabled ? "Credential verified" : model.disabledReason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-1.5 text-[10px] text-muted-foreground/70">
        Selected: <span className="font-medium text-foreground">{selected.name}</span>.{" "}
        {selected.identityMethod === "trained_persona_identity"
          ? "This route uses the trained persona identity."
          : "This route does not guarantee the persona identity."}
      </p>
    </div>
  );
}
