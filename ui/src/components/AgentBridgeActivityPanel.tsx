import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { agentsApi } from "../api/agents";
import { relativeTime } from "../lib/utils";

interface Props {
  agentId: string;
  companyId: string;
}

/**
 * Compact "Recent bridge activity" panel for the agent profile / detail page.
 * Shows the 24h count + last outcome and flips to a red badge if any reply
 * was rejected/errored in the last 24h. Built to make silent bridge failures
 * (the kind that look like "agent replied" in daemon logs but never landed in
 * the messages table) visible without digging into logs.
 */
export function AgentBridgeActivityPanel({ agentId, companyId }: Props) {
  const query = useQuery({
    queryKey: ["agent-bridge-attempts", companyId, agentId],
    queryFn: () => agentsApi.bridgeAttempts(companyId, agentId, 20),
    refetchInterval: 30_000,
    enabled: Boolean(companyId && agentId),
  });

  const data = query.data;

  if (query.isLoading) {
    return (
      <section
        data-testid="agent-bridge-activity-panel"
        className="rounded-xl border border-border bg-card p-5"
      >
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Recent bridge activity
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section
        data-testid="agent-bridge-activity-panel"
        className="rounded-xl border border-border bg-card p-5"
      >
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Recent bridge activity
        </h2>
        <p className="mt-3 text-sm text-destructive">
          Failed to load bridge attempts.
        </p>
      </section>
    );
  }

  if (!data || data.attempts.length === 0) {
    return (
      <section
        data-testid="agent-bridge-activity-panel"
        className="rounded-xl border border-border bg-card p-5"
      >
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Recent bridge activity
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          No bridge reply attempts recorded yet.
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="agent-bridge-activity-panel"
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Recent bridge activity
        </h2>
        {data.hasFailures24h ? (
          <span
            data-testid="agent-bridge-activity-badge-failure"
            className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive"
          >
            <AlertTriangle className="h-3 w-3" />
            {data.last24hCounts.rejected + data.last24hCounts.errored} failed in 24h
          </span>
        ) : (
          <span
            data-testid="agent-bridge-activity-badge-ok"
            className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="h-3 w-3" />
            healthy
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-md border border-border bg-background/50 p-2">
          <div className="text-muted-foreground">24h total</div>
          <div className="text-base font-semibold">{data.last24hCounts.total}</div>
        </div>
        <div className="rounded-md border border-border bg-background/50 p-2">
          <div className="text-muted-foreground">persisted</div>
          <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
            {data.last24hCounts.persisted}
          </div>
        </div>
        <div className="rounded-md border border-border bg-background/50 p-2">
          <div className="text-muted-foreground">failed</div>
          <div className="text-base font-semibold text-destructive">
            {data.last24hCounts.rejected + data.last24hCounts.errored}
          </div>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {data.attempts.slice(0, 5).map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent/40"
          >
            <Activity
              className={`h-3 w-3 ${
                a.outcome === "persisted"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
              }`}
            />
            <span className="font-medium">{a.outcome}</span>
            {a.errorDetail ? (
              <span className="truncate text-muted-foreground">
                · {a.errorDetail}
              </span>
            ) : null}
            <span className="ml-auto text-muted-foreground">
              {relativeTime(a.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
