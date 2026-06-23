import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import {
  ArrowUpRight,
  CircleDot,
  GitBranch,
  Inbox,
  Loader2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { jarvisApi, type JarvisDelegationRow } from "@/api/jarvis";
import { agentsApi } from "@/api/agents";
import { queryKeys } from "@/lib/queryKeys";
import {
  workerStatusOf,
  presentWorkerStatus,
} from "@/lib/team-mode-contract";
import { DS, MONO, surfaceCard, toneColor, type Tone } from "./warRoomTokens";

/* -------------------------------------------------------------------------- */
/* Team Mode (read-only) — the leader-directed task board for the War Room.    */
/*                                                                            */
/* DATA HONESTY: every value here is real or omitted. Sources:                */
/*   • Task board cards  → GET /companies/:id/jarvis/delegations (real ledger) */
/*   • Team roster       → GET /companies/:id/agents (real, live via WS)       */
/*   • Directed messages → the delegation row's task (leader→worker) + result  */
/*                         (worker→leader). No fabricated content.             */
/* This is a READ-ONLY slice: no assign / approve / cancel actions are wired.  */
/* -------------------------------------------------------------------------- */

const COLUMNS: ReadonlyArray<{
  key: JarvisDelegationRow["status"];
  label: string;
  tone: Tone;
}> = [
  { key: "queued", label: "Queued", tone: "muted" },
  { key: "running", label: "In progress", tone: "info" },
  { key: "completed", label: "Completed", tone: "success" },
  { key: "failed", label: "Failed", tone: "critical" },
];

const AGENT_STATUS_TONE: Record<string, Tone> = {
  running: "success",
  idle: "muted",
  error: "critical",
  paused: "warning",
  terminated: "muted",
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return `${Math.max(secs, 0)}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/** Resolve the directing leader (Ares/COO) from the real roster.
 *  NOTE: the live roster carries roles ("coo", "orchestrator") that are not in
 *  the typed AgentRole union yet, so we compare on the string value. */
function resolveLeader(agents: Agent[]): Agent | null {
  const coo = agents.find((a) => String(a.role) === "coo");
  if (coo) return coo;
  const flagged = agents.find(
    (a) => (a.metadata as Record<string, unknown> | null)?.distributor === true,
  );
  if (flagged) return flagged;
  // Fall back to the agent the most teammates report to.
  const counts = new Map<string, number>();
  for (const a of agents) {
    if (a.reportsTo) counts.set(a.reportsTo, (counts.get(a.reportsTo) ?? 0) + 1);
  }
  let bestId: string | null = null;
  let best = 0;
  for (const [id, n] of counts) {
    if (n > best) {
      best = n;
      bestId = id;
    }
  }
  return bestId ? agents.find((a) => a.id === bestId) ?? null : null;
}

function Chip({
  label,
  tone,
  title,
}: {
  label: string;
  tone: Tone;
  title?: string;
}) {
  const c = toneColor(tone);
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: `${c}1A`, border: `1px solid ${c}55`, color: c }}
    >
      {label}
    </span>
  );
}

function StatusDot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  const c = toneColor(tone);
  return (
    <span
      className="relative inline-flex h-2 w-2 shrink-0 rounded-full"
      style={{ background: c }}
    >
      {pulse ? (
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: c, animation: "tm-ping 1.6s cubic-bezier(0,0,.2,1) infinite" }}
        />
      ) : null}
    </span>
  );
}

export default function TeamModeBoard({ companyId }: { companyId: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });

  const delegationsQuery = useQuery({
    queryKey: [...queryKeys.agents.list(companyId), "team-mode", "delegations"],
    queryFn: () => jarvisApi.delegations(companyId, { limit: 200 }),
    refetchInterval: 30_000,
  });

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const delegations = useMemo(
    () => delegationsQuery.data?.delegations ?? [],
    [delegationsQuery.data],
  );

  const leader = useMemo(() => resolveLeader(agents), [agents]);
  const team = useMemo(
    () => (leader ? agents.filter((a) => a.reportsTo === leader.id) : []),
    [agents, leader],
  );

  // Match a delegation's peer-id (e.g. "codex") to a roster agent by name.
  const agentByName = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents) m.set(a.name.toLowerCase(), a);
    return m;
  }, [agents]);

  const byStatus = useMemo(() => {
    const map: Record<string, JarvisDelegationRow[]> = {
      queued: [],
      running: [],
      completed: [],
      failed: [],
    };
    for (const d of delegations) (map[d.status] ??= []).push(d);
    return map;
  }, [delegations]);

  const selected = useMemo(
    () => delegations.find((d) => d.id === selectedId) ?? null,
    [delegations, selectedId],
  );

  const loading = agentsQuery.isLoading || delegationsQuery.isLoading;
  const hasError = agentsQuery.isError || delegationsQuery.isError;

  return (
    <div className="px-8 py-6" style={{ color: DS.text }}>
      <style>{`@keyframes tm-ping{75%,100%{transform:scale(2.4);opacity:0}}`}</style>

      {/* Leader header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{ background: DS.primary }}
        >
          <ShieldCheck className="h-5 w-5" style={{ color: "#fff" }} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[15px] font-semibold">
            {leader ? leader.name : "Leader"}
            <span className="text-[12px] font-normal" style={{ color: DS.textFaint }}>
              {leader?.title ?? "Distributor"}
            </span>
          </div>
          <div className="text-[12px]" style={{ color: DS.textMuted }}>
            {leader
              ? `Directs ${team.length} teammate${team.length === 1 ? "" : "s"} — assigns work, collects results, integrates.`
              : "No COO/distributor resolved for this company yet."}
          </div>
        </div>
        <span
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px]"
          style={{ background: DS.surface2, border: `1px solid ${DS.border2}`, color: DS.textMuted }}
          title="The board reflects live dispatch + telemetry data. Read-only view."
        >
          <CircleDot className="h-3 w-3" style={{ color: DS.success }} />
          Live · read-only
        </span>
      </div>

      {hasError ? (
        <div
          className="mb-4 rounded-[14px] px-4 py-3 text-[13px]"
          style={{ background: `${DS.critical}14`, border: `1px solid ${DS.critical}55`, color: DS.critical }}
        >
          Couldn't load live team data. The board shows nothing rather than stale or invented data.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        {/* Task board */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
            <Users className="h-3.5 w-3.5" /> Task board
            <span className="font-normal normal-case" style={{ color: DS.textFaint }}>
              {delegations.length} assignment{delegations.length === 1 ? "" : "s"}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-10 text-[13px]" style={{ color: DS.textMuted }}>
              <Loader2 className="h-4 w-4 animate-spin" /> Loading live assignments…
            </div>
          ) : delegations.length === 0 ? (
            <EmptyBoard />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {COLUMNS.map((col) => (
                <div key={col.key} className="min-w-0">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <StatusDot tone={col.tone} />
                    <span className="text-[12px] font-semibold" style={{ color: DS.text }}>
                      {col.label}
                    </span>
                    <span className="text-[11px]" style={{ color: DS.textFaint, fontFamily: MONO }}>
                      {byStatus[col.key]?.length ?? 0}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {(byStatus[col.key] ?? []).map((d) => (
                      <AssignmentCard
                        key={d.id}
                        row={d}
                        worker={agentByName.get(d.agent.toLowerCase()) ?? null}
                        selected={d.id === selectedId}
                        onSelect={() => setSelectedId(d.id)}
                      />
                    ))}
                    {(byStatus[col.key]?.length ?? 0) === 0 ? (
                      <div
                        className="rounded-[12px] px-3 py-3 text-[11px]"
                        style={{ border: `1px dashed ${DS.border2}`, color: DS.textFaint }}
                      >
                        None
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Directed messages */}
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
              <ArrowUpRight className="h-3.5 w-3.5" /> Directed messages
            </div>
            <DirectedMessages
              row={selected}
              leaderName={leader?.name ?? "Leader"}
              workerName={
                selected ? agentByName.get(selected.agent.toLowerCase())?.name ?? selected.agent : null
              }
            />
          </div>
        </div>

        {/* Team roster + dependencies */}
        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
              Team — reports to {leader?.name ?? "leader"}
            </div>
            <div style={surfaceCard} className="flex flex-col divide-y" >
              {team.length === 0 ? (
                <div className="px-3 py-4 text-[12px]" style={{ color: DS.textFaint }}>
                  No teammates resolved.
                </div>
              ) : (
                team.map((a) => {
                  const tone = AGENT_STATUS_TONE[a.status] ?? "muted";
                  const current =
                    (a.metadata as Record<string, unknown> | null)?.currentTask;
                  return (
                    <div key={a.id} className="flex items-center gap-3 px-3 py-2.5" style={{ borderColor: DS.border }}>
                      <StatusDot tone={tone} pulse={a.status === "running"} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium" style={{ color: DS.text }}>
                            {a.name}
                          </span>
                          <span className="text-[11px]" style={{ color: DS.textFaint }}>
                            {a.title ?? a.role}
                          </span>
                        </div>
                        <div className="truncate text-[11px]" style={{ color: DS.textMuted }}>
                          {typeof current === "string" && current.length > 0
                            ? current
                            : `${a.status}${a.lastHeartbeatAt ? ` · ${relativeTime(String(a.lastHeartbeatAt))}` : ""}`}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
              <GitBranch className="h-3.5 w-3.5" /> Dependencies
            </div>
            <div
              className="rounded-[14px] px-3 py-3 text-[12px]"
              style={{ border: `1px dashed ${DS.border2}`, color: DS.textFaint }}
            >
              No dependencies recorded. The blocks / blocked-by graph
              (<code style={{ fontFamily: MONO }}>team_task_dependencies</code>) is
              wired into the data model and renders here once the leader records edges.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssignmentCard({
  row,
  worker,
  selected,
  onSelect,
}: {
  row: JarvisDelegationRow;
  worker: Agent | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const verdict = workerStatusOf(row);
  const presentation = verdict ? presentWorkerStatus(verdict) : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        ...surfaceCard,
        borderRadius: 12,
        outline: selected ? `2px solid ${DS.primary}` : "none",
      }}
      className="w-full p-3 text-left transition-transform hover:-translate-y-px"
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="truncate text-[12px] font-semibold" style={{ color: DS.text }}>
          {worker?.name ?? row.agent}
        </span>
        {presentation ? (
          <Chip label={presentation.label} tone={presentation.tone} title={presentation.hint} />
        ) : (
          <Chip label="verdict pending" tone="muted" title="Worker has not reported a typed status yet." />
        )}
      </div>
      <div
        className="line-clamp-3 text-[12px] leading-snug"
        style={{ color: DS.textMuted }}
      >
        {row.task}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px]" style={{ color: DS.textFaint, fontFamily: MONO }}>
        <span>{relativeTime(row.createdAt)}</span>
        {row.completedAt ? <span>· done {relativeTime(row.completedAt)}</span> : null}
      </div>
    </button>
  );
}

function DirectedMessages({
  row,
  leaderName,
  workerName,
}: {
  row: JarvisDelegationRow | null;
  leaderName: string;
  workerName: string | null;
}) {
  if (!row) {
    return (
      <div
        className="rounded-[14px] px-4 py-6 text-center text-[12px]"
        style={{ border: `1px dashed ${DS.border2}`, color: DS.textFaint }}
      >
        Select an assignment to read the directed thread — the leader's task down
        and the worker's result back up.
      </div>
    );
  }
  return (
    <div style={surfaceCard} className="flex flex-col gap-3 p-4">
      {/* Leader → worker */}
      <Bubble
        author={leaderName}
        role="Leader → worker"
        color={DS.primary}
        body={row.task}
      />
      {/* Worker → leader */}
      {row.result ? (
        <Bubble
          author={workerName ?? row.agent}
          role="Worker → leader"
          color={DS.success}
          body={row.result}
        />
      ) : (
        <div className="text-[11px]" style={{ color: DS.textFaint }}>
          {workerName ?? row.agent} has not reported a result yet
          {row.status === "queued" || row.status === "running" ? " (in flight)." : "."}
        </div>
      )}
    </div>
  );
}

function Bubble({
  author,
  role,
  color,
  body,
}: {
  author: string;
  role: string;
  color: string;
  body: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[12px] font-semibold" style={{ color }}>
          {author}
        </span>
        <span className="text-[10px] uppercase tracking-wide" style={{ color: DS.textFaint }}>
          {role}
        </span>
      </div>
      <div
        className="whitespace-pre-wrap rounded-[12px] px-3 py-2 text-[12px] leading-relaxed"
        style={{ background: DS.surface3, border: `1px solid ${DS.border}`, color: DS.text }}
      >
        {body}
      </div>
    </div>
  );
}

function EmptyBoard() {
  return (
    <div
      style={surfaceCard}
      className="flex flex-col items-center gap-2 px-6 py-12 text-center"
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: DS.surface3, border: `1px solid ${DS.border2}` }}
      >
        <Inbox className="h-5 w-5" style={{ color: DS.textMuted }} />
      </span>
      <div className="text-[14px] font-semibold" style={{ color: DS.text }}>
        No assignments in flight
      </div>
      <p className="max-w-[420px] text-[12px]" style={{ color: DS.textMuted }}>
        When Hermes proposes a plan and you approve it, Ares directs each step to a
        teammate — those directed assignments appear here with live status, pulled
        from the real dispatch ledger. Nothing is shown until there's real work.
      </p>
    </div>
  );
}
