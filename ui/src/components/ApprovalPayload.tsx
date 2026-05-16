import { UserPlus, Lightbulb, ShieldAlert, ShieldCheck, Target, CheckCircle2 } from "lucide-react";
import { formatCents } from "../lib/utils";

export const typeLabel: Record<string, string> = {
  hire_agent: "Hire Agent",
  approve_ceo_strategy: "CEO Strategy",
  budget_override_required: "Budget Override",
  goal_plan: "Goal Plan",
  goal_completion: "Goal Completion",
};

/** Build a contextual label for an approval, e.g. "Hire Agent: Designer" */
export function approvalLabel(type: string, payload?: Record<string, unknown> | null): string {
  const base = typeLabel[type] ?? type;
  if (type === "hire_agent" && payload?.name) {
    return `${base}: ${String(payload.name)}`;
  }
  if ((type === "goal_plan" || type === "goal_completion") && payload?.goalTitle) {
    return `${base}: ${String(payload.goalTitle)}`;
  }
  return base;
}

export const typeIcon: Record<string, typeof UserPlus> = {
  hire_agent: UserPlus,
  approve_ceo_strategy: Lightbulb,
  budget_override_required: ShieldAlert,
  goal_plan: Target,
  goal_completion: CheckCircle2,
};

export const defaultTypeIcon = ShieldCheck;

function PayloadField({ label, value }: { label: string; value: unknown }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">{label}</span>
      <span>{String(value)}</span>
    </div>
  );
}

function SkillList({ values }: { values: unknown }) {
  if (!Array.isArray(values)) return null;
  const items = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  if (items.length === 0) return null;

  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Skills</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

type AgentAssignment = {
  agentId?: string | null;
  agentName?: string | null;
  role?: string | null;
  task?: string | null;
  notes?: string | null;
};

function isAgentAssignment(value: unknown): value is AgentAssignment {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function AgentAssignmentList({ values }: { values: unknown }) {
  if (!Array.isArray(values)) return null;
  const assignments = values.filter(isAgentAssignment);
  if (assignments.length === 0) return null;

  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Assignments</span>
      <div className="flex flex-col gap-1.5 flex-1">
        {assignments.map((assignment, idx) => {
          const label = assignment.agentName ?? assignment.agentId ?? "—";
          const detail = assignment.role ?? assignment.task ?? null;
          return (
            <div
              key={`${assignment.agentId ?? idx}-${idx}`}
              className="rounded border border-border/60 bg-muted/30 px-2 py-1 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{String(label)}</span>
                {detail && (
                  <span className="text-muted-foreground">· {String(detail)}</span>
                )}
              </div>
              {assignment.notes && (
                <div className="mt-0.5 text-muted-foreground/90">{String(assignment.notes)}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProjectList({ values }: { values: unknown }) {
  if (!Array.isArray(values)) return null;
  const items = values.filter(
    (value): value is { id?: string; name?: string; description?: string } =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value),
  );
  if (items.length === 0) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Projects</span>
      <div className="flex flex-col gap-1 flex-1">
        {items.map((item, idx) => (
          <div key={item.id ?? idx} className="text-xs">
            <span className="font-medium">{item.name ?? "Unnamed project"}</span>
            {item.description && (
              <span className="text-muted-foreground"> · {item.description}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SubgoalList({ values }: { values: unknown }) {
  if (!Array.isArray(values)) return null;
  const items = values.filter(
    (value): value is { id?: string; title?: string; description?: string } =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value),
  );
  if (items.length === 0) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Subgoals</span>
      <div className="flex flex-col gap-1 flex-1">
        {items.map((item, idx) => (
          <div key={item.id ?? idx} className="text-xs">
            <span className="font-medium">{item.title ?? "Untitled"}</span>
            {item.description && (
              <span className="text-muted-foreground"> · {item.description}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HireAgentPayload({ payload }: { payload: Record<string, unknown> }) {
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">Name</span>
        <span className="font-medium">{String(payload.name ?? "—")}</span>
      </div>
      <PayloadField label="Role" value={payload.role} />
      <PayloadField label="Title" value={payload.title} />
      <PayloadField label="Icon" value={payload.icon} />
      {!!payload.capabilities && (
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs pt-0.5">Capabilities</span>
          <span className="text-muted-foreground">{String(payload.capabilities)}</span>
        </div>
      )}
      {!!payload.adapterType && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground w-20 sm:w-24 shrink-0 text-xs">Adapter</span>
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
            {String(payload.adapterType)}
          </span>
        </div>
      )}
      <SkillList values={payload.desiredSkills} />
    </div>
  );
}

export function CeoStrategyPayload({ payload }: { payload: Record<string, unknown> }) {
  const plan = payload.plan ?? payload.description ?? payload.strategy ?? payload.text;
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Title" value={payload.title} />
      {!!plan && (
        <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">
          {String(plan)}
        </div>
      )}
      {!plan && (
        <pre className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground overflow-x-auto max-h-48">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function BudgetOverridePayload({ payload }: { payload: Record<string, unknown> }) {
  const budgetAmount = typeof payload.budgetAmount === "number" ? payload.budgetAmount : null;
  const observedAmount = typeof payload.observedAmount === "number" ? payload.observedAmount : null;
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Scope" value={payload.scopeName ?? payload.scopeType} />
      <PayloadField label="Window" value={payload.windowKind} />
      <PayloadField label="Metric" value={payload.metric} />
      {(budgetAmount !== null || observedAmount !== null) ? (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Limit {budgetAmount !== null ? formatCents(budgetAmount) : "—"} · Observed {observedAmount !== null ? formatCents(observedAmount) : "—"}
        </div>
      ) : null}
      {!!payload.guidance && (
        <p className="text-muted-foreground">{String(payload.guidance)}</p>
      )}
    </div>
  );
}

export function GoalPlanPayload({ payload }: { payload: Record<string, unknown> }) {
  const summary = payload.planSummary ?? payload.summary ?? payload.plan ?? null;
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Goal" value={payload.goalTitle} />
      <PayloadField label="Level" value={payload.goalLevel} />
      <PayloadField label="Review" value={payload.reviewPolicy} />
      {!!summary && (
        <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">
          {String(summary)}
        </div>
      )}
      <SubgoalList values={payload.subgoals} />
      <ProjectList values={payload.projects} />
      <AgentAssignmentList values={payload.agentAssignments} />
    </div>
  );
}

export function GoalCompletionPayload({ payload }: { payload: Record<string, unknown> }) {
  const evidence = payload.evidence ?? payload.summary ?? payload.completionNotes ?? null;
  const issuesClosed = typeof payload.issuesClosed === "number" ? payload.issuesClosed : null;
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      <PayloadField label="Goal" value={payload.goalTitle} />
      <PayloadField label="Level" value={payload.goalLevel} />
      {issuesClosed !== null && (
        <PayloadField label="Issues" value={`${issuesClosed} closed`} />
      )}
      {!!evidence && (
        <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono text-xs max-h-48 overflow-y-auto">
          {String(evidence)}
        </div>
      )}
      <AgentAssignmentList values={payload.agentAssignments} />
    </div>
  );
}

export function ApprovalPayloadRenderer({ type, payload }: { type: string; payload: Record<string, unknown> }) {
  if (type === "hire_agent") return <HireAgentPayload payload={payload} />;
  if (type === "budget_override_required") return <BudgetOverridePayload payload={payload} />;
  if (type === "goal_plan") return <GoalPlanPayload payload={payload} />;
  if (type === "goal_completion") return <GoalCompletionPayload payload={payload} />;
  return <CeoStrategyPayload payload={payload} />;
}
