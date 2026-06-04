/**
 * Standalone PhotoShoot tool page (/image-studio/tools/photoshoot) — a secondary
 * entry point alongside the persona-card workbench. Mirrors ZenCreator's tool
 * layout: a Persona dropdown + category picker, with Tasks / Gallery / Library
 * tabs. The persona-card PhotoShoot still works in parallel.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Loader2, ImageIcon } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import {
  imageStudioApi,
  uploadUrl,
  type ImageProvider,
} from "@/api/imageStudio";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PhotoShootCategoryGrid } from "@/components/image-studio/PhotoShootCategoryGrid";
import { TemplateLibraryTab } from "@/components/image-studio/TemplateLibraryTab";
import { ExplicitToggle, GenderFilter, personaRating } from "@/components/image-studio/PersonaWorkbench";

function ToolGallery({ persona }: { persona: ImageProvider }) {
  const genQ = useQuery({
    queryKey: ["image-studio", "generations", persona.id],
    queryFn: () => imageStudioApi.listGenerations(persona.id, { limit: 60 }),
  });
  const gens = genQ.data?.generations ?? [];
  if (genQ.isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (gens.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border py-10 text-center">
        <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">No generations yet for {persona.name}.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
      {gens.map((g) => (
        <div key={g.id} className="aspect-square overflow-hidden rounded-md border border-border bg-muted">
          <img src={uploadUrl(g.thumbnailPath ?? g.imagePath)} alt={g.prompt ?? ""} loading="lazy" className="h-full w-full object-cover" />
        </div>
      ))}
    </div>
  );
}

export function PhotoShootTool() {
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

  const [personaId, setPersonaId] = useState<string>("");
  const persona = personas.find((p) => p.id === personaId) ?? personas[0];
  const [gender, setGender] = useState<"female" | "male">("female");
  const [showExplicit, setShowExplicit] = useState(false);
  const [aspect, setAspect] = useState("3:4");
  const [activeBatch, setActiveBatch] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center gap-2">
        <Camera className="h-6 w-6 text-indigo-500" />
        <div>
          <h1 className="text-xl font-bold tracking-tight">PhotoShoot</h1>
          <p className="text-sm text-muted-foreground">
            Generate professional photos across multiple categories
          </p>
        </div>
      </div>

      {providersQ.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading personas…
        </div>
      ) : personas.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No trained personas yet.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          {/* Main: tabs */}
          <div className="order-2 lg:order-1">
            <Tabs defaultValue="create">
              <TabsList>
                <TabsTrigger value="create" data-testid="tool-tab-tasks">Tasks</TabsTrigger>
                <TabsTrigger value="gallery" data-testid="tool-tab-gallery">Gallery</TabsTrigger>
                <TabsTrigger value="library" data-testid="tool-tab-library">Library</TabsTrigger>
              </TabsList>
              <TabsContent value="create" className="mt-3">
                {persona && (
                  <PhotoShootCategoryGrid
                    persona={persona}
                    showExplicit={showExplicit}
                    gender={gender}
                    onBatchStarted={(b) => setActiveBatch(b)}
                  />
                )}
                {activeBatch && (
                  <p className="mt-2 text-[11px] text-emerald-600">Batch {activeBatch.slice(0, 8)}… queued — see Gallery.</p>
                )}
              </TabsContent>
              <TabsContent value="gallery" className="mt-3">
                {persona && <ToolGallery persona={persona} />}
              </TabsContent>
              <TabsContent value="library" className="mt-3">
                {persona && (
                  <TemplateLibraryTab
                    persona={persona}
                    showExplicit={showExplicit}
                    personas={personas}
                    currentTool="photoshoot"
                    onUseTemplate={(_t, apply) => {
                      if (apply?.personaId) setPersonaId(apply.personaId);
                    }}
                  />
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Right: settings panel */}
          <aside className="order-1 space-y-4 rounded-xl border border-border bg-card p-4 lg:order-2" data-testid="photoshoot-settings">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Persona</label>
              <Select value={persona?.id ?? ""} onValueChange={setPersonaId}>
                <SelectTrigger data-testid="persona-dropdown"><SelectValue placeholder="Pick a persona" /></SelectTrigger>
                <SelectContent>
                  {personas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gender</label>
              <div><GenderFilter value={gender} onChange={setGender} /></div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Content</label>
              <div><ExplicitToggle value={showExplicit} onChange={setShowExplicit} /></div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aspect Ratio</label>
              <Select value={aspect} onValueChange={setAspect}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["1:1", "3:4", "4:3", "16:9", "9:16"].map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Pick categories + per-category counts in the Tasks tab, then Generate. The persona's
              trained LoRA provides the face automatically.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
