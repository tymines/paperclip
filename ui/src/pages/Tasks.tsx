import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleDot,
  Plus,
  Repeat,
  Target,
  AlertTriangle,
  MailQuestion,
} from "lucide-react";
import type { Goal, Issue, RoutineListItem } from "@paperclipai/shared";
import { INBOX_MINE_ISSUE_STATUS_FILTER } from "@paperclipai/shared";

import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import { routinesApi } from "../api/routines";
import { goalsApi } from "../api/goals";
import { approvalsApi } from "../api/approvals";
import { accessApi } from "../api/access";
import { ApiError } from "../api/client";

import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useDialogActions } from "../context/DialogContext";
import { useIssueNoun } from "../hooks/useIssueNoun";
import { queryKeys } from "../lib/queryKeys";
import { collectLiveIssueIds } from "../lib/liveIssueIds";
import { createIssueDetailLocationState } from "../lib/issueDetailBreadcrumb";
import { relativeTime } from "../lib/utils";

import { IssuesList } from "../components/IssuesList";
import { IntentBox } from "../components/IntentBox";
import { DraftPlanReview } from "../components/DraftPlanReview";
import { TasksKanban } from "../components/TasksKanban";
import { EmptyState } from "../components/EmptyState";
import { LayoutGrid, List } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { PriorityIcon } from "../components/PriorityIcon";
import { PageSkeleton } from "../components/PageSkeleton";

/* -------------------------------------------------------------------------- */
/* Paperclip Design System v1.0 tokens.                                       */
/* Mirrors the locked palette used by the Home / War Room / Fleet / Costs /   */
/* Studio / App Dev redesigns. Defined inline (not via global theme vars) so  */
/* this surface stays self-consistent without mutating shared CSS tokens.     */
/* -------------------------------------------------------------------------- */
const DS = {
  canvas: "#06090F",
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  border3: "#314158",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF", // blue — used ONLY for the active/selected state
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
  automation: "#A56EFF",
  analytics: "#31D9FF",
} as const;

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

/* -------------------------------------------------------------------------- */
/* Lens model — the three legacy surfaces folded into one filter set.         */
/*   States    (from the Tasks tracker):   all/backlog/active/blocked/        */
/*                                          in_review/done                     */
/*   Attention (from the Action Queue):     mine/unread/requests/failed        */
/*   Type      (from Work groupings):       routines/goals                     */
/* A single lens is active at a time; "all" is the default.                   */
/* -------------------------------------------------------------------------- */
type Lens =
  | "all"
  | "backlog"
  | "active"
  | "blocked"
  | "in_review"
  | "done"
  | "mine"
  | "unread"
  | "requests"
  | "failed"
  | "routines"
  | "goals";

const ISSUE_LENSES: ReadonlySet<Lens> = new Set<Lens>([
  "all",
  "backlog",
  "active",
  "blocked",
  "in_review",
  "done",
  "mine",
  "unread",
]);

// Tracker-state lens -> the issue statuses it admits. `all` is unfiltered.
const STATE_STATUS_SETS: Partial<Record<Lens, ReadonlySet<string>>> = {
  backlog: new Set(["backlog"]),
  active: new Set(["todo", "in_progress"]),
  blocked: new Set(["blocked"]),
  in_review: new Set(["in_review"]),
  done: new Set(["done", "cancelled"]),
};

const FAILED_RUN_STATUSES = new Set(["failed", "timed_out"]);
const ACTIONABLE_APPROVAL_STATUSES = new Set(["pending", "revision_requested"]);

interface LensDef {
  id: Lens;
  label: string;
}

interface LensGroup {
  label: string;
  lenses: LensDef[];
}

const LENS_GROUPS: LensGroup[] = [
  {
    label: "States",
    lenses: [
      { id: "all", label: "All" },
      { id: "backlog", label: "Backlog" },
      { id: "active", label: "Active" },
      { id: "blocked", label: "Blocked" },
      { id: "in_review", label: "In Review" },
      { id: "done", label: "Done" },
    ],
  },
  {
    label: "Attention",
    lenses: [
      { id: "mine", label: "Mine" },
      { id: "unread", label: "Unread" },
      { id: "requests", label: "Requests" },
      { id: "failed", label: "Failed runs" },
    ],
  },
  {
    label: "Type",
    lenses: [
      { id: "routines", label: "Routines" },
      { id: "goals", label: "Goals" },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Small presentational helpers                                               */
/* -------------------------------------------------------------------------- */
function FilterChip({
  label,
  count,
  active,
  tone = "default",
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  const dangerActive = tone === "danger" && (count ?? 0) > 0;
  const accent = dangerActive ? DS.critical : DS.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-medium transition-colors"
      style={{
        color: active ? accent : DS.textMuted,
        background: active ? `${accent}1F` : "transparent",
        border: `1px solid ${active ? `${accent}59` : "transparent"}`,
      }}
    >
      <span className="whitespace-nowrap">{label}</span>
      {count !== undefined ? (
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: active ? accent : DS.textFaint }}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="shrink-0 select-none text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: DS.textFaint }}
    >
      {children}
    </span>
  );
}

function NonIssueRow({
  href,
  external,
  icon,
  title,
  meta,
  right,
}: {
  href: string;
  external?: boolean;
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
  right?: ReactNode;
}) {
  const inner = (
    <div
      className="flex items-center gap-3 px-4 py-3 transition-colors"
      style={{ borderBottom: `1px solid ${DS.border}` }}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ background: DS.surface3, color: DS.textMuted }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]" style={{ color: DS.text }}>
          {title}
        </span>
        {meta ? (
          <span className="mt-0.5 block truncate text-[11px]" style={{ color: DS.textFaint }}>
            {meta}
          </span>
        ) : null}
      </span>
      {right ? <span className="shrink-0">{right}</span> : null}
    </div>
  );
  if (external) {
    return (
      <a href={href} className="block no-underline hover:brightness-110">
        {inner}
      </a>
    );
  }
  return (
    <Link to={href} className="block no-underline hover:brightness-110">
      {inner}
    </Link>
  );
}

function ThemedEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-[12px]"
        style={{ background: DS.surface3, color: DS.textFaint }}
      >
        <CircleDot className="h-6 w-6" />
      </div>
      <p className="text-[13px]" style={{ color: DS.textMuted }}>
        {message}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Unified Tasks page                                                         */
/* -------------------------------------------------------------------------- */
export function Tasks() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { openNewIssue } = useDialogActions();
  const issueNoun = useIssueNoun();
  const queryClient = useQueryClient();

  const [lens, setLens] = useState<Lens>("all");
  const [activePlan, setActivePlan] = useState<{
    roomId: string;
    planTitle: string;
    planText: string;
    steps: { label: string; duration?: string }[];
  } | null>(null);
  const [showKanban, setShowKanban] = useState(false);
  const [projectizeResult, setProjectizeResult] = useState<{
    goalId: string;
    projectId: string;
    issueIds: string[];
  } | null>(null);
  const navigate = useNavigate();

  const handlePlanReady = (
    roomId: string,
    planTitle: string,
    planText: string,
    steps: { label: string; duration?: string }[],
  ) => {
    setActivePlan({ roomId, planTitle, planText, steps });
  };

  const handlePlanApproved = (result: {
    goalId: string;
    projectId: string;
    issueIds: string[];
  }) => {
    setProjectizeResult(result);
    setShowKanban(true);
    setActivePlan(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.goals.list(selectedCompanyId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(selectedCompanyId!) });
  };

  const handlePlanRejected = (note: string) => {
    setActivePlan(null);
  };

  const toggleView = () => {
    setShowKanban((prev) => !prev);
  };

  useEffect(() => {
    setBreadcrumbs([{ label: "Tasks" }]);
    try {
      const savedView = sessionStorage.getItem("paperclip:tasks:view");
      if (savedView === "kanban" && !showKanban) {
        setShowKanban(true);
        sessionStorage.removeItem("paperclip:tasks:view");
      }
    } catch {}
  }, [setBreadcrumbs]);

  /* ------------------------------ data wiring ----------------------------- */
  // Real data from the same APIs the three legacy pages used. No fabricated rows.

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const liveRunsQuery = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 5000,
  });
  const liveIssueIds = useMemo(
    () => collectLiveIssueIds(liveRunsQuery.data),
    [liveRunsQuery.data],
  );

  // Main task list (Tasks page parity): everything, incl. routine executions.
  const issuesQuery = useQuery({
    queryKey: [
      ...queryKeys.issues.list(selectedCompanyId!),
      "tasks-unified",
      "with-routine-executions",
    ],
    queryFn: () =>
      issuesApi.list(selectedCompanyId!, {
        includeRoutineExecutions: true,
        limit: 500,
      }),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
  const allIssues = useMemo(() => issuesQuery.data ?? [], [issuesQuery.data]);

  // "Mine" — Action Queue parity (touched by me, not inbox-archived by me).
  const mineQuery = useQuery({
    queryKey: [
      ...queryKeys.issues.listMineByMe(selectedCompanyId!),
      "tasks-unified",
    ],
    queryFn: () =>
      issuesApi.list(selectedCompanyId!, {
        touchedByUserId: "me",
        inboxArchivedByUserId: "me",
        status: INBOX_MINE_ISSUE_STATUS_FILTER,
        includeRoutineExecutions: true,
        limit: 500,
      }),
    enabled: !!selectedCompanyId && (lens === "mine"),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  // "Unread" — derived from touched-by-me, filtered to unread.
  const touchedQuery = useQuery({
    queryKey: [
      ...queryKeys.issues.listTouchedByMe(selectedCompanyId!),
      "tasks-unified",
    ],
    queryFn: () =>
      issuesApi.list(selectedCompanyId!, {
        touchedByUserId: "me",
        status: INBOX_MINE_ISSUE_STATUS_FILTER,
        includeRoutineExecutions: true,
        limit: 500,
      }),
    enabled: !!selectedCompanyId && lens === "unread",
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
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

  const approvalsQuery = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const joinRequestsQuery = useQuery({
    queryKey: queryKeys.access.joinRequests(selectedCompanyId!),
    queryFn: async () => {
      try {
        return await accessApi.listJoinRequests(selectedCompanyId!, "pending_approval");
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) return [];
        throw err;
      }
    },
    enabled: !!selectedCompanyId,
    retry: false,
  });

  const heartbeatsQuery = useQuery({
    queryKey: [...queryKeys.heartbeats(selectedCompanyId!), "tasks-unified", 200],
    queryFn: () => heartbeatsApi.list(selectedCompanyId!, undefined, 200),
    enabled: !!selectedCompanyId,
  });

  /* ------------------------------ derived sets ---------------------------- */
  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agentsQuery.data ?? []) map.set(a.id, a.name);
    return map;
  }, [agentsQuery.data]);

  const failedRuns = useMemo(() => {
    const runs = (heartbeatsQuery.data ?? []).filter((r) => FAILED_RUN_STATUSES.has(r.status as string));
    // latest failed run per agent
    const latest = new Map<string, (typeof runs)[number]>();
    for (const run of runs) {
      const prev = latest.get(run.agentId);
      const t = new Date(run.startedAt ?? run.finishedAt ?? 0).getTime();
      const pt = prev ? new Date(prev.startedAt ?? prev.finishedAt ?? 0).getTime() : -1;
      if (!prev || t > pt) latest.set(run.agentId, run);
    }
    return [...latest.values()];
  }, [heartbeatsQuery.data]);

  const actionableApprovals = useMemo(
    () => (approvalsQuery.data ?? []).filter((a) => ACTIONABLE_APPROVAL_STATUSES.has(a.status as string)),
    [approvalsQuery.data],
  );
  const joinRequests = joinRequestsQuery.data ?? [];
  const requestsCount = actionableApprovals.length + joinRequests.length;

  const routines = routinesQuery.data ?? [];
  const activeGoals = useMemo(
    () => (goalsQuery.data ?? []).filter((g) => g.status !== "achieved" && g.status !== "cancelled"),
    [goalsQuery.data],
  );

  // Per-state counts from the main list.
  const stateCounts = useMemo(() => {
    const c: Record<string, number> = {
      all: allIssues.length,
      backlog: 0,
      active: 0,
      blocked: 0,
      in_review: 0,
      done: 0,
    };
    for (const iss of allIssues) {
      if (STATE_STATUS_SETS.backlog!.has(iss.status)) c.backlog += 1;
      if (STATE_STATUS_SETS.active!.has(iss.status)) c.active += 1;
      if (STATE_STATUS_SETS.blocked!.has(iss.status)) c.blocked += 1;
      if (STATE_STATUS_SETS.in_review!.has(iss.status)) c.in_review += 1;
      if (STATE_STATUS_SETS.done!.has(iss.status)) c.done += 1;
    }
    return c;
  }, [allIssues]);

  const unreadIssues = useMemo(
    () => (touchedQuery.data ?? []).filter((iss) => (iss as Issue & { isUnreadForMe?: boolean }).isUnreadForMe),
    [touchedQuery.data],
  );

  const countFor = (id: Lens): number | undefined => {
    switch (id) {
      case "all":
      case "backlog":
      case "active":
      case "blocked":
      case "in_review":
      case "done":
        return stateCounts[id];
      case "mine":
        return mineQuery.data?.length;
      case "unread":
        return touchedQuery.data ? unreadIssues.length : undefined;
      case "requests":
        return requestsCount;
      case "failed":
        return failedRuns.length;
      case "routines":
        return routines.length;
      case "goals":
        return activeGoals.length;
      default:
        return undefined;
    }
  };

  /* --------------------------- issue list for lens ------------------------ */
  const issueLinkState = useMemo(
    () => createIssueDetailLocationState("Tasks", `/issues`, "issues"),
    [],
  );

  const issuesForLens = useMemo<Issue[]>(() => {
    if (lens === "mine") return mineQuery.data ?? [];
    if (lens === "unread") return unreadIssues;
    const statusSet = STATE_STATUS_SETS[lens];
    if (!statusSet) return allIssues; // "all"
    return allIssues.filter((iss) => statusSet.has(iss.status));
  }, [lens, allIssues, mineQuery.data, unreadIssues]);

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listMineByMe(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId!) });
    },
  });

  /* -------------------------------- guards -------------------------------- */
  if (!selectedCompanyId) {
    return (
      <div style={{ background: DS.canvas }} className="min-h-full">
        <EmptyState icon={CircleDot} message="Select a company to view tasks." />
      </div>
    );
  }

  const isIssueLens = ISSUE_LENSES.has(lens);
  const issueLensLoading =
    (lens === "mine" && mineQuery.isLoading) ||
    (lens === "unread" && touchedQuery.isLoading) ||
    (isIssueLens && lens !== "mine" && lens !== "unread" && issuesQuery.isLoading);

  /* -------------------------------- render -------------------------------- */
  return (
    <div className="flex min-h-full flex-col" style={{ background: DS.canvas, color: DS.text }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-5 md:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em]" style={{ color: DS.text }}>
            Tasks
          </h1>
          <span className="font-mono text-[13px] tabular-nums" style={{ color: DS.textFaint }}>
            {allIssues.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => openNewIssue()}
          className="flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-opacity hover:opacity-90"
          style={{ background: DS.primary, color: "#FFFFFF" }}
          data-pp-new-task="true"
        >
          <Plus className="h-4 w-4" />
          <span>New {issueNoun.capSingular}</span>
        </button>
      </div>

      {/* Unified filter bar — scroll horizontally on mobile, wrap on desktop */}
      <div
        className="mt-4 flex items-center gap-x-3 gap-y-2 overflow-x-auto px-4 pb-4 flex-nowrap md:flex-wrap md:px-6"
        style={{ borderBottom: `1px solid ${DS.border}` }}
      >
        {LENS_GROUPS.map((group, gi) => (
          <div key={group.label} className="flex items-center gap-2">
            {gi > 0 ? (
              <span aria-hidden className="mx-1 h-4 w-px self-center" style={{ background: DS.border2 }} />
            ) : null}
            <GroupLabel>{group.label}</GroupLabel>
            <div className="flex items-center gap-1">
              {group.lenses.map((l) => (
                <FilterChip
                  key={l.id}
                  label={l.label}
                  count={countFor(l.id)}
                  active={lens === l.id}
                  tone={l.id === "failed" || l.id === "blocked" ? "danger" : "default"}
                  onClick={() => setLens(l.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Zone 1: Intent Box */}
      {selectedCompanyId && (
        <div className="px-4 pb-4 md:px-6">
          <IntentBox companyId={selectedCompanyId} onPlanReady={handlePlanReady} />
        </div>
      )}

      {/* Zone 2: Draft Plan Review */}
      {activePlan && (
        <div className="px-4 pb-4 md:px-6">
          <DraftPlanReview
            companyId={selectedCompanyId!}
            planTitle={activePlan.planTitle}
            planText={activePlan.planText}
            steps={activePlan.steps}
            onPlanApproved={handlePlanApproved}
            onPlanRejected={handlePlanRejected}
            onCancel={() => setActivePlan(null)}
          />
        </div>
      )}

      {/* Zone 3 Toggle */}
      <div className="flex items-center justify-between px-4 pb-2 md:px-6">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: DS.textFaint }}>
          {showKanban ? "Kanban Board" : isIssueLens ? (lens === "all" ? "All Issues" : lens.charAt(0).toUpperCase() + lens.slice(1).replace(/_/g, " ")) : ""}
        </span>
        <button
          onClick={toggleView}
          className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium transition-colors"
          style={{ background: DS.surface3, border: "1px solid " + DS.border, color: DS.textMuted }}
        >
          {showKanban ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
          <span>{showKanban ? "List View" : "Board View"}</span>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 py-4 md:px-6">
        {showKanban ? (
          <TasksKanban
            issues={issuesForLens}
            approvals={approvalsQuery.data}
            onIssueClick={(id) => {
              try { sessionStorage.setItem("paperclip:tasks:view", "kanban"); } catch {}
              navigate("/issues/" + id, { state: issueLinkState });
            }}
            onStatusChange={(id, status) => updateIssue.mutate({ id, data: { status } })}
          />
        ) : (
          <>
          {isIssueLens ? (
          issueLensLoading ? (
            <PageSkeleton variant="list" />
          ) : issuesForLens.length === 0 ? (
            <ThemedEmpty
              message={
                lens === "all"
                  ? `No ${issueNoun.plural} yet. Create one to get started.`
                  : lens === "mine"
                    ? "Nothing assigned to or touched by you."
                    : lens === "unread"
                      ? "No unread updates."
                      : `No ${issueNoun.plural} in this state.`
              }
            />
          ) : (
            <IssuesList
              issues={issuesForLens}
              isLoading={false}
              error={issuesQuery.error as Error | null}
              agents={agentsQuery.data}
              projects={projectsQuery.data}
              liveIssueIds={liveIssueIds}
              viewStateKey={`paperclip:tasks-unified:${lens}`}
              issueLinkState={issueLinkState}
              searchWithinLoadedIssues
              enableRoutineVisibilityFilter
              onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
            />
          )
        ) : (
          <div className="overflow-hidden" style={surfaceCard}>
            {renderNonIssueLens()}
          </div>
        )}
      </>
    )}
  </div>
    </div>
  );

  /* --------------------------- non-issue renderers ------------------------ */
  function renderNonIssueLens() {
    if (lens === "routines") {
      if (routinesQuery.isLoading) return <div className="p-4"><PageSkeleton variant="list" /></div>;
      if (routines.length === 0) return <ThemedEmpty message="No routines configured." />;
      return (
        <ul>
          {routines.map((r: RoutineListItem) => {
            const cron = r.triggers.find((t) => t.cronExpression)?.cronExpression ?? null;
            return (
              <li key={r.id}>
                <NonIssueRow
                  href={`/routines/${r.id}`}
                  icon={<Repeat className="h-4 w-4" />}
                  title={r.title}
                  meta={cron ? `Schedule · ${cron}` : "Routine"}
                  right={<StatusBadge status={r.status} />}
                />
              </li>
            );
          })}
        </ul>
      );
    }

    if (lens === "goals") {
      if (goalsQuery.isLoading) return <div className="p-4"><PageSkeleton variant="list" /></div>;
      if (activeGoals.length === 0) return <ThemedEmpty message="No active goals." />;
      return (
        <ul>
          {activeGoals.map((g: Goal) => (
            <li key={g.id}>
              <NonIssueRow
                href={`/goals/${g.id}`}
                icon={<Target className="h-4 w-4" />}
                title={g.title}
                meta={`Updated ${relativeTime(new Date(g.updatedAt))}`}
                right={<StatusBadge status={g.status} />}
              />
            </li>
          ))}
        </ul>
      );
    }

    if (lens === "requests") {
      const loading = approvalsQuery.isLoading || joinRequestsQuery.isLoading;
      if (loading) return <div className="p-4"><PageSkeleton variant="list" /></div>;
      if (requestsCount === 0) return <ThemedEmpty message="No pending requests." />;
      return (
        <ul>
          {actionableApprovals.map((a) => (
            <li key={`approval:${a.id}`}>
              <NonIssueRow
                href={`/approvals/${a.id}`}
                icon={<MailQuestion className="h-4 w-4" />}
                title={String((a.payload?.summary as string | undefined) ?? (a.payload?.title as string | undefined) ?? a.type.replace(/_/g, " "))}
                meta={`Approval · ${a.type.replace(/_/g, " ")}`}
                right={<StatusBadge status={a.status} />}
              />
            </li>
          ))}
          {joinRequests.map((jr) => (
            <li key={`join:${(jr as { id?: string }).id ?? Math.random()}`}>
              <NonIssueRow
                href="/company/settings/access"
                icon={<MailQuestion className="h-4 w-4" />}
                title={String(
                  (jr as { displayName?: string; name?: string; email?: string }).displayName ??
                    (jr as { name?: string }).name ??
                    (jr as { email?: string }).email ??
                    "Join request",
                )}
                meta="Join request · pending approval"
                right={<StatusBadge status="pending" />}
              />
            </li>
          ))}
        </ul>
      );
    }

    if (lens === "failed") {
      if (heartbeatsQuery.isLoading) return <div className="p-4"><PageSkeleton variant="list" /></div>;
      if (failedRuns.length === 0) return <ThemedEmpty message="No failed runs. Fleet is healthy." />;
      return (
        <ul>
          {failedRuns.map((run) => (
            <li key={run.id}>
              <NonIssueRow
                href={`/agents/${run.agentId}/runs/${run.id}`}
                icon={<AlertTriangle className="h-4 w-4" style={{ color: DS.critical }} />}
                title={agentNameById.get(run.agentId) ?? `Agent ${run.agentId.slice(0, 8)}`}
                meta={run.error ? String(run.error).slice(0, 120) : `Run ${run.status}`}
                right={
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                    style={{ background: `${DS.critical}1F`, color: DS.critical }}
                  >
                    {String(run.status).replace(/_/g, " ")}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      );
    }

    return <ThemedEmpty message="Nothing here." />;
  }
}