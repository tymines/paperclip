import {
  Suspense,
  lazy,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History } from "lucide-react";

// Lazy: ActivityCharts is ~9 KB of SVG-rendering code that isn't needed
// for first paint. Tyler was seeing a 12.8s black screen on mobile while
// the chart chunk + activity rows all hydrated synchronously. Splitting
// it out lets the page shell + filter chip render immediately.
const ActivityChartsSection = lazy(() => import("../components/ActivityChartsSection"));

const ACTIVITY_PAGE_LIMIT = 200;
const ACTIVITY_INITIAL_ROWS = 8;

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
  // staleTime: Infinity + placeholderData keep cached data on-screen so the
  // chart doesn't block first paint or flash a spinner on re-navigation.
  const { data: dashboard } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    staleTime: Infinity,
    placeholderData: (prev) => prev,
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
    staleTime: Infinity,
    placeholderData: (prev) => prev,
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

  // useDeferredValue keeps the page interactive while React diffs a long
  // activity list. Hoisted above the early-return so hook order stays
  // stable (same reason topCostAgents is hoisted — see commit fef69d1c).
  const deferredData = useDeferredValue(data);

  if (!selectedCompanyId) {
    return <EmptyState icon={History} message="Select a company to view activity." />;
  }

  const filtered =
    deferredData && filter !== "all"
      ? deferredData.filter((e) => e.entityType === filter)
      : deferredData;

  const entityTypes = data
    ? [...new Set(data.map((e) => e.entityType))].sort()
    : [];

  return (
    <div className="space-y-4">
      <Suspense fallback={<ChartSectionSkeleton />}>
        <ActivityChartsSection
          dashboard={dashboard}
          topCostAgents={topCostAgents}
        />
      </Suspense>

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

      {isLoading && !filtered ? (
        <ActivityRowsSkeleton />
      ) : filtered && filtered.length === 0 ? (
        <EmptyState icon={History} message="No activity yet." />
      ) : filtered && filtered.length > 0 ? (
        <ProgressiveActivityRows
          events={filtered}
          agentMap={agentMap}
          userProfileMap={userProfileMap}
          entityNameMap={entityNameMap}
          entityTitleMap={entityTitleMap}
        />
      ) : null}
    </div>
  );
}

function ChartSectionSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-44 w-full rounded-lg border border-border" />
      <Skeleton className="h-44 w-full rounded-lg border border-border" />
    </div>
  );
}

function ActivityRowsSkeleton() {
  return (
    <div className="border border-border divide-y divide-border" aria-busy="true">
      {Array.from({ length: ACTIVITY_INITIAL_ROWS }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ProgressiveActivityRowsProps {
  events: ActivityEvent[];
  agentMap: Map<string, Agent>;
  userProfileMap: ReturnType<typeof buildCompanyUserProfileMap>;
  entityNameMap: Map<string, string>;
  entityTitleMap: Map<string, string>;
}

// Renders the first ACTIVITY_INITIAL_ROWS rows immediately, then waits for
// the user to scroll past a sentinel before mounting the rest. Each
// ActivityRow can pull in lucide icons + popovers, so 200 of them at once
// was the dominant cause of the mobile black screen.
function ProgressiveActivityRows(props: ProgressiveActivityRowsProps) {
  const { events } = props;
  const [revealAll, setRevealAll] = useState(events.length <= ACTIVITY_INITIAL_ROWS);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (revealAll) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      // No IO support: degrade by revealing after a short delay so we
      // never strand users on the truncated list.
      const t = window.setTimeout(() => setRevealAll(true), 600);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealAll(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [revealAll]);

  const visible = revealAll ? events : events.slice(0, ACTIVITY_INITIAL_ROWS);
  const hiddenCount = revealAll ? 0 : Math.max(0, events.length - ACTIVITY_INITIAL_ROWS);

  return (
    <div className="border border-border divide-y divide-border">
      {visible.map((event) => (
        <ActivityRow
          key={event.id}
          event={event}
          agentMap={props.agentMap}
          userProfileMap={props.userProfileMap}
          entityNameMap={props.entityNameMap}
          entityTitleMap={props.entityTitleMap}
        />
      ))}
      {hiddenCount > 0 ? (
        <div ref={sentinelRef} className="px-4 py-3 text-center text-xs text-muted-foreground">
          Loading {hiddenCount} more…
        </div>
      ) : null}
    </div>
  );
}
