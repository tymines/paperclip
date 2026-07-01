import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals, projects, projectGoals, issues } from "@paperclipai/db";

export interface ProjectizePlanStep {
  label: string;
  duration?: string;
}

export interface ProjectizePlanResult {
  goalId: string;
  projectId: string;
  issueIds: string[];
}

export async function projectizePlan(
  db: Db,
  opts: {
    companyId: string;
    title: string;
    brief?: string;
    steps: ProjectizePlanStep[];
    createdByUserId?: string | null;
    createdByAgentId?: string | null;
  },
): Promise<ProjectizePlanResult> {
  const { companyId, title, brief, steps } = opts;

  const [goal] = await db
    .insert(goals)
    .values({
      companyId,
      title,
      description: brief ?? null,
      level: "project",
      status: "planned",
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      companyId,
      name: title,
      description: brief ?? null,
    })
    .returning();

  await db
    .insert(projectGoals)
    .values({
      projectId: project.id,
      goalId: goal.id,
      companyId,
    })
    .onConflictDoNothing();

  await db
    .update(projects)
    .set({ goalId: goal.id })
    .where(eq(projects.id, project.id));

  const issueIds: string[] = [];
  for (const step of steps) {
    const [issue] = await db
      .insert(issues)
      .values({
        companyId,
        projectId: project.id,
        goalId: goal.id,
        title: step.label,
        status: "backlog",
        priority: "medium",
        createdByUserId: opts.createdByUserId ?? null,
        createdByAgentId: opts.createdByAgentId ?? null,
        originKind: "plan",
      })
      .returning();
    issueIds.push(issue.id);
  }

  return { goalId: goal.id, projectId: project.id, issueIds };
}
