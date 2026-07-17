/**
 * Weekly auto-digest (spec Part 11) — per-app: gate passages, WOs closed,
 * spend, VFG state, waiting-on-Tyler. Deterministic aggregation, no LLM.
 *
 * Delivery: returns markdown; posts to Slack ONLY if APPDEV_SLACK_WEBHOOK_URL
 * is set (incoming-webhook URL for #ai-tech-new). No webhook = no silent
 * failure — the digest is still returned/observable. Scheduling: run
 * on-demand via the route, or wire APPDEV_WEEKLY_DIGEST=1 to the in-process
 * timer (Sundays). No new scheduler infrastructure invented.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  appdevApps,
  appdevGates,
  appdevVisualReviews,
  appdevWorkOrders,
} from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import { rethrowMigrationPending, tylerQueue } from "./gatekeeper.js";

export async function buildWeeklyDigest(db: Db, companyId: string): Promise<string> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const lines: string[] = [`*App Dev weekly digest* — ${new Date().toISOString().slice(0, 10)}`];
  try {
    const apps = await db.select().from(appdevApps).where(eq(appdevApps.companyId, companyId));
    const queue = await tylerQueue(db, companyId);
    lines.push(`Waiting on Tyler: *${queue.length}*${queue.length ? ` — oldest: ${queue[0].title}` : ""}`);
    for (const app of apps) {
      const gates = await db
        .select()
        .from(appdevGates)
        .where(and(eq(appdevGates.appId, app.id), gte(appdevGates.createdAt, since)));
      const wos = await db.select().from(appdevWorkOrders).where(eq(appdevWorkOrders.appId, app.id));
      const closed = wos.filter((w) => w.status === "done" && w.updatedAt >= since).length;
      const spend = wos.reduce((s, w) => s + Number(w.costUsd || 0), 0);
      const [latestVfg] = await db
        .select()
        .from(appdevVisualReviews)
        .where(eq(appdevVisualReviews.appId, app.id))
        .orderBy(desc(appdevVisualReviews.createdAt))
        .limit(1);
      lines.push(
        [
          `• *${app.name}* [${app.phase}${app.status !== "active" ? ` · ${app.status}` : ""}]`,
          `gates: ${gates.filter((g) => g.verdict === "passed").length} passed / ${gates.filter((g) => g.verdict !== "passed").length} other`,
          `WOs closed: ${closed}`,
          `spend to date: $${spend.toFixed(2)}`,
          `VFG: ${latestVfg ? latestVfg.verdict : "no reviews"}`,
        ].join(" · "),
      );
    }
    if (apps.length === 0) lines.push("_No apps in the pipeline._");
  } catch (err) {
    rethrowMigrationPending(err);
  }
  return lines.join("\n");
}

export async function postDigest(db: Db, companyId: string): Promise<{ markdown: string; slack: "posted" | "skipped" | "failed" }> {
  const markdown = await buildWeeklyDigest(db, companyId);
  const hook = process.env.APPDEV_SLACK_WEBHOOK_URL;
  if (!hook) return { markdown, slack: "skipped" };
  try {
    const resp = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: markdown }),
    });
    return { markdown, slack: resp.ok ? "posted" : "failed" };
  } catch (err) {
    logger.warn({ err }, "appdev digest slack post failed");
    return { markdown, slack: "failed" };
  }
}

/** Opt-in Sunday timer. Call once at boot; no-op unless APPDEV_WEEKLY_DIGEST=1. */
export function registerDigestTimer(db: Db, companyIds: () => Promise<string[]>) {
  if (process.env.APPDEV_WEEKLY_DIGEST !== "1") return;
  const DAY = 24 * 3600 * 1000;
  let lastRun = "";
  setInterval(async () => {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    if (now.getDay() !== 0 || lastRun === stamp) return; // Sundays, once
    lastRun = stamp;
    try {
      for (const id of await companyIds()) await postDigest(db, id);
    } catch (err) {
      logger.warn({ err }, "appdev weekly digest run failed");
    }
  }, DAY / 24).unref?.();
}
