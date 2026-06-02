import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { imageStudioApi, type ImageProvider } from "../api/imageStudio";
import { useCompany } from "../context/CompanyContext";
import { cn } from "@/lib/utils";
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
  Loader2,
  Plus,
  Train,
  ImageIcon,
  Bot,
  Sparkles,
  Server,
  TriangleAlert,
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

function providerIcon(type: string, name: string) {
  if (type === "local_lora") return <Train className="h-5 w-5 text-indigo-500" />;
  return <Sparkles className="h-5 w-5 text-blue-500" />;
}

// ─── Section A: Trained Personas ─────────────────────────────────────────────

function TrainedPersonasSection({ providers, loading }: { providers: ImageProvider[]; loading: boolean }) {
  const personas = useMemo(() => providers.filter((p) => p.type === "local_lora"), [providers]);

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
            <Card key={p.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {providerIcon("local_lora", p.name)}
                    <CardTitle className="text-sm">{p.name}</CardTitle>
                  </div>
                  {statusBadge(p)}
                </div>
                {p.model && (
                  <CardDescription className="text-xs">{p.model}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="pb-4">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Server className="h-3 w-3" />
                    ComfyUI :18801
                  </span>
                  <span>~$0 (local)</span>
                </div>
                {p.statusDetail && p.status !== "ready" && p.status !== "training" && (
                  <p className="mt-2 text-xs text-amber-600">{p.statusDetail}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
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
                ? `$${parseFloat(p.costPerUnit).toFixed(4)}/img`
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
                    {costLabel && (
                      <span className="text-xs text-muted-foreground">{costLabel}</span>
                    )}
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

  const providers = providersQ.data?.providers ?? [];
  const loading = providersQ.isLoading;

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

        <TrainedPersonasSection providers={providers} loading={loading} />

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
          Generation runs locally on ComfyUI :18801 · Selected provider costs apply for external APIs
        </p>
      </div>
    </div>
  );
}
