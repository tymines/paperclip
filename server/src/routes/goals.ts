import { Router } from "express";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals, issues, projects, projectGoals } from "@paperclipai/db";
import { createGoalSchema, updateGoalSchema, linkProjectToGoalSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { goalService, logActivity } from "../services/index.js";
import { wakeGoalOwner } from "../services/goal-wakeups.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

export function goalRoutes(db: Db) {
  const router = Router();
  const svc = goalService(db);

  router.get("/companies/:companyId/goals", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.list(companyId);
    res.json(result);
  });

  router.get("/goals/:id", async (req, res) => {
    const id = req.params.id as string;
    const goal = await svc.getById(id);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, goal.companyId);
    res.json(goal);
  });

  router.post("/companies/:companyId/goals", validate(createGoalSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const goal = await svc.create(companyId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.created",
      entityType: "goal",
      entityId: goal.id,
      details: { title: goal.title },
    });

    if (goal.status === "active") {
      await wakeGoalOwner(db, goal.id, "goal_activated", { actor });
    }

    res.status(201).json(goal);
  });

  router.patch("/goals/:id", validate(updateGoalSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const goal = await svc.update(id, req.body);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: goal.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.updated",
      entityType: "goal",
      entityId: goal.id,
      details: req.body,
    });

    if (existing.status !== "active" && goal.status === "active") {
      await wakeGoalOwner(db, goal.id, "goal_activated", { actor });
    }

    res.json(goal);
  });

  router.delete("/goals/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const goal = await svc.remove(id);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: goal.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.deleted",
      entityType: "goal",
      entityId: goal.id,
    });

    res.json(goal);
  });

  router.post("/goals/:id/pursue", async (req, res) => {
    const id = req.params.id as string;
    const goal = await svc.getById(id);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, goal.companyId);

    if (goal.status === "achieved" || goal.status === "cancelled") {
      res.status(409).json({
        error: `Cannot pursue a goal in status '${goal.status}'`,
      });
      return;
    }

    const actor = getActorInfo(req);
    const wakeup = await wakeGoalOwner(db, goal.id, "goal_activated", {
      actor,
      payload: { trigger: "manual_pursue" },
    });

    await logActivity(db, {
      companyId: goal.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.pursued",
      entityType: "goal",
      entityId: goal.id,
      details: { wakeupRequestId: wakeup?.id ?? null },
    });

    res.json({ goal, wakeup });
  });

  router.get("/goals/:id/heartbeat-context", async (req, res) => {
    const id = req.params.id as string;
    const goal = await svc.getById(id);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, goal.companyId);

    const [linkedIssues, linkedProjects, parent, children] = await Promise.all([
      db
        .select({
          id: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
          assigneeAgentId: issues.assigneeAgentId,
        })
        .from(issues)
        .where(and(eq(issues.companyId, goal.companyId), eq(issues.goalId, goal.id))),
      db
        .select({
          id: projects.id,
          name: projects.name,
          status: projects.status,
        })
        .from(projects)
        .innerJoin(projectGoals, eq(projectGoals.projectId, projects.id))
        .where(and(eq(projectGoals.goalId, goal.id), eq(projectGoals.companyId, goal.companyId))),
      goal.parentId
        ? svc.getById(goal.parentId).then((p) => (p ? { id: p.id, title: p.title, status: p.status, level: p.level } : null))
        : Promise.resolve(null),
      db
        .select({ id: goals.id, title: goals.title, status: goals.status, level: goals.level })
        .from(goals)
        .where(and(eq(goals.companyId, goal.companyId), eq(goals.parentId, goal.id))),
    ]);

    const openIssues = linkedIssues.filter((i) => i.status !== "done" && i.status !== "cancelled");
    const closedIssues = linkedIssues.filter((i) => i.status === "done" || i.status === "cancelled");

    res.json({
      goal: {
        id: goal.id,
        title: goal.title,
        description: goal.description,
        level: goal.level,
        status: goal.status,
        reviewPolicy: goal.reviewPolicy,
        ownerAgentId: goal.ownerAgentId,
        parentId: goal.parentId,
        updatedAt: goal.updatedAt,
      },
      parent,
      children,
      projects: linkedProjects,
      issues: {
        total: linkedIssues.length,
        open: openIssues,
        closed: closedIssues,
      },
    });
  });

  router.post("/goals/:id/link-project", validate(linkProjectToGoalSchema), async (req, res) => {
    const id = req.params.id as string;
    const goal = await svc.getById(id);
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    assertCompanyAccess(req, goal.companyId);

    const projectId = req.body.projectId as string;
    const project = await db
      .select({ id: projects.id, companyId: projects.companyId, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .then((rows) => rows[0] ?? null);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.companyId !== goal.companyId) {
      res.status(403).json({ error: "Project belongs to a different company" });
      return;
    }

    await db
      .insert(projectGoals)
      .values({ projectId, goalId: goal.id, companyId: goal.companyId })
      .onConflictDoNothing();

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: goal.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "goal.project_linked",
      entityType: "goal",
      entityId: goal.id,
      details: { projectId, projectName: project.name },
    });

    res.status(201).json({ goalId: goal.id, projectId, companyId: goal.companyId });
  });

  return router;
}
