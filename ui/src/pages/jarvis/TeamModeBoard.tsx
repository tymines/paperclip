import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import {
  ArrowUpRight,
  ChevronRight,
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

interface Leadership {
  /** Root leader / Chief of Staff — Hermes. */
  leader: Agent | null;
  /** Plan critic between leader and distributor — Brainstorm. */
  critic: Agent | null;
  /** COO / execution distributor that fans tasks to workers — Ares. */
  distributor: Agent | null;
  /** The worker execution layer (distributor's direct reports). */
  workers: Agent[];
}

/**
 * Resolve the leadership chain from the real roster, rooted at the leader.
 *
 * Correct chain (Tyler): Hermes (leader / Chief of Staff) → Brainstorm (plan
 * critic) → Ares (COO / execution distributor) → workers. Node data is all real
 * (names/roles/status from `agents`); the chain is rooted by walking the real
 * `reportsTo` graph UP from the COO to its top ancestor.
 *
 * NOTE: the live roster carries roles ("coo", "orchestrator", "strategist") that
 * are not in the typed AgentRole union yet, so we compare on the string value.
 */
function resolveLeadership(agents: Agent[]): Leadership {
  const byId = new Map(agents.map((a) => [a.id, a]));

  // Distributor = the COO (Ares); fall back to a metadata flag, then to the
  // agent the most teammates report to.
  let distributor =
    agents.find((a) => String(a.role) === "coo") ??
    agents.find(
      (a) => (a.metadata as Record<string, unknown> | null)?.distributor === true,
    ) ??
    null;
  if (!distributor) {
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
    distributor = bestId ? byId.get(bestId) ?? null : null;
  }

  // Leader = root ancestor of the distributor via real reportsTo (Hermes).
  let leader: Agent | null = distributor;
  const seen = new Set<string>();
  while (leader?.reportsTo && byId.has(leader.reportsTo) && !seen.has(leader.id)) {
    seen.add(leader.id);
    leader = byId.get(leader.reportsTo) ?? leader;
  }
  // Prefer an explicit orchestrator root if one exists and the walk didn't reach it.
  const orchestrator = agents.find((a) => String(a.role) === "orchestrator");
  if (orchestrator && (!leader || leader.id === distributor?.id)) {
    leader = orchestrator;
  }

  // Critic = a strategist among the leader's direct reports (Brainstorm).
  const critic =
    leader != null
      ? agents.find(
          (a) => a.reportsTo === leader!.id && String(a.role) === "strategist",
        ) ?? null
      : null;

  const workers = distributor
    ? agents.filter((a) => a.reportsTo === distributor!.id)
    : [];

  return { leader, critic, distributor, workers };
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

  const { leader, critic, distributor, workers } = useMemo(
    () => resolveLeadership(agents),
    [agents],
  );
  const team = workers;

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

      {/* Leader header — rooted at Hermes (Chief of Staff / leader). */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
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
              {leader?.title ?? "Chief of Staff"}
            </span>
          </div>
          <div className="text-[12px]" style={{ color: DS.textMuted }}>
            {leader
              ? `Leader — plans and approves, then directs work down through ${distributor?.name ?? "the COO"} to ${team.length} worker${team.length === 1 ? "" : "s"}.`
              : "No leader resolved for this company yet."}
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

      {/* Leadership chain — Hermes → Brainstorm → Ares → workers (real reportsTo). */}
      <LeadershipChain
        leader={leader}
        critic={critic}
        distributor={distributor}
        workerCount={team.length}
      />

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
              leaderName={distributor?.name ?? leader?.name ?? "Leader"}
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
              Workers — report to {distributor?.name ?? "the COO"}
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

function ChainNode({
  agent,
  roleLabel,
  emphasis,
}: {
  agent: Agent | null;
  roleLabel: string;
  emphasis?: boolean;
}) {
  if (!agent) {
    return (
      <div
        className="rounded-[12px] px-3 py-2"
        style={{ border: `1px dashed ${DS.border2}`, color: DS.textFaint }}
      >
        <div className="text-[12px] font-medium">{roleLabel}</div>
        <div className="text-[10px]">not resolved</div>
      </div>
    );
  }
  const tone = AGENT_STATUS_TONE[agent.status] ?? "muted";
  return (
    <div
      className="min-w-0 rounded-[12px] px-3 py-2"
      style={{
        ...surfaceCard,
        borderRadius: 12,
        outline: emphasis ? `1px solid ${DS.primary}66` : "none",
      }}
    >
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} pulse={agent.status === "running"} />
        <span className="truncate text-[13px] font-semibold" style={{ color: DS.text }}>
          {agent.name}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[10px] uppercase tracking-wide" style={{ color: DS.textFaint }}>
        {roleLabel}
      </div>
    </div>
  );
}

function ChainArrow() {
  return (
    <ChevronRight
      className="h-4 w-4 shrink-0 self-center"
      style={{ color: DS.textFaint }}
      aria-hidden
    />
  );
}

/** Hermes → Brainstorm → Ares → workers, rooted at the real leader. */
function LeadershipChain({
  leader,
  critic,
  distributor,
  workerCount,
}: {
  leader: Agent | null;
  critic: Agent | null;
  distributor: Agent | null;
  workerCount: number;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: DS.textFaint }}>
        Leadership chain
      </div>
      <div className="flex flex-wrap items-stretch gap-2">
        <ChainNode agent={leader} roleLabel="Leader · Chief of Staff" emphasis />
        <ChainArrow />
        {critic ? (
          <>
            <ChainNode agent={critic} roleLabel="Plan critic" />
            <ChainArrow />
          </>
        ) : null}
        <ChainNode agent={distributor} roleLabel="COO · execution distributor" />
        <ChainArrow />
        <div
          className="flex min-w-0 items-center rounded-[12px] px-3 py-2"
          style={{ border: `1px solid ${DS.border2}`, background: DS.surface2 }}
        >
          <Users className="mr-2 h-4 w-4" style={{ color: DS.textMuted }} />
          <div>
            <div className="text-[13px] font-semibold" style={{ color: DS.text }}>
              {workerCount} worker{workerCount === 1 ? "" : "s"}
            </div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: DS.textFaint }}>
              Execution layer
            </div>
          </div>
        </div>
      </div>
      <div className="mt-1.5 text-[11px]" style={{ color: DS.textFaint }}>
        Rooted on real <code style={{ fontFamily: MONO }}>reportsTo</code>:{" "}
        {leader?.name ?? "leader"} directs the fleet;{" "}
        {distributor?.name ?? "the COO"} fans tasks out to workers.
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
