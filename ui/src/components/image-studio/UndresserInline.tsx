/**
 * UndresserInline — the Undresser tool collapsed INTO the persona workbench.
 *
 * Unlike the retired standalone /image-studio/tools/female-undresser page, this
 * is PERSONA-BOUND: the persona is whichever card hosts the workbench, so its
 * face/LoRA is applied automatically — no persona dropdown. You upload a source
 * photo, pick a model, and fire. (The "any photo, no persona" workflow is a
 * later v2 lane.)
 *
 * Backend is still a stub (returns { status: "backend_pending" }); the UI shell
 * is wired so it lights up the moment the generation endpoint ships.
 *
 * Paperclip v1 is single-operator (Tyler only) — no consent gate.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, Loader2, Shirt } from "lucide-react";
import { usePersistedModel } from "@/hooks/usePersistedModel";
import {
  imageStudioApi,
  type ImageProvider,
  type ImageStudioProviderCapabilityState,
} from "@/api/imageStudio";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ModelPicker } from "./ModelPicker";
import { findModel, type ImageModel } from "./models";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the source image."));
    reader.readAsDataURL(file);
  });
}

export function UndresserInline({
  persona,
  showExplicit,
  models,
  providers,
  capabilitiesLoading,
}: {
  persona: ImageProvider;
  showExplicit: boolean;
  models: ImageModel[];
  providers: ImageStudioProviderCapabilityState[];
  capabilitiesLoading: boolean;
}) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [count, setCount] = useState(1);
  const [modelId, setModelId] = usePersistedModel(persona.id, "female_undresser");
  const [result, setResult] = useState<string | null>(null);
  const configuredUndresserModel = (persona.defaultParams as Record<string, unknown> | null)?.undresser_model;
  const backendConfigured = typeof configuredUndresserModel === "string" && configuredUndresserModel.trim().length > 0;
  const selectedModel = findModel(modelId, models);
  const selectedModelAvailable = models.some((model) => model.id === modelId && model.enabled);
  const capabilitiesReady = !capabilitiesLoading && models.length > 0;

  useEffect(() => {
    if (models.length === 0 || selectedModelAvailable) return;
    const fallback = models.find((model) => model.recommended && model.enabled) ?? models.find((model) => model.enabled);
    if (fallback && fallback.id !== modelId) setModelId(fallback.id);
  }, [modelId, models, selectedModelAvailable, setModelId]);

  const genMut = useMutation({
    mutationFn: async () => {
      if (!sourceFile) throw new Error("Choose a source image first.");
      if (!backendConfigured) throw new Error("Undresser generation is not configured for this persona yet.");
      const sourceImage = await readFileAsDataUrl(sourceFile);
      return imageStudioApi.femaleUndresserGenerate({
        source_file: sourceFile.name,
        source_image: sourceImage,
        persona_id: persona.id,
        model: modelId,
        count,
        content_rating: showExplicit ? "explicit" : "sfw",
      });
    },
    onSuccess: (res) => setResult(res.message ?? res.status),
  });

  return (
    <div className="space-y-4" data-testid="undresser-inline">
      <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/60 p-2.5 text-[11px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        <Shirt className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>
          Undress with <b>{persona.name}</b>&rsquo;s face applied. Upload a source photo, pick a
          model, and fire — the persona LoRA keeps the face consistent.
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* Source upload */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Source image
            </span>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground hover:border-indigo-300">
              <Upload className="h-4 w-4 shrink-0" />
              {sourceFile?.name || "Upload JPG/PNG/JFIF/HEIC (<5MB)"}
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.jfif,.heic"
                className="hidden"
                onChange={(e) => setSourceFile(e.target.files?.[0] ?? null)}
                data-testid="undresser-source"
              />
            </label>
          </div>

          {result ? (
            <div
              className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              data-testid="undresser-result"
            >
              {result}
            </div>
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No results yet — upload a source image and hit Generate.
            </p>
          )}
        </div>

        {/* Settings rail */}
        <div className="space-y-3">
          <ModelPicker
            value={modelId}
            onChange={setModelId}
            models={models}
            providers={providers}
            loading={capabilitiesLoading}
          />
          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">Number of images</span>
            <Input
              type="number"
              min={1}
              max={8}
              value={count}
              onChange={(e) => setCount(Math.min(Math.max(Number(e.target.value), 1), 8))}
              data-testid="undresser-count"
            />
          </label>
        </div>
      </div>

      {!backendConfigured && (
        <p className="rounded-md border border-amber-300/60 bg-amber-50/60 p-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          Undresser generation is not configured for this persona yet. Upload and model controls are available for preparation, but generation remains disabled until an approved provider model is assigned.
        </p>
      )}

      {/* Sticky generate bar (safe-area aware) — matches the Generate tab. */}
      <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-border bg-card/95 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <Button
          onClick={() => genMut.mutate()}
          disabled={
            genMut.isPending ||
            !sourceFile ||
            !backendConfigured ||
            !capabilitiesReady ||
            !selectedModel.enabled
          }
          title={
            !backendConfigured
              ? "Undresser generation is not configured for this persona."
              : !capabilitiesReady
                ? "Generation capabilities are still loading or unavailable."
              : (selectedModel.disabledReason ?? undefined)
          }
          data-testid="undresser-generate"
        >
          {genMut.isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Shirt className="mr-1.5 h-3.5 w-3.5" />
          )}
          Generate {count}
        </Button>
      </div>
      {genMut.isError && (
        <p className="text-xs text-red-600">
          {(genMut.error as Error)?.message ?? "Failed to start generation."}
        </p>
      )}
    </div>
  );
}
