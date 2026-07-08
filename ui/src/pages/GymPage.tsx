import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { cn } from "../lib/utils";
import { gymApi, type EvolutionRun } from "../api/gym";

function statusColor(status: string) {
  switch (status) {
    case "active":
      return "bg-yellow-400";
    case "idle":
      return "bg-green-400";
    case "paused":
      return "bg-gray-400";
    default:
      return "bg-gray-400";
  }
}

function AgentCard({
  name,
  status,
  skillCount,
}: {
  name: string;
  status: string;
  skillCount: number;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 transition-colors hover:border-gray-700">
      <div className="flex items-center gap-3">
        <span className={cn("h-3 w-3 rounded-full", statusColor(status))} />
        <span className="text-sm font-medium text-gray-200">{name}</span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
        <span className="capitalize">{status}</span>
        <span>{skillCount} skills</span>
      </div>
    </div>
  );
}

function EvolutionRunRow({
  run,
  defaultExpanded,
}: {
  run: EvolutionRun;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const deltaClass =
    run.delta > 0 ? "text-green-400" : run.delta < 0 ? "text-red-400" : "text-gray-400";
  const statusClass =
    run.status === "approved"
      ? "text-green-400"
      : run.status === "rejected"
        ? "text-red-400"
        : "text-yellow-400";

  return (
    <>
      <tr
        className="cursor-pointer border-b border-gray-800 transition-colors hover:bg-gray-900/50"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-xs font-mono text-gray-400">{run.id}</td>
        <td className="px-4 py-3 text-sm text-gray-200">{run.targetSkill}</td>
        <td className="px-4 py-3 text-sm text-gray-400">
          {run.beforeScore} &rarr; {run.afterScore}
        </td>
        <td className={cn("px-4 py-3 text-sm font-medium", deltaClass)}>
          {run.delta > 0 ? "+" : ""}{run.delta}
        </td>
        <td className={cn("px-4 py-3 text-sm capitalize", statusClass)}>
          {run.status.replace("_", " ")}
        </td>
      </tr>
      {expanded && run.diff && (
        <tr className="border-b border-gray-800 bg-gray-900/30">
          <td colSpan={5} className="px-6 py-3">
            <div className="rounded-md border border-gray-700 bg-gray-950 p-3">
              <p className="mb-2 text-xs font-medium text-gray-400">Change Description</p>
              <pre className="whitespace-pre-wrap font-mono text-xs text-gray-300">{run.diff}</pre>
              {run.rationale && (
                <>
                  <p className="mb-1 mt-3 text-xs font-medium text-gray-400">Rationale</p>
                  <p className="text-xs text-gray-300">{run.rationale}</p>
                </>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function LiveActivityFeed({ runs }: { runs: EvolutionRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-950 p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
          <span className="text-xl">&#x1F3CB;</span>
        </div>
        <h3 className="mb-1 text-sm font-medium text-gray-200">No self-improvement events yet</h3>
        <p className="text-xs text-gray-400">
          Agent skill creation and evolution events will appear here
        </p>
      </div>
    );
  }

  const latest = runs.slice(0, 15);
  const iconForAction = (status: string) => {
    if (status === "awaiting_approval") return "&#x1F4A1;"; // lightbulb — proposed
    if (status === "approved") return "&#x2705;"; // check
    if (status === "rejected") return "&#x274C;"; // X
    return "&#x1F4CC;"; // pin — default
  };
  const actionLabel = (status: string) => {
    if (status === "awaiting_approval") return "proposed evolution";
    if (status === "approved") return "approved evolution";
    if (status === "rejected") return "rejected evolution";
    return status;
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-medium text-gray-300">Live Self-Improvement Feed</h2>
      </div>
      <div className="divide-y divide-gray-800/50 max-h-[480px] overflow-y-auto">
        {latest.map((run) => {
          const d = (run.details ?? {}) as any;
          return (
            <div key={run.id} className="px-4 py-3 hover:bg-gray-900/30 transition-colors">
              <div className="flex items-start gap-3">
                <span
                  className="mt-0.5 text-sm flex-shrink-0"
                  dangerouslySetInnerHTML={{ __html: iconForAction(run.status) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-200">{run.targetSkill}</span>
                    <span className="text-xs text-gray-500">{actionLabel(run.status)}</span>
                  </div>
                  {d.whatWorks && (
                    <p className="mt-1 text-xs text-green-400/80 leading-relaxed">
                      <span className="text-green-500 font-medium">Works: </span>
                      {d.whatWorks}
                    </p>
                  )}
                  {d.whatFailed && (
                    <p className="mt-0.5 text-xs text-red-400/80 leading-relaxed">
                      <span className="text-red-500 font-medium">Failed: </span>
                      {d.whatFailed}
                    </p>
                  )}
                  {d.rationale && (
                    <p className="mt-0.5 text-xs text-gray-400 leading-relaxed italic">
                      {d.rationale}
                    </p>
                  )}
                  {d.beforeScore != null && d.afterScore != null && (
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <span className="text-gray-500">{d.beforeScore}</span>
                      <span className="text-gray-600">&rarr;</span>
                      <span
                        className={d.afterScore > d.beforeScore ? "text-green-400" : "text-red-400"}
                      >
                        {d.afterScore}
                      </span>
                      <span
                        className={
                          d.afterScore > d.beforeScore
                            ? "text-green-500 font-medium"
                            : "text-red-500 font-medium"
                        }
                      >
                        ({d.afterScore > d.beforeScore ? "+" : ""}{d.afterScore - d.beforeScore})
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GymPage() {
  const { selectedCompanyId } = useCompany();

  const agentsQuery = useQuery({
    queryKey: ["gym", "agents", selectedCompanyId],
    queryFn: () => gymApi.listAgents(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const evolutionRunsQuery = useQuery({
    queryKey: ["gym", "evolution-runs", selectedCompanyId],
    queryFn: () => gymApi.listEvolutionRuns(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const skillStatsQuery = useQuery({
    queryKey: ["gym", "skills-stats", selectedCompanyId],
    queryFn: () => gymApi.listSkillStats(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  if (!selectedCompanyId) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm text-gray-400">Select a company to view the Gym</p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-200">Gym</h1>
        <p className="mt-1 text-sm text-gray-400">Agent self-improvement dashboard</p>
      </div>

      {/* Live Self-Improvement Feed */}
      <LiveActivityFeed runs={evolutionRunsQuery.data ?? []} />

      {/* Per-Agent Cards */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-gray-300">Per-Agent Cards</h2>
        {agentsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="animate-pulse rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="h-4 w-24 rounded bg-gray-800" />
                <div className="mt-3 h-3 w-16 rounded bg-gray-800" />
              </div>
            ))}
          </div>
        ) : agentsQuery.error ? (
          <p className="text-sm text-red-400">Failed to load agent cards</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(agentsQuery.data ?? []).map((agent) => (
              <AgentCard
                key={agent.name}
                name={agent.name}
                status={agent.status}
                skillCount={agent.skillCount}
              />
            ))}
          </div>
        )}
      </div>

      {/* Evolution Runs */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-gray-300">Evolution Runs</h2>
        {evolutionRunsQuery.isLoading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-6 text-center">
            <p className="text-sm text-gray-400">Loading evolution runs...</p>
          </div>
        ) : evolutionRunsQuery.error ? (
          <p className="text-sm text-red-400">Failed to load evolution runs</p>
        ) : (evolutionRunsQuery.data ?? []).length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-6 text-center">
            <p className="text-sm text-gray-400">
              No evolution runs yet. Self-evolution proposals will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/50">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Run ID
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Target Skill
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Before to After
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Delta
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {(evolutionRunsQuery.data ?? []).map((run) => (
                  <EvolutionRunRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Skill Scoreboard */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-gray-300">Skill Scoreboard</h2>
        {skillStatsQuery.isLoading ? (
          <div className="rounded-lg border border-gray-800 bg-gray-950 p-6 text-center">
            <p className="text-sm text-gray-400">Loading skill stats...</p>
          </div>
        ) : skillStatsQuery.error ? (
          <p className="text-sm text-red-400">Failed to load skill stats</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/50">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Skill
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Score
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-gray-400">
                    Last Improved
                  </th>
                </tr>
              </thead>
              <tbody>
                {(skillStatsQuery.data ?? []).map((stat) => (
                  <tr key={stat.skill} className="border-b border-gray-800 transition-colors hover:bg-gray-900/50">
                    <td className="px-4 py-3 text-sm text-gray-200">{stat.skill}</td>
                    <td className="px-4 py-3 text-sm text-gray-200">{stat.score}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">{stat.lastImproved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
