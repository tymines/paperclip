/**
 * Female Undresser tool — UI SHELL ONLY. The generation backend is a peer
 * agent's lane; Generate currently hits a stub endpoint that returns
 * { status: "backend_pending" }. Swap for the real call once it ships.
 *
 * Paperclip v1 is single-operator (Tyler only), so there is no consent gate —
 * Tyler self-authorizes every action. A consumer-facing gate would belong in v2.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Shirt, Upload, Loader2 } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { imageStudioApi } from "@/api/imageStudio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function FemaleUndresserTool() {
  const { selectedCompanyId } = useCompany();
  const providersQ = useQuery({
    queryKey: ["image-studio", "providers", selectedCompanyId],
    queryFn: () => imageStudioApi.listProviders(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const personas = useMemo(
    () => (providersQ.data?.providers ?? []).filter((p) => p.type === "local_lora"),
    [providersQ.data],
  );

  const [fileName, setFileName] = useState<string>("");
  const [personaId, setPersonaId] = useState<string>("none");
  const [count, setCount] = useState(1);
  const [result, setResult] = useState<string | null>(null);

  const genMut = useMutation({
    mutationFn: () =>
      imageStudioApi.femaleUndresserGenerate({
        source_file: fileName || null,
        persona_id: personaId === "none" ? null : personaId,
        count,
      }),
    onSuccess: (res) => setResult(res.message ?? res.status),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center gap-2">
        <Shirt className="h-6 w-6 text-indigo-500" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">Female Undresser</h1>
          <p className="text-sm text-muted-foreground">
            Upload a photo to generate an alternate version. Backend wiring in progress.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="order-2 lg:order-1">
          <Tabs defaultValue="tasks">
            <TabsList>
              <TabsTrigger value="tasks" data-testid="fu-tab-tasks">Tasks</TabsTrigger>
              <TabsTrigger value="gallery" data-testid="fu-tab-gallery">Gallery</TabsTrigger>
              <TabsTrigger value="library" data-testid="fu-tab-library">Library</TabsTrigger>
            </TabsList>
            <TabsContent value="tasks" className="mt-3">
              {result ? (
                <div className="rounded-md border border-amber-300/60 bg-amber-50/60 p-3 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" data-testid="fu-result">
                  {result}
                </div>
              ) : (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  No tasks yet. Upload a source image and hit Generate.
                </p>
              )}
            </TabsContent>
            <TabsContent value="gallery" className="mt-3">
              <p className="py-8 text-center text-xs text-muted-foreground">No generations yet.</p>
            </TabsContent>
            <TabsContent value="library" className="mt-3">
              <p className="py-8 text-center text-xs text-muted-foreground" data-testid="fu-library-empty">
                No templates yet — author one or wait for community.
              </p>
            </TabsContent>
          </Tabs>
        </div>

        {/* Settings panel */}
        <aside className="order-1 space-y-4 rounded-xl border border-border bg-card p-4 lg:order-2" data-testid="undresser-settings">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source Image</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground hover:border-indigo-300">
              <Upload className="h-4 w-4" />
              {fileName || "Upload JPG/PNG/JFIF/HEIC (<5MB)"}
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.jfif,.heic"
                className="hidden"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
                data-testid="fu-source"
              />
            </label>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Persona (optional, face-consistent)
            </label>
            <Select value={personaId} onValueChange={setPersonaId}>
              <SelectTrigger data-testid="fu-persona"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {personas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Model</label>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              Model picker pending — populated once the generation backend lands.
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Number of images</label>
            <Input type="number" min={1} max={8} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
          <Button className="w-full" onClick={() => genMut.mutate()} disabled={genMut.isPending} data-testid="fu-generate">
            {genMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Generate
          </Button>
        </aside>
      </div>
    </div>
  );
}
