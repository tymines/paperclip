import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  imageStudioApi,
  uploadUrl,
  type ImageProvider,
  type LoraTrainingJob,
  type PersonaGeneration,
  type GenerationSource,
  type PromptTemplate,
  type GenerationJob,
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  Trash2,
  ArrowDownUp,
  Wand2,
  Zap,
  Send,
  Save,
  X,
  Tag,
  BookMarked,
  Camera,
} from "lucide-react";
import { GeneratePanel } from "@/components/image-studio/GeneratePanel";
import { PhotoShootModal } from "@/components/image-studio/PhotoShootModal";

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

// ─── Persona gallery ──────────────────────────────────────────────────────────

type GalleryFilter = "all" | "test" | "production";

function formatGenDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Full-size viewer for a single generation, with prune + reference actions. */
function GenerationModal({
  generation,
  onOpenChange,
  onDelete,
  deleting,
}: {
  generation: PersonaGeneration | null;
  onOpenChange: (open: boolean) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}) {
  const g = generation;
  return (
    <Dialog open={!!g} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {g && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="h-4 w-4 text-indigo-500" />
                Generation
                <Badge variant="secondary" className="ml-1 capitalize">
                  {g.source}
                </Badge>
                {g.contentRating === "explicit" && (
                  <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                    NSFW
                  </Badge>
                )}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              <div className="overflow-hidden rounded-lg border border-border bg-muted">
                <img
                  src={uploadUrl(g.imagePath)}
                  alt={g.prompt ?? "generation"}
                  className="mx-auto max-h-[55vh] w-auto object-contain"
                />
              </div>

              {g.prompt && (
                <p className="rounded-md bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">
                  {g.prompt}
                </p>
              )}

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Model</p>
                  <p className="font-medium">{g.model ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">LoRA strength</p>
                  <p className="font-medium">{g.loraStrength ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Generated</p>
                  <p className="font-medium">{formatGenDate(g.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cost</p>
                  <p className="font-medium">
                    {g.costUsd ? `$${parseFloat(g.costUsd).toFixed(2)}` : "—"}
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDelete(g.id)}
                disabled={deleting}
                className="text-red-600 hover:text-red-700"
              >
                {deleting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Delete
              </Button>
              {/* Stub — wiring lands with the inference path. */}
              <Button variant="secondary" size="sm" disabled title="Coming soon">
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                Use as reference
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A persona's gallery: filter chips, sort toggle, 3-col thumbnail grid. */
function PersonaGallery({ persona }: { persona: ImageProvider }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [newestFirst, setNewestFirst] = useState(true);
  const [selected, setSelected] = useState<PersonaGeneration | null>(null);

  const genQ = useQuery({
    queryKey: ["image-studio", "generations", persona.id],
    queryFn: () => imageStudioApi.listGenerations(persona.id, { limit: 60 }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => imageStudioApi.deleteGeneration(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["image-studio", "generations", persona.id],
      });
      setSelected(null);
    },
  });

  const generations = genQ.data?.generations ?? [];

  const visible = useMemo(() => {
    const rows =
      filter === "all" ? generations : generations.filter((g) => g.source === filter);
    const sorted = [...rows].sort((a, b) => {
      const delta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return newestFirst ? delta : -delta;
    });
    return sorted;
  }, [generations, filter, newestFirst]);

  const chip = (value: GalleryFilter, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setFilter(value)}
      className={
        "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors " +
        (filter === value
          ? "bg-indigo-100 text-indigo-700"
          : "bg-muted text-muted-foreground hover:bg-muted/70")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Gallery</span>
          <div className="ml-1 flex items-center gap-1">
            {chip("all", "All")}
            {chip("test", "Test")}
            {chip("production", "Production")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setNewestFirst((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          title="Toggle sort order"
        >
          <ArrowDownUp className="h-3 w-3" />
          {newestFirst ? "Newest first" : "Oldest first"}
        </button>
      </div>

      {genQ.isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading gallery…
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border py-6 text-center">
          <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">
            No generations yet — hit 'Train' or 'Generate' to populate
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {visible.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setSelected(g)}
              className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted focus:outline-none focus:ring-2 focus:ring-indigo-400"
              title={g.prompt ?? undefined}
            >
              <img
                src={uploadUrl(g.thumbnailPath ?? g.imagePath)}
                alt={g.prompt ?? "generation"}
                loading="lazy"
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
              {g.source === "production" && (
                <span className="absolute right-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium text-white">
                  prod
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <GenerationModal
        generation={selected}
        onOpenChange={(o) => !o && setSelected(null)}
        onDelete={(id) => deleteMut.mutate(id)}
        deleting={deleteMut.isPending}
      />
    </div>
  );
}

// (Legacy single-textarea composer removed — replaced by GeneratePanel / PhotoShootModal.)

/** Live batch status row shown under a persona card while a batch is firing. */
function BatchProgressRow({
  persona,
  batchId,
  onClear,
}: {
  persona: ImageProvider;
  batchId: string;
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const lastSucceeded = useRef(-1);

  const batchQ = useQuery({
    queryKey: ["image-studio", "batch", persona.id, batchId],
    queryFn: () => imageStudioApi.getBatch(persona.id, batchId),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs ?? [];
      const active = jobs.some((j) => j.status !== "succeeded" && j.status !== "failed");
      return active || jobs.length === 0 ? 5_000 : false;
    },
  });

  const jobs: GenerationJob[] = batchQ.data?.jobs ?? [];
  const total = jobs.length;
  const succeeded = jobs.filter((j) => j.status === "succeeded").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const inFlight = total - succeeded - failed;
  const done = total > 0 && inFlight === 0;

  // Stream finished images into the gallery as soon as they land.
  useEffect(() => {
    if (succeeded !== lastSucceeded.current) {
      lastSucceeded.current = succeeded;
      queryClient.invalidateQueries({ queryKey: ["image-studio", "generations", persona.id] });
    }
  }, [succeeded, persona.id, queryClient]);

  return (
    <div
      className="mt-3 flex items-center justify-between gap-2 rounded-md border border-indigo-200 bg-indigo-50/60 px-3 py-2"
      data-testid="batch-progress-row"
    >
      <div className="flex items-center gap-2 text-xs">
        {done ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
        )}
        <span className="font-medium text-indigo-900">
          {done ? "Generated" : "Generating"} {succeeded}/{total || "…"}
        </span>
        <span className="text-indigo-700/80">
          — {succeeded} succeeded{failed > 0 ? `, ${failed} failed` : ""}
          {inFlight > 0 ? `, ${inFlight} in flight` : ""}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-indigo-700 hover:text-indigo-900"
        onClick={onClear}
      >
        {done ? "Dismiss" : "Cancel"}
      </Button>
    </div>
  );
}

/** A single Trained Persona card: status, Generate/Train actions, batch row, gallery. */
function PersonaCard({
  persona,
  job,
  canTrain,
  onTrain,
}: {
  persona: ImageProvider;
  job: LoraTrainingJob | undefined;
  canTrain: boolean;
  onTrain: () => void;
}) {
  const [showComposer, setShowComposer] = useState(false);
  const [showPhotoShoot, setShowPhotoShoot] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const pill = trainingPill(job);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {providerIcon("local_lora", persona.name)}
            <CardTitle className="text-sm">{persona.name}</CardTitle>
          </div>
          {pill ?? statusBadge(persona)}
        </div>
        {persona.model && <CardDescription className="text-xs">{persona.model}</CardDescription>}
      </CardHeader>
      <CardContent className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Server className="h-3 w-3" />
              ComfyUI :18801
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setShowComposer(true)} data-testid="generate-open">
              <Zap className="mr-1.5 h-3.5 w-3.5" />
              Generate
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPhotoShoot(true)}
              data-testid="photoshoot-open"
            >
              <Camera className="mr-1.5 h-3.5 w-3.5" />
              PhotoShoot
            </Button>
            <Button size="sm" variant="outline" onClick={onTrain} disabled={!canTrain}>
              <Cloud className="mr-1.5 h-3.5 w-3.5" />
              Train
            </Button>
          </div>
        </div>
        {job?.status === "failed" && job.errorMessage && (
          <p className="mt-2 text-xs text-red-600">{job.errorMessage}</p>
        )}
        {job?.status === "ready" && job.outputLoraPath && (
          <p className="mt-2 truncate text-xs text-green-700" title={job.outputLoraPath}>
            Installed: {job.outputLoraPath}
          </p>
        )}
        {!job && persona.statusDetail && persona.status !== "ready" && persona.status !== "training" && (
          <p className="mt-2 text-xs text-amber-600">{persona.statusDetail}</p>
        )}

        {activeBatchId && (
          <BatchProgressRow
            persona={persona}
            batchId={activeBatchId}
            onClear={() => setActiveBatchId(null)}
          />
        )}

        <PersonaGallery persona={persona} />
      </CardContent>

      {showComposer && (
        <GeneratePanel
          persona={persona}
          open={showComposer}
          onOpenChange={setShowComposer}
          onBatchStarted={(batchId) => setActiveBatchId(batchId)}
        />
      )}

      {showPhotoShoot && (
        <PhotoShootModal
          persona={persona}
          open={showPhotoShoot}
          onOpenChange={setShowPhotoShoot}
          onBatchStarted={(batchId) => setActiveBatchId(batchId)}
        />
      )}
    </Card>
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
          {personas.map((p) => (
            <PersonaCard
              key={p.id}
              persona={p}
              job={jobsByPersona.get(p.id)}
              canTrain={trainers.length > 0}
              onTrain={() => setTrainingPersona(p)}
            />
          ))}
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
