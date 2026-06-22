/**
 * SkillsCatalog — v2 catalog + management surface for company skills.
 *
 * Replaces the bare-bones index of the legacy SKILL.md editor with a
 * filterable card grid, a slide-out detail drawer (per-agent grants,
 * usage, try-it preview), and a custom-skill install wizard. The
 * underlying markdown editor is still reachable at /skills/library/<id>
 * via the drawer's "Open editor" link.
 *
 * NOT gated behind enableUiV2 — Skills is a product addition, not a
 * cosmetic reskin.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@/lib/router";
import type {
  CompanySkillListItem,
  CompanySkillManifest,
  CompanySkillSourceBadge,
} from "@paperclipai/shared";
import {
  Activity,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Code2,
  Filter,
  Github,
  Globe,
  Layers,
  Package,
  Paperclip,
  Plus,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import { companySkillsApi } from "../api/companySkills";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkillDetailDrawer } from "../components/skills/SkillDetailDrawer";
import { EmptyState } from "../components/EmptyState";

/** UI source filter — `all` matches everything; the rest map to source badges. */
type SourceFilter = "all" | "builtin" | "plugin" | "custom" | "external";
type EnabledFilter = "all" | "on" | "off";
type SortKey = "name" | "most-used" | "recent";

const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
  { key: "all", label: "All sources" },
  { key: "builtin", label: "Built-in" },
  { key: "plugin", label: "Plugin" },
  { key: "custom", label: "Custom" },
  { key: "external", label: "External" },
];

const ENABLED_FILTERS: { key: EnabledFilter; label: string }[] = [
  { key: "all", label: "Any state" },
  { key: "on", label: "Enabled" },
  { key: "off", label: "Disabled" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Alphabetical" },
  { key: "most-used", label: "Most used" },
  { key: "recent", label: "Recently added" },
];

const SOURCE_BADGE_LABEL: Record<CompanySkillSourceBadge, string> = {
  paperclip: "Built-in",
  local: "Custom",
  github: "Plugin",
  url: "Plugin",
  catalog: "Plugin",
  skills_sh: "External",
};

const SOURCE_BADGE_TONE: Record<CompanySkillSourceBadge, string> = {
  paperclip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  local: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  github: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  url: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  catalog: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  skills_sh: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

const SOURCE_BADGE_ICON: Record<CompanySkillSourceBadge, typeof Paperclip> = {
  paperclip: Paperclip,
  local: Code2,
  github: Github,
  url: Globe,
  catalog: Package,
  skills_sh: Sparkles,
};

const SOURCE_FILTER_MATCH: Record<SourceFilter, (badge: CompanySkillSourceBadge) => boolean> = {
  all: () => true,
  builtin: (badge) => badge === "paperclip",
  plugin: (badge) => badge === "github" || badge === "url" || badge === "catalog",
  custom: (badge) => badge === "local",
  external: (badge) => badge === "skills_sh",
};

/**
 * Three placeholder skills shown in the catalog's empty state. They
 * mirror the shape of `CompanySkillListItem` closely enough to render
 * inside <SkillCard /> without forking the component. None of them are
 * clickable — the empty state surfaces install CTAs, not detail drawers.
 */
const EXAMPLE_EMPTY_STATE_SKILLS: Array<{
  name: string;
  description: string;
  badge: CompanySkillSourceBadge;
}> = [
  {
    name: "Web Search",
    description: "Let agents query the public web for fresh context before answering.",
    badge: "paperclip",
  },
  {
    name: "Code Execution",
    description: "Run sandboxed Python or Node scripts to compute, test, and verify.",
    badge: "paperclip",
  },
  {
    name: "Read Filesystem",
    description: "Grant scoped read access to project workspaces and shared knowledge.",
    badge: "paperclip",
  },
];

function formatNumber(value: number): string {
  if (value < 1_000) return value.toString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(2)} s`;
}

function formatPercent(ratio: number | null): string {
  if (ratio == null) return "—";
  return `${Math.round(ratio * 100)}%`;
}

function formatCost(cents: number): string {
  if (cents === 0) return "$0";
  if (cents < 100) return `$${(cents / 100).toFixed(2)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function SkillCard({
  skill,
  onOpen,
  onToggleEnabled,
  toggling,
}: {
  skill: CompanySkillListItem;
  onOpen: () => void;
  onToggleEnabled: (next: boolean) => void;
  toggling: boolean;
}) {
  const SourceIcon = SOURCE_BADGE_ICON[skill.sourceBadge] ?? Boxes;
  return (
    <div
      data-testid="skill-card"
      data-skill-id={skill.id}
      className={cn(
        "group relative flex flex-col gap-3 rounded-2xl border bg-gradient-to-br from-card to-card/40 p-4 shadow-sm",
        "backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
        skill.enabled ? "border-border/60" : "border-border/40 opacity-75",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open ${skill.name} details`}
      />
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background/60">
            <SourceIcon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{skill.name}</h3>
            <p className="truncate text-xs text-muted-foreground">{skill.slug}</p>
          </div>
        </div>
        <div onClick={(event) => event.stopPropagation()}>
          <ToggleSwitch
            checked={skill.enabled}
            onCheckedChange={onToggleEnabled}
            disabled={toggling}
            aria-label={`${skill.enabled ? "Disable" : "Enable"} ${skill.name}`}
          />
        </div>
      </div>

      <p className="relative z-10 line-clamp-2 min-h-[2.5rem] text-xs text-muted-foreground">
        {skill.description ?? "No description provided."}
      </p>

      <div className="relative z-10 flex flex-wrap items-center gap-2 pt-1">
        <Badge
          variant="outline"
          className={cn("gap-1 px-1.5 py-0 text-[10px] font-medium", SOURCE_BADGE_TONE[skill.sourceBadge])}
        >
          <SourceIcon className="h-3 w-3" />
          {SOURCE_BADGE_LABEL[skill.sourceBadge]}
        </Badge>
        {skill.sourceRef && (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-mono text-muted-foreground">
            {skill.sourceRef.slice(0, 7)}
          </Badge>
        )}
        {!skill.enabled && (
          <Badge variant="outline" className="border-muted-foreground/40 px-1.5 py-0 text-[10px] uppercase text-muted-foreground">
            Disabled
          </Badge>
        )}
      </div>

      <div className="relative z-10 flex items-center justify-between border-t border-border/40 pt-3 text-[11px] text-muted-foreground">
        <span>
          Enabled for{" "}
          <span className="font-mono tabular-nums text-foreground">
            {skill.attachedAgentCount}/{skill.totalAgentCount}
          </span>{" "}
          agents
        </span>
        <span>
          <span className="font-mono tabular-nums text-foreground/80">{formatNumber(skill.usage30d.invocations)}</span> invocations · 30d
        </span>
      </div>
    </div>
  );
}

function EmptyExampleCard({
  example,
}: {
  example: (typeof EXAMPLE_EMPTY_STATE_SKILLS)[number];
}) {
  const SourceIcon = SOURCE_BADGE_ICON[example.badge] ?? Boxes;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-card/30 p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background/60">
          <SourceIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{example.name}</h3>
          <Badge variant="outline" className={cn("mt-1 px-1.5 py-0 text-[10px]", SOURCE_BADGE_TONE[example.badge])}>
            Example
          </Badge>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{example.description}</p>
    </div>
  );
}

function InstallSkillDialog({
  open,
  onOpenChange,
  onInstall,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstall: (payload: { manifestUrl?: string | null; manifest?: CompanySkillManifest | null }) => void;
  pending: boolean;
}) {
  const [mode, setMode] = useState<"manifest" | "marketplace">("marketplace");
  const [manifestUrl, setManifestUrl] = useState("");
  const [manifestJson, setManifestJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const reset = () => {
    setMode("marketplace");
    setManifestUrl("");
    setManifestJson("");
    setParseError(null);
  };

  const handleSubmit = () => {
    setParseError(null);
    if (manifestUrl.trim()) {
      onInstall({ manifestUrl: manifestUrl.trim(), manifest: null });
      return;
    }
    if (manifestJson.trim()) {
      try {
        const parsed = JSON.parse(manifestJson) as CompanySkillManifest;
        if (typeof parsed.name !== "string" || parsed.name.length === 0) {
          throw new Error("Manifest must include a non-empty `name` field.");
        }
        onInstall({ manifestUrl: null, manifest: parsed });
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "Manifest is not valid JSON.");
      }
      return;
    }
    setParseError("Provide either a manifest URL or paste a manifest JSON document.");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Install a skill
          </DialogTitle>
          <DialogDescription>
            Pull a skill from the upcoming Paperclip marketplace or hand-roll one from a manifest.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("marketplace")}
            className={cn(
              "flex-1 rounded-sm px-3 py-1.5 transition-colors",
              mode === "marketplace" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Store className="mr-1.5 inline h-3.5 w-3.5" />
            Marketplace
          </button>
          <button
            type="button"
            onClick={() => setMode("manifest")}
            className={cn(
              "flex-1 rounded-sm px-3 py-1.5 transition-colors",
              mode === "manifest" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Code2 className="mr-1.5 inline h-3.5 w-3.5" />
            Custom manifest
          </button>
        </div>

        {mode === "marketplace" ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-10 text-center">
            <Store className="h-8 w-8 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Marketplace browser is coming soon</p>
              <p className="text-xs text-muted-foreground">
                We're packaging featured skills behind a discoverable index. Until then, drop in a
                manifest URL or paste JSON.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setMode("manifest")}>
              Use a custom manifest instead
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="manifest-url">Manifest URL</Label>
              <Input
                id="manifest-url"
                placeholder="https://example.com/my-skill/manifest.json"
                value={manifestUrl}
                onChange={(event) => setManifestUrl(event.target.value)}
                autoComplete="off"
              />
              <p className="text-[11px] text-muted-foreground">
                Fetched server-side. Required fields: <code>name</code>. Optional: <code>slug</code>,{" "}
                <code>description</code>, <code>markdown</code>, <code>iconKey</code>.
              </p>
            </div>

            <div className="relative">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
              <span className="relative mx-auto block w-fit bg-background px-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                Or paste JSON
              </span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="manifest-json">Manifest JSON</Label>
              <Textarea
                id="manifest-json"
                rows={8}
                placeholder={`{\n  "name": "Translate",\n  "description": "Translate text between languages",\n  "markdown": "# Translate\\n..."\n}`}
                value={manifestJson}
                onChange={(event) => setManifestJson(event.target.value)}
                className="font-mono text-xs"
              />
            </div>

            {parseError && (
              <p className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {parseError}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={pending || mode === "marketplace"}
          >
            {pending ? "Installing…" : "Install skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SkillsCatalog() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToastActions();

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [togglingSkillId, setTogglingSkillId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Skills" }]);
  }, [setBreadcrumbs]);

  const skillsQuery = useQuery({
    queryKey: queryKeys.companySkills.list(selectedCompanyId ?? "__none__"),
    queryFn: () => companySkillsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const skills = skillsQuery.data ?? [];

  const filteredSkills = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const passSearch = (skill: CompanySkillListItem) =>
      !normalizedSearch ||
      skill.name.toLowerCase().includes(normalizedSearch) ||
      (skill.description ?? "").toLowerCase().includes(normalizedSearch) ||
      skill.slug.toLowerCase().includes(normalizedSearch);

    const passSource = (skill: CompanySkillListItem) =>
      SOURCE_FILTER_MATCH[sourceFilter](skill.sourceBadge);

    const passEnabled = (skill: CompanySkillListItem) => {
      if (enabledFilter === "all") return true;
      if (enabledFilter === "on") return skill.enabled;
      return !skill.enabled;
    };

    return skills.filter((skill) => passSearch(skill) && passSource(skill) && passEnabled(skill));
  }, [skills, search, sourceFilter, enabledFilter]);

  const sortedSkills = useMemo(() => {
    const copy = [...filteredSkills];
    switch (sortKey) {
      case "most-used":
        copy.sort((a, b) => b.usage30d.invocations - a.usage30d.invocations || a.name.localeCompare(b.name));
        break;
      case "recent":
        copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case "name":
      default:
        copy.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return copy;
  }, [filteredSkills, sortKey]);

  const totals = useMemo(() => {
    return {
      total: skills.length,
      enabled: skills.filter((skill) => skill.enabled).length,
      attached: skills.reduce((sum, skill) => sum + skill.attachedAgentCount, 0),
      invocations: skills.reduce((sum, skill) => sum + skill.usage30d.invocations, 0),
    };
  }, [skills]);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [skills, selectedSkillId],
  );

  const toggleEnabledMutation = useMutation({
    mutationFn: (params: { skillId: string; enabled: boolean }) =>
      companySkillsApi.setEnabled(selectedCompanyId!, params.skillId, params.enabled),
    onMutate: ({ skillId }) => setTogglingSkillId(skillId),
    onSuccess: (updated) => {
      pushToast({
        title: updated.enabled ? `${updated.name} enabled` : `${updated.name} disabled`,
        tone: updated.enabled ? "success" : "info",
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.companySkills.list(selectedCompanyId ?? "__none__"),
      });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to update skill", body: err.message, tone: "error" });
    },
    onSettled: () => setTogglingSkillId(null),
  });

  const installMutation = useMutation({
    mutationFn: (payload: { manifestUrl?: string | null; manifest?: CompanySkillManifest | null }) =>
      companySkillsApi.installManifest(selectedCompanyId!, payload),
    onSuccess: (created) => {
      pushToast({ title: `Installed ${created.name}`, tone: "success" });
      setInstallOpen(false);
      queryClient.invalidateQueries({
        queryKey: queryKeys.companySkills.list(selectedCompanyId ?? "__none__"),
      });
      setSelectedSkillId(created.id);
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to install skill", body: err.message, tone: "error" });
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Boxes} message="Select a company to manage its skills." />;
  }

  const isLoading = skillsQuery.isLoading;
  const hasNoSkills = !isLoading && skills.length === 0;

  return (
    <div
      className="flex flex-col gap-6 bg-gradient-to-b from-background via-background to-primary/[0.03]"
      data-testid="skills-catalog"
      data-pp-page-v2="skills"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Skills</h1>
          <p className="text-sm text-muted-foreground">
            Atomic capabilities your {selectedCompany?.name ?? "company"} agents can use — manage,
            inspect, and grant per-agent access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/skills/library">
              <Settings className="mr-1.5 h-4 w-4" />
              Open editor
            </Link>
          </Button>
          <Button size="sm" onClick={() => setInstallOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Install skill
          </Button>
        </div>
      </header>

      {!hasNoSkills && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Boxes} label="Skills" value={totals.total.toString()} />
          <StatCard icon={CheckCircle2} label="Enabled" value={totals.enabled.toString()} tone="emerald" />
          <StatCard icon={Layers} label="Agent grants" value={totals.attached.toString()} />
          <StatCard
            icon={Activity}
            label="Invocations · 30d"
            value={formatNumber(totals.invocations)}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search skills by name, slug, or description"
            className="pl-9"
            aria-label="Search skills"
          />
        </div>
        <FilterPills
          label={<Puzzle className="h-3.5 w-3.5" />}
          srLabel="Source filter"
          options={SOURCE_FILTERS}
          value={sourceFilter}
          onChange={setSourceFilter}
        />
        <FilterPills
          label={<Filter className="h-3.5 w-3.5" />}
          srLabel="Enabled filter"
          options={ENABLED_FILTERS}
          value={enabledFilter}
          onChange={setEnabledFilter}
        />
        <FilterPills
          label={<ArrowUpRight className="h-3.5 w-3.5" />}
          srLabel="Sort"
          options={SORT_OPTIONS}
          value={sortKey}
          onChange={setSortKey}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-xl border border-border bg-card/40"
            />
          ))}
        </div>
      ) : hasNoSkills ? (
        <SkillsEmptyState onInstall={() => setInstallOpen(true)} />
      ) : sortedSkills.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center text-sm text-muted-foreground">
          No skills match the current filters.
          <div className="mt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setSourceFilter("all");
                setEnabledFilter("all");
              }}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Clear filters
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sortedSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onOpen={() => setSelectedSkillId(skill.id)}
              onToggleEnabled={(next) =>
                toggleEnabledMutation.mutate({ skillId: skill.id, enabled: next })
              }
              toggling={togglingSkillId === skill.id}
            />
          ))}
        </div>
      )}

      <SkillDetailDrawer
        companyId={selectedCompanyId}
        skillSummary={selectedSkill}
        open={Boolean(selectedSkill)}
        onClose={() => setSelectedSkillId(null)}
        onOpenEditor={(skillId) => {
          setSelectedSkillId(null);
          navigate(`/skills/library/${skillId}`);
        }}
        formatNumber={formatNumber}
        formatLatency={formatLatency}
        formatPercent={formatPercent}
        formatCost={formatCost}
      />

      <InstallSkillDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        onInstall={(payload) => installMutation.mutate(payload)}
        pending={installMutation.isPending}
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
  tone?: "default" | "emerald";
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-gradient-to-br from-card to-card/40 px-4 py-3.5 shadow-sm backdrop-blur-sm">
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl border",
          tone === "emerald"
            ? "border-[#2FE38A]/40 bg-[#2FE38A]/10 text-[#2FE38A]"
            : "border-border bg-background/60 text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate font-mono text-xl font-semibold leading-tight tabular-nums text-foreground">{value}</div>
        <div className="truncate text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function FilterPills<T extends string>({
  label,
  srLabel,
  options,
  value,
  onChange,
}: {
  label: React.ReactNode;
  srLabel: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={srLabel}
      className="flex items-center gap-1 rounded-md border border-border bg-card/40 p-1 text-xs"
    >
      <span className="ml-1 text-muted-foreground" aria-hidden>{label}</span>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={cn(
            "rounded-sm px-2 py-1 transition-colors",
            value === option.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SkillsEmptyState({ onInstall }: { onInstall: () => void }) {
  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card/50 p-8 backdrop-blur-sm">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-background/60">
            <Sparkles className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Bootstrap your skill library</h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              Skills are atomic capabilities — web search, code execution, file access, MCP tools —
              that agents pick up at runtime. Install one to start.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onInstall}>
            <Store className="mr-1.5 h-4 w-4" />
            Browse marketplace
          </Button>
          <Button size="sm" onClick={onInstall}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add custom skill
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {EXAMPLE_EMPTY_STATE_SKILLS.map((example) => (
          <EmptyExampleCard key={example.name} example={example} />
        ))}
      </div>
    </div>
  );
}
