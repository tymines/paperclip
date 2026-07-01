import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { ActivityEvent, Agent } from "@paperclipai/shared";
import { activityApi } from "../api/activity";
import { accessApi } from "../api/access";
import { agentsApi } from "../api/agents";
import { buildCompanyUserProfileMap } from "../lib/company-members";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { ActivityRow } from "../components/ActivityRow";
import { MlflowObservabilityCard } from "../components/MlflowObservabilityCard";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Paperclip Design System v1.0 tokens (locked)                               */
/* Applied locally to the Activity feed so the redesign is self-contained and */
/* does not mutate global theme variables used by other pages. Matches the    */
/* Home / Costs / Fleet builds.                                               */
/* -------------------------------------------------------------------------- */
const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  border3: "#314158",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
  automation: "#A56EFF",
  analytics: "#31D9FF",
} as const;

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

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

  // useDeferredValue keeps the page interactive while React diffs a long
  // activity list. Hoisted above the early-return so hook order stays
  // stable (see commit fef69d1c).
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
    <div
      className="flex min-h-full flex-col gap-5 p-8"
      style={{ background: DS.canvas }}
      data-pp-page-v2="activity-feed"
    >
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight" style={{ color: DS.text }}>
            Activity
          </h1>
          <p className="text-[14px]" style={{ color: DS.textMuted }}>
            Chronological event feed across your fleet.
          </p>
        </div>

        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger
            className="w-[160px] h-9 text-xs"
            style={{
              background: DS.surface3,
              border: `1px solid ${DS.border2}`,
              color: DS.text,
            }}
          >
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

      <MlflowObservabilityCard variant="activity" />

      {error && (
        <p className="text-sm" style={{ color: DS.critical }}>
          {error.message}
        </p>
      )}

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

function ActivityRowsSkeleton() {
  return (
    <div style={surfaceCard} className="overflow-hidden" aria-busy="true">
      {Array.from({ length: ACTIVITY_INITIAL_ROWS }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3"
          style={{
            borderBottom: i === ACTIVITY_INITIAL_ROWS - 1 ? "none" : `1px solid ${DS.border}`,
          }}
        >
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
    <div style={surfaceCard} className="overflow-hidden">
      {visible.map((event, idx) => (
        <div
          key={event.id}
          style={{
            borderBottom:
              idx === visible.length - 1 && hiddenCount === 0
                ? "none"
                : `1px solid ${DS.border}`,
          }}
        >
          <ActivityRow
            event={event}
            agentMap={props.agentMap}
            userProfileMap={props.userProfileMap}
            entityNameMap={props.entityNameMap}
            entityTitleMap={props.entityTitleMap}
          />
        </div>
      ))}
      {hiddenCount > 0 ? (
        <div
          ref={sentinelRef}
          className="px-4 py-3 text-center text-xs"
          style={{ color: DS.textFaint }}
        >
          Loading {hiddenCount} more…
        </div>
      ) : null}
    </div>
  );
}
