import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import type { ActivityEvent, Agent } from "@paperclipai/shared";
import { activityApi } from "../api/activity";
import { accessApi } from "../api/access";
import { agentsApi } from "../api/agents";
import { costsApi } from "../api/costs";
import { dashboardApi } from "../api/dashboard";
import { buildCompanyUserProfileMap } from "../lib/company-members";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { ActivityRow } from "../components/ActivityRow";
import { PageSkeleton } from "../components/PageSkeleton";
import { ChartCard, SpendActivityChart } from "../components/ActivityCharts";
import { agentUrl, formatCostUsdCompact, formatTokens } from "../lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History } from "lucide-react";

const ACTIVITY_PAGE_LIMIT = 200;

function detailString(event: ActivityEvent, ...keys: string[]) {
  const details = event.details;
  for (const key of keys) {
    const value = details?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function activityEntityName(event: ActivityEvent) {
  if (event.entityType === "issue") return detailString(event, "identifier", "issueIdentifier");
  if (event.entityType === "project") return detailString(event, "projectName", "name", "title");
  if (event.entityType === "goal") return detailString(event, "goalTitle", "title", "name");
  return detailString(event, "name", "title");
}

function activityEntityTitle(event: ActivityEvent) {
  if (event.entityType === "issue") return detailString(event, "issueTitle", "title");
  return null;
}

export function Activity() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setBreadcrumbs([{ label: "Activity" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: [...queryKeys.activity(selectedCompanyId!), { limit: ACTIVITY_PAGE_LIMIT }],
    queryFn: () => activityApi.list(selectedCompanyId!, { limit: ACTIVITY_PAGE_LIMIT }),
    enabled: !!selectedCompanyId,
  });

  // Activity needs spend visibility but doesn't own its own time-series —
  // the dashboard summary already carries 14 days of per-day cost rolled up
  // from cost_events, so we reuse it for the spend chart.
  const { data: dashboard } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // Per-agent spend rollup for the same window. Default range covers the last
  // 30 days so the breakdown contextually matches the activity feed window.
  const costAgentRangeFrom = useMemo(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString();
  }, []);
  const { data: costByAgent } = useQuery({
    queryKey: [...queryKeys.dashboard(selectedCompanyId!), "activity", "cost-by-agent", costAgentRangeFrom],
    queryFn: () => costsApi.byAgent(selectedCompanyId!, costAgentRangeFrom),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: companyMembers } = useQuery({
    queryKey: queryKeys.access.companyUserDirectory(selectedCompanyId!),
    queryFn: () => accessApi.listUserDirectory(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const userProfileMap = useMemo(
    () => buildCompanyUserProfileMap(companyMembers?.users),
    [companyMembers?.users],
  );

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    for (const event of data ?? []) {
      const name = activityEntityName(event);
      if (name) map.set(`${event.entityType}:${event.entityId}`, name);
    }
    return map;
  }, [data, agents]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of data ?? []) {
      const title = activityEntityTitle(event);
      if (title) map.set(`${event.entityType}:${event.entityId}`, title);
    }
    return map;
  }, [data]);

  const topCostAgents = useMemo(() => {
    return [...(costByAgent ?? [])]
      .filter((row) => (row.costCents ?? 0) > 0 || (row.inputTokens ?? 0) + (row.outputTokens ?? 0) > 0)
      .slice(0, 10);
  }, [costByAgent]);

  if (!selectedCompanyId) {
    return <EmptyState icon={History} message="Select a company to view activity." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const filtered =
    data && filter !== "all"
      ? data.filter((e) => e.entityType === filter)
      : data;

  const entityTypes = data
    ? [...new Set(data.map((e) => e.entityType))].sort()
    : [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2" data-pp-activity-spend-overview>
        <ChartCard title="Spend" subtitle="Last 14 days">
          <SpendActivityChart activity={dashboard?.runActivity ?? []} />
        </ChartCard>
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground">Spend by agent</h3>
            <span className="text-[10px] text-muted-foreground/60">Last 30 days</span>
          </div>
          {topCostAgents.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No per-agent spend yet — once cost_events flow this fills in.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border/60 text-xs">
              {topCostAgents.map((row) => {
                const tokens = (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
                const agentRef = row.agentId
                  ? agentUrl({ id: row.agentId, name: row.agentName ?? null, urlKey: null })
                  : null;
                return (
                  <li
                    key={row.agentId ?? "unknown"}
                    className="flex items-center justify-between gap-3 py-1.5"
                  >
                    <span className="min-w-0 truncate">
                      {agentRef ? (
                        <Link to={agentRef} className="text-foreground/80 hover:underline">
                          {row.agentName ?? row.agentId?.slice(0, 8) ?? "Unknown agent"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Unattributed</span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 font-mono tabular-nums">
                      {tokens > 0 ? (
                        <span className="text-muted-foreground">{formatTokens(tokens)}t</span>
                      ) : null}
                      <span className="text-foreground/80">
                        {formatCostUsdCompact((row.costCents ?? 0) / 100)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {entityTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {filtered && filtered.length === 0 && (
        <EmptyState icon={History} message="No activity yet." />
      )}

      {filtered && filtered.length > 0 && (
        <div className="border border-border divide-y divide-border">
          {filtered.map((event) => (
            <ActivityRow
              key={event.id}
              event={event}
              agentMap={agentMap}
              userProfileMap={userProfileMap}
              entityNameMap={entityNameMap}
              entityTitleMap={entityTitleMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}
