import { useMemo, useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CircleDot, Clock, AlertTriangle, CheckCircle2, RotateCcw, User,
  ArrowRight, ThumbsUp, ThumbsDown, FileText, Image, Code,
  Link2, FileJson, ChevronDown, ChevronUp, ExternalLink,
} from "lucide-react";
import type { Issue, Approval, EvidenceEntry } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { approvalsApi } from "../api/approvals";
import { relativeTime } from "../lib/utils";

const DS = {
  surface: "#0D131D",
  surface2: "#111926",
  surface3: "#172131",
  border: "#1C2635",
  border2: "#263246",
  text: "#F5F8FF",
  textMuted: "#A3B0C2",
  textFaint: "#68758A",
  primary: "#3B82FF",
  success: "#2FE38A",
  warning: "#F4B940",
  critical: "#FF5B5B",
  automation: "#A56EFF",
} as const;

interface TasksKanbanProps {
  issues: Issue[];
  onIssueClick: (issueId: string) => void;
  onStatusChange: (issueId: string, newStatus: string) => void;
  approvals?: Approval[];
}

const COLUMNS = [
  { id: "backlog", label: "Backlog", icon: CircleDot, color: DS.textFaint, statuses: ["backlog"] },
  { id: "in_progress", label: "In Progress", icon: Clock, color: DS.primary, statuses: ["todo", "in_progress"] },
  { id: "in_review", label: "In Review", icon: AlertTriangle, color: DS.warning, statuses: ["in_review"] },
  { id: "needs_approval", label: "Needs Approval", icon: ArrowRight, color: DS.automation, statuses: ["needs_approval"] },
  { id: "done", label: "Done", icon: CheckCircle2, color: DS.success, statuses: ["done"] },
  { id: "changes_requested", label: "Changes Requested", icon: RotateCcw, color: DS.critical, statuses: ["changes_requested", "blocked"] },
] as const;

/** Allowed direct transitions per status. "done" is deliberately excluded from everything except the approve action. */
const ALLOWED_DIRECT_TRANSITIONS: Record<string, string[]> = {
  backlog: ["todo", "cancelled"],
  todo: ["in_progress", "backlog", "cancelled"],
  in_progress: ["in_review", "blocked", "todo", "backlog", "cancelled"],
  in_review: ["blocked", "in_progress", "cancelled"],
  needs_approval: ["changes_requested", "blocked"],
  done: [],
  blocked: ["in_progress", "todo", "cancelled"],
  changes_requested: ["in_progress"],
  cancelled: [],
};

export function TasksKanban({ issues, onIssueClick, onStatusChange, approvals }: TasksKanbanProps) {
  const columnIssues = useMemo(() => {
    const map: Record<string, Issue[]> = {};
    for (const col of COLUMNS) map[col.id] = [];
    for (const issue of issues) {
      for (const col of COLUMNS) {
        if ((col.statuses as readonly string[]).includes(issue.status)) {
          map[col.id].push(issue);
          break;
        }
      }
    }
    return map;
  }, [issues]);

  // Build a map: issueId → pending task_completion approval
  const pendingApprovalByIssueId = useMemo(() => {
    const map = new Map<string, Approval>();
    if (!approvals) return map;
    for (const a of approvals) {
      if (a.type === "task_completion" && (a.status === "pending" || a.status === "revision_requested")) {
        // issueIds are not returned by the API on Approval objects.
        // Map is keyed by approval ID instead; render-time lookup matches
        // via payload-based issue reference.
        map.set(a.id, a);
      }
    }
    return map;
  }, [approvals]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
      {COLUMNS.map((col) => {
        const items = columnIssues[col.id] ?? [];
        const Icon = col.icon;
        return (
          <div
            key={col.id}
            className="flex w-[240px] shrink-0 flex-col rounded-[16px]"
            style={{ background: DS.surface, border: "1px solid " + DS.border }}
          >
            {/* Column header */}
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderBottom: "1px solid " + DS.border }}
            >
              <Icon className="h-4 w-4" style={{ color: col.color }} />
              <span className="text-[12px] font-semibold" style={{ color: DS.text }}>
                {col.label}
              </span>
              <span
                className="ml-auto font-mono text-[11px] tabular-nums rounded px-1.5 py-0.5"
                style={{ background: DS.surface3, color: DS.textFaint }}
              >
                {String(items.length)}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ minHeight: 100 }}>
              {items.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <p className="text-[11px]" style={{ color: DS.textFaint }}>Empty</p>
                </div>
              ) : (
                items.map((issue) => (
                  <KanbanCard
                    key={issue.id}
                    issue={issue}
                    approval={pendingApprovalByIssueId.get(issue.id) ?? null}
                    onClick={() => onIssueClick(issue.id)}
                    onStatusChange={onStatusChange}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  issue,
  approval,
  onClick,
  onStatusChange,
}: {
  issue: Issue;
  approval: Approval | null;
  onClick: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const approveMutation = useMutation({
    mutationFn: (approvalId: string) => approvalsApi.approve(approvalId, "Approved via Kanban board"),
    onSettled: () => setApproving(false),
  });

  const requestRevisionMutation = useMutation({
    mutationFn: ({ approvalId, note }: { approvalId: string; note: string }) =>
      approvalsApi.requestRevision(approvalId, note),
    onSettled: () => setRejecting(false),
  });

  const priorityColor = issue.priority === "critical" ? DS.critical
    : issue.priority === "high" ? DS.warning
    : issue.priority === "medium" ? DS.textFaint
    : DS.textFaint;

  const isNeedsApproval = issue.status === "needs_approval";

  // Extract evidence from approval payload
  const evidenceSummary = approval?.payload?.summary as string | undefined;
  const evidenceItems = (
    approval?.payload?.evidence as EvidenceEntry[] | undefined
  ) ?? [];

  const allowedTransitions = ALLOWED_DIRECT_TRANSITIONS[issue.status] ?? [];

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-[10px] px-3 py-2.5 transition-colors hover:opacity-90"
      style={{ background: DS.surface2, border: "1px solid " + DS.border2 }}
    >
      <p className="mb-1 truncate text-[12px] font-medium" style={{ color: DS.text }}>
        {issue.title}
      </p>
      <div className="flex items-center gap-2 text-[10px]">
        <span style={{ color: priorityColor }}>
          {issue.priority ?? "medium"}
        </span>
        {"assigneeName" in issue && (issue as any).assigneeName && (
          <span className="flex items-center gap-1" style={{ color: DS.textFaint }}>
            <User className="h-3 w-3" />
            {(issue as any).assigneeName}
          </span>
        )}
        {issue.updatedAt && (
          <span className="ml-auto" style={{ color: DS.textFaint }}>
            {relativeTime(new Date(issue.updatedAt))}
          </span>
        )}
      </div>

      {/* ── Anti-over-claiming: Evidence block for Needs Approval cards ── */}
      {isNeedsApproval && (evidenceSummary || evidenceItems.length > 0) && (
        <EvidenceBlock summary={evidenceSummary} items={evidenceItems} />
      )}

      {/* Approve / Request Changes for needs_approval */}
      {isNeedsApproval && approval && (
        <div className="mt-1.5 flex gap-1.5">
          <button
            type="button"
            disabled={approving}
            onClick={(e) => {
              e.stopPropagation();
              setApproving(true);
              approveMutation.mutate(approval.id);
            }}
            className="flex flex-1 items-center justify-center gap-1 rounded-[6px] px-2 py-1.5 text-[10px] font-medium transition-colors"
            style={{ background: `${DS.success}20`, color: DS.success, border: "1px solid " + `${DS.success}40` }}
          >
            <ThumbsUp className="h-3 w-3" />
            <span>{approving ? "..." : "Approve"}</span>
          </button>
          <button
            type="button"
            disabled={rejecting}
            onClick={(e) => {
              e.stopPropagation();
              setRejecting(true);
              const note = window.prompt("Request changes — describe what needs to change:");
              if (note) {
                requestRevisionMutation.mutate({ approvalId: approval.id, note });
              } else {
                setRejecting(false);
              }
            }}
            className="flex flex-1 items-center justify-center gap-1 rounded-[6px] px-2 py-1.5 text-[10px] font-medium transition-colors"
            style={{ background: `${DS.warning}20`, color: DS.warning, border: "1px solid " + `${DS.warning}40` }}
          >
            <ThumbsDown className="h-3 w-3" />
            <span>{rejecting ? "..." : "Changes"}</span>
          </button>
        </div>
      )}

      {/* Status dropdown (restricted — no direct "done" except via approve) */}
      {allowedTransitions.length > 0 && (
        <div className="mt-1.5">
          <select
            value={issue.status}
            onChange={(e) => { e.stopPropagation(); onStatusChange(issue.id, e.target.value); }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-[6px] px-2 py-1 text-[10px] outline-none"
            style={{ background: DS.surface3, border: "1px solid " + DS.border, color: DS.textMuted }}
          >
            <option value={issue.status} disabled>{issue.status.replace(/_/g, " ")}</option>
            {allowedTransitions.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/* ── Anti-over-claiming: Evidence block ────────────────────────────── */

/** Map evidence type to a display icon. */
function evidenceTypeIcon(type: EvidenceEntry["type"]) {
  switch (type) {
    case "screenshot":  return <Image className="h-3 w-3" />;
    case "test_output": return <Code className="h-3 w-3" />;
    case "log":         return <FileJson className="h-3 w-3" />;
    case "link":        return <Link2 className="h-3 w-3" />;
    case "before_after":return <FileText className="h-3 w-3" />;
  }
}

function evidenceTypeLabel(type: EvidenceEntry["type"]) {
  switch (type) {
    case "screenshot":  return "Screenshot";
    case "test_output": return "Test Output";
    case "log":         return "Log";
    case "link":        return "Link";
    case "before_after":return "Before / After";
  }
}

/** Colour token per evidence type. */
function evidenceTypeColor(type: EvidenceEntry["type"]) {
  switch (type) {
    case "screenshot":  return "#A56EFF";  // automation purple
    case "test_output": return "#2FE38A";  // success green
    case "log":         return "#F4B940";  // warning amber
    case "link":        return "#3B82FF";  // primary blue
    case "before_after":return "#FF5B5B";  // critical red
  }
}

function EvidenceBlock({
  summary,
  items,
}: {
  summary: string | undefined;
  items: EvidenceEntry[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 1);

  return (
    <div className="mt-1.5 space-y-1">
      {/* Summary line */}
      {summary && (
        <div
          className="flex items-start gap-1 rounded-[6px] px-2 py-1.5 text-[10px] leading-tight"
          style={{ background: DS.surface3, border: "1px solid " + DS.border, color: DS.textMuted }}
          title={summary}
        >
          <FileText className="mt-px h-3 w-3 shrink-0" style={{ color: DS.automation }} />
          <span className="line-clamp-3">{summary}</span>
        </div>
      )}

      {/* Evidence items */}
      {items.length > 0 && (
        <div className="space-y-1">
          {visible.map((ev, i) => (
            <div
              key={i}
              className="flex items-start gap-1 rounded-[6px] px-2 py-1 text-[10px] leading-tight"
              style={{ background: DS.surface3, border: "1px solid " + DS.border }}
            >
              <span className="mt-px shrink-0" style={{ color: evidenceTypeColor(ev.type) }}>
                {evidenceTypeIcon(ev.type)}
              </span>
              <span className="min-w-0 flex-1 truncate" style={{ color: DS.textMuted }}>
                {ev.label ?? evidenceTypeLabel(ev.type)}:{" "}
                {ev.type === "link" ? (
                  <a
                    href={ev.content}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-dotted"
                    style={{ color: DS.primary }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {ev.content.length > 40
                      ? ev.content.slice(0, 40) + "…"
                      : ev.content}
                    <ExternalLink className="ml-0.5 inline h-2.5 w-2.5" />
                  </a>
                ) : (
                  <span>{ev.content.length > 50 ? ev.content.slice(0, 50) + "…" : ev.content}</span>
                )}
              </span>
            </div>
          ))}
          {items.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="flex w-full items-center justify-center gap-1 rounded-[6px] px-2 py-1 text-[10px] transition-colors"
              style={{ background: DS.surface3, border: "1px solid " + DS.border, color: DS.textFaint }}
            >
              {expanded ? (
                <><ChevronUp className="h-3 w-3" /> Show less</>
              ) : (
                <><ChevronDown className="h-3 w-3" /> {items.length - 1} more evidence items</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
