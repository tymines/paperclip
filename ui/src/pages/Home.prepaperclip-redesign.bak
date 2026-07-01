import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, RefreshCcw, SlidersHorizontal, Sparkles } from "lucide-react";
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
import { formatCostUsdCompact, formatTokens, relativeTime } from "../lib/utils";
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
    <div className="flex flex-col bg-gradient-to-b from-background via-background to-primary/[0.03]" data-pp-page-v2="home">
      <div data-pp-agent-strip="true">
        <AgentStrip companyId={selectedCompanyId} />
      </div>

      <div className="border-b border-border bg-gradient-to-r from-cyan-500/10 via-cyan-500/5 to-transparent px-3 py-3 md:px-5">
        <button
          type="button"
          onClick={() => navigate("/jarvis")}
          className="group flex w-full items-center gap-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 text-left transition-colors hover:border-cyan-500/60 hover:bg-cyan-500/10 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          aria-label="Wake Augi — open Jarvis voice mode"
          data-pp-jarvis-launcher="true"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400 transition-transform group-hover:scale-105"
            style={{ boxShadow: "0 0 16px rgba(0, 212, 255, 0.45)" }}
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">Wake Augi</div>
            <div className="text-xs text-muted-foreground">
              Voice-first briefing — ask anything, hands-free
            </div>
          </div>
          <span className="hidden text-xs uppercase tracking-widest text-cyan-400 md:inline">
            Jarvis ›
          </span>
        </button>
      </div>

      <div className="flex items-center justify-between border-b border-border px-3 py-3 md:px-5" data-pp-home-now="true">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
          <h1 className="text-lg font-bold tracking-tight">Now</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {waitingItems.length} waiting on you
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" disabled className="hidden md:inline-flex">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => issuesQuery.refetch()}
            aria-label="Refresh"
            className="min-h-[44px] min-w-[44px]"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" data-pp-home-grid="true">
        <section className="border-b border-border px-3 py-4 md:px-5 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/90">
              Goals
            </span>
            <Link
              to={companyPrefix ? `/${companyPrefix}/goals` : "/goals"}
              className="-my-3 inline-flex min-h-[44px] min-w-[44px] items-center justify-end px-3 text-xs text-primary hover:underline"
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

        <section className="px-3 py-4 md:px-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/90">
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
                    className="flex min-h-[44px] w-full items-start gap-3 rounded-xl border border-border/60 bg-gradient-to-br from-card to-card/40 px-3.5 py-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md md:py-2.5"
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
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 truncate text-xs text-muted-foreground">
                        <span className="font-mono">{issue.identifier ?? issue.id.slice(0, 8)}</span>
                        <span>·</span>
                        <span>{relativeTime(issue.updatedAt)}</span>
                        {issue.costCents && issue.costCents > 0 ? (
                          <>
                            <span aria-hidden>·</span>
                            <span
                              className="rounded-sm bg-muted/40 px-1 font-mono text-[10px] tabular-nums text-foreground/80"
                              data-pp-waiting-cost={issue.id}
                              title={`Spend on this issue: $${(issue.costCents / 100).toFixed(2)}`}
                            >
                              {formatCostUsdCompact(issue.costCents / 100)}
                            </span>
                          </>
                        ) : null}
                        {issue.inputTokens || issue.outputTokens ? (
                          <span
                            className="rounded-sm bg-muted/30 px-1 font-mono text-[10px] tabular-nums text-foreground/70"
                            data-pp-waiting-tokens={issue.id}
                            title="Tokens used on this issue"
                          >
                            {formatTokens((issue.inputTokens ?? 0) + (issue.outputTokens ?? 0))}t
                          </span>
                        ) : null}
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
