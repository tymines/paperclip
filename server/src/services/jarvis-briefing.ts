import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  issues,
  projects,
  routineRuns,
  routines,
  agentBridgeReplyAttempts,
} from "@paperclipai/db";
import { getCostWatcherPayload } from "./cost-watcher.js";
import { logger } from "../middleware/logger.js";

/**
 * Daddy's Home briefing payload — the structured snapshot the morning routine
 * hands to Augi as user-message context. Mirrors the persona's "Daily morning
 * briefing" ordering: work first (shipped, blocked, fleet, projects), with the
 * cost surface tucked at the end (only mentioned by Augi when there's an alert
 * or Tyler asks).
 *
 * Every numeric field is best-effort. If a sub-query fails we keep going with
 * the rest — Tyler always gets a briefing, even if one source is broken.
 */
export interface BriefingPayload {
  asOf: string;
  windowHours: number;
  shipped: {
    closedLast12h: number;
    /** Most-recent few titles, capped at 5, used to ground the prose. */
    recentTitles: string[];
  };
  blocked: {
    total: number;
    /** Highest-priority items that have never started — what Augi nudges first. */
    topPriorityNotYetStarted: Array<{
      id: string;
      title: string;
      priority: string;
    }>;
  };
  fleet: {
    total: number;
    active: number;
    errored: number;
    paused: number;
    nearingBudgetCount: number;
    /** Agents at or above 80% of their monthly budget — surface by name. */
    nearingBudgetNames: string[];
  };
  routines: {
    failedLast24h: number;
    successfulLast24h: number;
    /** Routine titles that fired in the window — woven into "what changed". */
    firedTitles: string[];
  };
  projects: {
    activeTotal: number;
    movedLast24h: number;
    /** Names of projects with any completed issue in the window. */
    movedNames: string[];
  };
  costs: {
    mtdUsd: number | null;
    alerts: number;
    topBurnAgentName: string | null;
  };
  bridge: {
    /** agent_bridge_reply_attempts rows in the last 12h with outcome != "ok". */
    failureCount: number;
  };
}

/**
 * Wrap a sub-query so one broken source can't take down the whole briefing.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T, tag: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err, tag }, "jarvis-briefing: sub-query failed");
    return fallback;
  }
}

const WINDOW_MS = 12 * 60 * 60 * 1000;
const PROJECT_WINDOW_MS = 24 * 60 * 60 * 1000;

const HEALTH_CHECK_TITLE_FILTERS = [
  "%daily-health-check%",
  "%bridge-health%",
  "%auto-archive%",
];

export async function gatherBriefingPayload(
  db: Db,
  companyId: string,
): Promise<BriefingPayload> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const projectWindowStart = new Date(now.getTime() - PROJECT_WINDOW_MS);

  const [
    closedRows,
    blockedRows,
    agentRows,
    routineRunRows,
    projectMovedRows,
    activeProjectCount,
    costPayload,
    bridgeFailureRows,
  ] = await Promise.all([
    safe(
      () =>
        db
          .select({
            id: issues.id,
            title: issues.title,
            completedAt: issues.completedAt,
          })
          .from(issues)
          .where(
            and(
              eq(issues.companyId, companyId),
              eq(issues.status, "done"),
              gte(issues.completedAt, windowStart),
              // exclude noise from auto-archived health-check tickets
              sql`(${issues.title} NOT ILIKE ${HEALTH_CHECK_TITLE_FILTERS[0]}
                AND ${issues.title} NOT ILIKE ${HEALTH_CHECK_TITLE_FILTERS[1]}
                AND ${issues.title} NOT ILIKE ${HEALTH_CHECK_TITLE_FILTERS[2]})`,
            ),
          )
          .orderBy(desc(issues.completedAt))
          .limit(50),
      [] as Array<{ id: string; title: string; completedAt: Date | null }>,
      "shipped",
    ),
    safe(
      () =>
        db
          .select({
            id: issues.id,
            title: issues.title,
            priority: issues.priority,
            startedAt: issues.startedAt,
            status: issues.status,
          })
          .from(issues)
          .where(
            and(
              eq(issues.companyId, companyId),
              inArray(issues.status, ["backlog", "todo", "blocked"]),
            ),
          )
          .limit(200),
      [] as Array<{
        id: string;
        title: string;
        priority: string;
        startedAt: Date | null;
        status: string;
      }>,
      "blocked",
    ),
    safe(
      () =>
        db
          .select({
            id: agents.id,
            name: agents.name,
            status: agents.status,
            budgetMonthlyCents: agents.budgetMonthlyCents,
            spentMonthlyCents: agents.spentMonthlyCents,
          })
          .from(agents)
          .where(eq(agents.companyId, companyId)),
      [] as Array<{
        id: string;
        name: string;
        status: string;
        budgetMonthlyCents: number;
        spentMonthlyCents: number;
      }>,
      "fleet",
    ),
    safe(
      () =>
        db
          .select({
            id: routineRuns.id,
            routineId: routineRuns.routineId,
            status: routineRuns.status,
            triggeredAt: routineRuns.triggeredAt,
          })
          .from(routineRuns)
          .where(
            and(
              eq(routineRuns.companyId, companyId),
              gte(routineRuns.triggeredAt, new Date(now.getTime() - PROJECT_WINDOW_MS)),
            ),
          )
          .limit(200),
      [] as Array<{ id: string; routineId: string; status: string; triggeredAt: Date }>,
      "routines",
    ),
    safe(
      () =>
        db
          .selectDistinct({
            projectId: issues.projectId,
          })
          .from(issues)
          .where(
            and(
              eq(issues.companyId, companyId),
              eq(issues.status, "done"),
              gte(issues.completedAt, projectWindowStart),
            ),
          ),
      [] as Array<{ projectId: string | null }>,
      "projects-moved",
    ),
    safe(
      () =>
        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(projects)
          .where(
            and(
              eq(projects.companyId, companyId),
              ne(projects.status, "archived"),
            ),
          )
          .then((rows) => rows[0]?.count ?? 0),
      0,
      "projects-active",
    ),
    safe(() => getCostWatcherPayload(db, companyId), null, "cost-watcher"),
    safe(
      () =>
        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(agentBridgeReplyAttempts)
          .where(
            and(
              eq(agentBridgeReplyAttempts.companyId, companyId),
              ne(agentBridgeReplyAttempts.outcome, "ok"),
              gte(agentBridgeReplyAttempts.createdAt, windowStart),
            ),
          )
          .then((rows) => rows[0]?.count ?? 0),
      0,
      "bridge-failures",
    ),
  ]);

  const movedProjectIds = projectMovedRows
    .map((r) => r.projectId)
    .filter((id): id is string => !!id);
  const movedNames = movedProjectIds.length
    ? await safe(
        () =>
          db
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(inArray(projects.id, movedProjectIds)),
        [] as Array<{ id: string; name: string }>,
        "project-names",
      ).then((rows) => rows.map((r) => r.name))
    : [];

  // Map routine IDs back to titles for the "what fired" line.
  const firedRoutineIds = Array.from(
    new Set(routineRunRows.map((r) => r.routineId).filter(Boolean)),
  );
  const firedTitles = firedRoutineIds.length
    ? await safe(
        () =>
          db
            .select({ id: routines.id, title: routines.title })
            .from(routines)
            .where(inArray(routines.id, firedRoutineIds)),
        [] as Array<{ id: string; title: string }>,
        "routine-titles",
      ).then((rows) => rows.map((r) => r.title).slice(0, 8))
    : [];

  // Fleet bucketing — "active" mirrors the brain's existing definition.
  const fleetActive = agentRows.filter(
    (a) => a.status === "active" || a.status === "running",
  ).length;
  const fleetErrored = agentRows.filter((a) => a.status === "error").length;
  const fleetPaused = agentRows.filter((a) => a.status === "paused").length;

  // Agents at >=80% of their monthly budget — early-warning signal.
  const nearingBudget = agentRows.filter(
    (a) =>
      a.budgetMonthlyCents > 0 &&
      a.spentMonthlyCents / a.budgetMonthlyCents >= 0.8,
  );

  // top_priority_not_yet_started — high/critical/urgent items still in
  // backlog or todo (never started_at, never claimed an execution run).
  // Excludes anything that has been touched, so this stays small and is
  // genuinely the queue Tyler should look at first.
  const topPriorityNotYetStarted = blockedRows
    .filter(
      (r) =>
        (r.priority === "critical" ||
          r.priority === "urgent" ||
          r.priority === "high") &&
        r.startedAt == null,
    )
    .slice(0, 5)
    .map((r) => ({ id: r.id, title: r.title, priority: r.priority }));

  const blockedTotal = blockedRows.filter((r) => r.status === "blocked").length;

  const failedRoutineRuns = routineRunRows.filter(
    (r) => r.status === "failed" || r.status === "error",
  ).length;
  const successfulRoutineRuns = routineRunRows.filter(
    (r) => r.status === "completed" || r.status === "succeeded",
  ).length;

  const costPayloadTyped = costPayload as unknown as
    | {
        totals?: { mtdUsd?: number };
        topAgents?: Array<{ agentName?: string; agentId?: string }>;
        alerts?: unknown[];
      }
    | null;

  return {
    asOf: now.toISOString(),
    windowHours: 12,
    shipped: {
      closedLast12h: closedRows.length,
      recentTitles: closedRows.slice(0, 5).map((r) => r.title),
    },
    blocked: {
      total: blockedTotal,
      topPriorityNotYetStarted,
    },
    fleet: {
      total: agentRows.length,
      active: fleetActive,
      errored: fleetErrored,
      paused: fleetPaused,
      nearingBudgetCount: nearingBudget.length,
      nearingBudgetNames: nearingBudget.slice(0, 3).map((a) => a.name),
    },
    routines: {
      failedLast24h: failedRoutineRuns,
      successfulLast24h: successfulRoutineRuns,
      firedTitles,
    },
    projects: {
      activeTotal: activeProjectCount,
      movedLast24h: movedNames.length,
      movedNames: movedNames.slice(0, 5),
    },
    costs: {
      mtdUsd:
        typeof costPayloadTyped?.totals?.mtdUsd === "number"
          ? costPayloadTyped.totals.mtdUsd
          : null,
      alerts: Array.isArray(costPayloadTyped?.alerts)
        ? costPayloadTyped.alerts.length
        : 0,
      topBurnAgentName:
        costPayloadTyped?.topAgents?.[0]?.agentName ??
        costPayloadTyped?.topAgents?.[0]?.agentId ??
        null,
    },
    bridge: {
      failureCount: bridgeFailureRows,
    },
  };
}

/**
 * Compose the "user message" that we hand to Augi. The persona file gives the
 * voice and tone; this block gives the facts. Mirrors the persona's "Daily
 * morning briefing" ordering: shipped → blocked → fleet → projects → recommend.
 * We deliberately phrase it as the briefing payload Tyler asked for, not as a
 * fake user transcript, so Augi knows it's running the routine, not
 * answering a question.
 */
export function composeBriefingTranscript(
  payload: BriefingPayload,
  source: string,
): string {
  const shippedLine =
    payload.shipped.closedLast12h > 0
      ? `${payload.shipped.closedLast12h} task${payload.shipped.closedLast12h === 1 ? "" : "s"} shipped in the last 12 hours${
          payload.shipped.recentTitles.length > 0
            ? ` (most recent: ${payload.shipped.recentTitles.slice(0, 3).map((t) => `"${t}"`).join(", ")})`
            : ""
        }`
      : "nothing shipped in the last 12 hours";

  const topBlockedLine =
    payload.blocked.topPriorityNotYetStarted.length > 0
      ? `Top priority not yet started: ${payload.blocked.topPriorityNotYetStarted
          .map((b) => `"${b.title}" (${b.priority})`)
          .join(", ")}`
      : "no high-priority items waiting to start";

  const fleetLine = `Fleet: ${payload.fleet.active} of ${payload.fleet.total} agents active${
    payload.fleet.errored > 0 ? `, ${payload.fleet.errored} in error` : ""
  }${payload.fleet.paused > 0 ? `, ${payload.fleet.paused} paused` : ""}${
    payload.fleet.nearingBudgetCount > 0
      ? `, ${payload.fleet.nearingBudgetCount} nearing budget ceiling (${payload.fleet.nearingBudgetNames.join(", ")})`
      : ""
  }`;

  const routinesLine =
    payload.routines.firedTitles.length > 0
      ? `Routines fired in last 24h: ${payload.routines.firedTitles.slice(0, 4).join(", ")}${
          payload.routines.failedLast24h > 0
            ? ` (${payload.routines.failedLast24h} failing — needs attention)`
            : ""
        }`
      : payload.routines.failedLast24h > 0
        ? `${payload.routines.failedLast24h} routine runs failed in the last 24h`
        : "no notable routine activity";

  const projectsLine =
    payload.projects.movedLast24h > 0
      ? `${payload.projects.movedLast24h} project${payload.projects.movedLast24h === 1 ? "" : "s"} moved forward in last 24h${
          payload.projects.movedNames.length > 0
            ? `: ${payload.projects.movedNames.join(", ")}`
            : ""
        }`
      : `${payload.projects.activeTotal} active project${payload.projects.activeTotal === 1 ? "" : "s"}, none moved in the last 24h`;

  const costLine =
    payload.costs.alerts > 0
      ? `${payload.costs.alerts} cost alert${payload.costs.alerts === 1 ? "" : "s"} firing${
          payload.costs.topBurnAgentName ? ` on ${payload.costs.topBurnAgentName}` : ""
        }`
      : "no cost alerts";

  const bridgeLine =
    payload.bridge.failureCount > 0
      ? `${payload.bridge.failureCount} agent-bridge reply failures in the last 12h (worth a glance)`
      : "agent bridge healthy";

  const sourceLine =
    source === "mac-wake"
      ? "Trigger: Mac wake event — Tyler just unlocked the machine, this is his first morning briefing."
      : source === "schedule"
        ? "Trigger: daily 7am scheduled briefing."
        : "Trigger: Tyler hit the Brief-me button.";

  return [
    `Daddy's Home morning briefing — ${sourceLine}`,
    "",
    "OPERATIONS SNAPSHOT (real, current — use these numbers to ground your reply):",
    `- Shipped overnight: ${shippedLine}`,
    `- Blocked work: ${payload.blocked.total} blocked issues. ${topBlockedLine}.`,
    `- ${fleetLine}`,
    `- ${projectsLine}`,
    `- What changed: ${routinesLine}. ${bridgeLine}.`,
    `- Cost surface (mention ONLY if alerts > 0 or Tyler asks): ${costLine}`,
    "",
    "INSTRUCTIONS:",
    "Deliver the briefing in your usual voice — 4 to 6 sentences of prose, lead with work (shipped, blocked, fleet, projects), weave in only the things that actually matter from the snapshot above (do not enumerate every line). End with ONE concrete recommended next action framed as a question Tyler can say yes to. Skip revenue unless an alert is firing.",
  ].join("\n");
}

/**
 * The persona ends every briefing with one next-action sentence — usually a
 * "Want me to ..." question. Pull that last sentence out so the UI can render
 * it as a primary CTA button in the orb center.
 */
export function extractRecommendedAction(reply: string): string {
  const trimmed = reply.trim();
  if (!trimmed) return "";
  const matches = trimmed.match(/[^.!?]+[.!?]+/g);
  if (!matches || matches.length === 0) return trimmed;
  // Find the last sentence that actually proposes an action — prefer one
  // ending in "?" (Augi's CTAs are nearly always questions). Fall back to
  // the final sentence if none qualify.
  for (let i = matches.length - 1; i >= 0; i--) {
    const s = matches[i]?.trim() ?? "";
    if (/[?]/.test(s)) return s;
  }
  return (matches[matches.length - 1] ?? trimmed).trim();
}
