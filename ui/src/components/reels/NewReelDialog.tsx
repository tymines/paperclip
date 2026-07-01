import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/context/CompanyContext";
import { useNavigate } from "@/lib/router";
import {
  reelsApi,
  STYLE_PRESET_LABELS,
  type AspectRatio,
  type StylePreset,
} from "@/api/reels";
import { imageStudioApi } from "@/api/imageStudio";
import { Loader2, Sparkles } from "lucide-react";

export function NewReelDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const { selectedCompanyId } = useCompany();
  const navigate = useNavigate();

  const [personaId, setPersonaId] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState<StylePreset>("cinematic");
  const [durationSeconds, setDurationSeconds] = useState(15);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");

  const personasQuery = useQuery({
    queryKey: ["image-studio", "providers", selectedCompanyId],
    queryFn: () => imageStudioApi.listProviders(selectedCompanyId!),
    enabled: open && !!selectedCompanyId,
  });

  const personas = (personasQuery.data?.providers ?? []).filter(
    (p) => p.type === "local_lora" || p.type === "external_api",
  );

  const createMut = useMutation({
    mutationFn: () =>
      reelsApi.create(selectedCompanyId!, {
        personaId,
        prompt,
        stylePreset,
        durationSeconds,
        aspectRatio,
      }),
    onSuccess: (result) => {
      onCreated?.();
      onOpenChange(false);
      // Reset form
      setPrompt("");
      setPersonaId("");
      // Navigate to detail page so user can watch progress
      navigate(`/reels/${result.reelId}`);
    },
  });

  const estimatedCost = useMemo(() => {
    // Rough: ~$0.05/keyframe × ~6 + ~$0.10/video clip × ~6 + ~$0.50 music
    const numScenes = Math.max(4, Math.min(8, Math.round(durationSeconds / 3)));
    const keyframeCost = numScenes * 0.05;
    const videoCost = numScenes * 0.1;
    const musicCost = 0.5;
    return keyframeCost + videoCost + musicCost;
  }, [durationSeconds]);

  const canSubmit = personaId && prompt.trim().length > 0 && !createMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-500" />
            New reel
          </DialogTitle>
          <DialogDescription>
            One line. We'll break it into scenes, animate them, stitch into a 9:16 reel ready to post.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="reel-persona">Persona</Label>
            <Select value={personaId} onValueChange={setPersonaId}>
              <SelectTrigger id="reel-persona" data-testid="reel-form-persona">
                <SelectValue placeholder="Pick a persona" />
              </SelectTrigger>
              <SelectContent>
                {personas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="reel-prompt">Idea</Label>
            <Textarea
              id="reel-prompt"
              data-testid="reel-form-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Raven makes a futuristic glowing smoothie in her neon kitchen"
              rows={3}
              maxLength={500}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Hook should land in the first 1.5 seconds — algorithm rewards completion rate. Keep it specific.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="reel-style">Style</Label>
              <Select
                value={stylePreset}
                onValueChange={(v) => setStylePreset(v as StylePreset)}
              >
                <SelectTrigger id="reel-style">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STYLE_PRESET_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="reel-duration">Duration</Label>
              <Select
                value={String(durationSeconds)}
                onValueChange={(v) => setDurationSeconds(parseInt(v, 10))}
              >
                <SelectTrigger id="reel-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8">8s</SelectItem>
                  <SelectItem value="12">12s</SelectItem>
                  <SelectItem value="15">15s (recommended)</SelectItem>
                  <SelectItem value="20">20s</SelectItem>
                  <SelectItem value="30">30s</SelectItem>
                  <SelectItem value="45">45s</SelectItem>
                  <SelectItem value="60">60s</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="reel-aspect">Aspect</Label>
              <Select
                value={aspectRatio}
                onValueChange={(v) => setAspectRatio(v as AspectRatio)}
              >
                <SelectTrigger id="reel-aspect">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="9:16">9:16 (Reels)</SelectItem>
                  <SelectItem value="1:1">1:1 (square)</SelectItem>
                  <SelectItem value="16:9">16:9 (landscape)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
            Estimated cost: <span className="font-medium text-foreground">~${estimatedCost.toFixed(2)}</span> · ETA ~3-5 min
          </div>

          {createMut.error && (
            <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              {(createMut.error as Error).message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMut.mutate()}
            disabled={!canSubmit}
            data-testid="reel-form-submit"
          >
            {createMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Generate reel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

