import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import {
  agentUrl,
  cn,
  formatCostUsdCompact,
  visibleRunCostUsd,
} from "../lib/utils";

type DotKind = "running" | "active" | "paused" | "error" | "idle";

const DOT_CLASS: Record<DotKind, string> = {
  running: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]",
  active: "bg-emerald-400/80",
  paused: "bg-amber-400",
  error: "bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.6)]",
  idle: "bg-muted-foreground/40",
};

const TEXT_CLASS: Record<DotKind, string> = {
  running: "text-foreground",
  active: "text-foreground",
  paused: "text-muted-foreground",
  error: "text-foreground",
  idle: "text-muted-foreground",
};

interface AgentStripProps {
  companyId: string;
  className?: string;
}

/**
 * Linear-style horizontal strip of every agent in the company with a status
 * dot. Pairs the agents list with live runs so a "running" dot pulses for
 * agents that currently have an active heartbeat run.
 *
 * Lightweight on purpose — meant to live in the page chrome above Home and
 * complement (not replace) ActiveAgentsPanel's heavier run cards.
 */
export function AgentStrip({ companyId, className }: AgentStripProps) {
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(companyId), "agent-strip"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
    enabled: !!companyId,
    refetchInterval: 10_000,
  });

  const runningAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (run.status === "running" || run.status === "queued") ids.add(run.agentId);
    }
    return ids;
  }, [liveRuns]);

  // Per-agent live burn, summed across any live runs that have a usageJson
  // snapshot. `LiveRunForIssue.usageJson` is optional — when missing (e.g.
  // pre-bridge runs or adapters that don't emit usage) the agent simply gets
  // no live burn badge instead of a misleading $0.
  const liveBurnByAgent = useMemo(() => {
    const map = new Map<string, number>();
    for (const run of liveRuns ?? []) {
      const usage = run.usageJson ?? null;
      if (!usage) continue;
      const cost = visibleRunCostUsd(usage);
      if (cost <= 0) continue;
      map.set(run.agentId, (map.get(run.agentId) ?? 0) + cost);
    }
    return map;
  }, [liveRuns]);

  const sortedAgents = useMemo(() => {
    const list = agents ?? [];
    return [...list].sort((a, b) => {
      const aRunning = runningAgentIds.has(a.id) ? 0 : 1;
      const bRunning = runningAgentIds.has(b.id) ? 0 : 1;
      if (aRunning !== bRunning) return aRunning - bRunning;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });
  }, [agents, runningAgentIds]);

  if (sortedAgents.length === 0) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 overflow-x-auto border-b border-border bg-background/60 px-3 py-2 text-[13px] scrollbar-auto-hide md:px-4",
        className,
      )}
    >
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Agents
      </span>
      <div className="flex items-center gap-3 md:gap-4">
        {sortedAgents.map((agent) => {
          const isRunning = runningAgentIds.has(agent.id);
          const dot: DotKind = isRunning
            ? "running"
            : agent.status === "error"
              ? "error"
              : agent.status === "paused"
                ? "paused"
                : agent.status === "active"
                  ? "active"
                  : "idle";
          const spent = agent.spentMonthlyCents ?? 0;
          const budget = agent.budgetMonthlyCents ?? 0;
          const burn = liveBurnByAgent.get(agent.id) ?? 0;
          const showSpend = spent > 0 || budget > 0;
          const utilPct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
          const overBudget = budget > 0 && spent > budget;
          const spendTooltip = budget > 0
            ? `$${(spent / 100).toFixed(2)} of $${(budget / 100).toFixed(2)} this month`
            : spent > 0
              ? `$${(spent / 100).toFixed(2)} this month`
              : null;
          const title = [
            `${agent.name} — ${dot}`,
            spendTooltip,
            burn > 0 ? `Live burn ${formatCostUsdCompact(burn)}` : null,
          ].filter(Boolean).join("\n");
          return (
            <Link
              key={agent.id}
              to={agentUrl(agent)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 hover:underline",
                TEXT_CLASS[dot],
              )}
              title={title}
              data-pp-agent-pill={agent.id}
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT_CLASS[dot])} />
              <span className="max-w-[140px] truncate">{agent.name}</span>
              {showSpend ? (
                <span
                  className={cn(
                    "shrink-0 rounded-sm px-1 font-mono text-[10px] tabular-nums",
                    overBudget
                      ? "bg-rose-500/15 text-rose-300"
                      : "bg-muted/40 text-muted-foreground",
                  )}
                  data-pp-agent-spend={agent.id}
                  aria-label={spendTooltip ?? undefined}
                >
                  {budget > 0 ? `${utilPct}%` : `$${(spent / 100).toFixed(0)}`}
                </span>
              ) : null}
              {burn > 0 ? (
                <span
                  className="shrink-0 rounded-sm bg-emerald-500/15 px-1 font-mono text-[10px] tabular-nums text-emerald-300"
                  data-pp-agent-live-burn={agent.id}
                  aria-label={`Live burn ${formatCostUsdCompact(burn)}`}
                >
                  {formatCostUsdCompact(burn)}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
