import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  imageStudioApi,
  type ImageProvider,
  type LoraTrainingJob,
} from "../api/imageStudio";
import { useCompany } from "../context/CompanyContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Plus,
  Train,
  ImageIcon,
  Bot,
  Sparkles,
  Server,
  TriangleAlert,
  Cloud,
  CheckCircle2,
  XCircle,
} from "lucide-react";

// ─── Local helpers ──────────────────────────────────────────────────────────

function statusBadge(provider: ImageProvider) {
  const { status, statusDetail } = provider;
  if (!status) return null;

  if (status === "ready") {
    return (
      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
        ready
      </Badge>
    );
  }
  if (status === "training") {
    return (
      <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        {statusDetail ?? "training..."}
      </Badge>
    );
  }
  if (status === "needs_photos") {
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
        <TriangleAlert className="mr-1 h-3 w-3" />
        {statusDetail ?? "needs photos"}
      </Badge>
    );
  }

  return <Badge variant="secondary">{status}</Badge>;
}

/** Status pill derived from the persona's most recent training job. */
function trainingPill(job: LoraTrainingJob | undefined) {
  if (!job) return null;
  switch (job.status) {
    case "ready":
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          ready
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          <XCircle className="mr-1 h-3 w-3" />
          failed
        </Badge>
      );
    case "training":
      return (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          training {job.progress}%
        </Badge>
      );
    case "downloading":
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          installing
        </Badge>
      );
    default:
      // pending | uploading
      return (
        <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
          <Cloud className="mr-1 h-3 w-3" />
          queued
        </Badge>
      );
  }
}

function providerIcon(type: string, _name: string) {
  if (type === "local_lora") return <Train className="h-5 w-5 text-indigo-500" />;
  return <Sparkles className="h-5 w-5 text-blue-500" />;
}

// ─── Train modal ──────────────────────────────────────────────────────────────

function TrainPersonaModal({
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
            <p className="flex items-center gap-1.5 text-xs text-red-600">
              <TriangleAlert className="h-3.5 w-3.5" />
              Trigger <code className="font-mono">{photos?.triggerWord}</code> — output is tagged
              explicit and is hard-blocked from SFW surfaces (IG / TikTok).
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

// ─── Section A: Trained Personas ─────────────────────────────────────────────

function TrainedPersonasSection({
  providers,
  loading,
  companyId,
  jobsByPersona,
}: {
  providers: ImageProvider[];
  loading: boolean;
  companyId: string;
  jobsByPersona: Map<string, LoraTrainingJob>;
}) {
  const personas = useMemo(() => providers.filter((p) => p.type === "local_lora"), [providers]);
  const trainers = useMemo(
    () => providers.filter((p) => p.trainingCapable),
    [providers],
  );
  const [trainingPersona, setTrainingPersona] = useState<ImageProvider | null>(null);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading personas...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Trained Personas</h2>
          <p className="text-sm text-muted-foreground">Flux + LoRA models trained on specific subjects</p>
        </div>
        <Button variant="outline" size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          New Persona
        </Button>
      </div>

      {personas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Train className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No trained personas yet.</p>
            <p className="text-xs text-muted-foreground/60">
              Train a Flux + LoRA model to generate consistent characters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {personas.map((p) => {
            const job = jobsByPersona.get(p.id);
            const pill = trainingPill(job);
            return (
              <Card key={p.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {providerIcon("local_lora", p.name)}
                      <CardTitle className="text-sm">{p.name}</CardTitle>
                    </div>
                    {pill ?? statusBadge(p)}
                  </div>
                  {p.model && (
                    <CardDescription className="text-xs">{p.model}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Server className="h-3 w-3" />
                        ComfyUI :18801
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTrainingPersona(p)}
                      disabled={trainers.length === 0}
                    >
                      <Cloud className="mr-1.5 h-3.5 w-3.5" />
                      Train
                    </Button>
                  </div>
                  {job?.status === "failed" && job.errorMessage && (
                    <p className="mt-2 text-xs text-red-600">{job.errorMessage}</p>
                  )}
                  {job?.status === "ready" && job.outputLoraPath && (
                    <p className="mt-2 truncate text-xs text-green-700" title={job.outputLoraPath}>
                      Installed: {job.outputLoraPath}
                    </p>
                  )}
                  {!job && p.statusDetail && p.status !== "ready" && p.status !== "training" && (
                    <p className="mt-2 text-xs text-amber-600">{p.statusDetail}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {trainingPersona && (
        <TrainPersonaModal
          open={!!trainingPersona}
          onOpenChange={(o) => !o && setTrainingPersona(null)}
          companyId={companyId}
          persona={trainingPersona}
          trainers={trainers}
        />
      )}
    </div>
  );
}

// ─── Section B: General Image Gen ─────────────────────────────────────────────

const EXTERNAL_PROVIDER_LABELS: Record<string, string> = {
  "Nano Banana": "Gemini 2.5 Flash Image",
  "OpenAI": "gpt-image-2",
  "BFL Flux": "Replicate",
  "Recraft v3": "Recraft",
  "Ideogram v2": "Ideogram",
  "Replicate": "ostris/flux-dev-lora-trainer",
};

function externalProviderDescription(name: string): string {
  return EXTERNAL_PROVIDER_LABELS[name] ?? name;
}

function GeneralImageGenSection({ providers, loading }: { providers: ImageProvider[]; loading: boolean }) {
  const external = useMemo(() => providers.filter((p) => p.type === "external_api"), [providers]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading providers...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">General Image Gen</h2>
          <p className="text-sm text-muted-foreground">External API providers for image generation</p>
        </div>
        <Button variant="outline" size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Provider
        </Button>
      </div>

      {external.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No external providers configured.</p>
            <p className="text-xs text-muted-foreground/60">
              Add API providers like OpenAI, Replicate, or Gemini.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {external.map((p) => {
            const label = externalProviderDescription(p.name);
            const costLabel =
              p.costPerUnit && p.costPerUnit !== "0"
                ? p.trainingCapable
                  ? `$${parseFloat(p.costPerUnit).toFixed(2)}/run`
                  : `$${parseFloat(p.costPerUnit).toFixed(4)}/img`
                : null;

            return (
              <Card key={p.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {providerIcon("external_api", p.name)}
                      <div>
                        <CardTitle className="text-sm">{p.name}</CardTitle>
                        <CardDescription className="text-xs">{label}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.trainingCapable && (
                        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                          trainer
                        </Badge>
                      )}
                      {costLabel && (
                        <span className="text-xs text-muted-foreground">{costLabel}</span>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Bot className="h-3 w-3" />
                      {p.model ?? label}
                    </span>
                    {p.endpoint && (
                      <span className="truncate max-w-[160px]" title={p.endpoint}>
                        {p.endpoint}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ImageStudio() {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? null;

  const providersQ = useQuery({
    queryKey: ["image-studio", "providers", companyId],
    queryFn: () => imageStudioApi.listProviders(companyId!),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const jobsQ = useQuery({
    queryKey: ["image-studio", "training", companyId],
    queryFn: () => imageStudioApi.listTrainingJobs(companyId!),
    enabled: !!companyId,
    // Poll while any job is mid-flight so the status pill stays live.
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const active = jobs.some(
        (j) => j.status !== "ready" && j.status !== "failed",
      );
      return active ? 8_000 : false;
    },
  });

  const providers = providersQ.data?.providers ?? [];
  const loading = providersQ.isLoading;

  // Latest job per persona (jobs come back newest-first).
  const jobsByPersona = useMemo(() => {
    const map = new Map<string, LoraTrainingJob>();
    for (const job of jobsQ.data?.jobs ?? []) {
      if (!map.has(job.personaId)) map.set(job.personaId, job);
    }
    return map;
  }, [jobsQ.data]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Image Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate images with local LoRA personas or external API providers
        </p>
      </div>

      <div className="space-y-10">
        {/* Horizontal divider with label */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-border" />
          </div>
        </div>

        <TrainedPersonasSection
          providers={providers}
          loading={loading}
          companyId={companyId ?? ""}
          jobsByPersona={jobsByPersona}
        />

        <div className="relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-border" />
          </div>
        </div>

        <GeneralImageGenSection providers={providers} loading={loading} />
      </div>

      {/* Quiet status bar */}
      <div className="mt-10 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground/60">
          Generation runs locally on ComfyUI :18801 · Cloud training via Replicate (~$3/run) · Selected provider costs apply for external APIs
        </p>
      </div>
    </div>
  );
}
