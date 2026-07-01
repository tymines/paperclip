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
        "flex items-center gap-2.5 overflow-x-auto border-b border-border/70 bg-gradient-to-b from-background/80 to-background/40 px-3 py-3 scrollbar-auto-hide md:px-4",
        className,
      )}
    >
      <span className="shrink-0 self-center pr-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Fleet
      </span>
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
        const initial = (agent.name ?? "?").trim().charAt(0).toUpperCase();
        const title = [
          `${agent.name} — ${dot}`,
          spendTooltip,
          burn > 0 ? `Live burn ${formatCostUsdCompact(burn)}` : null,
        ].filter(Boolean).join("\n");
        return (
          <Link
            key={agent.id}
            to={agentUrl(agent)}
            title={title}
            data-pp-agent-pill={agent.id}
            className={cn(
              "group relative flex w-[86px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border border-border/50 bg-card/50 px-2 py-2.5 transition-all duration-200",
              "hover:-translate-y-0.5 hover:border-border hover:bg-card hover:shadow-lg hover:shadow-black/20",
            )}
          >
            <div className="relative">
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full text-base font-bold text-white shadow-inner ring-1 ring-white/10",
                  isRunning
                    ? "bg-gradient-to-br from-emerald-400 to-cyan-600"
                    : dot === "error"
                      ? "bg-gradient-to-br from-rose-500 to-rose-700"
                      : dot === "idle"
                        ? "bg-gradient-to-br from-slate-600 to-slate-800"
                        : "bg-gradient-to-br from-violet-500 to-indigo-700",
                )}
              >
                {initial}
              </div>
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card",
                  DOT_CLASS[dot],
                  isRunning && "animate-pulse",
                )}
              />
            </div>
            <span className={cn("max-w-[78px] truncate text-[11px] font-medium leading-none", TEXT_CLASS[dot])}>
              {agent.name}
            </span>
            {burn > 0 ? (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-emerald-300">
                {formatCostUsdCompact(burn)}
              </span>
            ) : showSpend ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-mono text-[9px] tabular-nums",
                  overBudget ? "bg-rose-500/15 text-rose-300" : "bg-muted/50 text-muted-foreground",
                )}
              >
                {budget > 0 ? `${utilPct}%` : `$${(spent / 100).toFixed(0)}`}
              </span>
            ) : (
              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60">
                {isRunning ? "live" : dot}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
