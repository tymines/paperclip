/**
 * TrainPersonaModal — fire a Replicate Flux+LoRA training run for a persona.
 * Shared by the Image Studio persona cards and the Personas detail page (kept in
 * its own module so neither page imports the other — preserves Fast Refresh).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, TriangleAlert, Loader2 } from "lucide-react";
import { imageStudioApi, type ImageProvider } from "@/api/imageStudio";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function TrainPersonaModal({
  open,
  onOpenChange,
  companyId,
  persona,
  trainers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  persona: ImageProvider;
  trainers: ImageProvider[];
}) {
  const queryClient = useQueryClient();
  const defaultTrainer = trainers.find((t) => t.providerKey === "replicate") ?? trainers[0];
  const [providerId, setProviderId] = useState(defaultTrainer?.id ?? "");

  const photosQ = useQuery({
    queryKey: ["image-studio", "persona-photos", companyId, persona.id],
    queryFn: () => imageStudioApi.getPersonaPhotos(companyId, persona.id),
    enabled: open,
  });

  const trainMut = useMutation({
    mutationFn: () => imageStudioApi.trainPersona(companyId, persona.id, { provider_id: providerId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-studio", "training", companyId] });
      queryClient.invalidateQueries({ queryKey: ["image-studio", "providers"] });
      onOpenChange(false);
    },
  });

  const photos = photosQ.data;
  const isNsfw = photos?.contentRating === "explicit";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-indigo-500" />
            Train {persona.name}
          </DialogTitle>
          <DialogDescription>
            Train a Flux + LoRA model on Replicate's hosted H100s.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Provider dropdown */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Training provider</label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {trainers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} {t.trainingModel ? `· ${t.trainingModel}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-border p-3 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Photos</p>
              <p className="text-sm font-semibold">
                {photosQ.isLoading ? "…" : photos?.count ?? 0}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Est. cost</p>
              <p className="text-sm font-semibold">$3</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Est. time</p>
              <p className="text-sm font-semibold">~30 min</p>
            </div>
          </div>

          {photos && !photos.exists && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600">
              <TriangleAlert className="h-3.5 w-3.5" />
              Photos directory not found: <code className="font-mono">{photos.dir}</code>
            </p>
          )}
          {isNsfw && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600">
              <TriangleAlert className="h-3.5 w-3.5" />
              Trigger <code className="font-mono">{photos?.triggerWord}</code> — output is tagged
              NSFW. This is a label only; you choose where it posts.
            </p>
          )}
          {trainMut.isError && (
            <p className="text-xs text-red-600">
              {(trainMut.error as Error)?.message ?? "Failed to start training."}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => trainMut.mutate()} disabled={!providerId || trainMut.isPending}>
            {trainMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Start training
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
