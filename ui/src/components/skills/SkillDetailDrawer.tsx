/**
 * SkillDetailDrawer — right slide-out sheet shown when a catalog card is
 * clicked. Houses the full description, a "Try it" preview pane, the
 * per-agent enablement table, and 30-day usage stats. The drawer is
 * intentionally read-mostly: deep editing happens in the legacy markdown
 * editor at /skills/library/<id> via the "Open editor" button.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CompanySkillAgentGrant,
  CompanySkillDetail,
  CompanySkillInvokeResponse,
  CompanySkillListItem,
  CompanySkillSourceBadge,
} from "@paperclipai/shared";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Code2,
  Cpu,
  DollarSign,
  ExternalLink,
  Github,
  Globe,
  Pencil,
  Play,
  Sparkles,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { companySkillsApi } from "../../api/companySkills";
import { queryKeys } from "../../lib/queryKeys";
import { useToastActions } from "../../context/ToastContext";
import { cn } from "../../lib/utils";

const SOURCE_ICON: Record<CompanySkillSourceBadge, typeof Boxes> = {
  paperclip: Sparkles,
  local: Code2,
  github: Github,
  url: Globe,
  catalog: Boxes,
  skills_sh: Sparkles,
};

type Tab = "overview" | "try" | "agents" | "usage";

const TABS: { key: Tab; label: string; icon: typeof Boxes }[] = [
  { key: "overview", label: "Overview", icon: Boxes },
  { key: "try", label: "Try it", icon: Play },
  { key: "agents", label: "Agents", icon: Cpu },
  { key: "usage", label: "Usage", icon: Activity },
];

export function SkillDetailDrawer({
  companyId,
  skillSummary,
  open,
  onClose,
  onOpenEditor,
  formatNumber,
  formatLatency,
  formatPercent,
  formatCost,
}: {
  companyId: string;
  skillSummary: CompanySkillListItem | null;
  open: boolean;
  onClose: () => void;
  onOpenEditor: (skillId: string) => void;
  formatNumber: (value: number) => string;
  formatLatency: (ms: number | null) => string;
  formatPercent: (ratio: number | null) => string;
  formatCost: (cents: number) => string;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [invokeInput, setInvokeInput] = useState("{\n  \"prompt\": \"hello\"\n}");
  const [invokeResult, setInvokeResult] = useState<CompanySkillInvokeResponse | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();

  // Reset transient drawer state every time we open a different skill so the
  // user doesn't see stale try-it output for a different capability.
  useEffect(() => {
    setTab("overview");
    setInvokeResult(null);
    setInvokeError(null);
  }, [skillSummary?.id]);

  const detailQuery = useQuery({
    queryKey: queryKeys.companySkills.detail(companyId, skillSummary?.id ?? "__none__"),
    queryFn: () => companySkillsApi.detail(companyId, skillSummary!.id),
    enabled: Boolean(skillSummary?.id) && open,
  });

  const grantsQuery = useQuery({
    queryKey: queryKeys.companySkills.agentGrants(companyId, skillSummary?.id ?? "__none__"),
    queryFn: () => companySkillsApi.listAgentGrants(companyId, skillSummary!.id),
    enabled: Boolean(skillSummary?.id) && open && tab === "agents",
  });

  const detail: CompanySkillDetail | null = detailQuery.data ?? null;

  const grantMutation = useMutation({
    mutationFn: ({ agentId, granted }: { agentId: string; granted: boolean }) =>
      companySkillsApi.setAgentGrant(companyId, skillSummary!.id, agentId, granted),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.companySkills.agentGrants(companyId, skillSummary!.id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.companySkills.list(companyId),
      });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to update grant", body: err.message, tone: "error" });
    },
  });

  const invokeMutation = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      companySkillsApi.invoke(companyId, skillSummary!.id, input),
    onSuccess: (result) => setInvokeResult(result),
    onError: (err: Error) => {
      setInvokeError(err.message);
      setInvokeResult(null);
    },
  });

  const grants = grantsQuery.data?.grants ?? [];

  const handleInvoke = () => {
    setInvokeError(null);
    setInvokeResult(null);
    let parsed: Record<string, unknown> = {};
    const trimmed = invokeInput.trim();
    if (trimmed.length > 0) {
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("Input must be a JSON object.");
        }
      } catch (err) {
        setInvokeError(err instanceof Error ? err.message : "Invalid JSON.");
        return;
      }
    }
    invokeMutation.mutate(parsed);
  };

  const SourceIcon = skillSummary ? (SOURCE_ICON[skillSummary.sourceBadge] ?? Boxes) : Boxes;

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        side="right"
        className="flex w-full max-w-full flex-col gap-0 overflow-hidden border-l border-border bg-background p-0 sm:max-w-xl"
        data-testid="skill-detail-drawer"
      >
        {skillSummary && (
          <>
            <SheetHeader className="space-y-3 border-b border-border p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card">
                  <SourceIcon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-lg">{skillSummary.name}</SheetTitle>
                  <SheetDescription className="truncate font-mono text-xs">
                    {skillSummary.slug}
                  </SheetDescription>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {skillSummary.sourceBadge === "paperclip" ? "Built-in" : skillSummary.sourceBadge}
                </Badge>
                {skillSummary.sourceRef && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {skillSummary.sourceRef.slice(0, 7)}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    skillSummary.enabled
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                      : "border-muted-foreground/40 text-muted-foreground",
                  )}
                >
                  {skillSummary.enabled ? "Enabled" : "Disabled"}
                </Badge>
                {skillSummary.sourcePath && (
                  <Badge variant="outline" className="max-w-[24rem] truncate font-mono text-[10px] text-muted-foreground">
                    {skillSummary.sourcePath}
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => onOpenEditor(skillSummary.id)}>
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Open editor
                </Button>
                {skillSummary.sourceLabel && skillSummary.sourcePath && (
                  <span className="truncate text-xs text-muted-foreground">
                    {skillSummary.sourceLabel}
                  </span>
                )}
              </div>
            </SheetHeader>

            <nav
              role="tablist"
              aria-label="Skill detail sections"
              className="flex items-center gap-1 border-b border-border px-3 pt-2"
            >
              {TABS.map((entry) => {
                const Icon = entry.icon;
                const active = entry.key === tab;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(entry.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-medium transition-colors",
                      active
                        ? "border-b-2 border-foreground text-foreground"
                        : "border-b-2 border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {entry.label}
                  </button>
                );
              })}
            </nav>

            <div className="flex-1 overflow-y-auto p-5">
              {tab === "overview" && (
                <OverviewPane
                  detail={detail}
                  loading={detailQuery.isLoading}
                  summary={skillSummary}
                  formatNumber={formatNumber}
                  formatLatency={formatLatency}
                  formatPercent={formatPercent}
                  formatCost={formatCost}
                />
              )}
              {tab === "try" && (
                <TryItPane
                  input={invokeInput}
                  onInputChange={setInvokeInput}
                  result={invokeResult}
                  error={invokeError}
                  pending={invokeMutation.isPending}
                  onInvoke={handleInvoke}
                />
              )}
              {tab === "agents" && (
                <AgentsPane
                  grants={grants}
                  loading={grantsQuery.isLoading}
                  pendingAgentId={
                    grantMutation.isPending
                      ? (grantMutation.variables?.agentId ?? null)
                      : null
                  }
                  onToggle={(agentId, granted) =>
                    grantMutation.mutate({ agentId, granted })
                  }
                />
              )}
              {tab === "usage" && (
                <UsagePane
                  summary={skillSummary}
                  formatNumber={formatNumber}
                  formatLatency={formatLatency}
                  formatPercent={formatPercent}
                  formatCost={formatCost}
                />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function OverviewPane({
  detail,
  loading,
  summary,
  formatNumber,
  formatLatency,
  formatPercent,
  formatCost,
}: {
  detail: CompanySkillDetail | null;
  loading: boolean;
  summary: CompanySkillListItem;
  formatNumber: (value: number) => string;
  formatLatency: (ms: number | null) => string;
  formatPercent: (ratio: number | null) => string;
  formatCost: (cents: number) => string;
}) {
  const description = detail?.description ?? summary.description;
  const fileInventory = detail?.fileInventory ?? summary.fileInventory;
  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Description
        </h4>
        <p className="leading-relaxed text-foreground">
          {description ?? "No description set for this skill yet."}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Stat label="Enabled for" value={`${summary.attachedAgentCount} / ${summary.totalAgentCount}`} />
        <Stat label="Trust" value={summary.trustLevel.replaceAll("_", " ")} />
        <Stat label="Compatibility" value={summary.compatibility} />
        <Stat label="Invocations · 30d" value={formatNumber(summary.usage30d.invocations)} />
        <Stat label="Success rate" value={formatPercent(summary.usage30d.successRate)} />
        <Stat label="Avg latency" value={formatLatency(summary.usage30d.avgLatencyMs)} />
        <Stat label="Cost · 30d" value={formatCost(summary.usage30d.totalCostCents)} />
        <Stat label="Files" value={fileInventory.length.toString()} />
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          File inventory
        </h4>
        {loading ? (
          <div className="h-24 animate-pulse rounded border border-border bg-card/40" />
        ) : fileInventory.length === 0 ? (
          <p className="text-xs text-muted-foreground">No files materialised yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border bg-card/40 text-xs">
            {fileInventory.slice(0, 20).map((file) => (
              <li key={file.path} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="truncate font-mono">{file.path}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {file.kind}
                </span>
              </li>
            ))}
          </ul>
        )}
        {fileInventory.length > 20 && (
          <p className="text-xs text-muted-foreground">
            …and {fileInventory.length - 20} more — open the editor to browse.
          </p>
        )}
      </section>

      {summary.sourceLabel && (
        <section className="rounded border border-border bg-card/40 p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Source</span>
            <span className="font-mono">{summary.sourceLabel}</span>
          </div>
          {summary.sourcePath && (
            <div className="mt-1 truncate text-[11px] text-muted-foreground">
              {summary.sourcePath}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function TryItPane({
  input,
  onInputChange,
  result,
  error,
  pending,
  onInvoke,
}: {
  input: string;
  onInputChange: (next: string) => void;
  result: CompanySkillInvokeResponse | null;
  error: string | null;
  pending: boolean;
  onInvoke: () => void;
}) {
  const echoStr = useMemo(() => {
    if (!result) return "";
    return JSON.stringify(result.echo, null, 2);
  }, [result]);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="skill-invoke-input" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Input JSON
          </label>
          <Button size="sm" onClick={onInvoke} disabled={pending}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {pending ? "Running…" : "Run"}
          </Button>
        </div>
        <Textarea
          id="skill-invoke-input"
          rows={6}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Preview only — the response echoes your input and renders the SKILL.md description.
          Real runtime invocation lands later.
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3 rounded-lg border border-border bg-card/60 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-300">
              {result.status}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {result.latencyMs} ms
            </Badge>
          </div>
          <section className="space-y-1">
            <h5 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Preview
            </h5>
            <p className="leading-relaxed text-foreground/90">{result.preview}</p>
          </section>
          <section className="space-y-1">
            <h5 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Echoed input
            </h5>
            <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-[11px]">{echoStr}</pre>
          </section>
          {result.warnings.length > 0 && (
            <section className="space-y-1">
              <h5 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Warnings
              </h5>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-300">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function AgentsPane({
  grants,
  loading,
  pendingAgentId,
  onToggle,
}: {
  grants: CompanySkillAgentGrant[];
  loading: boolean;
  pendingAgentId: string | null;
  onToggle: (agentId: string, granted: boolean) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded border border-border bg-card/40" />
        ))}
      </div>
    );
  }
  if (grants.length === 0) {
    return (
      <p className="rounded border border-dashed border-border bg-card/40 p-6 text-center text-xs text-muted-foreground">
        This company has no agents yet. Create one to start granting skills.
      </p>
    );
  }
  return (
    <ul
      data-testid="skill-grant-table"
      className="divide-y divide-border overflow-hidden rounded-lg border border-border"
    >
      {grants.map((grant) => (
        <li key={grant.agentId} className="flex items-center justify-between gap-3 bg-card/40 px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{grant.agentName}</span>
              <Badge variant="outline" className="text-[10px]">
                {grant.adapterType}
              </Badge>
            </div>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{grant.agentUrlKey}</p>
          </div>
          <ToggleSwitch
            checked={grant.granted}
            onCheckedChange={(next) => onToggle(grant.agentId, next)}
            disabled={pendingAgentId === grant.agentId}
            aria-label={`${grant.granted ? "Revoke" : "Grant"} skill access for ${grant.agentName}`}
          />
        </li>
      ))}
    </ul>
  );
}

function UsagePane({
  summary,
  formatNumber,
  formatLatency,
  formatPercent,
  formatCost,
}: {
  summary: CompanySkillListItem;
  formatNumber: (value: number) => string;
  formatLatency: (ms: number | null) => string;
  formatPercent: (ratio: number | null) => string;
  formatCost: (cents: number) => string;
}) {
  const { usage30d } = summary;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Invocations" value={formatNumber(usage30d.invocations)} />
        <Stat label="Success rate" value={formatPercent(usage30d.successRate)} />
        <Stat label="Avg latency" value={formatLatency(usage30d.avgLatencyMs)} />
        <Stat label="Total cost" value={formatCost(usage30d.totalCostCents)} />
      </div>
      <div className="rounded border border-border bg-card/40 p-4 text-xs text-muted-foreground">
        <DollarSign className="mr-1 inline h-3.5 w-3.5" />
        Cost and latency rollups will populate once tool invocations start flowing through the
        telemetry pipeline. Until then, this panel shows zeros to confirm the shape end-to-end.
      </div>
      <a
        href="https://docs.paperclip.ai/skills/usage"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="h-3 w-3" />
        Read about skill usage metrics
      </a>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-card/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
