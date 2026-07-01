import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { goals, issues } from "@paperclipai/db";
import { heartbeatService } from "./heartbeat.js";
import { logger } from "../middleware/logger.js";

type ActorType = "user" | "system" | "agent";

type Actor = {
  actorType: string;
  actorId: string | null;
  agentId: string | null;
};

function normalizeActorType(value?: string): ActorType {
  if (value === "user" || value === "agent" || value === "system") return value;
  return "system";
}

function resolveActorMeta(actor?: Actor) {
  return {
    requestedByActorType: normalizeActorType(actor?.actorType),
    requestedByActorId: actor?.actorId ?? null,
  };
}

export async function wakeGoalOwner(
  db: Db,
  goalId: string,
  reason: "goal_activated" | "goal_work_complete",
  opts: { actor?: Actor; payload?: Record<string, unknown> } = {},
) {
  const goal = await db
    .select()
    .from(goals)
    .where(eq(goals.id, goalId))
    .then((rows) => rows[0] ?? null);
  if (!goal) return null;
  if (!goal.ownerAgentId) {
    logger.info({ goalId, reason }, "skipping goal wakeup — no ownerAgentId");
    return null;
  }

  const heartbeat = heartbeatService(db);
  const actorMeta = resolveActorMeta(opts.actor);
  const payload = {
    goalId: goal.id,
    goalTitle: goal.title,
    goalLevel: goal.level,
    goalStatus: goal.status,
    reviewPolicy: goal.reviewPolicy,
    ...(opts.payload ?? {}),
  };

  return heartbeat.wakeup(goal.ownerAgentId, {
    source: "automation",
    triggerDetail: "system",
    reason,
    payload,
    requestedByActorType: actorMeta.requestedByActorType,
    requestedByActorId: actorMeta.requestedByActorId,
    contextSnapshot: { goalId: goal.id, source: `goal.${reason}` },
    idempotencyKey: `goal_${reason}_${goal.id}`,
  });
}

/**
 * After an issue closes, check whether all sibling issues sharing its goal are
 * also closed. If yes, fire goal_work_complete so CEO can mark goal achieved.
 *
 * Why: keeps the "goal status" loop reactive without polling.
 */
export async function detectAndFireGoalWorkComplete(
  db: Db,
  closedIssue: { id: string; companyId: string; status: string; goalId: string | null },
  actor?: Actor,
): Promise<void> {
  if (!closedIssue.goalId) return;
  if (closedIssue.status !== "done" && closedIssue.status !== "cancelled") return;

  const openSibling = await db
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, closedIssue.companyId),
        eq(issues.goalId, closedIssue.goalId),
        ne(issues.status, "done"),
        ne(issues.status, "cancelled"),
      ),
    )
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (openSibling) return;

  await wakeGoalOwner(db, closedIssue.goalId, "goal_work_complete", {
    actor,
    payload: { triggerIssueId: closedIssue.id },
  });
}
