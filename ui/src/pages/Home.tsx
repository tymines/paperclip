import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, RefreshCcw, SlidersHorizontal } from "lucide-react";
import { goalsApi } from "../api/goals";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useDialogActions } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";
import { AgentStrip } from "../components/AgentStrip";
import { GoalTree } from "../components/GoalTree";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "../components/StatusBadge";
import { relativeTime } from "../lib/utils";
import { Target } from "lucide-react";
import type { Issue } from "@paperclipai/shared";

const WAITING_STATUSES = new Set<Issue["status"]>(["blocked", "in_review"]);

function priorityWeight(priority: Issue["priority"]): number {
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

/**
 * UI v1 Home page (replaces Dashboard when `enableUiV1` is on).
 * Linear-inspired three-zone layout:
 *  - AgentStrip across the top
 *  - "Now" head bar
 *  - Goals tree on the left, "Waiting on you" issue list on the right
 */
export function Home() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { openNewIssue } = useDialogActions();
  const navigate = useNavigate();
  const companyPrefix = selectedCompany?.issuePrefix;

  useEffect(() => {
    setBreadcrumbs([{ label: "Home" }]);
  }, [setBreadcrumbs]);

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const issuesQuery = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const waitingItems = useMemo(() => {
    const list = issuesQuery.data ?? [];
    return list
      .filter((issue) => WAITING_STATUSES.has(issue.status))
      .sort((a, b) => {
        const p = priorityWeight(a.priority) - priorityWeight(b.priority);
        if (p !== 0) return p;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 8);
  }, [issuesQuery.data]);

  const topBlocker = useMemo(
    () => waitingItems.find((item) => item.status === "blocked") ?? waitingItems[0] ?? null,
    [waitingItems],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Target} message="Select a company to view Home." />;
  }

  if (issuesQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  function goToIssue(issue: Issue) {
    const prefix = companyPrefix ?? "PAP";
    const idPart = issue.identifier ?? issue.id;
    navigate(`/${prefix}/issues/${idPart}`);
  }

  return (
    <div className="flex flex-col">
      <AgentStrip companyId={selectedCompanyId} />

      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">Now</h1>
          <span className="text-xs text-muted-foreground">
            {waitingItems.length} waiting on you
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => issuesQuery.refetch()}
            aria-label="Refresh"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="border-b border-border px-5 py-4 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Goals
            </span>
            <Link
              to={companyPrefix ? `/${companyPrefix}/goals` : "/goals"}
              className="text-xs text-primary hover:underline"
            >
              Open all
            </Link>
          </div>
          {goals && goals.length > 0 ? (
            <GoalTree
              goals={goals}
              goalLink={(goal) =>
                companyPrefix ? `/${companyPrefix}/goals/${goal.id}` : `/goals/${goal.id}`
              }
            />
          ) : (
            <p className="text-sm text-muted-foreground">No goals yet.</p>
          )}
        </section>

        <section className="px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Waiting on you
            </span>
            <span className="text-xs text-muted-foreground">{waitingItems.length} items</span>
          </div>

          {waitingItems.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              You're caught up. Nothing is blocked or waiting on review.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {waitingItems.map((issue) => (
                <li key={issue.id}>
                  <button
                    type="button"
                    onClick={() => goToIssue(issue)}
                    className="flex w-full items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-accent/40"
                  >
                    <span
                      className={
                        issue.status === "blocked"
                          ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-400"
                          : "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-400"
                      }
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{issue.title}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        <span className="font-mono">{issue.identifier ?? issue.id.slice(0, 8)}</span>
                        <span className="mx-1.5">·</span>
                        <span>{relativeTime(issue.updatedAt)}</span>
                      </div>
                    </div>
                    <span className="self-center">
                      <StatusBadge status={issue.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {topBlocker ? (
            <Button
              className="mt-4 w-full"
              onClick={() => goToIssue(topBlocker)}
            >
              <AlertCircle className="h-4 w-4" />
              Resolve top blocker
            </Button>
          ) : (
            <Button
              variant="outline"
              className="mt-4 w-full"
              onClick={() => openNewIssue()}
            >
              + New issue
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
