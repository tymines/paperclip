import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl, cn } from "../lib/utils";

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
        "flex items-center gap-3 overflow-x-auto border-b border-border bg-background/60 px-4 py-2 text-[13px] scrollbar-auto-hide",
        className,
      )}
    >
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Agents
      </span>
      <div className="flex items-center gap-4">
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
          return (
            <Link
              key={agent.id}
              to={agentUrl(agent)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 hover:underline",
                TEXT_CLASS[dot],
              )}
              title={`${agent.name} — ${dot}`}
            >
              <span className={cn("h-2 w-2 rounded-full", DOT_CLASS[dot])} />
              <span className="truncate">{agent.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
