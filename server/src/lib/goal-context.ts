export interface IssueGoalContext {
  id: string;
  title: string;
  description: string | null;
  level: string;
  status: string;
}

export function applyIssueGoalContext(
  context: Record<string, unknown>,
  issueGoal: IssueGoalContext | null,
): void {
  if (issueGoal) {
    context.goalId = issueGoal.id;
    context.goalTitle = issueGoal.title;
    context.goalDescription = issueGoal.description ?? null;
    context.goalLevel = issueGoal.level;
    context.goalStatus = issueGoal.status;
    return;
  }

  delete context.goalId;
  delete context.goalTitle;
  delete context.goalDescription;
  delete context.goalLevel;
  delete context.goalStatus;
}

export function readIssueGoalTitle(issue: Record<string, unknown>): string | null {
  if (!("goal" in issue)) return null;
  const goal = issue.goal;
  if (!goal || typeof goal !== "object") return null;
  const title = (goal as { title?: unknown }).title;
  return typeof title === "string" ? title : null;
}
