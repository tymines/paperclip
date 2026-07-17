/**
 * Feedback ingestion + triage auto-draft (spec Part 6).
 *
 * Deterministic core, LLM garnish: dedupe/severity/lane are heuristic code
 * that always works; nothing here blocks on a model or on dispatch. The
 * auto-draft produces a DRAFT work order only — "Tyler's action collapses
 * from compose to approve/edit/dismiss." Nothing auto-queues.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  appdevAssets,
  appdevFeedbackItems,
  appdevScreens,
  appdevWorkOrders,
} from "@paperclipai/db";
import { rethrowMigrationPending } from "./gatekeeper.js";

/* ── Sentry payload normalization ─────────────────────────────────────────── */

export interface NormalizedFeedback {
  source: "sentry" | "manual" | "testflight" | "appstore_review" | "in_app";
  externalId: string | null;
  title: string;
  body: string;
  severity: "p0" | "p1" | "p2" | "p3";
  clusterKey: string | null;
  raw: Record<string, unknown>;
}

/** Sentry webhook (issue alert / event alert shapes both carry event+issue). */
export function normalizeSentry(payload: Record<string, unknown>): NormalizedFeedback {
  const data = (payload.data ?? payload) as Record<string, unknown>;
  const event = (data.event ?? data.issue ?? data) as Record<string, unknown>;
  const issueId = String(
    (data.issue as Record<string, unknown> | undefined)?.id ?? event.issue_id ?? event.groupID ?? payload.id ?? "",
  ) || null;
  const level = String(event.level ?? "error").toLowerCase();
  const title = String(event.title ?? event.message ?? event.culprit ?? "Sentry event").slice(0, 300);
  const severity: NormalizedFeedback["severity"] =
    level === "fatal" ? "p0" : level === "error" ? "p1" : level === "warning" ? "p2" : "p3";
  return {
    source: "sentry",
    externalId: issueId,
    title,
    body: [
      event.culprit ? `culprit: ${event.culprit}` : "",
      event.location ? `location: ${event.location}` : "",
      event.web_url ? `sentry: ${event.web_url}` : "",
    ].filter(Boolean).join("\n"),
    severity,
    clusterKey: issueId,
    raw: payload,
  };
}

/* ── Ingest (dedupe via unique index) ─────────────────────────────────────── */

export async function ingestFeedback(
  db: Db,
  companyId: string,
  appId: string,
  fb: NormalizedFeedback,
): Promise<{ item: typeof appdevFeedbackItems.$inferSelect | null; deduped: boolean }> {
  try {
    const rows = await db
      .insert(appdevFeedbackItems)
      .values({
        companyId,
        appId,
        source: fb.source,
        externalId: fb.externalId,
        severity: fb.severity,
        title: fb.title,
        body: fb.body || null,
        raw: fb.raw,
        clusterKey: fb.clusterKey,
        status: "new",
      })
      .onConflictDoNothing()
      .returning();
    return { item: rows[0] ?? null, deduped: rows.length === 0 };
  } catch (err) {
    rethrowMigrationPending(err);
  }
  return { item: null, deduped: false };
}

/* ── Auto-draft (spec 6: "pre-draft the work order") ──────────────────────── */

const VISUAL_WORDS = /\b(look|looks|color|colour|palette|layout|align|font|ugly|render|visual|icon|blurry|overlap|cut ?off)\b/i;

export async function autoDraftFromFeedback(
  db: Db,
  item: typeof appdevFeedbackItems.$inferSelect,
): Promise<typeof appdevWorkOrders.$inferSelect | null> {
  try {
    const text = `${item.title}\n${item.body ?? ""}`;
    const isVisual = VISUAL_WORDS.test(text);
    const isCrash = item.source === "sentry" || /crash|exception|fatal|freeze|hang/i.test(text);
    const lane = isVisual && !isCrash ? "design" : "code";

    // Visual complaints auto-attach the mentioned screen's baseline + latest
    // screenshot as acceptance context (spec 6).
    const attachments: Array<Record<string, unknown>> = [];
    if (isVisual) {
      const screens = await db.select().from(appdevScreens).where(eq(appdevScreens.appId, item.appId));
      const mentioned = screens.filter((s) => text.toLowerCase().includes(s.screenTag.replace(/_/g, " ")) || text.includes(s.screenTag));
      for (const s of mentioned.slice(0, 3)) {
        const [latestShot] = await db
          .select()
          .from(appdevAssets)
          .where(and(eq(appdevAssets.appId, item.appId), eq(appdevAssets.kind, "screenshot")))
          .orderBy(desc(appdevAssets.createdAt))
          .limit(1);
        attachments.push({
          screen_tag: s.screenTag,
          baseline_asset_id: s.baselineAssetId,
          latest_screenshot_asset_id: latestShot?.id ?? null,
        });
      }
    }

    const existing = await db
      .select({ id: appdevWorkOrders.id })
      .from(appdevWorkOrders)
      .where(eq(appdevWorkOrders.appId, item.appId));
    const codePrefix = "FB";
    const [wo] = await db
      .insert(appdevWorkOrders)
      .values({
        companyId: item.companyId,
        appId: item.appId,
        code: `${codePrefix}-WO-${existing.length + 1}-${item.id.slice(0, 4)}`,
        type: isCrash ? "bug" : isVisual ? "design" : "bug",
        lane,
        objective: `[auto-draft from ${item.source} ${item.severity}] ${item.title}`,
        acceptanceCriteria: [
          { criterion_id: "fb-1", text: `Resolves feedback: ${item.title}`, kind: "feedback" },
          { criterion_id: "fb-2", text: item.body ?? "(no body)", kind: "context" },
          ...(attachments.length ? [{ criterion_id: "fb-3", kind: "visual_context", attachments }] : []),
        ],
        touchesUi: false, // draft default — composer enforcement applies if flipped to UI work
        sizeClass: item.severity === "p0" ? "m" : "s",
        planStatus: item.severity === "p0" ? "pending" : "not_required",
        status: "draft",
        sourceFeedbackId: item.id,
      })
      .returning();

    await db
      .update(appdevFeedbackItems)
      .set({ status: "auto_drafted", convertedWorkOrderId: wo.id })
      .where(eq(appdevFeedbackItems.id, item.id));
    return wo;
  } catch (err) {
    rethrowMigrationPending(err);
  }
  return null;
}
