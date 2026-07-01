import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  ListChecks,
  Mic,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { goalsApi } from "../api/goals";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { approvalsApi } from "../api/approvals";
import { costsApi } from "../api/costs";
import { activityApi } from "../api/activity";
import { jarvisApi } from "../api/jarvis";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useDialogActions } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";
import { GoalTree } from "../components/GoalTree";
import { ActivityRow } from "../components/ActivityRow";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "../components/StatusBadge";
import { relativeTime } from "../lib/utils";
import { Target } from "lucide-react";
import type { Agent, Approval, ApprovalType, Issue } from "@paperclipai/shared";

/* -------------------------------------------------------------------------- */
/* Paperclip Design System v1.0 tokens (locked)                               */
/* Applied locally to the Home cockpit so the redesign is self-contained and  */
/* does not mutate global theme variables used by other pages.                */
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
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
  automation: "#A56EFF",
  analytics: "#31D9FF",
} as const;

// Decorative per-agent ring hues (styling only — not data).
const RING_HUES = [
  DS.primary,
  DS.automation,
  DS.success,
  DS.analytics,
  DS.warning,
  DS.critical,
  "#7C5CFF",
  "#22B8CF",
];

const ISSUE_PRIORITY_WEIGHT: Record<Issue["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// Issues actively being worked or reviewed = "in flight".
const IN_FLIGHT_STATUSES = new Set<Issue["status"]>(["in_progress", "in_review"]);
// Items that need Tyler's attention.
const WAITING_ISSUE_STATUSES = new Set<Issue["status"]>(["blocked", "in_review"]);

// Operational = not parked/broken. Mirrors the fleet strip's notion of "active".
function isAgentOperational(agent: Agent): boolean {
  return !["paused", "error", "terminated", "pending_approval"].includes(
    agent.status as string,
  );
}

function agentStatusColor(agent: Agent): string {
  switch (agent.status) {
    case "active":
      return DS.success;
    case "paused":
      return DS.warning;
    case "error":
      return DS.critical;
    default:
      return DS.textFaint;
  }
}

function agentStatusLabel(agent: Agent): string {
  switch (agent.status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "error":
      return "Error";
    case "terminated":
      return "Off";
    case "pending_approval":
      return "Pending";
    default:
      return "Idle";
  }
}

const APPROVAL_LABEL: Record<ApprovalType, string> = {
  hire_agent: "Hire agent",
  approve_ceo_strategy: "Approve CEO strategy",
  budget_override_required: "Budget override",
  request_board_approval: "Board approval",
  goal_plan: "Goal plan",
  goal_completion: "Goal completion",
  task_completion: "Task completion",
};

function approvalLabel(type: ApprovalType): string {
  return APPROVAL_LABEL[type] ?? "Approval";
}

function approvalSubtitle(approval: Approval): string | null {
  const p = approval.payload ?? {};
  const candidate =
    (p.summary as string | undefined) ??
    (p.title as string | undefined) ??
    (p.description as string | undefined) ??
    (p.reason as string | undefined) ??
    (p.agentName as string | undefined) ??
    null;
  if (!candidate || typeof candidate !== "string") return null;
  return candidate.length > 90 ? `${candidate.slice(0, 90)}…` : candidate;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const surfaceCard: CSSProperties = {
  background: `linear-gradient(180deg, ${DS.surface2} 0%, ${DS.surface} 100%)`,
  border: `1px solid ${DS.border}`,
  borderRadius: 16,
  boxShadow: "0 1px 0 rgba(255,255,255,0.02), 0 8px 24px -16px rgba(0,0,0,0.8)",
};

/* -------------------------------------------------------------------------- */
/* Section label                                                              */
/* -------------------------------------------------------------------------- */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[13px] font-semibold uppercase tracking-[0.12em]"
      style={{ color: DS.textMuted }}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Fleet strip                                                                */
/* -------------------------------------------------------------------------- */
function FleetStrip({ companyId, companyPrefix }: { companyId: string; companyPrefix?: string }) {
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const list = useMemo(() => {
    const a = agents ?? [];
    return [...a].sort((x, y) => {
      const xo = isAgentOperational(x) ? 0 : 1;
      const yo = isAgentOperational(y) ? 0 : 1;
      if (xo !== yo) return xo - yo;
      return (y.spentMonthlyCents ?? 0) - (x.spentMonthlyCents ?? 0);
    });
  }, [agents]);

  const totalSpend = useMemo(
    () => (agents ?? []).reduce((sum, a) => sum + (a.spentMonthlyCents ?? 0), 0),
    [agents],
  );

  if (!agents) return null;

  return (
    <section style={surfaceCard} className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <SectionLabel>Your fleet</SectionLabel>
          <span className="text-[12px] font-medium" style={{ color: DS.textFaint }}>
            · {agents.length} agents · {formatUsd(totalSpend)} this month
          </span>
        </div>
        <Link
          to={companyPrefix ? `/${companyPrefix}/agents` : "/agents"}
          className="text-[12px] font-medium hover:underline"
          style={{ color: DS.primary }}
        >
          View fleet
        </Link>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-auto-hide">
        {list.map((agent, i) => {
          const ring = RING_HUES[i % RING_HUES.length];
          const icon = agent.icon ?? null;
          const isImg = !!icon && (icon.startsWith("http") || icon.startsWith("/"));
          const initial = (agent.name ?? "?").trim().charAt(0).toUpperCase();
          const role = agent.title ?? agent.role ?? "";
          const spent = agent.spentMonthlyCents ?? 0;
          return (
            <Link
              key={agent.id}
              to={companyPrefix ? `/${companyPrefix}/agents/${agent.id}` : `/agents/${agent.id}`}
              className="group flex w-[150px] shrink-0 flex-col gap-2.5 rounded-[14px] px-3.5 py-3 transition-colors"
              style={{ background: DS.surface3, border: `1px solid ${DS.border}` }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  style={{
                    color: DS.text,
                    background: DS.surface,
                    boxShadow: `0 0 0 2px ${ring}`,
                  }}
                >
                  {isImg ? (
                    <img src={icon!} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    initial
                  )}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold" style={{ color: DS.text }}>
                    {agent.name}
                  </div>
                  {role ? (
                    <div className="truncate text-[11px]" style={{ color: DS.textFaint }}>
                      {role}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[15px] tabular-nums" style={{ color: DS.text }}>
                  {formatUsd(spent)}
                </span>
                <span className="flex items-center gap-1.5 text-[11px]" style={{ color: DS.textMuted }}>
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: agentStatusColor(agent) }}
                  />
                  {agentStatusLabel(agent)}
                </span>
              </div>
            </Link>
          );
        })}
        <Link
          to={companyPrefix ? `/${companyPrefix}/agents/new` : "/agents/new"}
          className="flex w-[120px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[14px] text-[12px] transition-colors"
          style={{ border: `1px dashed ${DS.border3}`, color: DS.textFaint }}
        >
          <Plus className="h-4 w-4" />
          Add Agent
        </Link>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* KPI tile                                                                   */
/* -------------------------------------------------------------------------- */
function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  to,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Bot;
  accent: string;
  to?: string;
}) {
  const inner = (
    <div style={surfaceCard} className="flex h-full flex-col gap-2 p-5 transition-colors">
      <div className="flex items-center justify-between">
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.1em]"
          style={{ color: DS.textFaint }}
        >
          {label}
        </span>
        <Icon className="h-4 w-4" style={{ color: accent }} />
      </div>
      <span className="font-mono text-[30px] font-semibold leading-none tabular-nums" style={{ color: DS.text }}>
        {value}
      </span>
      {sub ? (
        <span className="text-[12px]" style={{ color: DS.textMuted }}>
          {sub}
        </span>
      ) : null}
    </div>
  );
  if (to) {
    return (
      <Link to={to} className="no-underline">
        {inner}
      </Link>
    );
  }
  return inner;
}

/* -------------------------------------------------------------------------- */
/* Talk to Zeus doorway                                                     */
/* -------------------------------------------------------------------------- */
function ZeusDoorway({ companyId, companyPrefix }: { companyId: string; companyPrefix?: string }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const warRoomUrl = companyPrefix ? `/${companyPrefix}/jarvis` : "/jarvis";

  const { data } = useQuery({
    queryKey: ["jarvis", "conversations", companyId, 1],
    queryFn: () => jarvisApi.conversations(companyId, 1),
    enabled: !!companyId,
  });
  const lastTurn = data?.conversations?.[0] ?? null;

  function openWarRoom() {
    navigate(warRoomUrl);
  }

  return (
    <section style={surfaceCard} className="flex flex-col p-5">
      <div className="mb-1 flex items-center gap-2">
        <SectionLabel>Talk to Zeus</SectionLabel>
      </div>
      <p className="mb-3 text-[12px]" style={{ color: DS.textFaint }}>
        Your top orchestrator. Delegate, ask, strategize.
      </p>

      <div
        className="flex items-center gap-2 rounded-[12px] px-3 py-2"
        style={{ background: DS.surface, border: `1px solid ${DS.border2}` }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") openWarRoom();
          }}
          placeholder="What should the fleet work on next?"
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          style={{ color: DS.text }}
          aria-label="Message Zeus"
        />
        <button
          type="button"
          onClick={openWarRoom}
          className="text-muted-foreground/70 transition-colors hover:text-foreground"
          aria-label="Voice"
          title="Open War Room to speak with Zeus"
        >
          <Mic className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={openWarRoom}
          className="flex h-8 w-8 items-center justify-center rounded-[10px] transition-opacity hover:opacity-90"
          style={{ background: DS.primary, color: "#fff" }}
          aria-label="Send to Zeus"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      {lastTurn ? (
        <div className="mt-4">
          <div
            className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em]"
            style={{ color: DS.textFaint }}
          >
            Last exchange
          </div>
          <div className="space-y-2">
            <div className="flex items-start gap-2.5">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ background: DS.surface3, color: DS.textMuted }}
              >
                You
              </span>
              <p className="text-[13px] leading-snug" style={{ color: DS.text }}>
                {lastTurn.userTranscript}
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ background: DS.primary, color: "#fff" }}
                title="Zeus"
              >
                H
              </span>
              <p className="line-clamp-3 text-[13px] leading-snug" style={{ color: DS.textMuted }}>
                {lastTurn.agentReply}
              </p>
            </div>
            <div className="pl-[34px] text-[11px]" style={{ color: DS.textFaint }}>
              {relativeTime(lastTurn.createdAt)}
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={openWarRoom}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-[12px] py-2.5 text-[13px] font-medium transition-colors"
        style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.text }}
      >
        Open War Room <ArrowRight className="h-3.5 w-3.5" style={{ color: DS.primary }} />
      </button>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Waiting on you                                                             */
/* -------------------------------------------------------------------------- */
type WaitingItem =
  | { kind: "approval"; id: string; approval: Approval }
  | { kind: "issue"; id: string; issue: Issue };

function WaitingOnYou({
  companyId,
  companyPrefix,
  onResolve,
}: {
  companyId: string;
  companyPrefix?: string;
  onResolve: () => void;
}) {
  const navigate = useNavigate();
  const prefix = companyPrefix ?? "PAP";

  const { data: approvals } = useQuery({
    queryKey: queryKeys.approvals.list(companyId, "pending"),
    queryFn: () => approvalsApi.list(companyId, "pending"),
    enabled: !!companyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(companyId),
    queryFn: () => issuesApi.list(companyId),
    enabled: !!companyId,
  });

  const waitingIssues = useMemo(() => {
    return (issues ?? [])
      .filter((i) => WAITING_ISSUE_STATUSES.has(i.status))
      .sort((a, b) => {
        const p = ISSUE_PRIORITY_WEIGHT[a.priority] - ISSUE_PRIORITY_WEIGHT[b.priority];
        if (p !== 0) return p;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [issues]);

  const items: WaitingItem[] = useMemo(() => {
    const a: WaitingItem[] = (approvals ?? []).map((ap) => ({
      kind: "approval" as const,
      id: ap.id,
      approval: ap,
    }));
    const i: WaitingItem[] = waitingIssues.map((iss) => ({
      kind: "issue" as const,
      id: iss.id,
      issue: iss,
    }));
    return [...a, ...i];
  }, [approvals, waitingIssues]);

  const visible = items.slice(0, 6);
  const total = items.length;

  function goToApproval(ap: Approval) {
    navigate(`/${prefix}/approvals/${ap.id}`);
  }
  function goToIssue(iss: Issue) {
    navigate(`/${prefix}/issues/${iss.identifier ?? iss.id}`);
  }

  return (
    <section style={surfaceCard} className="flex flex-col p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" style={{ color: DS.warning }} />
          <SectionLabel>Waiting on you</SectionLabel>
        </div>
        {total > 0 ? (
          <Button size="sm" onClick={onResolve} style={{ background: DS.warning, color: "#1a1300" }}>
            Resolve top blocker
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div
          className="flex items-center gap-2 rounded-[12px] p-5 text-[13px]"
          style={{ background: DS.surface, border: `1px solid ${DS.border}`, color: DS.textMuted }}
        >
          <CheckCircle2 className="h-4 w-4" style={{ color: DS.success }} />
          You&apos;re caught up. Nothing is waiting on you.
        </div>
      ) : (
        <ul className="flex flex-col">
          {visible.map((item, idx) => {
            const isLast = idx === visible.length - 1;
            const rowStyle: CSSProperties = {
              borderBottom: isLast ? "none" : `1px solid ${DS.border}`,
            };
            if (item.kind === "approval") {
              const ap = item.approval;
              const subtitle = approvalSubtitle(ap);
              return (
                <li key={`ap-${ap.id}`} style={rowStyle}>
                  <button
                    type="button"
                    onClick={() => goToApproval(ap)}
                    className="flex w-full items-center gap-3 py-3 text-left transition-colors"
                  >
                    <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: DS.automation }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium" style={{ color: DS.text }}>
                        {approvalLabel(ap.type)}
                      </div>
                      <div className="truncate text-[12px]" style={{ color: DS.textFaint }}>
                        {subtitle ?? "Requires your decision"}
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-[8px] px-3 py-1.5 text-[12px] font-medium"
                      style={{ background: DS.surface3, border: `1px solid ${DS.border2}`, color: DS.text }}
                    >
                      Review
                    </span>
                  </button>
                </li>
              );
            }
            const iss = item.issue;
            return (
              <li key={`iss-${iss.id}`} style={rowStyle}>
                <button
                  type="button"
                  onClick={() => goToIssue(iss)}
                  className="flex w-full items-center gap-3 py-3 text-left transition-colors"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: iss.status === "blocked" ? DS.critical : DS.warning }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium" style={{ color: DS.text }}>
                      {iss.title}
                    </div>
                    <div className="flex items-center gap-2 truncate text-[12px]" style={{ color: DS.textFaint }}>
                      <span className="font-mono">{iss.identifier ?? iss.id.slice(0, 8)}</span>
                      <span>·</span>
                      <span className="capitalize">{iss.priority}</span>
                    </div>
                  </div>
                  <span className="shrink-0">
                    <StatusBadge status={iss.status} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {total > visible.length ? (
        <Link
          to={`/${prefix}/approvals`}
          className="mt-3 text-[12px] font-medium hover:underline"
          style={{ color: DS.primary }}
        >
          View all ({total})
        </Link>
      ) : null}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Recent activity                                                            */
/* -------------------------------------------------------------------------- */
function RecentActivity({ companyId, companyPrefix }: { companyId: string; companyPrefix?: string }) {
  const { data: events } = useQuery({
    queryKey: queryKeys.activity(companyId),
    queryFn: () => activityApi.list(companyId, { limit: 8 }),
    enabled: !!companyId,
  });
  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents ?? []) m.set(a.id, a);
    return m;
  }, [agents]);
  const emptyNames = useMemo(() => new Map<string, string>(), []);

  const list = (events ?? []).slice(0, 8);

  return (
    <section style={surfaceCard} className="flex flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>Recent activity</SectionLabel>
        <Link
          to={companyPrefix ? `/${companyPrefix}/activity` : "/activity"}
          className="text-[12px] font-medium hover:underline"
          style={{ color: DS.primary }}
        >
          View all activity
        </Link>
      </div>
      {list.length === 0 ? (
        <p className="text-[13px]" style={{ color: DS.textMuted }}>
          No recent activity.
        </p>
      ) : (
        <div className="-mx-2 flex flex-col">
          {list.map((event, idx) => (
            <div
              key={event.id}
              style={{ borderBottom: idx === list.length - 1 ? "none" : `1px solid ${DS.border}` }}
            >
              <ActivityRow event={event} agentMap={agentMap} entityNameMap={emptyNames} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Home (cockpit)                                                             */
/* -------------------------------------------------------------------------- */
export function Home() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { openNewIssue } = useDialogActions();
  const navigate = useNavigate();
  const companyPrefix = selectedCompany?.issuePrefix;

  useEffect(() => {
    setBreadcrumbs([{ label: "Home" }]);
  }, [setBreadcrumbs]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: approvals } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!, "pending"),
    queryFn: () => approvalsApi.list(selectedCompanyId!, "pending"),
    enabled: !!selectedCompanyId,
  });
  const { data: costSummary } = useQuery({
    queryKey: queryKeys.costs(selectedCompanyId!),
    queryFn: () => costsApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentsActive = useMemo(
    () => (agents ?? []).filter(isAgentOperational).length,
    [agents],
  );
  const tasksInFlight = useMemo(
    () => (issues ?? []).filter((i) => IN_FLIGHT_STATUSES.has(i.status)).length,
    [issues],
  );
  const pendingApprovals = approvals?.length ?? 0;

  const topBlocker = useMemo(() => {
    if ((approvals?.length ?? 0) > 0) {
      return { kind: "approval" as const, approval: approvals![0] };
    }
    const blocked = (issues ?? [])
      .filter((i) => WAITING_ISSUE_STATUSES.has(i.status))
      .sort((a, b) => {
        const p = ISSUE_PRIORITY_WEIGHT[a.priority] - ISSUE_PRIORITY_WEIGHT[b.priority];
        if (p !== 0) return p;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    return blocked[0] ? { kind: "issue" as const, issue: blocked[0] } : null;
  }, [approvals, issues]);

  function resolveTopBlocker() {
    const prefix = companyPrefix ?? "PAP";
    if (!topBlocker) {
      openNewIssue();
      return;
    }
    if (topBlocker.kind === "approval") {
      navigate(`/${prefix}/approvals/${topBlocker.approval.id}`);
    } else {
      navigate(`/${prefix}/issues/${topBlocker.issue.identifier ?? topBlocker.issue.id}`);
    }
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={Target} message="Select a company to view Home." />;
  }
  if (!agents && !issues) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div
      className="flex min-h-full flex-col gap-5 p-8"
      style={{ background: DS.canvas }}
      data-pp-page-v2="home-cockpit"
    >
      {/* Page header */}
      <div>
        <h1 className="text-[32px] font-semibold leading-tight" style={{ color: DS.text }}>
          Home
        </h1>
        <p className="text-[14px]" style={{ color: DS.textMuted }}>
          Command center. Your fleet. Your mission.
        </p>
      </div>

      {/* 1 — Fleet strip */}
      <FleetStrip companyId={selectedCompanyId} companyPrefix={companyPrefix} />

      {/* 2 — Metrics row: exactly four KPI tiles */}
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        <KpiTile
          label="Agents Active"
          value={`${agentsActive}/${agents?.length ?? 0}`}
          sub="Operational (not paused/errored)"
          icon={Bot}
          accent={DS.primary}
          to={companyPrefix ? `/${companyPrefix}/agents` : "/agents"}
        />
        <KpiTile
          label="Tasks in Flight"
          value={`${tasksInFlight}`}
          sub="In progress + in review"
          icon={ListChecks}
          accent={DS.analytics}
          to={companyPrefix ? `/${companyPrefix}/issues` : "/issues"}
        />
        <KpiTile
          label="Spend This Month"
          value={costSummary ? formatUsd(costSummary.spendCents) : "—"}
          sub={
            costSummary && costSummary.budgetCents > 0
              ? `of ${formatUsd(costSummary.budgetCents)} budget`
              : undefined
          }
          icon={DollarSign}
          accent={DS.success}
          to={companyPrefix ? `/${companyPrefix}/costs` : "/costs"}
        />
        <KpiTile
          label="Pending Approvals"
          value={`${pendingApprovals}`}
          sub={pendingApprovals > 0 ? "Need your decision" : "All clear"}
          icon={ClipboardCheck}
          accent={DS.warning}
          to={companyPrefix ? `/${companyPrefix}/approvals` : "/approvals"}
        />
      </div>

      {/* 3 + 4 — Zeus doorway + Waiting on you */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <ZeusDoorway companyId={selectedCompanyId} companyPrefix={companyPrefix} />
        <WaitingOnYou
          companyId={selectedCompanyId}
          companyPrefix={companyPrefix}
          onResolve={resolveTopBlocker}
        />
      </div>

      {/* 5 + 6 — Goals tree + Recent activity */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section style={surfaceCard} className="flex flex-col p-5">
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Goals</SectionLabel>
            <Link
              to={companyPrefix ? `/${companyPrefix}/goals` : "/goals"}
              className="text-[12px] font-medium hover:underline"
              style={{ color: DS.primary }}
            >
              View all goals
            </Link>
          </div>
          {goals && goals.length > 0 ? (
            <div className="[&_.border-border]:border-transparent">
              <GoalTree
                goals={goals}
                goalLink={(goal) =>
                  companyPrefix ? `/${companyPrefix}/goals/${goal.id}` : `/goals/${goal.id}`
                }
              />
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: DS.textMuted }}>
              No goals yet.
            </p>
          )}
        </section>

        <RecentActivity companyId={selectedCompanyId} companyPrefix={companyPrefix} />
      </div>
    </div>
  );
}
