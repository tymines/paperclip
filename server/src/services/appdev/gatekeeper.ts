/**
 * appdev-gatekeeper — deterministic phase-gate mechanics (spec v1.1 Part 3).
 *
 * Design decisions (documented for Tyler's review — see vault doc §4):
 *  - SUPERSEDES the "ponytail" manual pipeline (routes/gate.ts, pipeline_runs/
 *    run_stages). That system stays untouched and running; this one is
 *    app-linked, evidence-ENFORCING (not shadow), and emits typed live events.
 *    gate.ts should be marked legacy once this tab is adopted.
 *  - No LLM anywhere in this file. Queue movement, gate sequencing, kill
 *    switches: deterministic Paperclip code (RAIL-v1 principle).
 *  - No dispatch assumed. Verdicts come from Tyler (board) or are posted back
 *    by the external pipeline through the post-back API. Requeue writes
 *    records; nothing here pretends an agent will pick them up.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  appdevApps,
  appdevGates,
  appdevProofBundles,
  appdevReferencePacks,
  appdevScreens,
  appdevVisualReviews,
  appdevWorkOrders,
} from "@paperclipai/db";
import type { LiveEventType } from "@paperclipai/shared";
import { publishLiveEvent } from "../live-events.js";
import { logger } from "../../middleware/logger.js";

/* ── Canonical value sets (text columns in the schema; law lives here) ────── */

export const APPDEV_PHASES = [
  "idea",
  "spec",
  "design",
  "build",
  "qc",
  "tyler_gate",
  "implement",
  "verify",
  "retro",
  "live",
] as const;
export type AppdevPhase = (typeof APPDEV_PHASES)[number];

export const APPDEV_GATES = [
  "idea_to_spec",
  "spec_to_design",
  "design_to_build",
  "build_to_qc",
  "qc_to_tyler",
  "tyler_to_implement",
  "implement_to_verify",
  "verify_to_retro",
  "retro_to_live",
] as const;
export type AppdevGate = (typeof APPDEV_GATES)[number];

export const GATE_TRANSITIONS: Record<AppdevGate, { from: AppdevPhase; to: AppdevPhase }> = {
  idea_to_spec: { from: "idea", to: "spec" },
  spec_to_design: { from: "spec", to: "design" },
  design_to_build: { from: "design", to: "build" },
  build_to_qc: { from: "build", to: "qc" },
  qc_to_tyler: { from: "qc", to: "tyler_gate" },
  tyler_to_implement: { from: "tyler_gate", to: "implement" },
  implement_to_verify: { from: "implement", to: "verify" },
  verify_to_retro: { from: "verify", to: "retro" },
  retro_to_live: { from: "retro", to: "live" },
};

/** Gates whose `passed` verdict is reserved for Tyler (board actor). */
export const TYLER_ONLY_GATES: readonly AppdevGate[] = [
  "tyler_to_implement",
  "retro_to_live",
];

export const WO_SIZE_DEFAULT_MAX_STEPS: Record<string, number> = {
  s: 40,
  m: 120,
  l: 300,
};

/* ── Migration gating ─────────────────────────────────────────────────────── */

/** Thrown when the gated 0146 migration has not been applied yet. */
export class AppdevMigrationPendingError extends Error {
  constructor() {
    super(
      "appdev_* tables missing — migration 0146_appdev_control_center.sql is written but gated (not applied). Amber state expected.",
    );
    this.name = "AppdevMigrationPendingError";
  }
}

/** Postgres undefined_table (42P01) → typed migration-pending error. */
export function rethrowMigrationPending(err: unknown): never {
  const code =
    (err as { code?: string })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code;
  if (code === "42P01") throw new AppdevMigrationPendingError();
  throw err;
}

/* ── Evidence rules (spec 3.1.2) ──────────────────────────────────────────── */

export interface EvidenceCheck {
  ok: boolean;
  /** Machine-readable missing-evidence identifiers (stable; UI renders them). */
  missing: string[];
  /** Human notes collected during the check. */
  notes: string[];
}

/**
 * Deterministic evidence check for a gate on an app. Read-only.
 * Exported for UI preflight: the Tyler queue disables Approve and shows
 * exactly what's missing — "the UI physically cannot pass an unproven gate."
 */
export async function checkGateEvidence(
  db: Db,
  companyId: string,
  appId: string,
  gate: AppdevGate,
): Promise<EvidenceCheck> {
  const missing: string[] = [];
  const notes: string[] = [];

  try {
    switch (gate) {
      case "design_to_build": {
        // Approved reference pack (approved_by='tyler') covering every screen_tag.
        const packs = await db
          .select()
          .from(appdevReferencePacks)
          .where(and(eq(appdevReferencePacks.appId, appId), eq(appdevReferencePacks.approvedBy, "tyler")))
          .orderBy(desc(appdevReferencePacks.createdAt));
        if (packs.length === 0) {
          missing.push("approved_reference_pack");
          break;
        }
        const screens = await db
          .select({ screenTag: appdevScreens.screenTag })
          .from(appdevScreens)
          .where(eq(appdevScreens.appId, appId));
        const covered = new Set<string>();
        for (const p of packs) {
          for (const item of p.items ?? []) {
            const tag = (item as Record<string, unknown>).screen_tag;
            if (typeof tag === "string") covered.add(tag);
          }
        }
        const uncovered = screens.map((s) => s.screenTag).filter((t) => !covered.has(t));
        if (screens.length === 0) {
          missing.push("screen_inventory");
          notes.push("No appdev_screens rows declared for this app.");
        }
        if (uncovered.length > 0) {
          missing.push("reference_pack_screen_coverage");
          notes.push(`Screens without reference coverage: ${uncovered.join(", ")}`);
        }
        break;
      }
      case "build_to_qc": {
        // Proof bundle kind build+test AND screenshot_set (w/ self_check) for
        // every UI work order currently awaiting review on this app.
        const wos = await db
          .select()
          .from(appdevWorkOrders)
          .where(
            and(
              eq(appdevWorkOrders.appId, appId),
              inArray(appdevWorkOrders.status, ["awaiting_review", "in_progress"]),
            ),
          );
        const woIds = wos.map((w) => w.id);
        const bundles = woIds.length
          ? await db
              .select()
              .from(appdevProofBundles)
              .where(inArray(appdevProofBundles.workOrderId, woIds))
          : [];
        const kindsByWo = new Map<string, Set<string>>();
        const selfCheckByWo = new Map<string, boolean>();
        for (const b of bundles) {
          if (!b.workOrderId) continue;
          if (!kindsByWo.has(b.workOrderId)) kindsByWo.set(b.workOrderId, new Set());
          kindsByWo.get(b.workOrderId)!.add(b.kind);
          if (b.kind === "screenshot_set" && b.selfCheck && Object.keys(b.selfCheck).length > 0) {
            selfCheckByWo.set(b.workOrderId, true);
          }
        }
        for (const wo of wos) {
          const kinds = kindsByWo.get(wo.id) ?? new Set();
          if (!kinds.has("build") && !kinds.has("test")) {
            missing.push(`proof_bundle_build_test:${wo.code}`);
          }
          if (wo.touchesUi) {
            if (!kinds.has("screenshot_set")) missing.push(`screenshot_set:${wo.code}`);
            else if (!selfCheckByWo.get(wo.id)) missing.push(`self_check:${wo.code}`);
          }
        }
        if (wos.length === 0) notes.push("No open work orders in review scope.");
        break;
      }
      case "qc_to_tyler": {
        // Passing visual_review for every UI work order in the batch.
        const wos = await db
          .select()
          .from(appdevWorkOrders)
          .where(
            and(
              eq(appdevWorkOrders.appId, appId),
              eq(appdevWorkOrders.touchesUi, true),
              inArray(appdevWorkOrders.status, ["awaiting_review"]),
            ),
          );
        for (const wo of wos) {
          const reviews = await db
            .select()
            .from(appdevVisualReviews)
            .where(eq(appdevVisualReviews.workOrderId, wo.id))
            .orderBy(desc(appdevVisualReviews.createdAt))
            .limit(1);
          const latest = reviews[0];
          if (!latest) missing.push(`visual_review:${wo.code}`);
          else if (latest.verdict === "fail") {
            missing.push(`visual_review_pass:${wo.code}`);
            notes.push(`${wo.code} latest VFG verdict: fail (worst: ${latest.worstScreen ?? "?"})`);
          } else if (latest.verdict === "borderline") {
            notes.push(`${wo.code} VFG borderline — surfaces amber at Tyler Gate (allowed through qc).`);
          }
        }
        break;
      }
      case "verify_to_retro": {
        // Release row at released status + post-deploy screenshot_set. Checked
        // via evidence payload links until the release train lands (Phase 6+).
        notes.push(
          "Release-train evidence (release=released + post-deploy screenshot_set) — release records land in a later phase; attach evidence links manually until then.",
        );
        break;
      }
      default:
        // idea→spec, spec→design, tyler→implement, implement→verify, retro→live:
        // no machine-checkable evidence in v1 — human judgment gates.
        break;
    }
  } catch (err) {
    rethrowMigrationPending(err);
  }

  return { ok: missing.length === 0, missing, notes };
}

/* ── Gate passage (spec 3.1) ──────────────────────────────────────────────── */

export interface GateDecisionInput {
  companyId: string;
  appId: string;
  gate: AppdevGate;
  verdict: "passed" | "failed" | "changes_requested";
  reviewer: string; // agent name or 'tyler'
  actorType: "board" | "agent" | "user";
  evidence?: Record<string, unknown>;
  comments?: string;
  /** Admin override: skip evidence enforcement. Requires reason. Logged. */
  overrideReason?: string;
}

export class GateRefusedError extends Error {
  constructor(
    message: string,
    public readonly details: { missing?: string[]; notes?: string[] } = {},
  ) {
    super(message);
    this.name = "GateRefusedError";
  }
}

function emit(companyId: string, type: LiveEventType, payload: Record<string, unknown>) {
  try {
    publishLiveEvent({ companyId, type, payload });
  } catch (err) {
    logger.warn({ err, type }, "appdev-gatekeeper event emit failed");
  }
}

/**
 * The only legal way an app changes phase (spec 3.1.1). Inserts the gate row,
 * enforces evidence, moves the app, requeues WOs on changes_requested.
 */
export async function decideGate(db: Db, input: GateDecisionInput) {
  const transition = GATE_TRANSITIONS[input.gate];
  if (!transition) throw new GateRefusedError(`Unknown gate: ${input.gate}`);

  let app: typeof appdevApps.$inferSelect | undefined;
  try {
    [app] = await db
      .select()
      .from(appdevApps)
      .where(and(eq(appdevApps.id, input.appId), eq(appdevApps.companyId, input.companyId)))
      .limit(1);
  } catch (err) {
    rethrowMigrationPending(err);
  }
  if (!app) throw new GateRefusedError("App not found");
  if (app.status === "killed") throw new GateRefusedError("App is killed — no gate movement");
  if (app.phase !== transition.from) {
    throw new GateRefusedError(
      `Gate ${input.gate} requires phase '${transition.from}' but app is at '${app.phase}'`,
    );
  }
  if (
    input.verdict === "passed" &&
    TYLER_ONLY_GATES.includes(input.gate) &&
    input.actorType !== "board"
  ) {
    throw new GateRefusedError(`Gate ${input.gate} passage is reserved for Tyler (board actor)`);
  }

  // Evidence enforcement — the gatekeeper refuses a passed verdict when
  // required evidence is missing (spec 3.1.2). Override requires a reason.
  let evidenceCheck: EvidenceCheck = { ok: true, missing: [], notes: [] };
  if (input.verdict === "passed") {
    evidenceCheck = await checkGateEvidence(db, input.companyId, input.appId, input.gate);
    if (!evidenceCheck.ok && !input.overrideReason) {
      throw new GateRefusedError("Gate pass refused — required evidence missing", {
        missing: evidenceCheck.missing,
        notes: evidenceCheck.notes,
      });
    }
  }

  const evidence: Record<string, unknown> = {
    ...(input.evidence ?? {}),
    evidence_check: evidenceCheck,
    ...(input.overrideReason
      ? { override_reason: input.overrideReason, override_by: input.reviewer }
      : {}),
  };

  const [gateRow] = await db
    .insert(appdevGates)
    .values({
      companyId: input.companyId,
      appId: input.appId,
      gate: input.gate,
      verdict: input.verdict,
      reviewer: input.reviewer,
      evidence,
      comments: input.comments ?? null,
      decidedAt: new Date(),
    })
    .returning();

  if (input.overrideReason) {
    logger.warn(
      { appId: input.appId, gate: input.gate, reviewer: input.reviewer, reason: input.overrideReason },
      "appdev gate passed with admin override",
    );
  }

  if (input.verdict === "passed") {
    await db
      .update(appdevApps)
      .set({ phase: transition.to, updatedAt: new Date() })
      .where(eq(appdevApps.id, input.appId));
    emit(input.companyId, "appdev.gate.passed", {
      appId: input.appId,
      gate: input.gate,
      from: transition.from,
      to: transition.to,
      gateId: gateRow.id,
      reviewer: input.reviewer,
    });
  } else {
    emit(input.companyId, "appdev.gate.failed", {
      appId: input.appId,
      gate: input.gate,
      verdict: input.verdict,
      gateId: gateRow.id,
      reviewer: input.reviewer,
    });
    if (input.verdict === "changes_requested") {
      // 3.1.3 — comments write back onto open WOs, which flip and requeue.
      const open = await db
        .select()
        .from(appdevWorkOrders)
        .where(
          and(
            eq(appdevWorkOrders.appId, input.appId),
            inArray(appdevWorkOrders.status, ["awaiting_review", "in_progress"]),
          ),
        );
      for (const wo of open) {
        const criteria = wo.acceptanceCriteria ?? [];
        await db
          .update(appdevWorkOrders)
          .set({
            status: "changes_requested",
            acceptanceCriteria: [
              ...criteria,
              {
                criterion_id: `gate-comment-${gateRow.id.slice(0, 8)}`,
                text: `[gate ${input.gate} — ${input.reviewer}] ${input.comments ?? "(no comment)"}`,
                kind: "gate_comment",
              },
            ],
            updatedAt: new Date(),
          })
          .where(eq(appdevWorkOrders.id, wo.id));
        emit(input.companyId, "appdev.wo.requeued", {
          appId: input.appId,
          workOrderId: wo.id,
          code: wo.code,
          gateId: gateRow.id,
        });
      }
    }
  }

  emit(input.companyId, "appdev.queue.updated", { appId: input.appId });
  return { gate: gateRow, evidenceCheck, phase: input.verdict === "passed" ? transition.to : app.phase };
}

/* ── Kill switches (spec Part 8; RAIL-v1 semantics, deterministic) ────────── */

export async function killApp(db: Db, companyId: string, appId: string, reason: string, by: string) {
  try {
    await db
      .update(appdevApps)
      .set({ status: "killed", updatedAt: new Date() })
      .where(and(eq(appdevApps.id, appId), eq(appdevApps.companyId, companyId)));
    await db
      .update(appdevWorkOrders)
      .set({ status: "killed", updatedAt: new Date() })
      .where(
        and(
          eq(appdevWorkOrders.appId, appId),
          inArray(appdevWorkOrders.status, ["draft", "queued", "planning", "in_progress", "awaiting_review", "changes_requested"]),
        ),
      );
  } catch (err) {
    rethrowMigrationPending(err);
  }
  logger.info({ appId, reason, by }, "appdev app killed");
  emit(companyId, "appdev.app.killed", { appId, reason, by });
}

/* ── Waiting-on-Tyler queue (spec 1.1 / Part 7) ───────────────────────────── */

export interface TylerQueueItem {
  kind: "gate" | "plan_escalation";
  appId: string;
  appName: string;
  appSlug: string;
  phase: string;
  id: string;
  title: string;
  createdAt: Date;
  detail: Record<string, unknown>;
}

/** Everything awaiting Tyler, oldest first. The loudest state in the UI. */
export async function tylerQueue(db: Db, companyId: string): Promise<TylerQueueItem[]> {
  const items: TylerQueueItem[] = [];
  try {
    const apps = await db
      .select()
      .from(appdevApps)
      .where(and(eq(appdevApps.companyId, companyId), eq(appdevApps.status, "active")));
    const byId = new Map(apps.map((a) => [a.id, a]));

    // Apps sitting at tyler_gate with no decided tyler_to_implement gate row.
    for (const app of apps) {
      if (app.phase === "tyler_gate") {
        const evidence = await checkGateEvidence(db, companyId, app.id, "tyler_to_implement");
        items.push({
          kind: "gate",
          appId: app.id,
          appName: app.name,
          appSlug: app.slug,
          phase: app.phase,
          id: `gate:${app.id}:tyler_to_implement`,
          title: `${app.name} — Tyler Gate review`,
          createdAt: app.updatedAt,
          detail: { gate: "tyler_to_implement", evidence },
        });
      }
    }

    // Escalated plans (3.4) — plan_status=escalated on live WOs.
    const escalated = await db
      .select()
      .from(appdevWorkOrders)
      .where(
        and(eq(appdevWorkOrders.companyId, companyId), eq(appdevWorkOrders.planStatus, "escalated")),
      );
    for (const wo of escalated) {
      const app = byId.get(wo.appId);
      if (!app) continue;
      items.push({
        kind: "plan_escalation",
        appId: wo.appId,
        appName: app.name,
        appSlug: app.slug,
        phase: app.phase,
        id: `plan:${wo.id}`,
        title: `${wo.code} — plan escalated (confidence below threshold or critique flags)`,
        createdAt: wo.updatedAt,
        detail: { workOrderId: wo.id, code: wo.code, plan: wo.plan ?? null },
      });
    }
  } catch (err) {
    rethrowMigrationPending(err);
  }
  // Oldest FIRST (spec Part 7): the queue surfaces what has been blocked on
  // Tyler the longest.