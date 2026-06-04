/**
 * Personas — the management surface for trained AI characters (image_providers
 * rows of type 'local_lora'). Search, organize into folders, favorite, and jump
 * straight into any Image Studio tool with the persona pre-selected. Clicking a
 * card opens its detail/edit page; "+ New Persona" launches the 3-step wizard.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Star, Wand2, Camera, Shirt, Pencil, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompany } from "@/context/CompanyContext";
import { Link } from "@/lib/router";
import { imageStudioApi, type ImageProvider } from "@/api/imageStudio";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import {
  PersonaAvatar,
  PersonaStatusBadge,
  personaTriggerWord,
  imageStudioToolPath,
  isPersonaTrained,
  type PersonaQuickTool,
} from "@/components/personas/shared";
import { NewPersonaWizard } from "@/components/personas/NewPersonaWizard";

function QuickAction({
  to,
  icon: Icon,
  label,
  testId,
}: {
  to: string;
  icon: typeof Wand2;
  label: string;
  testId: string;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-indigo-300 hover:text-foreground"
    >
      <Icon className="h-3 w-3" /> {label}
    </Link>
  );
}

function PersonaCard({ persona }: { persona: ImageProvider }) {
  const queryClient = useQueryClient();
  const trigger = personaTriggerWord(persona);
  const trained = isPersonaTrained(persona);

  const favMut = useMutation({
    mutationFn: () => imageStudioApi.updatePersona(persona.id, { is_favorite: !persona.isFavorite }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["image-studio", "providers"] }),
  });

  const tools: { tab: PersonaQuickTool; icon: typeof Wand2; label: string }[] = [
    { tab: "generate", icon: Wand2, label: "Generate" },
    { tab: "photoshoot", icon: Camera, label: "PhotoShoot" },
    { tab: "undresser", icon: Shirt, label: "Undress" },
  ];

  return (
    <Card className="group relative overflow-hidden transition-shadow hover:shadow-md" data-testid="persona-card">
      <CardContent className="p-4">
        {/* Favorite toggle */}
        <button
          type="button"
          onClick={() => favMut.mutate()}
          aria-label={persona.isFavorite ? "Unfavorite" : "Favorite"}
          data-testid="persona-favorite"
          className="absolute right-3 top-3 z-10 rounded-full p-1 text-muted-foreground transition-colors hover:text-amber-500"
        >
          <Star className={cn("h-4 w-4", persona.isFavorite && "fill-amber-400 text-amber-400")} />
        </button>

        <Link to={`/personas/${persona.id}`} className="flex items-start gap-3" data-testid="persona-card-link">
          <PersonaAvatar persona={persona} />
          <div className="min-w-0 flex-1 pr-6">
            <div className="truncate text-sm font-semibold">{persona.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <PersonaStatusBadge persona={persona} />
              <Badge variant="secondary" className="font-mono text-[10px]" title="Trigger word">
                {trigger}
              </Badge>
            </div>
          </div>
        </Link>

        {/* Quick actions */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {trained ? (
            tools.map((t) => (
              <QuickAction
                key={t.tab}
                to={imageStudioToolPath(persona.id, t.tab)}
                icon={t.icon}
                label={t.label}
                testId={`quick-${t.tab}`}
              />
            ))
          ) : (
            <Link
              to={`/personas/${persona.id}`}
              data-testid="quick-train"
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
            >
              <Camera className="h-3 w-3" /> Start training
            </Link>
          )}
          <QuickAction
            to={`/personas/${persona.id}`}
            icon={Pencil}
            label="Edit"
            testId="quick-edit"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function Personas() {
  const { selectedCompanyId } = useCompany();
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const providersQ = useQuery({
    queryKey: ["image-studio", "providers", selectedCompanyId],
    queryFn: () => imageStudioApi.listProviders(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const groupsQ = useQuery({
    queryKey: ["image-studio", "persona-groups", selectedCompanyId],
    queryFn: () => imageStudioApi.listPersonaGroups(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const personas = useMemo(
    () => (providersQ.data?.providers ?? []).filter((p) => p.type === "local_lora"),
    [providersQ.data],
  );
  const groups = groupsQ.data?.groups ?? [];

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return personas
      .filter((p) => (groupFilter ? p.groupId === groupFilter : true))
      .filter((p) =>
        term ? `${p.name} ${personaTriggerWord(p)}`.toLowerCase().includes(term) : true,
      )
      // Favorites first, then by sortOrder, then name.
      .sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
  }, [personas, search, groupFilter]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 text-indigo-500" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Personas</h1>
            <p className="text-sm text-muted-foreground">Your trained AI characters</p>
          </div>
        </div>
        <Button onClick={() => setWizardOpen(true)} data-testid="new-persona">
          <Plus className="mr-1.5 h-4 w-4" /> New Persona
        </Button>
      </div>

      {/* Search + group folders */}
      <div className="mb-4 space-y-3">
        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search personas…"
            data-testid="persona-search"
            className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="persona-groups">
            <button
              type="button"
              onClick={() => setGroupFilter(null)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                groupFilter === null ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              All
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroupFilter(g.id)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  groupFilter === g.id ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" : "bg-muted text-muted-foreground hover:bg-muted/70",
                )}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {providersQ.isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading personas…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Users}
          message={search ? "No personas match your search." : "No personas yet. Create your first trained character."}
          action={search ? undefined : "New Persona"}
          onAction={search ? undefined : () => setWizardOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <PersonaCard key={p.id} persona={p} />
          ))}
        </div>
      )}

      <NewPersonaWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
