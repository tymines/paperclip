/**
 * PersonaDetail — full edit surface for one trained character. Three tabs:
 *   • General Information — name, trigger word (locked once trained), bio,
 *     structured attributes, group folder.
 *   • Posts / Scheduled   — placeholder; wires to the social scheduler later.
 *   • Gallery             — the persona's generated images (persona_generations).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Cloud, Wand2, Camera, Save } from "lucide-react";
import { useParams, useNavigate } from "@/lib/router";
import { applyCompanyPrefix } from "@/lib/company-routes";
import { useCompany } from "@/context/CompanyContext";
import { imageStudioApi, uploadUrl, type Selections, type ImageProvider } from "@/api/imageStudio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DetailBackButton } from "@/components/DetailBackButton";
import { StructuredControlPanel } from "@/components/image-studio/StructuredControlPanel";
import { TrainPersonaModal } from "@/components/image-studio/TrainPersonaModal";
import {
  PersonaAvatar,
  PersonaStatusBadge,
  personaTriggerWord,
  imageStudioToolPath,
  isPersonaTrained,
  type PersonaQuickTool,
} from "@/components/personas/shared";

type Tab = "general" | "posts" | "gallery";
const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "General Information" },
  { key: "posts", label: "Posts / Scheduled" },
  { key: "gallery", label: "Gallery" },
];

const EDITABLE_ATTR_CATEGORIES = ["identity", "body", "face"];

export function PersonaDetail() {
  const { personaId } = useParams<{ personaId: string }>();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const prefix = selectedCompany?.issuePrefix ?? null;

  const [tab, setTab] = useState<Tab>("general");
  const [trainOpen, setTrainOpen] = useState(false);

  const personaQ = useQuery({
    queryKey: ["image-studio", "persona", personaId],
    queryFn: () => imageStudioApi.getPersona(personaId!),
    enabled: !!personaId,
  });
  const persona = personaQ.data?.provider;

  const providersQ = useQuery({
    queryKey: ["image-studio", "providers", selectedCompanyId],
    queryFn: () => imageStudioApi.listProviders(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const trainers = (providersQ.data?.providers ?? []).filter((p) => p.trainingCapable);

  if (personaQ.isLoading) {
    return <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-muted-foreground">Loading persona…</div>;
  }
  if (!persona) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <DetailBackButton fallbackTo="/personas" />
        <p className="mt-4 text-sm text-muted-foreground">Persona not found.</p>
      </div>
    );
  }

  const trained = isPersonaTrained(persona);
  const tools: { tab: PersonaQuickTool; icon: typeof Wand2; label: string }[] = [
    { tab: "generate", icon: Wand2, label: "Generate" },
    { tab: "photoshoot", icon: Camera, label: "PhotoShoot" },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <DetailBackButton fallbackTo="/personas" />

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <PersonaAvatar persona={persona} className="h-14 w-14" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">{persona.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <PersonaStatusBadge persona={persona} />
              <Badge variant="secondary" className="font-mono text-[10px]">
                {personaTriggerWord(persona)}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trained &&
            tools.map((t) => (
              <Button
                key={t.tab}
                variant="outline"
                size="sm"
                onClick={() => navigate(applyCompanyPrefix(imageStudioToolPath(persona.id, t.tab), prefix))}
                data-testid={`detail-quick-${t.tab}`}
              >
                <t.icon className="mr-1.5 h-3.5 w-3.5" /> {t.label}
              </Button>
            ))}
          <Button size="sm" onClick={() => setTrainOpen(true)} data-testid="detail-train">
            <Cloud className="mr-1.5 h-3.5 w-3.5" /> {trained ? "Train new version" : "Start training"}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-5 inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            data-testid={`persona-tab-${t.key}`}
            className={
              "rounded-md px-3 py-1 font-medium transition-colors " +
              (tab === t.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "general" && <GeneralTab key={persona.id} persona={persona} trained={trained} />}
        {tab === "posts" && (
          <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            Scheduled posts for this persona will live here — wires into the Social scheduler.
          </div>
        )}
        {tab === "gallery" && <GalleryTab personaId={persona.id} />}
      </div>

      {selectedCompanyId && (
        <TrainPersonaModal
          open={trainOpen}
          onOpenChange={setTrainOpen}
          companyId={selectedCompanyId}
          persona={persona}
          trainers={trainers}
        />
      )}
    </div>
  );
}

function GeneralTab({ persona, trained }: { persona: ImageProvider; trained: boolean }) {
  const queryClient = useQueryClient();
  const { selectedCompanyId } = useCompany();
  const [name, setName] = useState(persona.name);
  const [bio, setBio] = useState(persona.bio ?? "");
  const [groupId, setGroupId] = useState<string>(persona.groupId ?? "none");
  const [selections, setSelections] = useState<Selections>(() => {
    const out: Selections = {};
    const a = persona.attributes ?? {};
    for (const [k, v] of Object.entries(a)) if (typeof v === "string") out[k] = v;
    return out;
  });

  const controlsQ = useQuery({
    queryKey: ["image-studio", "attribute-controls"],
    queryFn: () => imageStudioApi.getAttributeControls(),
    staleTime: 5 * 60_000,
  });
  const editableControls = useMemo(
    () =>
      (controlsQ.data?.controls ?? [])
        .filter((c) => EDITABLE_ATTR_CATEGORIES.includes(c.category))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [controlsQ.data],
  );

  const groupsQ = useQuery({
    queryKey: ["image-studio", "persona-groups", selectedCompanyId],
    queryFn: () => imageStudioApi.listPersonaGroups(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const groups = groupsQ.data?.groups ?? [];

  const trigger = personaTriggerWord(persona);

  const saveMut = useMutation({
    mutationFn: () =>
      imageStudioApi.updatePersona(persona.id, {
        name: name.trim(),
        bio: bio.trim() || null,
        attributes: { ...(persona.attributes ?? {}), ...selections, trigger_word: trigger },
        group_id: groupId === "none" ? null : groupId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-studio", "persona", persona.id] });
      queryClient.invalidateQueries({ queryKey: ["image-studio", "providers"] });
    },
  });

  const dirty =
    name.trim() !== persona.name ||
    (bio.trim() || "") !== (persona.bio ?? "") ||
    (groupId === "none" ? null : groupId) !== (persona.groupId ?? null) ||
    JSON.stringify(selections) !==
      JSON.stringify(
        Object.fromEntries(Object.entries(persona.attributes ?? {}).filter(([, v]) => typeof v === "string")),
      );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pd-name">Name</Label>
          <Input id="pd-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="pd-name" />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            Trigger word
            {trained && <Lock className="h-3 w-3 text-muted-foreground" />}
          </Label>
          <Input value={trigger} readOnly disabled className="font-mono" data-testid="pd-trigger" />
          <p className="text-[11px] text-muted-foreground">
            {trained ? "Locked — renaming would break the trained LoRA." : "Auto-derived from the name until trained."}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pd-bio">Bio</Label>
        <Textarea id="pd-bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={4} data-testid="pd-bio" />
      </div>

      <div className="space-y-1.5">
        <Label>Group</Label>
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="max-w-xs" data-testid="pd-group"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No group</SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <Label>Structured attributes</Label>
        {controlsQ.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {editableControls.map((c) => (
              <StructuredControlPanel
                key={c.id}
                control={c}
                value={selections[c.key]}
                onChange={(v) => setSelections((prev) => ({ ...prev, [c.key]: v ?? "" }))}
                showExplicit={false}
              />
            ))}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background/95 py-3 backdrop-blur">
        {saveMut.isError && <span className="mr-auto text-xs text-red-600">Save failed.</span>}
        {saveMut.isSuccess && !dirty && <span className="mr-auto text-xs text-green-600">Saved.</span>}
        <Button onClick={() => saveMut.mutate()} disabled={!dirty || !name.trim() || saveMut.isPending} data-testid="pd-save">
          {saveMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}

function GalleryTab({ personaId }: { personaId: string }) {
  const q = useQuery({
    queryKey: ["image-studio", "generations", personaId],
    queryFn: () => imageStudioApi.listGenerations(personaId, { limit: 60 }),
  });
  const generations = q.data?.generations ?? [];

  if (q.isLoading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Loading gallery…</div>;
  }
  if (generations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        No generations yet. Use Generate or PhotoShoot to fill this gallery.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
      {generations.map((g) => (
        <img
          key={g.id}
          src={uploadUrl(g.imagePath)}
          alt={g.prompt ?? ""}
          loading="lazy"
          className="aspect-square w-full rounded-lg object-cover"
        />
      ))}
    </div>
  );
}
