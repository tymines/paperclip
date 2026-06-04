/**
 * NewPersonaWizard — 3-step "create a trained character" flow.
 *
 *   1. Identity        name + bio + structured attributes (Face-Generator style).
 *                      Completing this CREATES the persona (status='untrained')
 *                      so it is resumable and already visible in the list.
 *   2. Training photos batch upload (drag-drop). First photo becomes the cover.
 *                      Skippable — "train later" leaves it untrained in the list.
 *   3. Generate & train confirms cost, fires the Replicate LoRA training job.
 *
 * Persona creation + the structured form are fully wired. Training photos upload
 * to the asset store; feeding them to the Replicate trainer (which today zips a
 * server-side dir) is the same backend lane as the rest of the training pipeline.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, Wand2, Camera, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/context/CompanyContext";
import { useNavigate } from "@/lib/router";
import { applyCompanyPrefix } from "@/lib/company-routes";
import { imageStudioApi } from "@/api/imageStudio";
import { assetsApi } from "@/api/assets";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// The attribute-controls catalog only covers appearance dimensions
// (body_type, hairstyle, …). The classic Face-Generator descriptors below have
// no controlled vocabulary, so we collect them as free text / simple selects and
// store them straight into attributes for the prompt assembler + Generate panel.
const FREEFORM_IDENTITY: { key: string; label: string; options?: string[]; placeholder?: string }[] = [
  { key: "gender", label: "Gender", options: ["female", "male", "non-binary"] },
  { key: "age", label: "Age", placeholder: "e.g. 24" },
  { key: "ethnicity", label: "Ethnicity", placeholder: "e.g. Brazilian" },
  { key: "hair_color", label: "Hair color", placeholder: "e.g. honey blonde" },
  { key: "eye_color", label: "Eye color", placeholder: "e.g. green" },
];
// Catalog-backed appearance controls to surface as selects in the wizard.
const APPEARANCE_CATEGORIES = ["body", "face"];

type Step = 1 | 2 | 3;

const STEP_META: Record<Step, { title: string; icon: typeof Wand2 }> = {
  1: { title: "Identity", icon: Wand2 },
  2: { title: "Training photos", icon: Camera },
  3: { title: "Generate & train", icon: Cloud },
};

export function NewPersonaWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const prefix = selectedCompany?.issuePrefix ?? null;

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const controlsQ = useQuery({
    queryKey: ["image-studio", "attribute-controls"],
    queryFn: () => imageStudioApi.getAttributeControls(),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const appearanceControls = useMemo(
    () =>
      (controlsQ.data?.controls ?? [])
        .filter((c) => APPEARANCE_CATEGORIES.includes(c.category))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [controlsQ.data],
  );

  const providersQ = useQuery({
    queryKey: ["image-studio", "providers", selectedCompanyId],
    queryFn: () => imageStudioApi.listProviders(selectedCompanyId!),
    enabled: open && !!selectedCompanyId,
  });
  const trainer = (providersQ.data?.providers ?? []).find((p) => p.trainingCapable);

  function reset() {
    setStep(1);
    setName("");
    setBio("");
    setAttrs({});
    setPersonaId(null);
    setPhotos([]);
    setError(null);
  }

  function close() {
    onOpenChange(false);
    // Defer reset so the closing animation doesn't flash an empty step 1.
    setTimeout(reset, 200);
  }

  // Step 1 → 2: persist the persona so it's resumable + visible in the list.
  const createMut = useMutation({
    mutationFn: () =>
      imageStudioApi.createPersona(selectedCompanyId!, {
        name: name.trim(),
        bio: bio.trim() || null,
        attributes: attrs,
      }),
    onSuccess: (res) => {
      setPersonaId(res.provider.id);
      queryClient.invalidateQueries({ queryKey: ["image-studio", "providers"] });
      setStep(2);
    },
    onError: (e) => setError((e as Error)?.message ?? "Failed to create persona."),
  });

  const uploadMut = useMutation({
    mutationFn: async (files: File[]) => {
      const out: { name: string; url: string }[] = [];
      for (const f of files) {
        const asset = await assetsApi.uploadImage(selectedCompanyId!, f, `personas/${personaId}/training`);
        out.push({ name: f.name, url: asset.contentPath });
      }
      return out;
    },
    onSuccess: async (uploaded) => {
      const next = [...photos, ...uploaded];
      setPhotos(next);
      // First photo becomes the cover image.
      if (personaId && uploaded.length > 0 && photos.length === 0) {
        await imageStudioApi.updatePersona(personaId, { avatar_path: uploaded[0]!.url });
        queryClient.invalidateQueries({ queryKey: ["image-studio", "providers"] });
      }
    },
    onError: (e) => setError((e as Error)?.message ?? "Upload failed."),
  });

  const trainMut = useMutation({
    mutationFn: () => {
      if (!trainer) throw new Error("No training-capable provider configured.");
      return imageStudioApi.trainPersona(selectedCompanyId!, personaId!, { provider_id: trainer.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-studio", "providers"] });
      queryClient.invalidateQueries({ queryKey: ["image-studio", "training"] });
      const id = personaId;
      close();
      if (id) navigate(applyCompanyPrefix(`/personas/${id}`, prefix));
    },
    onError: (e) => setError((e as Error)?.message ?? "Failed to start training."),
  });

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) uploadMut.mutate(files);
    e.target.value = "";
  }

  const StepIcon = STEP_META[step].icon;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StepIcon className="h-4 w-4 text-indigo-500" />
            New Persona — {STEP_META[step].title}
          </DialogTitle>
          <DialogDescription>Step {step} of 3</DialogDescription>
        </DialogHeader>

        {/* Step progress dots */}
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                s <= step ? "bg-indigo-500" : "bg-muted",
              )}
            />
          ))}
        </div>

        {error && (
          <div className="rounded-md border border-red-300/60 bg-red-50/60 p-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="max-h-[55vh] space-y-4 overflow-y-auto py-1">
          {/* ── Step 1: Identity ── */}
          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="np-name">Name</Label>
                <Input
                  id="np-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Nova Sterling"
                  data-testid="np-name"
                />
                {name.trim() && (
                  <p className="text-[11px] text-muted-foreground">
                    Trigger word:{" "}
                    <span className="font-mono">
                      {name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}
                    </span>
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="np-bio">Bio</Label>
                <Textarea
                  id="np-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={3}
                  placeholder="A 24-year-old fashion model based in Lisbon, warm and playful…"
                  data-testid="np-bio"
                />
                <p className="text-[11px] text-muted-foreground">
                  Injected as prompt context by the assembler on every generation.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {/* Free-form identity descriptors (no catalog vocabulary). */}
                {FREEFORM_IDENTITY.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs">{f.label}</Label>
                    {f.options ? (
                      <Select
                        value={attrs[f.key] ?? ""}
                        onValueChange={(v) => setAttrs((prev) => ({ ...prev, [f.key]: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs" data-testid={`np-attr-${f.key}`}>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {f.options.map((o) => (
                            <SelectItem key={o} value={o} className="capitalize">
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={attrs[f.key] ?? ""}
                        onChange={(e) => setAttrs((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="h-8 text-xs"
                        data-testid={`np-attr-${f.key}`}
                      />
                    )}
                  </div>
                ))}
                {/* Catalog-backed appearance selects (body_type, hairstyle, …). */}
                {appearanceControls.map((c) => (
                  <div key={c.id} className="space-y-1">
                    <Label className="text-xs">{c.label}</Label>
                    <Select
                      value={attrs[c.key] ?? ""}
                      onValueChange={(v) => setAttrs((prev) => ({ ...prev, [c.key]: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs" data-testid={`np-attr-${c.key}`}>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {c.options
                          .filter((o) => o.contentRating !== "explicit")
                          .map((o) => (
                            <SelectItem key={o.id} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Step 2: Training photos ── */}
          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                data-testid="np-upload"
                className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border py-8 text-sm text-muted-foreground transition-colors hover:border-indigo-300"
              >
                {uploadMut.isPending ? (
                  <Loader2 className="h-6 w-6 animate-spin" />
                ) : (
                  <Upload className="h-6 w-6" />
                )}
                Upload 30–50 photos (drag-drop or click)
                <span className="text-[11px]">JPG/PNG · clear, varied face shots</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp"
                multiple
                className="hidden"
                onChange={onPickFiles}
              />
              {photos.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground" data-testid="np-photo-count">
                    {photos.length} photo{photos.length === 1 ? "" : "s"} uploaded
                  </p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {photos.slice(0, 15).map((p, i) => (
                      <img
                        key={i}
                        src={p.url}
                        alt={p.name}
                        className="aspect-square w-full rounded-md object-cover"
                      />
                    ))}
                  </div>
                </>
              )}
              <p className="text-[11px] text-muted-foreground">
                No photos yet? You can skip and train later — the persona stays in your list with a
                “Start training” action.
              </p>
            </>
          )}

          {/* ── Step 3: Generate & train ── */}
          {step === 3 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Persona</span>
                  <span className="font-medium">{name}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Training photos</span>
                  <span className="font-medium">{photos.length}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Est. cost · time</span>
                  <span className="font-medium">$1.58 · ~17 min</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Trainer</span>
                  <span className="font-medium">{trainer?.name ?? "none configured"}</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Training runs on Replicate (Flux LoRA). The persona flips to <b>ready</b> and its
                trigger word locks when it completes — you can close this and watch progress from the
                list.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => (step === 1 ? close() : setStep((s) => (s - 1) as Step))}>
            {step === 1 ? "Cancel" : "Back"}
          </Button>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <Button variant="outline" onClick={() => setStep(3)} data-testid="np-skip">
                Skip — train later
              </Button>
            )}
            {step === 1 && (
              <Button
                onClick={() => {
                  setError(null);
                  if (!name.trim()) {
                    setError("Name is required.");
                    return;
                  }
                  personaId ? setStep(2) : createMut.mutate();
                }}
                disabled={createMut.isPending}
                data-testid="np-next"
              >
                {createMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Next
              </Button>
            )}
            {step === 2 && (
              <Button onClick={() => setStep(3)} data-testid="np-continue">
                Continue
              </Button>
            )}
            {step === 3 && (
              <Button
                onClick={() => trainMut.mutate()}
                disabled={trainMut.isPending || !trainer}
                data-testid="np-train"
              >
                {trainMut.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Cloud className="mr-1.5 h-4 w-4" />
                )}
                Start training
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
