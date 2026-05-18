import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Calendar, SlidersHorizontal } from "lucide-react";
import type { Goal, Issue, RoutineListItem } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { routinesApi } from "../api/routines";
import { goalsApi } from "../api/goals";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityIcon } from "../components/PriorityIcon";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Layers } from "lucide-react";
import { cn, relativeTime } from "../lib/utils";

type WorkType = "issue" | "routine" | "goal";
type FilterTab = "all" | WorkType;

interface WorkRow {
  id: string;
  type: WorkType;
  title: string;
  identifier: string | null;
  status: string;
  priority: Issue["priority"] | null;
  ownerName: string | null;
  due: string | null;
  href: string;
  sortKey: number;
}

function priorityWeight(priority: Issue["priority"] | null | undefined): number {
  switch (priority) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}

function issueToRow(issue: Issue, prefix: string): WorkRow {
  return {
    id: `issue:${issue.id}`,
    type: "issue",
    title: issue.title,
    identifier: issue.identifier,
    status: issue.status,
    priority: issue.priority,
    ownerName: null,
    due: null,
    href: `/${prefix}/issues/${issue.identifier ?? issue.id}`,
    sortKey: priorityWeight(issue.priority) * 1e12 - new Date(issue.updatedAt).getTime(),
  };
}

function routineToRow(routine: RoutineListItem, prefix: string): WorkRow {
  const cron = routine.triggers.find((t) => t.cronExpression)?.cronExpression ?? null;
  return {
    id: `routine:${routine.id}`,
    type: "routine",
    title: routine.title,
    identifier: null,
    status: routine.status,
    priority: null,
    ownerName: null,
    due: cron,
    href: `/${prefix}/routines/${routine.id}`,
    sortKey: Number.MAX_SAFE_INTEGER - new Date(routine.updatedAt).getTime(),
  };
}

function goalToRow(goal: Goal, prefix: string): WorkRow {
  return {
    id: `goal:${goal.id}`,
    type: "goal",
    title: goal.title,
    identifier: null,
    status: goal.status,
    priority: null,
    ownerName: null,
    due: null,
    href: `/${prefix}/goals/${goal.id}`,
    sortKey: Number.MAX_SAFE_INTEGER - new Date(goal.updatedAt).getTime(),
  };
}

/**
 * UI v1 Work page — collapses Issues + Routines + Goals into one filterable list
 * (decision 10's "triangle" unification, extended to include Goals as the
 * mockup shows). Each filter tab still maps to the same underlying queries.
 */
export function Work() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [tab, setTab] = useState<FilterTab>("all");
  const companyPrefix = selectedCompany?.issuePrefix ?? "PAP";

  useEffect(() => {
    setBreadcrumbs([{ label: "Work" }]);
  }, [setBreadcrumbs]);

  const issuesQuery = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const routinesQuery = useQuery({
    queryKey: queryKeys.routines.list(selectedCompanyId!),
    queryFn: () => routinesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const goalsQuery = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const allRows: WorkRow[] = useMemo(() => {
    const rows: WorkRow[] = [];
    for (const issue of issuesQuery.data ?? []) {
      if (issue.status !== "done" && issue.status !== "cancelled") {
        rows.push(issueToRow(issue, companyPrefix));
      }
    }
    for (const routine of routinesQuery.data ?? []) {
      rows.push(routineToRow(routine, companyPrefix));
    }
    for (const goal of goalsQuery.data ?? []) {
      if (goal.status !== "achieved" && goal.status !== "cancelled") {
        rows.push(goalToRow(goal, companyPrefix));
      }
    }
    return rows.sort((a, b) => a.sortKey - b.sortKey);
  }, [issuesQuery.data, routinesQuery.data, goalsQuery.data, companyPrefix]);

  const counts = useMemo(() => {
    const c = { all: allRows.length, issue: 0, routine: 0, goal: 0 } as Record<FilterTab, number>;
    for (const row of allRows) c[row.type] += 1;
    return c;
  }, [allRows]);

  const filteredRows = useMemo(
    () => (tab === "all" ? allRows : allRows.filter((row) => row.type === tab)),
    [allRows, tab],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Layers} message="Select a company to view work." />;
  }

  if (issuesQuery.isLoading && routinesQuery.isLoading && goalsQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-3 md:px-5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">Work</h1>
          <p className="hidden text-xs text-muted-foreground md:block">Everything assigned or watched.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" disabled className="hidden md:inline-flex">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Group
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Calendar className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 overflow-x-auto border-b border-border px-3 scrollbar-auto-hide md:gap-5 md:px-5">
        {(["all", "issue", "routine", "goal"] as FilterTab[]).map((entry) => {
          const label =
            entry === "all"
              ? "All"
              : entry === "issue"
                ? "Issues"
                : entry === "routine"
                  ? "Routines"
                  : "Goals";
          const isActive = tab === entry;
          return (
            <button
              key={entry}
              type="button"
              onClick={() => setTab(entry)}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 py-3 text-sm transition-colors md:py-2.5",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}{" "}
              <span className="ml-1 text-xs text-muted-foreground">{counts[entry]}</span>
            </button>
          );
        })}
      </div>

      {filteredRows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Nothing here.
        </div>
      ) : (
        <div>
          <div className="hidden grid-cols-[24px_minmax(0,1fr)_90px_120px_120px] gap-3 border-b border-border bg-accent/20 px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
            <span />
            <span>Item</span>
            <span>Type</span>
            <span>State</span>
            <span>Due</span>
          </div>
          <ul>
            {filteredRows.map((row) => (
              <li key={row.id}>
                <Link
                  to={row.href}
                  className="flex min-h-[56px] items-center gap-3 border-b border-border/60 px-3 py-2.5 text-sm transition-colors hover:bg-accent/40 md:min-h-0 md:gap-3 md:px-5"
                >
                  <span className="flex w-6 shrink-0 justify-center">
                    {row.priority ? (
                      <PriorityIcon priority={row.priority} />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{row.title}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground md:hidden">
                      <span className="capitalize">{row.type}</span>
                      {row.identifier ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate font-mono">{row.identifier}</span>
                        </>
                      ) : null}
                    </span>
                    {row.identifier ? (
                      <span className="hidden truncate text-[11px] font-mono text-muted-foreground md:block">
                        {row.identifier}
                      </span>
                    ) : null}
                  </span>
                  <span className="hidden w-[90px] shrink-0 text-xs capitalize text-muted-foreground md:block">
                    {row.type}
                  </span>
                  <span className="shrink-0 md:w-[120px]">
                    <StatusBadge status={row.status} />
                  </span>
                  <span className="hidden w-[120px] shrink-0 truncate text-xs text-muted-foreground md:block">
                    {row.due ?? (row.type === "issue" ? relativeTime(new Date()) : "—")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
